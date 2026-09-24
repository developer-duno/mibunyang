// @ts-check
/**
 * collect-housing-supply-ratio.mjs 테스트 — KOSIS DT_MLTM_2100 주택보급률 파싱 검증
 *
 * 대상: parseKosisRows
 * 환각 차단: ITM_NM='보급률(다가구 구분거처 반영)' 필터 (세션 236 정정 박제)
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

const { parseKosisRows, main } = await import("./collect-housing-supply-ratio.mjs");
const { recordCollectorRun, getSupabase, log, createRegionResolutionTracker } = /** @type {any} */ (await import("./_shared.mjs"));

/**
 * @param {string} c1
 * @param {string} itm
 * @param {string} year
 * @param {string|number} value
 * @param {string} [unit]
 */
function makeRow(c1, itm, year, value, unit = "천호천가구％") {
  return { C1_NM: c1, ITM_NM: itm, PRD_DE: year, DT: String(value), UNIT_NM: unit };
}

describe("parseKosisRows (DT_MLTM_2100 주택보급률)", () => {
  it("빈 배열 → 빈 객체", () => {
    expect(parseKosisRows([])).toEqual({});
  });

  it("ITM_NM='보급률(다가구 구분거처 반영)' 매칭 시도 → 정상 추출", () => {
    const rows = [
      makeRow("서울", "보급률(다가구 구분거처 반영)", "2023", 93.6),
    ];
    const result = parseKosisRows(rows);
    expect(result["서울"]).toBeCloseTo(93.6, 1);
  });

  it("ITM_NM='보급률' (폐기 series) → 무시 (세션 236 환각 차단 박제)", () => {
    const rows = [
      makeRow("서울", "보급률", "2023", 0),
      makeRow("서울", "보급률(다가구 구분거처 반영)", "2023", 93.6),
    ];
    const result = parseKosisRows(rows);
    expect(result["서울"]).toBeCloseTo(93.6, 1);
  });

  it("ITM_NM='가구수' / '주택수' → 무시 (보급률 series 만 추출)", () => {
    const rows = [
      makeRow("서울", "가구수", "2023", 4000),
      makeRow("서울", "주택수", "2023", 3744),
      makeRow("서울", "보급률(다가구 구분거처 반영)", "2023", 93.6),
    ];
    const result = parseKosisRows(rows);
    expect(Object.keys(result)).toEqual(["서울"]);
    expect(result["서울"]).toBeCloseTo(93.6, 1);
  });

  it("최신 연도 우선 (2022 → 2023 덮어쓰기)", () => {
    const rows = [
      makeRow("서울", "보급률(다가구 구분거처 반영)", "2022", 90.0),
      makeRow("서울", "보급률(다가구 구분거처 반영)", "2023", 93.6),
    ];
    const result = parseKosisRows(rows);
    expect(result["서울"]).toBeCloseTo(93.6, 1);
  });

  it("정식명 '서울특별시' → '서울' 매핑 (REGION_MAP 답습)", () => {
    const rows = [
      makeRow("서울특별시", "보급률(다가구 구분거처 반영)", "2023", 93.6),
    ];
    const result = parseKosisRows(rows);
    expect(result["서울"]).toBeCloseTo(93.6, 1);
  });

  it("알 수 없는 시도명 ('전국'/'수도권'/'지방') → 무시 (시도 17 만)", () => {
    const rows = [
      makeRow("전국", "보급률(다가구 구분거처 반영)", "2023", 102.5),
      makeRow("수도권", "보급률(다가구 구분거처 반영)", "2023", 99.0),
      makeRow("지방", "보급률(다가구 구분거처 반영)", "2023", 105.0),
    ];
    const result = parseKosisRows(rows);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("DT='abc' (숫자 아님) → 무시", () => {
    const rows = [makeRow("서울", "보급률(다가구 구분거처 반영)", "2023", "abc")];
    expect(parseKosisRows(rows)).toEqual({});
  });

  it("DT=0 또는 음수 → 무시 (이상치 가드)", () => {
    const rows = [
      makeRow("서울", "보급률(다가구 구분거처 반영)", "2023", 0),
      makeRow("부산", "보급률(다가구 구분거처 반영)", "2023", -5),
    ];
    expect(parseKosisRows(rows)).toEqual({});
  });

  it("DT>200 (이상치) → 무시", () => {
    const rows = [makeRow("서울", "보급률(다가구 구분거처 반영)", "2023", 250)];
    expect(parseKosisRows(rows)).toEqual({});
  });

  it("시도 17개 동시 처리 (실측 응답 구조 답습)", () => {
    const regions = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
                     "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];
    const rows = regions.map((r, i) => makeRow(r, "보급률(다가구 구분거처 반영)", "2023", 90 + i * 0.5));
    const result = parseKosisRows(rows);
    expect(Object.keys(result)).toHaveLength(17);
    expect(result["서울"]).toBeCloseTo(90.0, 1);
    expect(result["제주"]).toBeCloseTo(98.0, 1);
  });

  // 세션568: REGION_MAP 무음 continue 제거 — 통합 시도("전남광주")는 이 표에서
  // 시도 단위 합계만 오므로(C2_NM 없음) 가를 수 없어 건너뛰되 tracker 로 집계.
  it("'전남광주' 시도 단위 합계 행 → 결과에 안 들어가고 tracker.unmergeable 집계", () => {
    const rows = [
      makeRow("전남광주", "보급률(다가구 구분거처 반영)", "2023", 100.0),
      makeRow("서울", "보급률(다가구 구분거처 반영)", "2023", 93.6),
    ];
    const tracker = createRegionResolutionTracker();
    const result = parseKosisRows(rows, tracker);
    expect(result["서울"]).toBeCloseTo(93.6, 1);
    expect(result["광주"]).toBeUndefined();
    expect(result["전남"]).toBeUndefined();
    expect(tracker.summary()).toEqual({ unmergeable: 1, unknown: 0, unknownNames: [] });
  });

  it("모르는 이름('지방') → tracker.unknownNames 에 잡힌다", () => {
    const rows = [makeRow("지방", "보급률(다가구 구분거처 반영)", "2023", 105.0)];
    const tracker = createRegionResolutionTracker();
    parseKosisRows(rows, tracker);
    expect(tracker.summary().unknownNames).toEqual(["지방"]);
  });

  it("tracker 생략 시(기본값) — 기존 호출부와 동일하게 동작(하위호환)", () => {
    const rows = [makeRow("서울", "보급률(다가구 구분거처 반영)", "2023", 93.6)];
    const result = parseKosisRows(rows);
    expect(result["서울"]).toBeCloseTo(93.6, 1);
  });
});

// ── main() collector_runs 기록 하드닝 (KOSIS 러너 차단 사고, 세션 395) ──
describe("main() recordCollectorRun 하드닝", () => {
  beforeEach(() => {
    fetchWithRetryMock.mockReset();
    recordCollectorRun.mockClear();
    getSupabase.mockReset();
  });

  it("KOSIS fetch 실패 → rethrow + status=failure 기록", async () => {
    fetchWithRetryMock.mockRejectedValue(new Error("fetch failed"));
    await expect(main()).rejects.toThrow(/KOSIS fetch failed/);
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "kosis-housing-supply-ratio",
      expect.objectContaining({ status: "failure" }),
    );
  });

  it("빈 응답 early-return 도 기록 (ok=0, skip=0)", async () => {
    fetchWithRetryMock.mockResolvedValue({ json: async () => [] });
    await main();
    expect(recordCollectorRun).toHaveBeenCalledTimes(1);
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "kosis-housing-supply-ratio",
      { ok: 0, skip: 0 },
    );
  });

  it("값 무변경(diff<0.05) → skip 기록 (monitor ⑤ outage 오탐 차단, 세션 395)", async () => {
    fetchWithRetryMock.mockResolvedValue({ json: async () => [
      makeRow("서울", "보급률(다가구 구분거처 반영)", "2023", 93.6),
    ] });
    getSupabase.mockReturnValue({
      from: () => ({ select: () => ({ is: async () => ({
        data: [{ id: "1", region: "서울", gu: null, housing_supply_level: 93.6 }],
        error: null,
      }) }) }),
    });
    await main();
    expect(recordCollectorRun).toHaveBeenCalledTimes(1);
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "kosis-housing-supply-ratio",
      { ok: 0, skip: 1 },
    );
  });

  it("'전남광주' 통합 시도 행이 섞여 있으면 main() 이 건너뜀을 로그로 남긴다", async () => {
    log.mockClear();
    fetchWithRetryMock.mockResolvedValue({ json: async () => [
      makeRow("전남광주", "보급률(다가구 구분거처 반영)", "2023", 100.0),
      makeRow("서울", "보급률(다가구 구분거처 반영)", "2023", 93.6),
    ] });
    getSupabase.mockReturnValue({
      from: () => ({
        select: () => ({ is: async () => ({
          data: [{ id: "1", region: "서울", gu: null, housing_supply_level: null }],
          error: null,
        }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
    });
    await main();
    const messages = log.mock.calls.map((/** @type {any[]} */ c) => String(c[1]));
    expect(messages.some((/** @type {string} */ m) => m.includes("전남광주") && m.includes("1행"))).toBe(true);
  });
});
