// @ts-check
/**
 * collect-regional-economy.mjs 테스트 — KOSIS 시도 경제·교육 지표 파싱 검증
 *
 * 대상: parseKosisRows(rows, spec) — medical-access 와 달리 2인자(spec 받음).
 * 환각 차단: C1 2자리 코드 매칭(이름 매칭 금지), ITM_ID=T00 필터, C2 방어 가드.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchWithRetryMock = vi.fn();

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
    fetchWithRetry: (/** @type {any[]} */ ...args) => fetchWithRetryMock(...args),
  };
});

process.env.KOSIS_KEY = "test-key";

const { parseKosisRows, main } = await import("./collect-regional-economy.mjs");
const { recordCollectorRun } = /** @type {any} */ (await import("./_shared.mjs"));

// ── spec fixture (TABLES 항목 재사용) ────────────────────────
/** @type {any} */
const SPEC_GRDP = { tblId: "INH_1C96_02", column: "grdp_per_capita", label: "GRDP", prdSe: "A", itmId: null, objL2: null };
/** @type {any} */
const SPEC_EDU_COST = { tblId: "DT_1PE105", column: "education_cost", label: "사교육비", prdSe: "A", itmId: "T00", objL2: null };
/** @type {any} */
const SPEC_EDU_PART = { tblId: "DT_1PE107", column: "education_participation", label: "참여율", prdSe: "A", itmId: "T00", objL2: null, maxValue: 100 };
/** @type {any} */
const SPEC_UNEMP = { tblId: "DT_1DA7104S", column: "unemployment_rate", label: "실업률", prdSe: "Y", itmId: null, objL2: "0", maxValue: 100 };

/**
 * KOSIS 행 생성 헬퍼. medical 과 달리 ITM_ID·C2 필드 포함.
 * @param {string} c1            C1 2자리 코드 (전국 '00' / 시도 '11'~'39')
 * @param {string} year          PRD_DE
 * @param {string|number} value  DT
 * @param {object} [opts]
 * @param {string} [opts.itmId]  ITM_ID
 * @param {string} [opts.c2]     C2 코드
 * @param {string} [opts.c1Nm]   C1_NM
 */
function makeRow(c1, year, value, opts = {}) {
  return {
    C1: c1,
    C1_NM: opts.c1Nm ?? "",
    C2: opts.c2,
    ITM_ID: opts.itmId,
    PRD_DE: year,
    DT: String(value),
  };
}

describe("parseKosisRows (KOSIS 시도 경제·교육 지표)", () => {
  it("빈 배열 → matched 빈 객체", () => {
    expect(parseKosisRows([], SPEC_GRDP)).toEqual({ matched: {}, unmatched: [], aggSkipped: 0 });
  });

  it("C1 2자리 코드 시도 매칭 → region 키로 추출 (이름 무관)", () => {
    const result = parseKosisRows([makeRow("11", "2023", 58829)], SPEC_GRDP);
    expect(result.matched["서울"]).toBeCloseTo(58829, 0);
  });

  it("전국 집계행 C1='00' → aggSkipped 증가, matched 미포함", () => {
    const result = parseKosisRows([
      makeRow("00", "2023", 46640),
      makeRow("11", "2023", 58829),
    ], SPEC_GRDP);
    expect(result.aggSkipped).toBe(1);
    expect(Object.keys(result.matched)).toEqual(["서울"]);
  });

  it("ITM 필터 (T00 외 ITM_ID skip — #9/#10 의 초/중/고 제외)", () => {
    const result = parseKosisRows([
      makeRow("11", "2024", 50.1, { itmId: "T00" }),
      makeRow("11", "2024", 44.2, { itmId: "T01" }),
      makeRow("11", "2024", 49.0, { itmId: "T02" }),
    ], SPEC_EDU_COST);
    expect(result.matched["서울"]).toBeCloseTo(50.1, 1);
  });

  it("ITM null spec → ITM_ID 무관 통과 (#6/#13)", () => {
    const result = parseKosisRows([makeRow("11", "2023", 58829, { itmId: "T1" })], SPEC_GRDP);
    expect(result.matched["서울"]).toBeCloseTo(58829, 0);
  });

  it("objL2 필터 (C2='0' 외 skip — #13 성별 남/여 제외)", () => {
    const result = parseKosisRows([
      makeRow("11", "2024", 3.0, { c2: "0" }),
      makeRow("11", "2024", 3.1, { c2: "2" }),
      makeRow("11", "2024", 2.9, { c2: "3" }),
    ], SPEC_UNEMP);
    expect(result.matched["서울"]).toBeCloseTo(3.0, 1);
  });

  it("objL2 null spec → C2 무관 통과 (#6/#9/#10)", () => {
    const result = parseKosisRows([makeRow("11", "2023", 58829, { c2: "9" })], SPEC_GRDP);
    expect(result.matched["서울"]).toBeCloseTo(58829, 0);
  });

  it("최신 연도 우선 (2021 → 2023 덮어쓰기)", () => {
    const result = parseKosisRows([
      makeRow("11", "2021", 52000),
      makeRow("11", "2023", 58829),
    ], SPEC_GRDP);
    expect(result.matched["서울"]).toBeCloseTo(58829, 0);
  });

  it("DT 숫자 아님 → 무시", () => {
    const result = parseKosisRows([makeRow("11", "2023", "abc")], SPEC_GRDP);
    expect(result.matched).toEqual({});
  });

  it("DT<=0 → 무시", () => {
    const result = parseKosisRows([makeRow("11", "2023", 0)], SPEC_GRDP);
    expect(result.matched).toEqual({});
  });

  it("maxValue 상한 — 참여율 spec 은 120 무시(상한 100), GRDP spec 은 큰 값 허용", () => {
    const part = parseKosisRows([makeRow("11", "2024", 120, { itmId: "T00" })], SPEC_EDU_PART);
    expect(part.matched["서울"]).toBeUndefined();
    const grdp = parseKosisRows([makeRow("11", "2023", 58829)], SPEC_GRDP);
    expect(grdp.matched["서울"]).toBeCloseTo(58829, 0);
  });

  it("미지의 C1 코드 (KOSIS_SIDO 미등록) → aggSkipped (전국 '00' 과 동일 처리)", () => {
    const result = parseKosisRows([makeRow("99", "2023", 100)], SPEC_GRDP);
    expect(result.matched).toEqual({});
    expect(result.aggSkipped).toBe(1);
  });

  it("17개 시도 동시 처리 — C1 코드별 region 매핑", () => {
    const codes = ["11", "21", "22", "23", "24", "25", "26", "29", "31", "32",
                   "33", "34", "35", "36", "37", "38", "39"];
    const rows = codes.map((c, i) => makeRow(c, "2023", 30000 + i * 100));
    const result = parseKosisRows(rows, SPEC_GRDP);
    expect(Object.keys(result.matched)).toHaveLength(17);
    expect(result.matched["서울"]).toBeCloseTo(30000, 0);
    expect(result.matched["제주"]).toBeCloseTo(31600, 0);
  });

  it("PRD_DE 비-연도 포맷 → 무시", () => {
    const result = parseKosisRows([makeRow("11", "2024M01", 58829)], SPEC_GRDP);
    expect(result.matched).toEqual({});
  });

  it("region 키는 약칭 ('서울특별시' 아닌 '서울') — 이름 변동에 면역", () => {
    // C1_NM 이 통계표마다 달라도 (강원도/강원특별자치도) C1 코드 '32' 면 '강원'
    const a = parseKosisRows([makeRow("32", "2023", 30000, { c1Nm: "강원도" })], SPEC_GRDP);
    const b = parseKosisRows([makeRow("32", "2023", 30000, { c1Nm: "강원특별자치도" })], SPEC_GRDP);
    expect(a.matched["강원"]).toBeCloseTo(30000, 0);
    expect(b.matched["강원"]).toBeCloseTo(30000, 0);
  });
});

// ── main() collector_runs 기록 하드닝 (KOSIS 러너 차단 사고, 세션 394) ──
describe("main() recordCollectorRun 하드닝", () => {
  beforeEach(() => {
    fetchWithRetryMock.mockReset();
    recordCollectorRun.mockClear();
  });

  it("KOSIS fetch 실패 → rethrow + status=failure 기록", async () => {
    fetchWithRetryMock.mockRejectedValue(new Error("fetch failed"));
    await expect(main()).rejects.toThrow(/KOSIS .* fetch failed/);
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "kosis-regional-economy",
      expect.objectContaining({ status: "failure" }),
    );
  });

  it("전 통계표 빈 응답 early-return 도 기록 (ok=0)", async () => {
    fetchWithRetryMock.mockResolvedValue({ json: async () => [] });
    await main();
    expect(recordCollectorRun).toHaveBeenCalledTimes(1);
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "kosis-regional-economy",
      { ok: 0, skip: 0 },
    );
  });
});
