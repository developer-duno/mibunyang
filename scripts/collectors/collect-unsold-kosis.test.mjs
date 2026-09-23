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

const { parseKosisRows, parseKosisRowsAllMonths, aggregateRegionTotals, calcProportionalUnsold, main } =
  await import("./collect-unsold-kosis.mjs");
const { recordCollectorRun } = /** @type {any} */ (await import("./_shared.mjs"));

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

describe("shouldSkipKosisFill — 공식 미분양이 매물 수에 밀리지 않는다 (세션559)", () => {
  /** @type {(a: any) => boolean} */
  let skip;
  beforeEach(async () => {
    ({ shouldSkipKosisFill: skip } = await import("./collect-unsold-kosis.mjs"));
  });

  it("매물이 많아도 KOSIS 로 채운다 (옛 코드는 naver_sell_count>0 이면 건너뛰었다)", () => {
    // 이 한 줄이 1,157곳(58%)의 unsold 를 '오늘 네이버 매물 수'로 만든 원인이었다.
    expect(skip({ unsold: null, units: 500, region: "경기", gu: "수원시" })).toBe(false);
  });

  it("미분양이 총세대수를 넘으면 오염값이므로 덮어쓴다", () => {
    // 실측 81곳 — 춘천 파밀리에 리버파크: 15세대인데 미분양 54(=매물 54건)
    expect(skip({ unsold: 54, units: 15, region: "강원", gu: "춘천시" })).toBe(false);
    expect(skip({ unsold: 24, units: 5, region: "경기", gu: "의정부시" })).toBe(false);
  });

  it("⚠️ units<=1 인 오염 단지는 이 함수가 못 고친다 (비례배분 분모가 없다)", () => {
    // 세종더샵예미지 L4블록: 1세대인데 미분양 18. 분모가 1이라 비례배분을 쓸 수 없어
    // 여기서는 건너뛴다 — 옛 오염값이 DB 에 남는다. 그건 **일회성 정리 스크립트**가 지운다.
    // 이 테스트는 그 한계를 명시적으로 박아, 다음 사람이 '왜 안 고쳐지지' 로 헤매지 않게 한다.
    expect(skip({ unsold: 18, units: 1, region: "세종", gu: "세종시" })).toBe(true);
  });

  it("유효한 기존 값(청약홈 단지별 실측)은 존중해 건너뛴다", () => {
    // 단지별 실측이 구 단위 비례배분보다 정확하다 — 총세대수 이하면 그대로 둔다
    expect(skip({ unsold: 30, units: 500, region: "경기", gu: "수원시" })).toBe(true);
    expect(skip({ unsold: 500, units: 500, region: "경기", gu: "수원시" })).toBe(true); // 경계: 같으면 유효
  });

  it("매물 수와 정확히 같으면 매물 유래이므로 덮어쓴다 (세션559 말미 — 1,090곳이 영구 보존되던 결함)", () => {
    // 첫 판은 "총세대수 초과만 오염"으로 봤는데, 매물 유래 값은 대부분 세대수 이내라
    // 1,090곳 전부가 "유효한 기존 값"으로 분류돼 영원히 안 덮어써졌다(적대검증 실측 100%).
    // 그중 196곳은 미분양률 15% 초과로 안전 점수를 깎는 중이었다
    // (두산위브 트리니뷰 구명역: 31세대인데 미분양 30 = 매물 30건 = 96.8%).
    expect(skip({ unsold: 30, units: 31, region: "부산", gu: "북구", naver_sell_count: 30 })).toBe(false);
    expect(skip({ unsold: 77, units: 80, region: "부산", gu: "부산진구", naver_sell_count: 77 })).toBe(false);
  });

  it("매물 수와 다르면 청약홈 실측으로 보고 존중한다", () => {
    // 출처가 다른 값까지 덮으면 단지별 실측(청약홈)을 구 단위 추정치로 갈아치운다
    expect(skip({ unsold: 30, units: 500, region: "경기", gu: "수원시", naver_sell_count: 12 })).toBe(true);
    expect(skip({ unsold: 30, units: 500, region: "경기", gu: "수원시", naver_sell_count: null })).toBe(true);
  });

  it("⚠️ 세종은 gu 가 null 이라 이 함수가 통째로 건너뛴다 (별개 구조 문제)", () => {
    // 실측 7곳(엘리프세종 계열 등)이 매물 유래인데도 안 덮어써진다.
    // 세종은 구·군이 없어 gu=null 이고, 비례배분 분모(시군구)가 없다.
    // 이 테스트는 그 한계를 못 박아 다음 사람이 "왜 세종만 안 고쳐지지"로 헤매지 않게 한다.
    expect(skip({ unsold: 23, units: 660, region: "세종", gu: null, naver_sell_count: 23 })).toBe(true);
  });

  it("비례배분 분모가 될 수 없는 단지는 건너뛴다", () => {
    expect(skip({ unsold: null, units: 1, region: "경기", gu: "수원시" })).toBe(true);
    expect(skip({ unsold: null, units: null, region: "경기", gu: "수원시" })).toBe(true);
    expect(skip({ unsold: null, units: 500, region: null, gu: "수원시" })).toBe(true);
    expect(skip({ unsold: null, units: 500, region: "경기", gu: null })).toBe(true);
  });

  it("unsold === 0(완판 실측)은 존중한다 — 구 추정치로 덮지 않는다 (세션559 말미 정정)", () => {
    // 옛 코드는 `unsold <= 0` 이라 0 을 "값 없음"으로 보고 **완판 91곳을 구 단위 추정치로 덮어썼다.**
    // "다 팔렸다(0세대)"는 단지별 실측이고, 이 수집기가 내세운 원칙(단지별 실측 > 구 비례배분)과
    // 정면으로 어긋났다. 적대검증이 잡았다.
    expect(skip({ unsold: 0, units: 500, region: "경기", gu: "수원시" })).toBe(true);
  });

  it("unsold 가 null 이면 진짜 값 없음이므로 채운다 (대조군)", () => {
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

  /** @param {number} n 채움 대상이 아닌 "이미 값 있음" 단지 수, 그 뒤 1개는 1,000번째를 넘는 채움 대상 */
  function makeApartments(n) {
    /** @type {any[]} */
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push({
        id: `apt-${i}`, name: `단지${i}`, region: "경기", gu: "수원시",
        units: 100, unsold: 10, unsold_rate: 10, naver_sell_count: null, // 유효 기존값 → skip
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
    const apartments = makeApartments(1004); // 0~1003 + target(인덱스1004) = 1,005건
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
    expect(recordCollectorRun).toHaveBeenCalledWith("kosis-unsold", { ok: 1 });
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
      rows.push({ id: `apt-${i}`, name: `단지${i}`, region: "경기", gu: "수원시", units: 100, unsold: 10, unsold_rate: 10, naver_sell_count: null });
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
