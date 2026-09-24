// @ts-check
/**
 * collect-unsold-kosis.mjs 테스트 — KOSIS 미분양 순수 함수 검증
 *
 * 대상: parseKosisRows, aggregateRegionTotals, calcProportionalUnsold
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const fetchWithRetryMock = vi.fn();

// _shared.mjs 모킹
const selectAllMock = vi.fn();

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    recordApiQuota: vi.fn(),
    recordCollectorRun: vi.fn(),
    upsertBatch: vi.fn(),
    // main 호출마다 실 SIGTERM 리스너 누적 방지 (반환 함수 = isInterrupted)
    setupGracefulShutdown: vi.fn(() => () => false),
    fetchWithRetry: (/** @type {any[]} */ ...args) => fetchWithRetryMock(...args),
    selectAll: (/** @type {any[]} */ ...args) => selectAllMock(...args),
  };
});

process.env.KOSIS_KEY = "test-key";

const { parseKosisRows, parseKosisRowsAllMonths, aggregateRegionTotals, calcProportionalUnsold, resolveKosisGuKey, planUnsoldUpdates, evaluateZeroBreaker, parseExpectZeroArg, main } =
  await import("./collect-unsold-kosis.mjs");
const { recordCollectorRun, getSupabase } = /** @type {any} */ (await import("./_shared.mjs"));

// ── 가짜 sb (세션570) ─────────────────────────────────────────
/**
 * 가짜 sb 의 update(payload).eq("id", id) — regions 쓰기는 그대로 await 되고, apartments 쓰기는 hold 보호
 * WHERE(`.or(filter).select("id")`)까지 이어 부른다. `protectedIds` 에 든 id 는 DB 가 그 WHERE 로 막은 것처럼
 * 빈 배열을 돌려준다(돌아온 행으로 세는지 시험하려고).
 * @param {any[]} updateCalls @param {string} table @param {any} payload @param {Set<string>} [protectedIds]
 */
function fakeEq(updateCalls, table, payload, protectedIds = new Set()) {
  return (/** @type {string} */ _col, /** @type {string} */ id) => {
    /** @type {{ table: string; payload: any; id: string; filter: string | null; selected: string | null }} */
    const call = { table, payload, id, filter: null, selected: null };
    updateCalls.push(call);
    return Object.assign(Promise.resolve({ error: null }), {
      or: (/** @type {string} */ filter) => {
        call.filter = filter;
        return {
          select: (/** @type {string} */ cols) => {
            call.selected = cols;
            return Promise.resolve({ data: protectedIds.has(id) ? [] : [{ id }], error: null });
          },
        };
      },
    });
  };
}

// ── 팩토리 ───────────────────────────────────────────────────
/** KOSIS 행 팩토리 */
function makeRow(/** @type {any} */ c1, /** @type {any} */ c2, /** @type {any} */ period, /** @type {any} */ value) {
  return { C1_NM: c1, C2_NM: c2, PRD_DE: period, DT: String(value) };
}

// ── parseKosisRows ────────────────────────────────────────────
describe("parseKosisRows", () => {
  it("빈 배열 → 빈 객체", () => {
    expect(parseKosisRows([])).toEqual({});
  });

  it("단일 시군구 행 → 올바른 매핑", () => {
    const rows = [makeRow("서울", "강남구", "202601", 150)];
    const result = parseKosisRows(rows);
    expect(result["서울"]["강남구"]).toBe(150);
  });

  it("'계' 행 → '_total' 키로 매핑", () => {
    const rows = [makeRow("서울", "계", "202601", 500)];
    const result = parseKosisRows(rows);
    expect(result["서울"]["_total"]).toBe(500);
  });

  it("같은 키의 이전 월 데이터 → 최신 월로 덮어씀", () => {
    const rows = [
      makeRow("서울", "강남구", "202601", 100),
      makeRow("서울", "강남구", "202602", 200), // 최신
    ];
    const result = parseKosisRows(rows);
    expect(result["서울"]["강남구"]).toBe(200);
  });

  it("알 수 없는 시도명 → 무시", () => {
    const rows = [makeRow("미국", "뉴욕", "202601", 100)];
    const result = parseKosisRows(rows);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("DT가 숫자 아님 → 무시", () => {
    const rows = [makeRow("서울", "강남구", "202601", "abc")];
    const result = parseKosisRows(rows);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("정식명 '서울특별시' → '서울' 매핑", () => {
    const rows = [makeRow("서울특별시", "종로구", "202601", 50)];
    const result = parseKosisRows(rows);
    expect(result["서울"]["종로구"]).toBe(50);
  });
});

// ── parseKosisRowsAllMonths ───────────────────────────────────
describe("parseKosisRowsAllMonths", () => {
  it("3개월치 행 → 월별 분리 반환 (모든 월 유지)", () => {
    const rows = [
      makeRow("서울", "강남구", "202601", 100),
      makeRow("서울", "강남구", "202602", 120),
      makeRow("서울", "강남구", "202603", 135),
    ];
    const result = parseKosisRowsAllMonths(rows);
    expect(result["서울"]["강남구"]).toEqual({
      "202601": 100,
      "202602": 120,
      "202603": 135,
    });
  });

  it("PRD_DE 포맷 위반(분기 '20261Q') → 무시", () => {
    const rows = [
      makeRow("서울", "강남구", "20261Q", 100),
      makeRow("서울", "강남구", "202602", 120),
    ];
    const result = parseKosisRowsAllMonths(rows);
    expect(result["서울"]["강남구"]).toEqual({ "202602": 120 });
  });

  it("C1_NM 매핑 실패 → skip", () => {
    const rows = [makeRow("미국", "뉴욕", "202601", 100)];
    const result = parseKosisRowsAllMonths(rows);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("DT NaN → skip", () => {
    const rows = [makeRow("서울", "강남구", "202601", "abc")];
    const result = parseKosisRowsAllMonths(rows);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("'계' 행 → '_total' 키로 월별 집계", () => {
    const rows = [
      makeRow("서울", "계", "202601", 500),
      makeRow("서울", "계", "202602", 520),
    ];
    const result = parseKosisRowsAllMonths(rows);
    expect(result["서울"]["_total"]).toEqual({ "202601": 500, "202602": 520 });
  });
});

// ── aggregateRegionTotals ─────────────────────────────────────
describe("aggregateRegionTotals", () => {
  it("빈 객체 → 빈 객체", () => {
    expect(aggregateRegionTotals({})).toEqual({});
  });

  it("'_total' 키 있으면 그대로 사용", () => {
    const result = aggregateRegionTotals({ "서울": { "_total": 500, "강남구": 150 } });
    expect(result["서울"]).toBe(500);
  });

  it("'소계' 키 있으면 우선 사용", () => {
    const result = aggregateRegionTotals({ "경기": { "소계": 1000, "수원시": 200 } });
    expect(result["경기"]).toBe(1000);
  });

  it("합계 키 없으면 시군구 합산", () => {
    const result = aggregateRegionTotals({ "부산": { "해운대구": 100, "남구": 200 } });
    expect(result["부산"]).toBe(300);
  });
});

// ── calcProportionalUnsold ────────────────────────────────────
describe("calcProportionalUnsold", () => {
  it("정상 비례배분 계산", () => {
    // 구 미분양 50, 단지 200세대, 구 전체 1000세대 → 10세대, 5%
    const result = calcProportionalUnsold(50, 200, 1000);
    expect(result?.estimated).toBe(10);
    expect(result?.unsoldRate).toBe(5.0);
  });

  it("비정상 unsoldRate > 100% → null", () => {
    // 구 미분양 1000, 단지 100세대, 구 전체 500세대 → 200세대, 200% → null
    const result = calcProportionalUnsold(1000, 100, 500);
    expect(result).toBeNull();
  });

  it("정상 범위 내 unsoldRate", () => {
    // 구 미분양 50, 단지 500세대, 구 전체 1000세대 → 25세대, 5%
    const result = calcProportionalUnsold(50, 500, 1000);
    expect(result?.estimated).toBe(25);
    expect(result?.unsoldRate).toBe(5.0);
  });

  it("guUnsold 0 → null", () => {
    expect(calcProportionalUnsold(0, 100, 500)).toBeNull();
  });

  it("aptUnits 0 → null", () => {
    expect(calcProportionalUnsold(100, 0, 500)).toBeNull();
  });

  it("totalUnitsInGu 0 → null", () => {
    expect(calcProportionalUnsold(100, 50, 0)).toBeNull();
  });

  it("null 입력 → null", () => {
    expect(calcProportionalUnsold(null, 100, 500)).toBeNull();
  });

  it("경계값: unsoldRate 정확히 100.0% → 허용 (> 100 조건)", () => {
    // guUnsold=100, aptUnits=100, totalUnitsInGu=100 → estimated=100, unsoldRate=100.0
    const result = calcProportionalUnsold(100, 100, 100);
    expect(result).not.toBeNull();
    expect(result?.unsoldRate).toBe(100.0);
  });

  it("경계값: unsoldRate 100.1% → null", () => {
    // guUnsold=1001, aptUnits=100, totalUnitsInGu=1000 → estimated=100, unsoldRate=100.0 (반올림)
    // 직접 100 초과 케이스: guUnsold=101, aptUnits=100, totalUnitsInGu=100 → 101, 101%
    const result = calcProportionalUnsold(101, 100, 100);
    expect(result).toBeNull();
  });
});

// ── fetchWithRetry 통합 ───────────────────────────────────────
// 세션118: raw https.request → fetchWithRetry 교체 후 ECONNRESET 재시도 검증.
describe("fetchWithRetry 통합", () => {
  it("ECONNRESET 1회 → 재시도 후 성공", async () => {
    // 세션 395: mock factory 가 fetchWithRetry 를 델리게이트로 바꿔 — 본 테스트는
    // 실물 재시도 동작 검증이므로 importActual 로 원본 확보.
    const { fetchWithRetry } = /** @type {any} */ (await vi.importActual("./_shared.mjs"));
    let calls = 0;
    const originalFetch = global.fetch;
    global.fetch = /** @type {any} */ (vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("read ECONNRESET");
      return { ok: true, json: async () => ({ err: null, result: "ok" }) };
    }));
    try {
      const res = await fetchWithRetry("https://example.test/", {}, 3);
      const body = await res.json();
      expect(calls).toBe(2);
      expect(body.result).toBe("ok");
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ── main() collector_runs 기록 하드닝 (KOSIS 러너 차단 사고, 세션 395) ──
describe("main() recordCollectorRun 하드닝", () => {
  beforeEach(() => {
    fetchWithRetryMock.mockReset();
    recordCollectorRun.mockClear();
  });

  it("KOSIS fetch 실패 → rethrow + status=failure 기록", async () => {
    fetchWithRetryMock.mockRejectedValue(new Error("fetch failed"));
    await expect(main()).rejects.toThrow(/KOSIS fetch failed/);
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "kosis-unsold",
      expect.objectContaining({ status: "failure" }),
    );
  });

  it("빈 응답 early-return 도 기록 (ok=0)", async () => {
    fetchWithRetryMock.mockResolvedValue({ json: async () => [] });
    await main();
    expect(recordCollectorRun).toHaveBeenCalledTimes(1);
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "kosis-unsold",
      { ok: 0 },
    );
  });
});

// ── regions 조회 배선 — selectAll keyCol (세션549) ──
// 무정렬 select 는 2,249행 표에서 첫 1,000행만 매칭한다
// (.claude/rules/collectors/unordered-pagination-loses-rows.md §1). main() 은 fetch mock 으로
// early-return 하는 케이스만 커버해 이 지점을 안 지나므로, 소스 grep 으로 배선을 지킨다
// (좌변까지 고정 — guards-must-be-mutation-tested §소스 grep 함정).
describe("regions 조회 배선 — selectAll keyCol", () => {
  const src = readFileSync(path.join(process.cwd(), "scripts/collectors/collect-unsold-kosis.mjs"), "utf8");

  it("selectAll 에 keyCol \"id\" 를 넘긴다 (무정렬 select 는 2,249행 표에서 1,000행만 매칭한다)", () => {
    expect(src).toMatch(
      /regions = [\s\S]{0,40}await selectAll\(\(s\) => s\.from\("regions"\)\.select\("id, region, gu, regional_unsold"\), sb, "id"\)/,
    );
  });

  it("커서 키가 select 에 들어 있다 (없으면 selectAll 이 즉시 throw)", () => {
    expect(src).toMatch(/\.select\("id, region, gu, regional_unsold"\)/);
  });

  it("조회 실패는 throw 대신 로그만 남기고 계속한다 (기존 fail-open 유지)", () => {
    expect(src).toMatch(/} catch \(e\) {\s*rErr = /);
  });
});

// ── apartments 조회 배선 — select 에 unsold_source 가 있다 (검사관 M2, 세션568-2) ──
// select 에서 unsold_source 를 빼면 planUnsoldUpdates 의 isKosisSourced 판정이 항상 false 가
// 되어 clear_kosis_stale 이 영영 안 나온다 — 좌변(대입문 시작)까지 고정해 선언부/주석과
// 구분한다(guards-must-be-mutation-tested §소스 grep 함정).
describe("apartments 조회 배선 — select 에 unsold_source 포함", () => {
  const src = readFileSync(path.join(process.cwd(), "scripts/collectors/collect-unsold-kosis.mjs"), "utf8");

  it("apartmentsTyped 조회 select 문자열에 unsold_source 가 들어 있다", () => {
    expect(src).toMatch(
      /apartmentsTyped = [\s\S]{0,60}await selectAll\(\(s\) => s\.from\("apartments"\)\.select\("id, name, region, gu, units, unsold, unsold_rate, naver_sell_count, presale_type, unsold_source, unsold_as_of"\), sb, "id"\)/, // 세션569 C6: 공고일 칸
    );
  });
});

// ── shouldSkipKosisFill — 세션568-3: 판정 축이 "값의 모양" 에서 "출처 칸" 으로 전면 개정 ──
describe("shouldSkipKosisFill — 출처 칸 기준 판정 (세션568-3)", () => {
  /** @type {(a: any) => boolean} */
  let skip;
  beforeEach(async () => {
    ({ shouldSkipKosisFill: skip } = await import("./collect-unsold-kosis.mjs"));
  });

  it("규칙1 — 비례배분 분모가 될 수 없는 단지(무효)는 존중(skip)한다", () => {
    expect(skip({ unsold: null, units: 1, region: "경기", gu: "수원시" })).toBe(true);
    expect(skip({ unsold: null, units: null, region: "경기", gu: "수원시" })).toBe(true);
    expect(skip({ unsold: null, units: 500, region: null, gu: "수원시" })).toBe(true);
    expect(skip({ unsold: null, units: 500, region: "경기", gu: null })).toBe(true);
  });

  it("규칙1 — 세종은 gu=null 이 정상 구조라 무효 처리되지 않는다", () => {
    expect(skip({ unsold: null, units: 660, region: "세종", gu: null })).toBe(false);
  });

  it("규칙2(applyhome) — 매물 수와 우연히 같아도, 세대수를 넘어도 항상 존중한다", () => {
    expect(skip({ unsold: 30, units: 500, region: "경기", gu: "수원시", naver_sell_count: 30, unsold_source: "applyhome" })).toBe(true);
    expect(skip({ unsold: 999, units: 500, region: "경기", gu: "수원시", unsold_source: "applyhome" })).toBe(true); // 세대수 초과여도 존중
  });

  it("규칙3(NULL 출처 완판) — unsold===0 이고 출처 NULL 이면 존중한다", () => {
    expect(skip({ unsold: 0, units: 500, region: "경기", gu: "수원시", unsold_source: null })).toBe(true);
    expect(skip({ unsold: 0, units: 500, region: "경기", gu: "수원시" })).toBe(true); // unsold_source 미지정(undefined)도 NULL 취급
  });

  it("검사관 M3(자기잠금 방지) — unsold===0 이라도 출처가 kosis 면 존중하지 않는다(false)", () => {
    // kosis 가 write_zero 로 쓴 0 은 다음 회차가 다시 갱신해야 한다.
    expect(skip({ unsold: 0, units: 500, region: "경기", gu: "수원시", unsold_source: "kosis" })).toBe(false);
  });

  it("규칙4 — 출처 kosis 인 값>0 은 세대수 이하·매물수와 달라도 항상 KOSIS 가 정한다(false)", () => {
    expect(skip({ unsold: 30, units: 500, region: "경기", gu: "수원시", naver_sell_count: null, unsold_source: "kosis" })).toBe(false);
  });

  it("규칙4 — 출처 NULL 인 값>0(사장님 결정: 이제 KOSIS 가 덮는다) → false", () => {
    // 이전 버전(세션559~568-2)은 이 자리를 '유효한 기존 값' 으로 보고 존중(true)했다.
    // 사장님 3차 결정: 출처 모르는 옛 값도 KOSIS 가 덮는다.
    expect(skip({ unsold: 30, units: 500, region: "경기", gu: "수원시", unsold_source: null })).toBe(false);
    expect(skip({ unsold: 500, units: 500, region: "경기", gu: "수원시", unsold_source: null })).toBe(false); // 세대수와 같아도
    expect(skip({ unsold: 999, units: 500, region: "경기", gu: "수원시", unsold_source: null })).toBe(false); // 세대수 초과여도
  });

  it("규칙4 — unsold_source 필드 자체가 없어도(undefined, 마이그레이션 전 fixture) NULL 취급 → false", () => {
    expect(skip({ unsold: 30, units: 500, region: "경기", gu: "수원시" })).toBe(false);
  });

  it("규칙4 — unsold 가 null(값 자체 없음) → false(KOSIS 가 정한다)", () => {
    expect(skip({ unsold: null, units: 500, region: "경기", gu: "수원시" })).toBe(false);
  });
});

// ── apartments 조회 — selectAll 전수 확보 (세션566, 1,000행 컷 정정) ──
// 무정렬 select 는 3,068행 표에서 1,000행만 매칭한다(unordered-pagination-loses-rows.md §1).
// 1,000행 컷의 두 가지 피해: (a) unitsByGu(비례배분 분모)가 표본만으로 계산돼 왜곡,
// (b) 1,000행 밖의 채움 대상이 영영 안 채워짐. 아래는 selectAll 이 전수(1,005건)를 돌려주는
// mock 으로, 1,000번째를 넘는 행도 처리되고 분모가 전량 기준임을 증명한다.
describe("apartments 조회 — selectAll 전수 확보 (1,000행 컷 정정)", () => {
  beforeEach(() => {
    selectAllMock.mockReset();
    fetchWithRetryMock.mockReset();
    recordCollectorRun.mockClear();
  });

  /** KOSIS 응답 — 경기 수원시에 미분양 1,000세대(비례배분 분모 검증용) */
  function kosisRows() {
    return [{ C1_NM: "경기", C2_NM: "수원시", PRD_DE: "202601", DT: "1000" }];
  }

  /** @param {number} n 이미 값 있음(NULL 출처 — 세션568-3 규칙4 로 KOSIS 가 덮는 대상) 단지 수, 그 뒤 1개는 1,000번째를 넘는 채움 대상 */
  function makeApartments(n) {
    /** @type {any[]} */
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push({
        id: `apt-${i}`, name: `단지${i}`, region: "경기", gu: "수원시",
        units: 100, unsold: 10, unsold_rate: 10, naver_sell_count: null, unsold_source: "applyhome", // 존중 대상
      });
    }
    // 1,000번째를 넘는 위치(인덱스 1004, 총 1,005건)에 채움 대상 1건 추가
    rows.push({
      id: "apt-target", name: "1005번째단지", region: "경기", gu: "수원시",
      units: 100, unsold: null, unsold_rate: null, naver_sell_count: null,
    });
    return rows;
  }

  it("1,000행 넘는 표(1,005건)에서 1,000번째를 넘는 채움 대상도 처리된다", async () => {
    const apartments = makeApartments(1004); // 0~1003(applyhome 존중) + target(인덱스1004) = 1,005건
    selectAllMock
      .mockResolvedValueOnce([]) // 1st call: regions (빈 배열 — regions 갱신은 본 테스트 밖)
      .mockResolvedValueOnce(apartments); // 2nd call: apartments
    fetchWithRetryMock.mockResolvedValue({ json: async () => kosisRows() });

    const originalArgv = process.argv;
    process.argv = [...originalArgv, "--dry-run"];
    try {
      await main();
    } finally {
      process.argv = originalArgv;
    }

    // selectAll 이 apartments 를 filter/range 없이 keyCol "id" 로 호출했는지 확인
    expect(selectAllMock).toHaveBeenCalledTimes(2);
    const apartmentsCallArgs = selectAllMock.mock.calls[1];
    expect(apartmentsCallArgs[2]).toBe("id"); // keyCol

    // aptUpdated 카운트 — main() 은 dry-run 이라 DB write 없이 카운트만 증가.
    // recordCollectorRun 의 ok 값으로 간접 검증(regUpdated=0 + aptUpdated=1 대상).
    // 세션569 C6: 이 픽스처의 applyhome 1004건은 공고일(unsold_as_of)이 없다 → 존중은 유지하되
    // skip_applyhome_no_date 로 세고, collector_runs.error_message 에 APPLYHOME_NO_DATE 마커를 남긴다
    // (status 는 그대로 — 조용히 넘기지 않는 배선 가드).
    expect(recordCollectorRun).toHaveBeenCalledWith("kosis-unsold", {
      ok: 1,
      errorMessage: expect.stringMatching(/^APPLYHOME_NO_DATE n=1004: apt-0, apt-1, /),
    });
  });

  it("per-gu 분모(unitsByGu)가 전체 1,005행 기준으로 계산된다 — 1,000행 컷이면 값이 왜곡된다", async () => {
    // guUnsold=1000, totalUnitsInGu=1,005*100=100,500 이면 채움 대상(units=100)의 비례배분:
    // estimated = round(1000 * 100/100500) = round(0.995) = 1
    // 1,000행 컷이었다면(999*100+100=100,000 대신 1000*100=100,000 아님 — 표본이 999건뿐이면
    // totalUnitsInGu=999*100=99,900 이 되어 estimated = round(1000*100/99900)=1 로 동일할 수도
    // 있으므로, 분모 차이가 값에 드러나도록 목표 단지 units 를 크게 잡아 대비시킨다.
    /** @type {any[]} */
    const rows = [];
    for (let i = 0; i < 1004; i++) {
      rows.push({ id: `apt-${i}`, name: `단지${i}`, region: "경기", gu: "수원시", units: 100, unsold: 10, unsold_rate: 10, naver_sell_count: null, unsold_source: "applyhome" });
    }
    rows.push({ id: "apt-target", name: "타겟", region: "경기", gu: "수원시", units: 50200, unsold: null, unsold_rate: null, naver_sell_count: null });
    // totalUnitsInGu(전체) = 1004*100 + 50200 = 150,600
    // 1,000행 컷이었다면 표본 999건(단지 999개, 타겟 미포함) → 분모 = 999*100 = 99,900 (타겟 자체가 안 보임)
    selectAllMock.mockResolvedValueOnce([]).mockResolvedValueOnce(rows);
    fetchWithRetryMock.mockResolvedValue({ json: async () => kosisRows() });

    /** @type {string[]} */
    const logLines = [];
    const { log: logMock } = /** @type {any} */ (await import("./_shared.mjs"));
    /** @type {any} */ (logMock).mockImplementation((/** @type {string} */ _phase, /** @type {string} */ msg) => {
      logLines.push(msg);
    });

    const originalArgv = process.argv;
    process.argv = [...originalArgv, "--dry-run"];
    try {
      await main();
    } finally {
      process.argv = originalArgv;
    }

    const targetLine = logLines.find((l) => l.includes("타겟"));
    expect(targetLine).toBeDefined();
    // estimated = round(1000 * 50200/150600) = round(333.33) = 333
    expect(targetLine).toMatch(/unsold=333,/);
  });
});

// ── main() — write_zero 를 실제로 0 으로 쓴다 (세션568-3 규칙 개정: 비우기 폐지 → 0 쓰기) ──
describe("main() — write_zero 가 dry-run 로그·ok 카운트·DB 반영에 나타난다", () => {
  beforeEach(() => {
    selectAllMock.mockReset();
    fetchWithRetryMock.mockReset();
    recordCollectorRun.mockClear();
  });

  /**
   * 차단기(값>0 대비 0-쓰기 10%)를 안 넘도록, write_zero 대상 1건 외에 "값>0 · 다른 구 ·
   * write 로 정상 처리될" 대상을 9건 함께 둔다 — 분모(kosisJudgedNonZero)를 10건으로
   * 만들어 분자(write_zero 1건)가 10%(경계값, 초과 아님)가 되게 한다.
   */
  function makeCrowdApartments() {
    /** @type {any[]} */
    const crowd = [];
    for (let i = 0; i < 9; i++) {
      crowd.push({ id: `crowd-${i}`, name: `혼잡단지${i}`, region: "경기", gu: "성남시", units: 100, unsold: 5, unsold_rate: 5, naver_sell_count: null, presale_type: null, unsold_source: null });
    }
    return crowd;
  }

  it("KOSIS=0 이고 출처 NULL 값>0 인 단지 → [DRY-RUN][0으로 씀] 로그 + ok 카운트 포함", async () => {
    const apartments = [
      { id: "apt-zero", name: "영으로바뀜단지", region: "경기", gu: "수원시", units: 500, unsold: 12, unsold_rate: 2.4, naver_sell_count: 12, presale_type: null, unsold_source: null },
      ...makeCrowdApartments(),
    ];
    selectAllMock.mockResolvedValueOnce([]).mockResolvedValueOnce(apartments);
    fetchWithRetryMock.mockResolvedValue({ json: async () => [
      { C1_NM: "경기", C2_NM: "수원시", PRD_DE: "202601", DT: "0" },
      { C1_NM: "경기", C2_NM: "성남시", PRD_DE: "202601", DT: "45" }, // 9곳 균등배분 → 각 5(<50% 문턱)
    ] });

    /** @type {string[]} */
    const logLines = [];
    const { log: logMock } = /** @type {any} */ (await import("./_shared.mjs"));
    /** @type {any} */ (logMock).mockImplementation((/** @type {string} */ _phase, /** @type {string} */ msg) => { logLines.push(msg); });

    const originalArgv = process.argv;
    process.argv = [...originalArgv, "--dry-run"];
    try {
      await main();
    } finally {
      process.argv = originalArgv;
    }

    const zeroLine = logLines.find((l) => l.includes("[0으로 씀]"));
    expect(zeroLine).toBeDefined();
    expect(zeroLine).toMatch(/영으로바뀜단지.*unsold 12 → 0/);
    expect(logLines.some((l) => l.includes("KOSIS 0-쓰기: 1건"))).toBe(true);
    // regUpdated=0 + aptUpdated=9(crowd 9건 write) + aptZeroed=1
    expect(recordCollectorRun).toHaveBeenCalledWith("kosis-unsold", { ok: 10 });
  });

  it("--impact-out 에 write_zero action 이 그대로 실린다", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const { readFileSync, rmSync } = await import("node:fs");
    const impactPath = path.join(os.tmpdir(), `s568_3_impact_${Date.now()}.json`);

    const apartments = [
      { id: "apt-zero2", name: "영으로바뀜단지2", region: "경기", gu: "수원시", units: 500, unsold: 12, unsold_rate: 2.4, naver_sell_count: 12, presale_type: null, unsold_source: null },
      ...makeCrowdApartments(),
    ];
    selectAllMock.mockResolvedValueOnce([]).mockResolvedValueOnce(apartments);
    fetchWithRetryMock.mockResolvedValue({ json: async () => [
      { C1_NM: "경기", C2_NM: "수원시", PRD_DE: "202601", DT: "0" },
      { C1_NM: "경기", C2_NM: "성남시", PRD_DE: "202601", DT: "45" },
    ] });

    const originalArgv = process.argv;
    process.argv = [...originalArgv, "--dry-run", `--impact-out=${impactPath}`];
    try {
      await main();
      const written = readFileSync(impactPath, "utf8");
      const parsed = JSON.parse(written);
      expect(parsed.actionCounts.write_zero).toBe(1);
      const row = parsed.plan.find((/** @type {any} */ p) => p.id === "apt-zero2");
      expect(row.action).toBe("write_zero");
      expect(row.newEstimate).toBe(0);
      expect(row.newRate).toBe(0);
    } finally {
      process.argv = originalArgv;
      try { rmSync(impactPath); } catch { /* noop */ }
    }
  });

  it("--apply 시 write_zero 대상은 unsold=0, unsold_rate=0, unsold_source='kosis' 로 UPDATE 된다", async () => {
    const apartments = [
      { id: "apt-zero3", name: "실적용단지", region: "경기", gu: "수원시", units: 500, unsold: 12, unsold_rate: 2.4, naver_sell_count: 12, presale_type: null, unsold_source: null },
      ...makeCrowdApartments(),
    ];
    selectAllMock.mockResolvedValueOnce([]).mockResolvedValueOnce(apartments);
    fetchWithRetryMock.mockResolvedValue({ json: async () => [
      { C1_NM: "경기", C2_NM: "수원시", PRD_DE: "202601", DT: "0" },
      { C1_NM: "경기", C2_NM: "성남시", PRD_DE: "202601", DT: "45" },
    ] });

    /** @type {any[]} */
    const updateCalls = [];
    getSupabase.mockReturnValue({
      from: (/** @type {string} */ table) => ({
        update: (/** @type {any} */ payload) => ({
          eq: fakeEq(updateCalls, table, payload),
        }),
      }),
    });

    const originalArgv = process.argv;
    process.argv = [...originalArgv.filter((a) => a !== "--dry-run")];
    try {
      await main();
    } finally {
      process.argv = originalArgv;
      getSupabase.mockReset();
    }

    const call = updateCalls.find((c) => c.id === "apt-zero3");
    expect(call).toBeDefined();
    expect(call.payload.unsold).toBe(0);
    expect(call.payload.unsold_rate).toBe(0);
    expect(call.payload.unsold_source).toBe("kosis");
  });
});

// ── 차단기 — 값>0 인데 0 으로 바뀌는 행이 10% 초과 시 0 쓰기 전부 중단 (사장님 결정) ──
// ── parseExpectZeroArg — 세션568-5 ──
describe("parseExpectZeroArg", () => {
  it("인자 없으면 null(기본 비율 판정)", () => {
    const r = parseExpectZeroArg(["node", "script.mjs"]);
    expect(r.expectZero).toBeNull();
    expect(r.explicit).toBe(false);
    expect(r.invalid).toBe(false);
  });

  it("정수 지정 → 그 값", () => {
    const r = parseExpectZeroArg(["--expect-zero=285"]);
    expect(r.expectZero).toBe(285);
    expect(r.explicit).toBe(true);
    expect(r.invalid).toBe(false);
  });

  it("0 도 유효한 지정값이다", () => {
    const r = parseExpectZeroArg(["--expect-zero=0"]);
    expect(r.expectZero).toBe(0);
    expect(r.explicit).toBe(true);
  });

  it("음수·비수치·소수는 무효 → null + invalid:true", () => {
    expect(parseExpectZeroArg(["--expect-zero=-1"])).toMatchObject({ expectZero: null, invalid: true });
    expect(parseExpectZeroArg(["--expect-zero=abc"])).toMatchObject({ expectZero: null, invalid: true });
    expect(parseExpectZeroArg(["--expect-zero=1.5"])).toMatchObject({ expectZero: null, invalid: true });
  });
});

// ── evaluateZeroBreaker — 세션568-5: 비율(기본) vs expect-zero(정확 일치) ──
describe("evaluateZeroBreaker", () => {
  /** @param {number} n write_zero(값>0→0) 대상 건수 */
  function makePlan(n, nonZeroTotal = 10) {
    /** @type {any[]} */
    const plan = [];
    for (let i = 0; i < n; i++) plan.push({ id: `z${i}`, action: "write_zero", currentUnsold: 5 });
    for (let i = n; i < nonZeroTotal; i++) plan.push({ id: `w${i}`, action: "write", currentUnsold: 5 });
    return plan;
  }

  it("expectZero 없음(null) — 비율 10% 초과 시 발동", () => {
    const r = evaluateZeroBreaker(makePlan(2, 10), null); // 20% > 10%
    expect(r.fired).toBe(true);
    expect(r.zeroChanges).toBe(2);
    expect(r.denominator).toBe(10);
  });

  it("expectZero 없음(null) — 정확히 10% 이하면 미발동", () => {
    const r = evaluateZeroBreaker(makePlan(1, 10), null); // 10%, 경계
    expect(r.fired).toBe(false);
  });

  it("expectZero=N 지정 — zeroChanges 가 N 과 정확히 같으면 통과(미발동), 개수가 커도(50%) 통과", () => {
    const r = evaluateZeroBreaker(makePlan(5, 10), 5); // 50% 지만 expectZero=5 와 일치
    expect(r.fired).toBe(false);
    expect(r.zeroChanges).toBe(5);
  });

  it("expectZero=N 지정 — N+1(더 많음) 이면 발동", () => {
    const r = evaluateZeroBreaker(makePlan(6, 10), 5);
    expect(r.fired).toBe(true);
  });

  it("expectZero=N 지정 — N-1(더 적음) 이어도 발동", () => {
    const r = evaluateZeroBreaker(makePlan(4, 10), 5);
    expect(r.fired).toBe(true);
  });

  it("expectZero=N 지정 — 비율은 10% 이하로 안전해도 N 불일치면 발동한다(비율 무시 확인)", () => {
    const r = evaluateZeroBreaker(makePlan(1, 100), 5); // 1%(안전) 이지만 expectZero=5 와 불일치(1≠5)
    expect(r.fired).toBe(true);
  });

  it("breaker 결과에 limit·expectZero 필드가 실린다", () => {
    const r = evaluateZeroBreaker(makePlan(3, 10), 3);
    expect(r.limit).toBe(10);
    expect(r.expectZero).toBe(3);
  });
});

describe("main() — 0-쓰기 차단기 (세션568-5: DB 쓰기 전 판정 + expect-zero)", () => {
  beforeEach(() => {
    selectAllMock.mockReset();
    fetchWithRetryMock.mockReset();
    recordCollectorRun.mockClear();
    getSupabase.mockReset();
  });

  /** regions 1건(갱신 대상) + apartments 5건(1건 write_zero, 4건 write) 픽스처 */
  function makeFixture() {
    const regions = [{ id: "reg-1", region: "경기", gu: "수원시", regional_unsold: 999 }];
    const apartments = [
      { id: "z1", name: "영전환1", region: "경기", gu: "수원시", units: 500, unsold: 12, unsold_rate: 2.4, naver_sell_count: null, presale_type: null, unsold_source: null },
      { id: "w1", name: "정상1", region: "경기", gu: "성남시", units: 100, unsold: 5, unsold_rate: 5, naver_sell_count: null, presale_type: null, unsold_source: null },
      { id: "w2", name: "정상2", region: "경기", gu: "성남시", units: 100, unsold: 5, unsold_rate: 5, naver_sell_count: null, presale_type: null, unsold_source: null },
      { id: "w3", name: "정상3", region: "경기", gu: "성남시", units: 100, unsold: 5, unsold_rate: 5, naver_sell_count: null, presale_type: null, unsold_source: null },
      { id: "w4", name: "정상4", region: "경기", gu: "성남시", units: 100, unsold: 5, unsold_rate: 5, naver_sell_count: null, presale_type: null, unsold_source: null },
    ];
    const kosisRows = [
      { C1_NM: "경기", C2_NM: "수원시", PRD_DE: "202601", DT: "0" },
      { C1_NM: "경기", C2_NM: "성남시", PRD_DE: "202601", DT: "20" },
    ];
    return { regions, apartments, kosisRows };
  }

  it("비율 10% 초과(20%) + --apply → regions·apartments 어느 쪽도 UPDATE 0건, collector_runs 실패 기록, rethrow", async () => {
    const { regions, apartments, kosisRows } = makeFixture();
    selectAllMock.mockResolvedValueOnce(regions).mockResolvedValueOnce(apartments);
    fetchWithRetryMock.mockResolvedValue({ json: async () => kosisRows });

    /** @type {any[]} */
    const updateCalls = [];
    getSupabase.mockReturnValue({
      from: (/** @type {string} */ table) => ({
        update: (/** @type {any} */ payload) => ({
          eq: fakeEq(updateCalls, table, payload),
        }),
      }),
    });

    const originalArgv = process.argv;
    process.argv = [...originalArgv.filter((a) => a !== "--dry-run")];
    try {
      await expect(main()).rejects.toThrow(/차단기 발동/);
    } finally {
      process.argv = originalArgv;
    }

    // 세션568-5 핵심 — DB 쓰기 전 판정이므로 regions UPDATE 도 0건이어야 한다(옛 부분 반영 버그 재발 방지).
    expect(updateCalls.filter((c) => c.table === "regions")).toHaveLength(0);
    expect(updateCalls.filter((c) => c.table === "apartments")).toHaveLength(0);
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "kosis-unsold",
      expect.objectContaining({ status: "failure" }),
    );
  });

  it("--expect-zero=1 (실제 write_zero 1건과 일치) → 차단기 통과, regions·apartments 정상 반영", async () => {
    const { regions, apartments, kosisRows } = makeFixture();
    selectAllMock.mockResolvedValueOnce(regions).mockResolvedValueOnce(apartments);
    fetchWithRetryMock.mockResolvedValue({ json: async () => kosisRows });

    /** @type {any[]} */
    const updateCalls = [];
    getSupabase.mockReturnValue({
      from: (/** @type {string} */ table) => ({
        update: (/** @type {any} */ payload) => ({
          eq: fakeEq(updateCalls, table, payload),
        }),
      }),
    });

    const originalArgv = process.argv;
    process.argv = [...originalArgv.filter((a) => a !== "--dry-run"), "--expect-zero=1"];
    try {
      await main();
    } finally {
      process.argv = originalArgv;
    }

    expect(updateCalls.filter((c) => c.table === "regions").length).toBeGreaterThan(0);
    expect(updateCalls.some((c) => c.table === "apartments" && c.payload.unsold === 0)).toBe(true);
  });

  it("--expect-zero=2 (실제 1건과 불일치) → 차단기 발동, rethrow", async () => {
    const { regions, apartments, kosisRows } = makeFixture();
    selectAllMock.mockResolvedValueOnce(regions).mockResolvedValueOnce(apartments);
    fetchWithRetryMock.mockResolvedValue({ json: async () => kosisRows });
    getSupabase.mockReturnValue({
      from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    });

    const originalArgv = process.argv;
    process.argv = [...originalArgv.filter((a) => a !== "--dry-run"), "--expect-zero=2"];
    try {
      await expect(main()).rejects.toThrow(/차단기 발동/);
    } finally {
      process.argv = originalArgv;
    }
  });

  it("dry-run + 차단기 발동 → exit 0(reject 안 함), impact-out 에 breaker 포함 저장", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const { readFileSync, rmSync } = await import("node:fs");
    const impactPath = path.join(os.tmpdir(), `s568_5_breaker_${Date.now()}.json`);

    const { regions, apartments, kosisRows } = makeFixture();
    selectAllMock.mockResolvedValueOnce(regions).mockResolvedValueOnce(apartments);
    fetchWithRetryMock.mockResolvedValue({ json: async () => kosisRows });

    const originalArgv = process.argv;
    process.argv = [...originalArgv, "--dry-run", `--impact-out=${impactPath}`];
    try {
      await expect(main()).resolves.not.toThrow();
      const parsed = JSON.parse(readFileSync(impactPath, "utf8"));
      expect(parsed.breaker).toBeDefined();
      expect(parsed.breaker.fired).toBe(true);
      expect(parsed.breaker.zeroChanges).toBe(1);
      expect(parsed.breaker.denominator).toBe(5);
    } finally {
      process.argv = originalArgv;
      try { rmSync(impactPath); } catch { /* noop */ }
    }
  });

  it("차단기 미발동(정상) 시에도 impact-out 에 breaker 가 fired:false 로 저장된다", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const { readFileSync, rmSync } = await import("node:fs");
    const impactPath = path.join(os.tmpdir(), `s568_5_normal_${Date.now()}.json`);

    // write_zero 없이 전부 write — 차단기 미발동 픽스처.
    const apartments = [
      { id: "w1", name: "정상1", region: "경기", gu: "수원시", units: 100, unsold: 5, unsold_rate: 5, naver_sell_count: null, presale_type: null, unsold_source: null },
    ];
    selectAllMock.mockResolvedValueOnce([]).mockResolvedValueOnce(apartments);
    fetchWithRetryMock.mockResolvedValue({ json: async () => [{ C1_NM: "경기", C2_NM: "수원시", PRD_DE: "202601", DT: "10" }] });

    const originalArgv = process.argv;
    process.argv = [...originalArgv, "--dry-run", `--impact-out=${impactPath}`];
    try {
      await main();
      const parsed = JSON.parse(readFileSync(impactPath, "utf8"));
      expect(parsed.breaker.fired).toBe(false);
    } finally {
      process.argv = originalArgv;
      try { rmSync(impactPath); } catch { /* noop */ }
    }
  });
});

// ── resolveKosisGuKey — 시도 합계 폴백 삭제 + 두 단어 gu → 시 단위 매칭 (세션567) ──
describe("resolveKosisGuKey", () => {
  it("정확 일치 — gu 그대로 KOSIS 키로 조회된다", () => {
    expect(resolveKosisGuKey("서울", "강남구", { "강남구": 10 })).toBe("강남구");
  });

  it("두 단어 gu('천안시 동남구') — 첫 토큰(시 단위)이 guMap 에 있으면 그것으로 매칭", () => {
    expect(resolveKosisGuKey("충남", "천안시 동남구", { "천안시": 5100 })).toBe("천안시");
    expect(resolveKosisGuKey("충남", "천안시 서북구", { "천안시": 5100 })).toBe("천안시");
  });

  it("두 단어 gu 인데 정확 일치가 먼저 있으면 정확 일치를 쓴다", () => {
    // guMap 에 두 단어 키 자체가 있는 경우(예: 경기 수원시 권선구가 KOSIS 에도 따로 나오는 가상 상황)
    expect(resolveKosisGuKey("경기", "수원시 권선구", { "수원시 권선구": 20, "수원시": 100 })).toBe("수원시 권선구");
  });

  it("세종(gu=null) — guMap 에 '세종시' 가 있으면 그것으로 매칭", () => {
    expect(resolveKosisGuKey("세종", null, { "세종시": 43 })).toBe("세종시");
  });

  it("세종인데 guMap 에 '세종시' 가 없으면 null", () => {
    expect(resolveKosisGuKey("세종", null, { "다른구": 1 })).toBeNull();
  });

  it("gu 도 없고 세종도 아니면 null — 시도 합계로 폴백하지 않는다", () => {
    expect(resolveKosisGuKey("경기", null, { "수원시": 100 })).toBeNull();
  });

  it("첫 토큰도 guMap 에 없으면 null — 시도 합계로 폴백하지 않는다", () => {
    expect(resolveKosisGuKey("충남", "모르는시 모르는구", { "천안시": 5100 })).toBeNull();
  });

  it("guMap 자체가 undefined 면 null", () => {
    expect(resolveKosisGuKey("경기", "수원시", undefined)).toBeNull();
  });

  it("⚠️ 'constructor' 같은 프로토타입 키는 hasOwnProperty 로 막혀 null — 함수를 돌려주지 않는다", () => {
    // guMap?.["constructor"] 는 Object.prototype.constructor(함수)를 돌려주는 함정이 있다
    // (admin-district-code-reform.md §3). hasOwnProperty 조회라 이 값은 절대 나오면 안 된다.
    const result = resolveKosisGuKey("경기", "constructor", { "수원시": 100 });
    expect(result).toBeNull();
    expect(typeof result).not.toBe("function");
  });

  it("'toString' 키도 마찬가지로 막힌다", () => {
    expect(resolveKosisGuKey("경기", "toString", { "수원시": 100 })).toBeNull();
  });
});

// ── planUnsoldUpdates — 순수 계획 함수 (세션567) ──
describe("planUnsoldUpdates", () => {
  /** @param {Partial<any>} overrides */
  function apt(overrides = {}) {
    return {
      id: "id-1", name: "테스트단지", region: "경기", gu: "수원시",
      units: 500, unsold: null, unsold_rate: null, naver_sell_count: null, presale_type: null,
      ...overrides,
    };
  }

  it("매칭 성공 + 낮은 비율 → write", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt()],
      unsoldByRegionGu: { "경기": { "수원시": 50 } },
    });
    expect(plan[0].action).toBe("write");
    expect(plan[0].newEstimate).toBe(50); // guUnsold=50, units=500, totalUnitsInGu=500 → 50*500/500=50
  });

  it("임대형은 대상에서 제외된다(skip_lease) — 분모에도 안 들어간다", () => {
    const plan = planUnsoldUpdates({
      apartments: [
        apt({ id: "lease-1", presale_type: "국민임대", units: 400 }),
        apt({ id: "target-1", units: 100 }),
      ],
      unsoldByRegionGu: { "경기": { "수원시": 50 } },
    });
    const lease = plan.find((p) => p.id === "lease-1");
    const target = plan.find((p) => p.id === "target-1");
    expect(lease?.action).toBe("skip_lease");
    // 분모에서 임대형(400)이 빠졌으므로 totalUnitsInGu = 100(target 자신만) → estimated = round(50*100/100) = 50
    expect(target?.totalUnitsInGu).toBe(100);
    expect(target?.newEstimate).toBe(50);
  });

  it("두 단어 gu('천안시 동남구') — 분모는 같은 시 전체(동남구+서북구) 비임대 합", () => {
    const plan = planUnsoldUpdates({
      apartments: [
        apt({ id: "a1", region: "충남", gu: "천안시 동남구", units: 300 }),
        apt({ id: "a2", region: "충남", gu: "천안시 서북구", units: 700 }),
      ],
      unsoldByRegionGu: { "충남": { "천안시": 100 } },
    });
    const a1 = plan.find((p) => p.id === "a1");
    const a2 = plan.find((p) => p.id === "a2");
    expect(a1?.kosisKey).toBe("천안시");
    expect(a2?.kosisKey).toBe("천안시");
    // 옛 결함이었다면 시도(충남) 합계 전체가 각 구에 몰렸을 것 — 이제는 시 단위 분모로 비례배분
    expect(a1?.totalUnitsInGu).toBe(1000); // 300+700
    expect(a1?.newEstimate).toBe(30); // round(100*300/1000)
    expect(a2?.newEstimate).toBe(70); // round(100*700/1000)
  });

  it("매칭 실패 시 시도 합계로 가지 않는다 — skip_no_match (옛 결함 삭제 확인)", () => {
    // 시도 합계(50)가 단지 세대수(500)보다 작아, 시도 합계로 폴백해도 100% 이하 비율이
    // 나오는 픽스처 — calcProportionalUnsold 의 자체 100% 상한 검사에 뮤테이션이 가려지지
    // 않도록 일부러 작게 잡았다(뮤테이션 검증 시 실측: 큰 분모는 100% 초과로 null 이 되어
    // "폴백을 되살려도" 결과가 우연히 같아지는 함정이 있었다).
    const plan = planUnsoldUpdates({
      apartments: [apt({ region: "충남", gu: "모르는시", units: 500 })],
      // 충남 시도 합계는 천안시(30)+아산시(20)=50 이지만, gu 매칭 실패 시 이 값을 절대 쓰면 안 된다
      unsoldByRegionGu: { "충남": { "천안시": 30, "아산시": 20 } },
    });
    expect(plan[0].action).toBe("skip_no_match");
    expect(plan[0].newEstimate).toBeNull();
  });

  it("새 추정 미분양률이 50% 이상이면 hold_ge50 — 쓰지 않는다", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt({ units: 100 })],
      // guUnsold=60, totalUnitsInGu=100(자기 자신) → estimated=60, rate=60%
      unsoldByRegionGu: { "경기": { "수원시": 60 } },
    });
    expect(plan[0].action).toBe("hold_ge50");
    expect(plan[0].newRate).toBe(60);
  });

  it("정확히 50%도 hold_ge50 (경계값, >= 조건)", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt({ units: 100 })],
      unsoldByRegionGu: { "경기": { "수원시": 50 } },
    });
    expect(plan[0].action).toBe("hold_ge50");
    expect(plan[0].newRate).toBe(50);
  });

  it("49.9% 는 write (경계값 확인)", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt({ units: 1000 })],
      // guUnsold=499, totalUnitsInGu=1000 → rate=49.9%
      unsoldByRegionGu: { "경기": { "수원시": 499 } },
    });
    expect(plan[0].action).toBe("write");
    expect(plan[0].newRate).toBe(49.9);
  });

  it("세션568-3 규정 변경 — NULL 출처 값>0 은 이제 존중되지 않고 KOSIS 가 덮는다(write)", () => {
    // 옛 규칙(세션559~568-2)이면 '유효한 기존 값(500 이하)' 으로 존중(skip_preserved)했을 자리.
    // 사장님 3차 결정으로 출처 모르는 옛 값도 KOSIS 가 덮게 됐다.
    const plan = planUnsoldUpdates({
      apartments: [apt({ unsold: 30, units: 500, unsold_source: null })],
      unsoldByRegionGu: { "경기": { "수원시": 50 } },
    });
    expect(plan[0].action).toBe("write");
    expect(plan[0].newEstimate).toBe(50);
  });

  it("applyhome 출처는 규칙3 으로 skip_preserved — 새 추정치도 참고용으로 함께 기록", () => {
    // 세션569 C6: 존중은 공고일 + 6개월 안에서만 — 공고 2026-08-14, 기준 2026-10-09 KST.
    const plan = planUnsoldUpdates({
      apartments: [apt({ unsold: 30, units: 500, unsold_source: "applyhome", unsold_as_of: "2026-08-14" })],
      unsoldByRegionGu: { "경기": { "수원시": 50 } },
      now: new Date("2026-10-08T21:00:00Z"),
    });
    expect(plan[0].action).toBe("skip_preserved");
    expect(plan[0].newEstimate).toBe(50); // 비교용으로 계산은 됐지만 안 쓴다
  });

  it("guUnsold 가 0 이하이면 write_zero(0 을 쓴다) — 세션568-3: 비우지 않고 0 을 쓴다", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt()],
      unsoldByRegionGu: { "경기": { "수원시": 0 } },
    });
    expect(plan[0].action).toBe("write_zero");
    expect(plan[0].newEstimate).toBe(0);
    expect(plan[0].newRate).toBe(0);
  });

  it("calcProportionalUnsold 가 null(비정상 비율 100% 초과)이면 skip_no_estimate", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt({ units: 10 })],
      // totalUnitsInGu=10(자기자신), guUnsold=1000 → rate 10000% > 100 → calcProportionalUnsold null
      unsoldByRegionGu: { "경기": { "수원시": 1000 } },
    });
    expect(plan[0].action).toBe("skip_no_estimate");
  });

  it("세종(gu=null) — '세종시' 로 매칭해 write 된다", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt({ id: "sejong-1", region: "세종", gu: null, units: 200 })],
      unsoldByRegionGu: { "세종": { "세종시": 20 } },
    });
    expect(plan[0].kosisKey).toBe("세종시");
    expect(plan[0].action).toBe("write");
    expect(plan[0].newEstimate).toBe(20); // totalUnitsInGu = 자기 units(200, 세종시 분모 없으면 자신)
  });
});

// ── 세션568-3 — 매물 유래 판정(listingDerived) 폐지. 출처(unsold_source)만으로 갈린다 ──
describe("planUnsoldUpdates — 매물 유래 판정 폐지 확인(값의 모양이 아니라 출처로만 갈린다)", () => {
  /** @param {Partial<any>} overrides */
  function apt(overrides = {}) {
    return {
      id: "id-1", name: "테스트단지", region: "경기", gu: "수원시",
      units: 500, unsold: null, unsold_rate: null, naver_sell_count: null, presale_type: null,
      unsold_source: null,
      ...overrides,
    };
  }

  it("KOSIS=0 · naver_sell_count 값과 무관하게 → write_zero (출처 NULL, 값의 모양은 이제 안 본다)", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt({ unsold: 30, naver_sell_count: 12 })], // 매물 수와 다름 — 옛 판정으론 skip_kosis_zero 였을 자리
      unsoldByRegionGu: { "경기": { "수원시": 0 } },
    });
    expect(plan[0].action).toBe("write_zero");
    expect(plan[0].newEstimate).toBe(0);
  });

  it("KOSIS=0 · unsold===naver_sell_count(옛 '매물 유래') → write_zero (clear_listing_derived 아님, 0 을 쓴다)", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt({ unsold: 12, naver_sell_count: 12 })],
      unsoldByRegionGu: { "경기": { "수원시": 0 } },
    });
    expect(plan[0].action).toBe("write_zero");
  });

  it("추정 반올림이 0 이하(거의 0) → write_zero (출처 무관, 0 을 쓴다)", () => {
    const plan = planUnsoldUpdates({
      apartments: [
        apt({ id: "big", units: 999 }), // 분모를 키우는 이웃
        apt({ id: "target", units: 2, unsold: 3, naver_sell_count: 3 }), // units>=2(무효 아님)
      ],
      unsoldByRegionGu: { "경기": { "수원시": 1 } }, // totalUnitsInGu=1001 → round(1*2/1001)=0
    });
    const target = plan.find((p) => p.id === "target");
    expect(target?.action).toBe("write_zero");
  });

  it("추정이 100% 초과(계산 불가) → skip_no_estimate(값 유지, 비우지도 0 쓰지도 않는다)", () => {
    // guUnsold=1000, aptUnits=100, totalUnitsInGu=500 → rate=200% > 100 → calcProportionalUnsold null
    const plan = planUnsoldUpdates({
      apartments: [apt({ units: 100, unsold: 50, naver_sell_count: 50 })],
      unsoldByRegionGu: { "경기": { "수원시": 1000 } },
    });
    expect(plan[0].action).toBe("skip_no_estimate");
    expect(plan[0].newEstimate).toBeNull();
    expect(plan[0].currentUnsold).toBe(50); // 값 유지 확인
  });

  it("유효한 추정 → write (기존 값 모양과 무관하게 정상 추정치를 쓴다)", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt({ units: 500, unsold: 30, naver_sell_count: 30 })],
      unsoldByRegionGu: { "경기": { "수원시": 50 } },
    });
    expect(plan[0].action).toBe("write");
    expect(plan[0].newEstimate).toBe(50);
  });

  it("임대형은 KOSIS=0 이어도 skip_lease (임대 제외가 규칙 5 전체보다 우선)", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt({ presale_type: "국민임대", units: 500, unsold: 30, naver_sell_count: 30 })],
      unsoldByRegionGu: { "경기": { "수원시": 0 } },
    });
    expect(plan[0].action).toBe("skip_lease");
  });

  it("applyhome 출처 + 매물 수와 값이 같음 + KOSIS=0 → 그래도 skip_preserved(값 유지, 규칙3 이 규칙5 보다 먼저 적용)", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt({ unsold: 12, naver_sell_count: 12, unsold_source: "applyhome", unsold_as_of: "2026-08-14" })],
      unsoldByRegionGu: { "경기": { "수원시": 0 } },
      now: new Date("2026-10-08T21:00:00Z"), // 세션569 C6: 공고 6개월 안
    });
    expect(plan[0].action).toBe("skip_preserved");
    expect(plan[0].currentUnsold).toBe(12); // 값 유지 확인 — write_zero 로 안 간다
  });
});

// ── 세션568-3 — unsold_source='kosis' 인데 이번 회차가 못 채우면(매칭실패=값유지, 0=0쓰기) ──
describe("planUnsoldUpdates — unsold_source='kosis' 동결 방지 (규칙5)", () => {
  /** @param {Partial<any>} overrides */
  function apt(overrides = {}) {
    return {
      id: "id-1", name: "테스트단지", region: "경기", gu: "수원시",
      units: 500, unsold: 30, unsold_rate: 6, naver_sell_count: null, presale_type: null,
      unsold_source: "kosis",
      ...overrides,
    };
  }

  // 검사관 H1(높음, 세션568-2·-3 모두 유지) — 매칭 실패는 "KOSIS 가 0" 이 아니다. 값을 유지한다.
  it("kosis 출처 · gu 매칭 실패(resolveKosisGuKey null) → skip_no_match (값 유지)", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt({ region: "충남", gu: "모르는시" })],
      unsoldByRegionGu: { "충남": { "천안시": 100 } },
    });
    expect(plan[0].action).toBe("skip_no_match");
    expect(plan[0].currentUnsold).toBe(30);
  });

  it("kosis 출처 · guUnsold 자체가 없음(그 지역 응답 자체가 누락) → skip_no_match (값 유지)", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt()],
      unsoldByRegionGu: { "경기": { "성남시": 10 } }, // 수원시 없음
    });
    expect(plan[0].action).toBe("skip_no_match");
    expect(plan[0].currentUnsold).toBe(30);
  });

  it("kosis 출처 · 시도 전체가 응답에서 빠짐(광주·전남 누락 시나리오) → skip_no_match, 값 유지", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt({ region: "광주", gu: "북구" })],
      unsoldByRegionGu: { "경기": { "수원시": 50 } }, // "광주" 키 자체가 없음
    });
    expect(plan[0].action).toBe("skip_no_match");
    expect(plan[0].currentUnsold).toBe(30);
  });

  it("kosis 출처 · KOSIS=0 → write_zero(0 을 쓴다, 비우지 않는다 — 사장님 3차 결정)", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt()],
      unsoldByRegionGu: { "경기": { "수원시": 0 } },
    });
    expect(plan[0].action).toBe("write_zero");
    expect(plan[0].newEstimate).toBe(0);
  });

  it("kosis 출처 · 반올림 추정이 0(거의 0) → write_zero", () => {
    const plan = planUnsoldUpdates({
      apartments: [
        apt({ id: "big", units: 999, unsold: null, unsold_rate: null, unsold_source: null }),
        apt({ id: "target", units: 2 }), // units>=2(무효 아님)
      ],
      unsoldByRegionGu: { "경기": { "수원시": 1 } }, // totalUnitsInGu=1001 → round(1*2/1001)=0
    });
    const target = plan.find((p) => p.id === "target");
    expect(target?.action).toBe("write_zero");
  });

  it("kosis 출처 · 추정이 100% 초과(계산 불가) → skip_no_estimate 그대로(값 유지)", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt({ units: 100 })],
      unsoldByRegionGu: { "경기": { "수원시": 1000 } },
    });
    expect(plan[0].action).toBe("skip_no_estimate");
  });

  it("kosis 출처 · 정상 매칭·유효 추정 → write (shouldSkipKosisFill 이 false 라 skip_preserved 로 안 빠진다)", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt()],
      unsoldByRegionGu: { "경기": { "수원시": 50 } },
    });
    expect(plan[0].action).toBe("write");
    expect(plan[0].newEstimate).toBe(50);
  });

  it("currentSource 가 계획 행에 실린다", () => {
    const plan = planUnsoldUpdates({
      apartments: [apt(), apt({ id: "id-2", unsold_source: "applyhome" }), apt({ id: "id-3", unsold_source: null })],
      unsoldByRegionGu: { "경기": { "수원시": 50 } },
    });
    expect(plan.find((p) => p.id === "id-1")?.currentSource).toBe("kosis");
    expect(plan.find((p) => p.id === "id-2")?.currentSource).toBe("applyhome");
    expect(plan.find((p) => p.id === "id-3")?.currentSource).toBeNull();
  });
});

// ── 세션568-3 핵심 시험 — 수집기가 자기 출력 위에서 2·3회차를 돌려도 동결되지 않는다 ──
describe("planUnsoldUpdates — 자기 출력 위 2·3회차 (동결 방지 회귀 가드)", () => {
  it("1회차 write → DB 반영(unsold_source='kosis') → 2회차(다른 구 합계) → write + 새 추정치(동결 안 됨)", () => {
    const round1 = planUnsoldUpdates({
      apartments: [{ id: "t1", name: "타겟", region: "경기", gu: "수원시", units: 500, unsold: null, unsold_rate: null, naver_sell_count: null, presale_type: null, unsold_source: null }],
      unsoldByRegionGu: { "경기": { "수원시": 50 } },
    });
    expect(round1[0].action).toBe("write");
    expect(round1[0].newEstimate).toBe(50);

    const dbAfterRound1 = { id: "t1", name: "타겟", region: "경기", gu: "수원시", units: 500, unsold: round1[0].newEstimate, unsold_rate: round1[0].newRate, naver_sell_count: null, presale_type: null, unsold_source: "kosis" };

    const round2 = planUnsoldUpdates({
      apartments: [dbAfterRound1],
      unsoldByRegionGu: { "경기": { "수원시": 80 } },
    });
    expect(round2[0].action).toBe("write");
    expect(round2[0].newEstimate).toBe(80);
  });

  it("3회차 — 2회차와 같은 KOSIS 값이면 변화 0(같은 추정치를 다시 write)", () => {
    const dbAfterRound2 = { id: "t1", name: "타겟", region: "경기", gu: "수원시", units: 500, unsold: 80, unsold_rate: 16, naver_sell_count: null, presale_type: null, unsold_source: "kosis" };
    const round3 = planUnsoldUpdates({
      apartments: [dbAfterRound2],
      unsoldByRegionGu: { "경기": { "수원시": 80 } }, // 2회차와 동일
    });
    expect(round3[0].action).toBe("write");
    expect(round3[0].newEstimate).toBe(80); // 값 변화 없음(같은 추정치)
  });

  it("0 을 쓴 행도 다음 달 양수 KOSIS 값이 오면 갱신된다(자기잠금 방지, 검사관 M3)", () => {
    // 1회차: KOSIS=0 → write_zero(unsold=0, source='kosis')
    const round1 = planUnsoldUpdates({
      apartments: [{ id: "t2", name: "영단지", region: "경기", gu: "수원시", units: 500, unsold: null, unsold_rate: null, naver_sell_count: null, presale_type: null, unsold_source: null }],
      unsoldByRegionGu: { "경기": { "수원시": 0 } },
    });
    expect(round1[0].action).toBe("write_zero");

    const dbAfterRound1 = { id: "t2", name: "영단지", region: "경기", gu: "수원시", units: 500, unsold: 0, unsold_rate: 0, naver_sell_count: null, presale_type: null, unsold_source: "kosis" };

    // 2회차: KOSIS 가 이제 40 을 준다 — 옛 규칙(unsold===0 존중)이면 여기서도 존중돼 영구 잠길 자리.
    const round2 = planUnsoldUpdates({
      apartments: [dbAfterRound1],
      unsoldByRegionGu: { "경기": { "수원시": 40 } },
    });
    expect(round2[0].action).toBe("write");
    expect(round2[0].newEstimate).toBe(40); // 자기잠금 없이 갱신됨
  });

  it("같은 시나리오에서 applyhome 출처 단지는 공고 6개월 안이면 여러 회차에도 보존된다(대조군, 세션569 C6)", () => {
    const apt = { id: "ah-1", name: "청약홈단지", region: "경기", gu: "수원시", units: 500, unsold: 30, unsold_rate: 6, naver_sell_count: null, presale_type: null, unsold_source: "applyhome", unsold_as_of: "2026-08-14" };
    const now = new Date("2026-10-08T21:00:00Z"); // 2026-10-09 06:00 KST — 공고 후 2개월

    const round1 = planUnsoldUpdates({ apartments: [apt], unsoldByRegionGu: { "경기": { "수원시": 50 } }, now });
    expect(round1[0].action).toBe("skip_preserved");

    const round2 = planUnsoldUpdates({ apartments: [apt], unsoldByRegionGu: { "경기": { "수원시": 80 } }, now });
    expect(round2[0].action).toBe("skip_preserved");

    const round3 = planUnsoldUpdates({ apartments: [apt], unsoldByRegionGu: { "경기": { "수원시": 0 } }, now });
    expect(round3[0].action).toBe("skip_preserved"); // KOSIS=0 이어도 applyhome 은 흔들리지 않는다
  });

  it("같은 시나리오에서 kosis 출처 단지가 2회차에 KOSIS=0 이면 write_zero(비움도 오염값 잔류도 아니다)", () => {
    const dbAfterRound1 = { id: "t1", name: "타겟", region: "경기", gu: "수원시", units: 500, unsold: 50, unsold_rate: 10, naver_sell_count: null, presale_type: null, unsold_source: "kosis" };
    const round2 = planUnsoldUpdates({ apartments: [dbAfterRound1], unsoldByRegionGu: { "경기": { "수원시": 0 } } });
    expect(round2[0].action).toBe("write_zero");
  });
});

// ── 검사관 H1 시나리오 — 광주+전남 통째 누락 → 그 지역 행은 0곳 변경(값 유지) ──
describe("planUnsoldUpdates — 시도 통째 누락(광주·전남) 시 0곳 변경", () => {
  it("광주·전남 kosis 출처 행은 skip_no_match 로 전부 값 유지, 다른 지역은 정상 처리", () => {
    const apartments = [
      { id: "gwangju-1", name: "광주단지", region: "광주", gu: "북구", units: 500, unsold: 30, unsold_rate: 6, naver_sell_count: null, presale_type: null, unsold_source: "kosis" },
      { id: "jeonnam-1", name: "전남단지", region: "전남", gu: "순천시", units: 300, unsold: 20, unsold_rate: 6.7, naver_sell_count: null, presale_type: null, unsold_source: "kosis" },
      { id: "gyeonggi-1", name: "경기단지", region: "경기", gu: "수원시", units: 500, unsold: 10, unsold_rate: 2, naver_sell_count: null, presale_type: null, unsold_source: "kosis" },
    ];
    // 광주·전남 키 자체가 응답에 없음(통째 누락) — 경기만 정상 응답
    const plan = planUnsoldUpdates({ apartments, unsoldByRegionGu: { "경기": { "수원시": 50 } } });

    const gwangju = plan.find((p) => p.id === "gwangju-1");
    const jeonnam = plan.find((p) => p.id === "jeonnam-1");
    const gyeonggi = plan.find((p) => p.id === "gyeonggi-1");

    expect(gwangju?.action).toBe("skip_no_match");
    expect(gwangju?.currentUnsold).toBe(30); // 변경 0
    expect(jeonnam?.action).toBe("skip_no_match");
    expect(jeonnam?.currentUnsold).toBe(20); // 변경 0
    expect(gyeonggi?.action).toBe("write"); // 다른 지역은 정상 처리
  });
});

// ── 세션568 — main() 의 실제 write/비움 UPDATE 페이로드에 unsold_source 가 실리는지 ──
describe("main() — 값 유지 대상(skip_no_match·skip_no_estimate·hold_ge50)은 UPDATE 를 아예 안 부른다", () => {
  beforeEach(() => {
    selectAllMock.mockReset();
    fetchWithRetryMock.mockReset();
    recordCollectorRun.mockClear();
    getSupabase.mockReset();
  });

  it("kosis 출처 매칭 실패(skip_no_match) → apartments UPDATE 0회(값 유지)", async () => {
    const apartments = [
      { id: "apt-nomatch", name: "매칭실패단지", region: "충남", gu: "모르는시", units: 500, unsold: 30, unsold_rate: 6, naver_sell_count: null, presale_type: null, unsold_source: "kosis" },
    ];
    selectAllMock.mockResolvedValueOnce([]).mockResolvedValueOnce(apartments);
    fetchWithRetryMock.mockResolvedValue({ json: async () => [{ C1_NM: "충남", C2_NM: "천안시", PRD_DE: "202601", DT: "100" }] });

    /** @type {any[]} */
    const updateCalls = [];
    getSupabase.mockReturnValue({
      from: (/** @type {string} */ table) => ({
        update: (/** @type {any} */ payload) => ({
          eq: fakeEq(updateCalls, table, payload),
        }),
      }),
    });

    const originalArgv = process.argv;
    process.argv = [...originalArgv.filter((a) => a !== "--dry-run")];
    try {
      await main();
    } finally {
      process.argv = originalArgv;
    }

    expect(updateCalls.find((c) => c.table === "apartments" && c.id === "apt-nomatch")).toBeUndefined();
  });
});

// ── 전남광주 파싱 — MERGED_SIDO_RE 확장 이후 (세션567) ──
describe("parseKosisRows/parseKosisRowsAllMonths — 전남광주 통합 시도 실측 행 형태", () => {
  it("C1_NM='전남광주' + C2_NM='북구' → 광주로 분류된다", () => {
    const rows = [makeRow("전남광주", "북구", "202607", 30)];
    const result = parseKosisRows(rows);
    expect(result["광주"]?.["북구"]).toBe(30);
  });

  it("C1_NM='전남광주' + C2_NM='순천시' → 전남으로 분류된다", () => {
    const rows = [makeRow("전남광주", "순천시", "202607", 45)];
    const result = parseKosisRows(rows);
    expect(result["전남"]?.["순천시"]).toBe(45);
  });

  it("C1_NM='전남광주' + C2_NM='계'(시도 합계) → 못 갈라 버려진다", () => {
    const rows = [makeRow("전남광주", "계", "202607", 999)];
    const result = parseKosisRows(rows);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("광주·전남 구 값을 합해 시도 합계를 재구성한다(aggregateRegionTotals)", () => {
    const rows = [
      makeRow("전남광주", "북구", "202607", 30),
      makeRow("전남광주", "광산구", "202607", 20),
      makeRow("전남광주", "순천시", "202607", 45),
    ];
    const parsed = parseKosisRows(rows);
    const totals = aggregateRegionTotals(parsed);
    expect(totals["광주"]).toBe(50); // 30+20 (소계/_total 없어 구 합산)
    expect(totals["전남"]).toBe(45);
  });

  it("parseKosisRowsAllMonths 도 동일하게 '전남광주'를 가른다", () => {
    const rows = [makeRow("전남광주", "북구", "202607", 30)];
    const result = parseKosisRowsAllMonths(rows);
    expect(result["광주"]?.["북구"]).toEqual({ "202607": 30 });
  });
});

// ── 세션569 C6 검사관 후속 — 조회 실패는 failure 로, KOSIS 쓰기는 공고일을 비운다 ──
describe("C6 후속 (세션569 검사관)", () => {
  beforeEach(() => {
    selectAllMock.mockReset();
    fetchWithRetryMock.mockReset();
    recordCollectorRun.mockClear();
  });

  it("apartments 조회가 실패하면(예: 마이그 전 unsold_as_of 칸 없음) success ok=0 이 아니라 failure 로 기록한다", async () => {
    selectAllMock
      .mockResolvedValueOnce([]) // regions
      .mockRejectedValueOnce(new Error('column apartments.unsold_as_of does not exist')); // apartments
    fetchWithRetryMock.mockResolvedValue({ json: async () => [{ C1_NM: "경기", C2_NM: "수원시", PRD_DE: "202601", DT: "10" }] });
    const originalArgv = process.argv;
    process.argv = [...originalArgv, "--dry-run"];
    try {
      await expect(main()).rejects.toThrow(/apartments 조회 실패/);
    } finally {
      process.argv = originalArgv;
    }
    expect(recordCollectorRun).toHaveBeenCalledWith("kosis-unsold", expect.objectContaining({
      status: "failure",
      errorMessage: expect.stringContaining("apartments 조회 실패"),
    }));
  });

  it("KOSIS 쓰기 내용은 출처 kosis + unsold_as_of null(만료된 applyhome 을 덮을 때 옛 공고일이 남지 않게)", async () => {
    const { kosisWritePayload } = await import("./collect-unsold-kosis.mjs");
    expect(kosisWritePayload(50, 10, "T")).toEqual({ unsold: 50, unsold_rate: 10, unsold_source: "kosis", unsold_as_of: null, updated_at: "T" });
    expect(kosisWritePayload(0, 0, "T").unsold_as_of).toBeNull();
  });

  it("write·write_zero 두 쓰기 경로가 모두 kosisWritePayload 를 쓴다(소스)", () => {
    const src = readFileSync(path.join(process.cwd(), "scripts/collectors/collect-unsold-kosis.mjs"), "utf8");
    // 세션570: 두 경로 모두 hold 보호 헬퍼(updateApartmentUnlessHold)를 거쳐 쓴다.
    expect(src).toContain("updateApartmentUnlessHold(sb, p.id, kosisWritePayload(p.newEstimate, p.newRate))");
    expect(src).toContain("updateApartmentUnlessHold(sb, p.id, kosisWritePayload(0, 0))");
    expect(src).not.toMatch(/unsold_source: "kosis",\s*updated_at/);
  });
});

// ── 세션570 — 사람 보류(hold): 수집기가 사람이 비운 자리를 0 으로 되돌리지 않는다 ──
describe("사람 보류 hold (세션570)", () => {
  /** @param {Partial<any>} o */
  const apt = (o = {}) => ({
    id: "h-1", name: "보류단지", region: "경기", gu: "수원시",
    units: 500, unsold: null, unsold_rate: null, naver_sell_count: null, presale_type: null, unsold_source: null, unsold_as_of: null,
    ...o,
  });
  const NOW = new Date("2026-10-09T05:30:00+09:00");

  it("shouldSkipKosisFill — hold 는 값·세대수·날짜와 무관하게 존중(true), 같은 행이 출처 NULL 이면 KOSIS 가 정한다(false)", async () => {
    const { shouldSkipKosisFill } = await import("./collect-unsold-kosis.mjs");
    expect(shouldSkipKosisFill(apt({ unsold_source: "hold" }), NOW)).toBe(true);
    expect(shouldSkipKosisFill(apt({ unsold_source: "hold", unsold_as_of: "2020-01-01" }), NOW)).toBe(true); // 만료 없음
    expect(shouldSkipKosisFill(apt({ unsold_source: null }), NOW)).toBe(false); // 대조군 — 이게 10/09 되돌림 경로
  });

  it("planUnsoldUpdates — hold 는 skip_hold, 무효(units≤1)·임대형 판정보다 먼저", () => {
    const plan = planUnsoldUpdates({
      apartments: [
        apt({ id: "h-ok", unsold_source: "hold" }),
        apt({ id: "h-tiny", unsold_source: "hold", units: 1 }),
        apt({ id: "h-lease", unsold_source: "hold", presale_type: "국민임대" }),
        apt({ id: "h-nogu", unsold_source: "hold", gu: null }),
      ],
      unsoldByRegionGu: { "경기": { "수원시": 0 } },
      now: NOW,
    });
    expect(plan.map((p) => [p.id, p.action])).toEqual([
      ["h-ok", "skip_hold"], ["h-tiny", "skip_hold"], ["h-lease", "skip_hold"], ["h-nogu", "skip_hold"],
    ]);
  });

  it("★ 대조군 — 같은 값·출처 NULL 이면 KOSIS 0 에 write_zero(빈칸 → 0), hold 면 skip_hold", () => {
    const u = { "경기": { "수원시": 0 } };
    expect(planUnsoldUpdates({ apartments: [apt()], unsoldByRegionGu: u, now: NOW })[0].action).toBe("write_zero");
    expect(planUnsoldUpdates({ apartments: [apt({ unsold_source: "hold" })], unsoldByRegionGu: u, now: NOW })[0].action).toBe("skip_hold");
  });

  it("★ 분모 불변 — hold 단지가 같은 시에 있어도 이웃 단지 추정치는 hold 전과 같다", () => {
    const u = { "경기": { "수원시": 100 } };
    const neighbour = apt({ id: "nb", units: 300, unsold: 10, unsold_rate: 3.3, unsold_source: "kosis" });
    const before = planUnsoldUpdates({ apartments: [apt({ id: "h-1", units: 700 }), neighbour], unsoldByRegionGu: u, now: NOW });
    const after = planUnsoldUpdates({ apartments: [apt({ id: "h-1", units: 700, unsold_source: "hold" }), neighbour], unsoldByRegionGu: u, now: NOW });
    const b = before.find((p) => p.id === "nb");
    const a = after.find((p) => p.id === "nb");
    expect(a?.totalUnitsInGu).toBe(1000); // 700(hold) + 300 — hold 도 분모에 남는다
    expect(a?.newEstimate).toBe(b?.newEstimate);
    expect(a?.newEstimate).toBe(30);
    expect(after.find((p) => p.id === "h-1")?.action).toBe("skip_hold");
  });

  it("summarizeHoldAndNullToZero — hold 명단과 빈칸→0 명단(값>0 → 0 은 빈칸→0 아님)", async () => {
    const { summarizeHoldAndNullToZero } = await import("./collect-unsold-kosis.mjs");
    const plan = planUnsoldUpdates({
      apartments: [
        apt({ id: "h-1", unsold_source: "hold" }),
        apt({ id: "z-null" }),
        apt({ id: "z-pos", unsold: 5, unsold_rate: 1, unsold_source: "kosis" }),
      ],
      unsoldByRegionGu: { "경기": { "수원시": 0 } },
      now: NOW,
    });
    expect(summarizeHoldAndNullToZero(plan)).toEqual({ holdIds: ["h-1"], nullToZeroIds: ["z-null"] });
  });

  it("excludeHoldFromHistory — hold 만 빼고 나머지는 순서 그대로", async () => {
    const { excludeHoldFromHistory } = await import("./collect-unsold-kosis.mjs");
    const r = excludeHoldFromHistory([{ id: "a", unsold_source: null }, { id: "h", unsold_source: "hold" }, { id: "k", unsold_source: "kosis" }]);
    expect(r.kept.map((x) => x.id)).toEqual(["a", "k"]);
    expect(r.excludedIds).toEqual(["h"]);
  });

  it("updateApartmentUnlessHold — hold 보호 WHERE 를 걸고, 돌아온 행으로 판정(빈 배열 = protected)", async () => {
    const { updateApartmentUnlessHold, NOT_HOLD_FILTER } = await import("./collect-unsold-kosis.mjs");
    expect(NOT_HOLD_FILTER).toBe("unsold_source.is.null,unsold_source.neq.hold");
    /** @type {any[]} */
    const calls = [];
    const sb = { from: (/** @type {string} */ t) => ({ update: (/** @type {any} */ p) => ({ eq: fakeEq(calls, t, p, new Set(["h-1"])) }) }) };
    expect(await updateApartmentUnlessHold(sb, "a-1", { unsold: 3 })).toEqual({ status: "updated" });
    expect(await updateApartmentUnlessHold(sb, "h-1", { unsold: 0 })).toEqual({ status: "protected" });
    expect(calls.map((c) => [c.table, c.id, c.filter, c.selected])).toEqual([
      ["apartments", "a-1", NOT_HOLD_FILTER, "id"],
      ["apartments", "h-1", NOT_HOLD_FILTER, "id"],
    ]);
    const errSb = { from: () => ({ update: () => ({ eq: () => ({ or: () => ({ select: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }) }) }) };
    expect(await updateApartmentUnlessHold(errSb, "x", {})).toEqual({ status: "error", message: "boom" });
  });

  it("소스 가드 — apartments UPDATE 는 헬퍼 한 곳뿐(hold 보호 WHERE + select id), write·write_zero 두 경로가 헬퍼를 부른다", () => {
    const src = readFileSync(path.join(process.cwd(), "scripts/collectors/collect-unsold-kosis.mjs"), "utf8");
    expect(src.match(/from\("apartments"\)\.update\(/g) ?? []).toHaveLength(1);
    expect(src).toContain('sb.from("apartments").update(payload).eq("id", id).or(NOT_HOLD_FILTER).select("id")');
    expect(src.match(/await updateApartmentUnlessHold\(sb, p\.id, /g) ?? []).toHaveLength(2);
    expect(src).toContain("for (const apt of historyApartments) {");
  });

  describe("main() 배선", () => {
    beforeEach(() => {
      selectAllMock.mockReset();
      fetchWithRetryMock.mockReset();
      recordCollectorRun.mockClear();
    });

    /** 차단기(값>0 대비 0-쓰기)에 안 걸리게 모두 빈칸(값 null) 행으로 — 분모 0 → 미발동 */
    const fixture = () => [
      apt({ id: "h-1", name: "보류", unsold_source: "hold", unsold_as_of: "2026-09-24" }),
      apt({ id: "z-1", name: "빈칸" }),
    ];

    it("dry-run — [hold]·[빈칸→0] 명단 로그 + impact 에 holdIds·nullToZeroIds + 요약에 hold=1", async () => {
      const os = await import("node:os");
      const { rmSync } = await import("node:fs");
      const impactPath = path.join(os.tmpdir(), `s570_hold_impact_${Date.now()}.json`);
      selectAllMock.mockResolvedValueOnce([]).mockResolvedValueOnce(fixture());
      fetchWithRetryMock.mockResolvedValue({ json: async () => [{ C1_NM: "경기", C2_NM: "수원시", PRD_DE: "202607", DT: "0" }] });
      /** @type {string[]} */
      const lines = [];
      const { log: logMock } = /** @type {any} */ (await import("./_shared.mjs"));
      logMock.mockImplementation((/** @type {string} */ _p, /** @type {string} */ m) => { lines.push(m); });
      const originalArgv = process.argv;
      process.argv = [...originalArgv, "--dry-run", `--impact-out=${impactPath}`];
      try {
        await main();
        const parsed = JSON.parse(readFileSync(impactPath, "utf8"));
        expect(parsed.holdIds).toEqual(["h-1"]);
        expect(parsed.nullToZeroIds).toEqual(["z-1"]);
      } finally {
        process.argv = originalArgv;
        logMock.mockReset();
        try { rmSync(impactPath); } catch { /* noop */ }
      }
      expect(lines).toContain("[hold] 1건: h-1");
      expect(lines).toContain("[빈칸→0] 1건: z-1");
      expect(lines.some((l) => l.startsWith("요약") && l.includes("hold=1"))).toBe(true);
    });

    it("--apply — DB 가 hold 보호로 0행을 돌려주면 성공으로 세지 않는다(protectedByHold), hold 행은 UPDATE·history 둘 다 안 간다", async () => {
      selectAllMock.mockResolvedValueOnce([]).mockResolvedValueOnce([...fixture(), apt({ id: "race-1", name: "경합" })]);
      fetchWithRetryMock.mockResolvedValue({ json: async () => [
        { C1_NM: "경기", C2_NM: "수원시", PRD_DE: "202606", DT: "40" },
        { C1_NM: "경기", C2_NM: "수원시", PRD_DE: "202607", DT: "0" },
      ] });
      /** @type {any[]} */
      const updateCalls = [];
      // race-1 = 계획 뒤 사람이 hold 로 바꾼 행 — DB WHERE 가 막아 빈 배열을 돌려준다
      getSupabase.mockReturnValue({
        from: (/** @type {string} */ table) => ({ update: (/** @type {any} */ payload) => ({ eq: fakeEq(updateCalls, table, payload, new Set(["race-1"])) }) }),
      });
      const { log: logMock, upsertBatch } = /** @type {any} */ (await import("./_shared.mjs"));
      upsertBatch.mockReset();
      upsertBatch.mockResolvedValue(0);
      /** @type {string[]} */
      const lines = [];
      logMock.mockImplementation((/** @type {string} */ _p, /** @type {string} */ m) => { lines.push(m); });
      const originalArgv = process.argv;
      process.argv = [...originalArgv.filter((a) => a !== "--dry-run")];
      try {
        await main();
      } finally {
        process.argv = originalArgv;
        getSupabase.mockReset();
        logMock.mockReset();
      }
      const apts = updateCalls.filter((c) => c.table === "apartments");
      expect(apts.map((c) => c.id).sort()).toEqual(["race-1", "z-1"]); // h-1 은 UPDATE 를 부르지도 않는다
      expect(lines.some((l) => l.includes("KOSIS 0-쓰기: 1건"))).toBe(true); // race-1 은 세지 않는다
      expect(lines.some((l) => l.startsWith("요약") && l.includes("hold 보호로 건너뜀 1"))).toBe(true);
      expect(recordCollectorRun).toHaveBeenCalledWith("kosis-unsold", { ok: 1 });
      // history — hold 행 제외, 나머지 단지는 202606 값(40)의 비례배분으로 저장 대상
      expect(lines).toContain("unsold_history hold 제외: 1건");
      const historyRows = upsertBatch.mock.calls.find((/** @type {any[]} */ c) => c[0] === "unsold_history")?.[1] ?? [];
      expect(historyRows.some((/** @type {any} */ r) => r.apartment_id === "h-1")).toBe(false);
      expect(historyRows.some((/** @type {any} */ r) => r.apartment_id === "z-1")).toBe(true);
    });
  });
});
