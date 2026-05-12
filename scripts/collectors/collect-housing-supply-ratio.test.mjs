// @ts-check
/**
 * collect-housing-supply-ratio.mjs 테스트 — KOSIS DT_MLTM_2100 주택보급률 파싱 검증
 *
 * 대상: parseKosisRows
 * 환각 차단: ITM_NM='보급률(다가구 구분거처 반영)' 필터 (세션 236 정정 박제)
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    recordApiQuota: vi.fn(),
  };
});

const { parseKosisRows } = await import("./collect-housing-supply-ratio.mjs");

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
});
