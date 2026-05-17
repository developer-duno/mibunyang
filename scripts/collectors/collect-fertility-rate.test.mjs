// @ts-check
/**
 * collect-fertility-rate.mjs 테스트 — KOSIS DT_1B81A17 합계출산율 파싱 검증
 *
 * 대상: parseKosisRows
 * 환각 차단: 1차원 통계표 C1 길이 2(집계행)/5(시군구) 분기, 동명 시군구 시도코드 구분
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
    recordCollectorRun: vi.fn(),
  };
});

const { parseKosisRows } = await import("./collect-fertility-rate.mjs");

/**
 * @param {string} c1     C1 코드 (2자리=집계행 / 5자리=시군구)
 * @param {string} c1Nm   C1_NM (시도명 또는 시군구명)
 * @param {string} year   PRD_DE
 * @param {string|number} value  DT
 * @param {string} [itm]  ITM_NM
 */
function makeRow(c1, c1Nm, year, value, itm = "합계출산율") {
  return { C1: c1, C1_NM: c1Nm, ITM_NM: itm, PRD_DE: year, DT: String(value) };
}

describe("parseKosisRows (DT_1B81A17 합계출산율)", () => {
  it("빈 배열 → matched 빈 객체", () => {
    expect(parseKosisRows([])).toEqual({ matched: {}, unmatched: [], aggSkipped: 0 });
  });

  it("5자리 C1 시군구 정상 → region::gu 키로 추출", () => {
    const result = parseKosisRows([makeRow("11010", "종로구", "2023", 0.406)]);
    expect(result.matched["서울::종로구"]).toBeCloseTo(0.406, 3);
  });

  it("동명 시군구 — C1 앞 2자리 시도코드로 구분 (서울 중구 ≠ 부산 중구)", () => {
    const result = parseKosisRows([
      makeRow("11020", "중구", "2023", 0.534),
      makeRow("21010", "중구", "2023", 0.32),
    ]);
    expect(result.matched["서울::중구"]).toBeCloseTo(0.534, 3);
    expect(result.matched["부산::중구"]).toBeCloseTo(0.32, 3);
  });

  it("2자리 C1 집계행 (전국 '00' / 서울 '11') → aggSkipped 증가, matched 미포함", () => {
    const result = parseKosisRows([
      makeRow("00", "전국", "2023", 0.721),
      makeRow("11", "서울특별시", "2023", 0.552),
      makeRow("11010", "종로구", "2023", 0.406),
    ]);
    expect(result.aggSkipped).toBe(2);
    expect(Object.keys(result.matched)).toEqual(["서울::종로구"]);
  });

  it("최신 연도 우선 (2022 → 2023 덮어쓰기)", () => {
    const result = parseKosisRows([
      makeRow("11010", "종로구", "2022", 0.477),
      makeRow("11010", "종로구", "2023", 0.406),
    ]);
    expect(result.matched["서울::종로구"]).toBeCloseTo(0.406, 3);
  });

  it("DT='abc' (숫자 아님) → 무시", () => {
    const result = parseKosisRows([makeRow("11010", "종로구", "2023", "abc")]);
    expect(result.matched).toEqual({});
  });

  it("DT<=0 또는 >5 (이상치 가드) → 무시", () => {
    const result = parseKosisRows([
      makeRow("11010", "종로구", "2023", 0),
      makeRow("11020", "중구", "2023", 7),
    ]);
    expect(result.matched).toEqual({});
  });

  it("알 수 없는 KOSIS 시도코드 (99xxx) → unmatched 에 C1_NM push", () => {
    const result = parseKosisRows([makeRow("99010", "가상시", "2023", 0.5)]);
    expect(result.matched).toEqual({});
    expect(result.unmatched).toEqual(["가상시"]);
  });

  it("ITM_NM='합계출산율' 외 (모의 연령별출산율) → 무시", () => {
    const result = parseKosisRows([
      makeRow("11010", "종로구", "2023", 15.2, "모의 연령별출산율:15-19세"),
      makeRow("11010", "종로구", "2023", 0.406, "합계출산율"),
    ]);
    expect(Object.keys(result.matched)).toEqual(["서울::종로구"]);
    expect(result.matched["서울::종로구"]).toBeCloseTo(0.406, 3);
  });

  it("PRD_DE 비-연도 포맷 → 무시", () => {
    const result = parseKosisRows([makeRow("11010", "종로구", "2023M01", 0.4)]);
    expect(result.matched).toEqual({});
  });

  it("C1 길이 비정상 (3·4자리) → 무시", () => {
    const result = parseKosisRows([
      makeRow("110", "이상", "2023", 0.4),
      makeRow("1101", "이상", "2023", 0.4),
    ]);
    expect(result.matched).toEqual({});
  });

  it("17개 시도 시군구 동시 처리 — 시도코드별 region 매핑", () => {
    const sido = [
      ["11", "서울"], ["21", "부산"], ["22", "대구"], ["23", "인천"], ["24", "광주"],
      ["25", "대전"], ["26", "울산"], ["29", "세종"], ["31", "경기"], ["32", "강원"],
      ["33", "충북"], ["34", "충남"], ["35", "전북"], ["36", "전남"], ["37", "경북"],
      ["38", "경남"], ["39", "제주"],
    ];
    const rows = sido.map(([code, region], i) =>
      makeRow(`${code}010`, `${region}시군구`, "2023", 0.5 + i * 0.01),
    );
    const result = parseKosisRows(rows);
    expect(Object.keys(result.matched)).toHaveLength(17);
    expect(result.matched["서울::서울시군구"]).toBeCloseTo(0.5, 3);
    expect(result.matched["제주::제주시군구"]).toBeCloseTo(0.66, 3);
    expect(result.unmatched).toHaveLength(0);
  });

  it("전국 + 시도 + 시군구 혼합 → 시군구만 matched, 나머지 aggSkipped", () => {
    const result = parseKosisRows([
      makeRow("00", "전국", "2023", 0.721),
      makeRow("11", "서울특별시", "2023", 0.552),
      makeRow("31", "경기도", "2023", 0.766),
      makeRow("11010", "종로구", "2023", 0.406),
      makeRow("31010", "수원시", "2023", 0.8),
    ]);
    expect(result.aggSkipped).toBe(3);
    expect(Object.keys(result.matched).sort()).toEqual(["경기::수원시", "서울::종로구"]);
  });
});
