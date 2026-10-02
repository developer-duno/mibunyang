// @ts-check
/**
 * molit-units.mjs 테스트 — 세대수(units) 보정 수집기 검증
 *
 * 대상: getTargets, fetchAptDetail, updateUnits, E2E 시나리오
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// _shared.mjs 모킹 — 외부 호출 차단
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    sleep: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    recordApiQuota: vi.fn(),
    recordCollectorRun: vi.fn(),
  };
});

// _molit-api.mjs 모킹 — molitApiCall·fetchSidoAptList 제어 (fetchSidoAptList 는 모듈 안에서 원본
// molitApiCall 을 부르므로 따로 바꿔 둔다 — main() 경로 시험용, 세션589)
const mockMolitApiCall = vi.fn();
const mockFetchSidoAptList = vi.fn();
/** 일시 코드 재시도 누적 카운터(재검사 🟡2) — molitApiCall 을 흉내 내므로 이것도 흉내 낸다 */
const mockRetryCount = vi.fn(() => 0);
vi.mock("./_molit-api.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, molitApiCall: mockMolitApiCall, fetchSidoAptList: mockFetchSidoAptList, kaptTransientRetryCount: mockRetryCount };
});

// MOLIT_KEY 설정 — process.exit 방지
process.env.MOLIT_KEY = "test-key";

const { getTargets, fetchAptDetail, updateUnits, resolveUnits, writeUnmatchedLog, unmatchedLogPath, main } =
  await import("./molit-units.mjs");
const { getSupabase, recordCollectorRun, recordApiQuota } = /** @type {any} */ (await import("./_shared.mjs"));
const { KaptResultError } = await import("./_molit-api.mjs");

// ── 헬퍼 ─────────────────────────────────────────────────────
/**
 * @param {any} data
 * @param {any} [error]
 * @returns {any}
 */
function makeMockSbForQuery(data, error = null) {
  // selectAll 은 **고유키(id) 커서 모드**로 호출된다 (세션544):
  //   `.order("id",{ascending:true}).limit(1000)` → (2페이지부터) `.gt("id", cursor)`.
  // ⚠️ `.range` 를 일부러 두지 않는다 — 무정렬 OFFSET 으로 되돌아가면
  //   `range is not a function` 으로 시끄럽게 깨진다 (unordered-pagination-loses-rows.md).
  const gt = vi.fn().mockResolvedValue({ data, error });
  const limit = vi.fn().mockReturnValue({
    gt,
    /** @param {any} res @param {any} rej */
    then: (res, rej) => Promise.resolve({ data, error }).then(res, rej),
  });
  const order = vi.fn().mockReturnValue({ limit });
  const or = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ or });
  const from = vi.fn().mockReturnValue({ select });
  return { from, select, or, order, limit, gt };
}

/**
 * @param {any} [updateResult]
 * @returns {any}
 */
function makeMockSbForUpdate(updateResult = { error: null }) {
  const eq = vi.fn().mockResolvedValue(updateResult);
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { from, update, eq };
}

// ── getTargets ───────────────────────────────────────────────
describe("getTargets", () => {
  it("정상 조회 — Supabase 쿼리 체인 검증 + 데이터 반환", async () => {
    const mockData = [{ id: "a1", name: "테스트아파트", units: 0, unsold: 50 }];
    const sb = makeMockSbForQuery(mockData);

    const result = await getTargets(sb);
    expect(result).toEqual(mockData);
    expect(sb.from).toHaveBeenCalledWith("apartments");
    // ★ 세션544 — 고유키(id) 커서로 훑는다. select 에 id 가 없으면 selectAll 이 즉시 throw 한다.
    expect(sb.order).toHaveBeenCalledWith("id", { ascending: true });
    expect(sb.limit).toHaveBeenCalledWith(1000);
    expect(sb.select.mock.calls[0][0]).toContain("id,");
  });

  // 에러 + 빈 데이터
  const errorCases = [
    ["Supabase 에러 → throw", null, { message: "DB 오류" }, true],
    ["data=null → 빈 배열", null, null, false],
  ];
  for (const [label, data, error, shouldThrow] of errorCases) {
    it(/** @type {string} */ (label), async () => {
      const sb = makeMockSbForQuery(data, error);
      if (shouldThrow) {
        await expect(getTargets(sb)).rejects.toThrow("selectAll 조회 실패");
      } else {
        const result = await getTargets(sb);
        expect(result).toEqual([]);
      }
    });
  }
});

// ── resolveUnits (kaptdaCnt 우선 + hoCnt 폴백, 세션 444) ──────
describe("resolveUnits — 세대수 결정 (kaptdaCnt 우선, 0이면 hoCnt 폴백)", () => {
  it("kaptdaCnt>1 이면 kaptdaCnt 사용 (정상 단지)", () => {
    expect(resolveUnits({ kaptdaCnt: "500", hoCnt: "500" })).toEqual({ units: 500, field: "kaptdaCnt" });
  });

  it("kaptdaCnt=0 이고 hoCnt>1 이면 hoCnt 폴백 (임의공급·특수 물량)", () => {
    // 주안 극동스타클래스 실측: kaptdaCnt=0, hoCnt=249
    expect(resolveUnits({ kaptdaCnt: "0", hoCnt: "249" })).toEqual({ units: 249, field: "hoCnt(폴백)" });
  });

  it("kaptdaCnt>1 이면 hoCnt 와 달라도 kaptdaCnt 우선 (회귀 방지)", () => {
    expect(resolveUnits({ kaptdaCnt: "920", hoCnt: "1000" }).units).toBe(920);
  });

  it("둘 다 0/1 이면 보정 불가 (units 0)", () => {
    expect(resolveUnits({ kaptdaCnt: "0", hoCnt: "1" }).units).toBe(0);
    expect(resolveUnits({ kaptdaCnt: "1", hoCnt: "0" }).units).toBe(0);
  });

  it("필드 누락·null detail 도 안전 (units 0)", () => {
    expect(resolveUnits({}).units).toBe(0);
    expect(resolveUnits(null).units).toBe(0);
    expect(resolveUnits({ kaptdaCnt: "abc", hoCnt: "xyz" }).units).toBe(0);
  });
});

// ── fetchAptDetail ───────────────────────────────────────────
describe("fetchAptDetail", () => {
  beforeEach(() => mockMolitApiCall.mockReset());

  // 응답 구조별 파싱
  const parseCases = [
    ["body.item 직접 반환", { response: { body: { item: { kaptdaCnt: "500" } } } }, "500"],
    ["body.items.item 반환", { response: { body: { items: { item: { kaptdaCnt: "300" } } } } }, "300"],
    ["body null → null", { response: { body: null } }, null],
    ["응답 전체 null → null", null, null],
  ];
  for (const [label, mockResponse, expectedCnt] of parseCases) {
    it(/** @type {string} */ (label), async () => {
      mockMolitApiCall.mockResolvedValueOnce(mockResponse);
      const detail = await fetchAptDetail("K001");
      if (expectedCnt === null) {
        expect(detail).toBeNull();
      } else {
        expect(detail?.kaptdaCnt).toBe(expectedCnt);
      }
    });
  }
});

// ── updateUnits ──────────────────────────────────────────────
describe("updateUnits", () => {
  it("정상 보정 — units=500, unsold=50 → rate=10.0, unit_source='molit'", async () => {
    const sb = makeMockSbForUpdate();
    const ok = await updateUnits(sb, "a1", 500, 50, false);

    expect(ok).toBe(true);
    const updateArg = sb.from("apartments").update.mock.calls[0][0];
    expect(updateArg.units).toBe(500);
    expect(updateArg.unsold_rate).toBe(10.0);
    expect(updateArg.unit_source).toBe("molit");
    expect(updateArg.updated_at).toBeDefined();
  });

  // unsoldRate 계산 엣지케이스
  const rateCases = [
    ["unsold=null → rate null", 500, null, null],
    ["newUnits=0 → rate null", 0, 50, null],
    ["unsold=0 → rate 0.0", 500, 0, 0],
    // 세션539 F-2: 형제 writer(collect-data·sync-naver-complex·applyhome-seed 는
    // clampUnsoldRate, collect-unsold-kosis 는 calcProportionalUnsold 내부)는 전부 갖고
    // 있는 >100→null 방어가 이 수집기만 없었다. 이 수집기의 SELECT 대상 자체가
    // unsold_rate>=100 인 망가진 행이라, 매칭이 다시 폭발값을 주면 자기가 재기입하는 자리다.
    ["unsold > newUnits (100% 초과) → clampUnsoldRate 로 null (세션539 F-2, 없으면 red)", 10, 15, null],
    ["unsold == newUnits (정확히 100%) → 클램프 경계, 100은 그대로 유지", 10, 10, 100],
  ];
  for (const [label, units, unsold, expectedRate] of rateCases) {
    it(/** @type {string} */ (label), async () => {
      const sb = makeMockSbForUpdate();
      await updateUnits(sb, "a1", /** @type {any} */ (units), /** @type {any} */ (unsold), false);
      if (expectedRate === null) {
        // dryRun이 아닌 경우에도 DB 호출은 함
        // unsoldRate 자체만 검증
        const arg = sb.from("apartments").update.mock.calls[0]?.[0];
        expect(arg?.unsold_rate ?? null).toBe(null);
      } else {
        const arg = sb.from("apartments").update.mock.calls[0][0];
        expect(arg.unsold_rate).toBe(expectedRate);
      }
    });
  }

  // dryRun + DB 에러
  const modeCases = [
    ["dryRun=true → DB 미호출 + true", true, { error: null }, true],
    ["DB 에러 → false", false, { error: { message: "실패" } }, false],
  ];
  for (const [label, dryRun, dbResult, expectedOk] of modeCases) {
    it(/** @type {string} */ (label), async () => {
      const sb = makeMockSbForUpdate(dbResult);
      const ok = await updateUnits(sb, "a1", 500, 50, /** @type {any} */ (dryRun));
      expect(ok).toBe(expectedOk);
      if (dryRun) {
        expect(sb.from).not.toHaveBeenCalled();
      }
    });
  }
});

// ── 미매칭 목록 파일 기록 (세션 495) ─────────────────────────
describe("writeUnmatchedLog — 미매칭 목록을 날짜별 파일로 남긴다", () => {
  /** @type {string} */
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "molit-units-log-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const entries = [
    { id: "ap-1", name: "가나아파트", region: "경기", gu: "화성시", reason: "이름 매칭 실패 (유사도 < 0.6)" },
    { id: "ap-2", name: "다라아파트", region: "서울", gu: null, reason: "상세 조회 실패 (kaptCode=K9)" },
  ];

  it("단지명·사유가 파일에 남는다 (bat 이 stdout 을 안 남겨 생긴 구멍)", () => {
    const p = writeUnmatchedLog(entries, dir, "2026-08-07");
    expect(p).toBe(unmatchedLogPath(dir, "2026-08-07"));
    const saved = JSON.parse(readFileSync(/** @type {string} */ (p), "utf8"));
    expect(saved.count).toBe(2);
    expect(saved.entries.map((/** @type {any} */ e) => e.name)).toEqual(["가나아파트", "다라아파트"]);
    expect(saved.entries[0].reason).toMatch(/이름 매칭 실패/);
    expect(saved.entries[1].reason).toMatch(/상세 조회 실패/);
  });

  it("미매칭 0건이면 파일을 만들지 않는다 (빈 파일 쓰레기 방지)", () => {
    expect(writeUnmatchedLog([], dir, "2026-08-07")).toBeNull();
    expect(existsSync(unmatchedLogPath(dir, "2026-08-07"))).toBe(false);
  });

  it("파일명에 날짜가 박혀 실행마다 덮어쓰지 않는다", () => {
    writeUnmatchedLog(entries, dir, "2026-08-07");
    writeUnmatchedLog(entries, dir, "2026-08-11");
    expect(existsSync(unmatchedLogPath(dir, "2026-08-07"))).toBe(true);
    expect(existsSync(unmatchedLogPath(dir, "2026-08-11"))).toBe(true);
  });

  it("기록 실패(없는 상위 경로 등)해도 예외를 던지지 않는다 — 진단이 수집을 죽이면 안 됨", () => {
    // 파일을 디렉토리 이름으로 써서 mkdir/write 를 실패시킨다.
    const bad = join(dir, "nope.json", "sub");
    expect(() => writeUnmatchedLog(entries, bad, "2026-08-07")).not.toThrow();
  });
});

describe("main 이 unmatched 를 collector_runs 의 skip 에 합산한다 (세션 495)", () => {
  // main() 은 export 되지 않아 배선 자체를 소스로 확인한다.
  // ⚠️ 좌변(await recordCollectorRun)까지 고정 + 주석 제거 사본에 검사 — 선언부·주석 매칭 함정 차단.
  const src = readFileSync(new URL("./molit-units.mjs", import.meta.url), "utf8")
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  it("recordCollectorRun 호출의 skip 이 skipped + unmatched 다", () => {
    expect(src).toMatch(/await\s+recordCollectorRun\(\s*PHASE\s*,\s*\{[^}]*skip:\s*skipped\s*\+\s*unmatched/);
  });

  it("미매칭 목록을 파일로 남기는 호출이 배선돼 있다", () => {
    // 세션589: main(opts) 가 시험용 폴더를 둘째 인자로 넘긴다(opts.unmatchedLogDir — 평소 undefined = 기본 폴더).
    expect(src).toMatch(/const\s+unmatchedLog\s*=\s*writeUnmatchedLog\(\s*unmatchedList\s*(?:,\s*opts\.unmatchedLogDir\s*)?\)/);
  });
});

// ── E2E 시나리오 ─────────────────────────────────────────────
describe("E2E 시나리오", () => {
  beforeEach(() => mockMolitApiCall.mockReset());

  it("상세조회 → kaptdaCnt 추출 → updateUnits 연결", async () => {
    // fetchAptDetail 성공
    mockMolitApiCall.mockResolvedValueOnce({
      response: { body: { item: { kaptdaCnt: "800" } } },
    });

    const detail = await fetchAptDetail("K001");
    expect(detail).not.toBeNull();

    const kaptdaCnt = parseInt(/** @type {string} */ (detail?.kaptdaCnt), 10);
    expect(kaptdaCnt).toBe(800);
    expect(kaptdaCnt).toBeGreaterThan(1);

    // updateUnits 성공
    const sb = makeMockSbForUpdate();
    const ok = await updateUnits(sb, "a1", kaptdaCnt, 120, false);
    expect(ok).toBe(true);

    const arg = sb.from("apartments").update.mock.calls[0][0];
    expect(arg.units).toBe(800);
    expect(arg.unsold_rate).toBe(15.0); // 120/800*100 = 15.0
    expect(arg.unit_source).toBe("molit");
  });

  it("세대수 무효 (kaptdaCnt='0') → 보정 불가 로직 재현", async () => {
    mockMolitApiCall.mockResolvedValueOnce({
      response: { body: { item: { kaptdaCnt: "0" } } },
    });

    const detail = await fetchAptDetail("K999");
    expect(detail).not.toBeNull();

    const kaptdaCnt = parseInt(/** @type {string} */ (detail?.kaptdaCnt || "0"), 10);
    // main()에서 isNaN(kaptdaCnt) || kaptdaCnt <= 1 이면 skipped
    expect(isNaN(kaptdaCnt) || kaptdaCnt <= 1).toBe(true);
  });
});

// ── main() 실전 경로 — 짝 짓기 게이트·사용승인일·결과 코드·2u 창 (세션589 T3) ─────────
// 옛 동작: findBestMatch(시도 전체에서 이름 0.5) 짝이면 무조건 units·unit_source=molit 를 썼다.
// 이제: pickKaptMatch(입주 후·같은 시군구·차수·이름 0.6) → 기본정보 사용승인일 ±24개월 → 씀.
// 04 같은 결과 코드는 "상세 조회 실패"로 넘기지 않고 회차를 멈춘다. 2u 창이면 아예 안 부른다.
describe("main() — 세션589 게이트 실전 경로", () => {
  /** 2026-10-05(월) 05:30 KST — 2u 창 밖 */
  const NOW = new Date("2026-10-04T20:30:00Z");
  /** @type {string} */
  let dir;
  /** @type {any} */
  let exitSpy;

  const LIST = [
    { kaptCode: "K-SDT", kaptName: "신동탄 롯데캐슬아파트", bjdCode: "4159510500", as1: "경기도", as2: "화성병점구", as3: "반월동" },
    { kaptCode: "K-DT2", kaptName: "동탄2 롯데캐슬", bjdCode: "4159711100", as1: "경기도", as2: "화성동탄구", as3: "장지동" },
    { kaptCode: "A10027643", kaptName: "광명철산도덕파크타운", bjdCode: "4121010200", as1: "경기도", as2: "광명시", as3: "철산동" },
  ];
  /** @param {string} id @param {string} name @param {string|null} completion @param {string|null} bjd @param {string} gu */
  const target = (id, name, completion, bjd, gu) => ({ id, name, region: "경기", gu, address: null, units: 1, unsold: null, unsold_rate: null, unit_source: null, completion, bjd_code: bjd });

  /** @param {any[]} rows */
  function makeMainSb(rows) {
    /** @type {Array<{ id: string; row: any }>} */
    const updates = [];
    const sb = {
      from: () => ({
        select: () => ({ or: () => ({ order: () => ({ limit: () => ({
          gt: () => Promise.resolve({ data: [], error: null }),
          /** @param {any} res @param {any} rej */
          then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
        }) }) }) }),
        /** @param {any} row */
        update: (row) => ({ eq: (/** @type {string} */ _c, /** @type {string} */ id) => { updates.push({ id, row }); return Promise.resolve({ error: null }); } }),
      }),
    };
    return { sb, updates };
  }

  /** @param {Record<string, any>} details kaptCode → 기본정보 item (Error 면 던짐) */
  function routeDetail(details) {
    mockMolitApiCall.mockImplementation(async (/** @type {string} */ _p, /** @type {string} */ _b, /** @type {string} */ _ep, /** @type {any} */ params) => {
      const d = details[params.kaptCode];
      if (d instanceof Error) throw d;
      return { response: { header: { resultCode: "00" }, body: { item: d } } };
    });
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "molit-units-main-"));
    mockMolitApiCall.mockReset();
    mockFetchSidoAptList.mockReset();
    mockRetryCount.mockImplementation(() => 0);
    recordCollectorRun.mockClear();
    recordApiQuota.mockClear();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(/** @type {any} */ (() => undefined));
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); exitSpy.mockRestore(); });

  it("입주 후·같은 시군구 짝만 쓰고(신동탄롯데캐슬 → 맞는 단지) 입주 전·이름 미달·완공월 모름은 안 쓴다", async () => {
    const { sb, updates } = makeMainSb([
      target("ap-6001392", "신동탄롯데캐슬", "201806", "4159510500", "화성시"),
      target("pre", "신동탄롯데캐슬", "202711", "4159510500", "화성시"), // 입주 전
      target("ap-6028119", "광명소하파크타워", "202510", "4121010400", "광명시"), // 이름 0.56
      target("nocomp", "신동탄롯데캐슬", null, "4159510500", "화성시"), // 완공월 모름(K5)
    ]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    routeDetail({ "K-SDT": { kaptdaCnt: 612, kaptUsedate: "20180629" } });

    await main({ now: NOW, unmatchedLogDir: dir });

    expect(updates.map((u) => u.id)).toEqual(["ap-6001392"]);
    expect(updates[0].row.units).toBe(612);
    expect(mockMolitApiCall).toHaveBeenCalledTimes(1); // 기본정보는 짝이 있는 1곳만
    expect(mockMolitApiCall.mock.calls[0][3]).toEqual({ kaptCode: "K-SDT" }); // 옛 짝 K-DT2 가 아니다
    const saved = JSON.parse(readFileSync(unmatchedLogPath(dir), "utf8"));
    const reasons = Object.fromEntries(saved.entries.map((/** @type {any} */ e) => [e.id, e.reason]));
    expect(reasons.pre).toMatch(/입주 전/);
    expect(reasons["ap-6028119"]).toMatch(/이름 유사도/);
    expect(reasons.nocomp).toMatch(/완공월 모름/);
    expect(recordCollectorRun).toHaveBeenCalledWith("molit-units", expect.objectContaining({ ok: 1, skip: 3, fail: 0 }));
  });

  it("K4 — 사용승인일이 완공월과 24개월 넘게 다르면 쓰지 않는다(25개월 거부 · 24개월 통과)", async () => {
    const { sb, updates } = makeMainSb([
      target("far", "신동탄롯데캐슬", "201806", "4159510500", "화성시"),
    ]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    routeDetail({ "K-SDT": { kaptdaCnt: 612, kaptUsedate: "20200701" } }); // +25개월
    await main({ now: NOW, unmatchedLogDir: dir });
    expect(updates).toEqual([]);
    const saved = JSON.parse(readFileSync(unmatchedLogPath(dir), "utf8"));
    expect(saved.entries[0].reason).toMatch(/사용승인일 불일치/);

    routeDetail({ "K-SDT": { kaptdaCnt: 612, kaptUsedate: "20200615" } }); // +24개월
    await main({ now: NOW, unmatchedLogDir: dir });
    expect(updates.map((u) => u.id)).toEqual(["far"]);
  });

  it("R2 — 기본정보가 04 면 회차를 멈추고 KAPT_RESULT_04 로 실패 기록(다음 단지를 부르지 않는다)", async () => {
    const { sb, updates } = makeMainSb([
      target("a", "신동탄롯데캐슬", "201806", "4159510500", "화성시"),
      target("b", "신동탄롯데캐슬", "201806", "4159510500", "화성시"),
    ]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    routeDetail({ "K-SDT": new KaptResultError("04", "HTTP_ERROR", "getAphusBassInfoV5") });
    await main({ now: NOW, unmatchedLogDir: dir });
    expect(mockMolitApiCall).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([]);
    const rec = recordCollectorRun.mock.calls.at(-1)[1];
    expect(rec.fail).toBeGreaterThan(0);
    expect(rec.errorMessage).toMatch(/^KAPT_RESULT_04/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("R2 — 목록이 04 면 다른 시도도 부르지 않는다", async () => {
    const { sb } = makeMainSb([
      target("a", "신동탄롯데캐슬", "201806", "4159510500", "화성시"),
      { ...target("s", "서울단지", "201001", "1111010100", "종로구"), region: "서울" },
    ]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockRejectedValue(new KaptResultError("04", null, "getSidoAptList4"));
    await main({ now: NOW, unmatchedLogDir: dir });
    expect(mockFetchSidoAptList).toHaveBeenCalledTimes(1);
    expect(recordCollectorRun.mock.calls.at(-1)[1].errorMessage).toMatch(/^KAPT_RESULT_04/);
  });

  it("R3 — 2u 창(13:00 KST)이면 K-apt 를 부르지 않고 skip 으로 흔적을 남긴다", async () => {
    const { sb, updates } = makeMainSb([target("a", "신동탄롯데캐슬", "201806", "4159510500", "화성시")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    await main({ now: new Date("2026-10-05T04:00:00Z"), unmatchedLogDir: dir });
    expect(mockFetchSidoAptList).not.toHaveBeenCalled();
    expect(mockMolitApiCall).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(recordCollectorRun).toHaveBeenCalledWith("molit-units", expect.objectContaining({ ok: 0, skip: 1, fail: 0, errorMessage: expect.stringMatching(/^SIBLING_KAPT_WINDOW/) }));
  });

  it("R3 — 매월 21일 16:00 KST(2u 21일 매칭 창)도 건너뛴다(세션589 보완 B9)", async () => {
    const { sb } = makeMainSb([target("a", "신동탄롯데캐슬", "201806", "4159510500", "화성시")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    await main({ now: new Date("2026-10-21T07:00:00Z"), unmatchedLogDir: dir });
    expect(mockFetchSidoAptList).not.toHaveBeenCalled();
    expect(recordCollectorRun.mock.calls.at(-1)[1].errorMessage).toMatch(/^SIBLING_KAPT_WINDOW .*매월 21일 14:50~21:00/);
  });

  it("R3 앞당김(재검사 🟡4) — 창 시작 5분 전 안(12:36 KST)에 시작하면 건너뛰고, 6분 전(12:34)이면 진행", async () => {
    const { sb } = makeMainSb([target("a", "신동탄롯데캐슬", "201806", "4159510500", "화성시")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    routeDetail({ "K-SDT": { kaptdaCnt: 612, kaptUsedate: "20180629" } });
    await main({ now: new Date("2026-10-12T03:36:00Z"), unmatchedLogDir: dir }); // 12:36 KST
    expect(mockFetchSidoAptList).not.toHaveBeenCalled();
    // 시작 때 판정(시도 차례 판정이 아니라) — 옛 기록 형식 "…이라 건너뜀 — 대상 N건 다음 회차로" 그대로
    expect(recordCollectorRun.mock.calls.at(-1)[1]).toMatchObject({ ok: 0, skip: 1, fail: 0, errorMessage: expect.stringMatching(/^SIBLING_KAPT_WINDOW 2u K-apt 창.*건너뜀 — 대상 1건 다음 회차로$/) });

    await main({ now: new Date("2026-10-12T03:34:00Z"), unmatchedLogDir: dir }); // 12:34 KST
    expect(mockFetchSidoAptList).toHaveBeenCalledTimes(1);
    expect(recordCollectorRun.mock.calls.at(-1)[1]).toMatchObject({ ok: 1, errorMessage: null });
  });

  it("R3 앞당김 — 시도 목록마다 다시 본다: 둘째 시도 차례에 창 5분 전이면 멈추고 남은 대상을 skip 으로", async () => {
    const { sb, updates } = makeMainSb([
      target("a", "신동탄롯데캐슬", "201806", "4159510500", "화성시"),
      { ...target("s1", "서울단지", "201001", "1111010100", "종로구"), region: "서울" },
      { ...target("s2", "서울단지2", "201001", "1111010100", "종로구"), region: "서울" },
    ]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    routeDetail({ "K-SDT": { kaptdaCnt: 612, kaptUsedate: "20180629" } });
    const times = ["2026-10-12T03:30:00Z", "2026-10-12T03:30:00Z", "2026-10-12T03:36:00Z"]; // 12:30 · 12:30 · 12:36 KST
    let i = 0;
    const clock = () => new Date(times[Math.min(i++, times.length - 1)]);
    await main({ now: NOW, clock, unmatchedLogDir: dir });
    expect(mockFetchSidoAptList).toHaveBeenCalledTimes(1); // 경기만
    expect(updates.map((u) => u.id)).toEqual(["a"]);
    const rec = recordCollectorRun.mock.calls.at(-1)[1];
    expect(rec).toMatchObject({ ok: 1, skip: 2, fail: 0 });
    expect(rec.errorMessage).toMatch(/^SIBLING_KAPT_WINDOW 2u K-apt 창.*남은 2곳/);
  });

  /** @param {(n: number) => Error | null} failAt n = 몇 번째 기본정보 호출(1부터) */
  function routeFail(failAt) {
    let n = 0;
    mockMolitApiCall.mockImplementation(async () => {
      n++;
      const e = failAt(n);
      if (e) throw e;
      return { response: { header: { resultCode: "00" }, body: { item: { kaptdaCnt: 612, kaptUsedate: "20180629" } } } };
    });
  }
  /** @param {number} k */
  const rows = (k) => Array.from({ length: k }, (_, i) => target(`t${i}`, "신동탄롯데캐슬", "201806", "4159510500", "화성시"));

  it("B3 — 매개변수 코드(10)는 그 단지만 실패, 다음 단지는 쓴다", async () => {
    const { sb, updates } = makeMainSb(rows(2));
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    routeFail((n) => (n === 1 ? new KaptResultError("10", null, "getAphusBassInfoV5") : null));
    await main({ now: NOW, unmatchedLogDir: dir });
    expect(updates.map((u) => u.id)).toEqual(["t1"]);
    const rec = recordCollectorRun.mock.calls.at(-1)[1];
    expect(rec.fail).toBe(1);
    expect(rec.errorMessage).toBeNull();
  });

  // 재검사 🟡2 — 쿼터 기록(recordApiQuota 셋째 인자)은 던진 호출도 1회로 세고, 일시 재시도로 더 나간 호출을 더한다.
  const quotaOf = () => recordApiQuota.mock.calls.at(-1)?.[2];
  it("쿼터 셈 — 목록 호출 1건이 (결과 코드 아닌 실패로) 던지면 기록 1", async () => {
    const { sb } = makeMainSb([target("a", "신동탄롯데캐슬", "201806", "4159510500", "화성시")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockRejectedValue(new Error("getSidoAptList4: 3회 재시도 소진 (마지막 상태: 0)"));
    await main({ now: NOW, unmatchedLogDir: dir });
    expect(quotaOf()).toBe(1);
  });

  it("쿼터 셈 — 기본정보가 던지면 목록 1 + 기본정보 1 = 2", async () => {
    const { sb } = makeMainSb([target("a", "신동탄롯데캐슬", "201806", "4159510500", "화성시")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    routeDetail({ "K-SDT": new Error("getAphusBassInfoV5: 3회 재시도 소진 (마지막 상태: 429)") });
    await main({ now: NOW, unmatchedLogDir: dir });
    expect(quotaOf()).toBe(2);
  });

  it("쿼터 셈 — 기본정보가 04 두 번 재시도 뒤 성공(누적 카운터 +2)이면 목록 1 + 기본정보 1 + 재시도 2 = 4", async () => {
    const { sb } = makeMainSb([target("a", "신동탄롯데캐슬", "201806", "4159510500", "화성시")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    let retries = 10; // 회차 시작 전 누적값(앞 회차 몫) — 차이만 더해야 한다
    mockRetryCount.mockImplementation(() => retries);
    mockMolitApiCall.mockImplementation(async () => {
      retries += 2;
      return { response: { header: { resultCode: "00" }, body: { item: { kaptdaCnt: 612, kaptUsedate: "20180629" } } } };
    });
    await main({ now: NOW, unmatchedLogDir: dir });
    mockRetryCount.mockImplementation(() => 0);
    expect(quotaOf()).toBe(4);
  });

  it("B4 — 결과 코드 아닌 실패가 연속 5건이면 KAPT_FETCH_FAIL 로 멈춘다(여섯째는 안 부른다)", async () => {
    const { sb, updates } = makeMainSb(rows(7));
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    routeFail(() => new Error("getAphusBassInfoV5: 3회 재시도 소진 (마지막 상태: 429)"));
    await main({ now: NOW, unmatchedLogDir: dir });
    expect(mockMolitApiCall).toHaveBeenCalledTimes(5);
    expect(updates).toEqual([]);
    const rec = recordCollectorRun.mock.calls.at(-1)[1];
    expect(rec.fail).toBe(5);
    expect(rec.errorMessage).toMatch(/^KAPT_FETCH_FAIL 연속 5건/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
