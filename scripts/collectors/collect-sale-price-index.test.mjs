// @ts-check
/**
 * collect-sale-price-index.mjs 테스트 — KOSIS DT_KAB_11672_S5 매매가격지수 파싱 검증
 *
 * 대상: parseKabRows
 * 환각 차단: C1 코드 앞 2자리(부동산원 자체 시도 순번) 판정, 동명 시군구 구분,
 *           8개 시도 외 코드 skip, 분기 base_month 형식
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
    upsertBatch: vi.fn(),
    recordApiQuota: vi.fn(),
    recordCollectorRun: vi.fn(),
  };
});

const { parseKabRows } = await import("./collect-sale-price-index.mjs");

/**
 * @param {string} c1     C1 코드 (SSNNN 5자리)
 * @param {string} c1Nm   C1_NM (시군구명)
 * @param {string} prd    PRD_DE (분기 YYYYQ 또는 YYYYMM)
 * @param {string|number} value  DT
 * @param {string} [itm]  ITM_NM
 */
function makeRow(c1, c1Nm, prd, value, itm = "지수") {
  return { C1: c1, C1_NM: c1Nm, ITM_NM: itm, PRD_DE: prd, DT: String(value) };
}

describe("parseKabRows (DT_KAB_11672_S5 매매가격지수)", () => {
  it("빈 배열 → matched 빈 배열", () => {
    expect(parseKabRows([])).toEqual({ matched: [], unmatched: [], skipped: 0 });
  });

  it("정상 시군구 행 → region/gu/base_month/sale_price_index 추출", () => {
    const result = parseKabRows([makeRow("10001", "종로구", "20251", 157.97)]);
    expect(result.matched).toEqual([
      { region: "서울", gu: "종로구", base_month: "20251", sale_price_index: 157.97 },
    ]);
  });

  it("C1 앞 2자리로 시도 판정 (10→서울, 80→경기)", () => {
    const result = parseKabRows([
      makeRow("10001", "종로구", "20251", 157.97),
      makeRow("80001", "수원시", "20251", 120.5),
    ]);
    expect(result.matched).toContainEqual(
      { region: "서울", gu: "종로구", base_month: "20251", sale_price_index: 157.97 },
    );
    expect(result.matched).toContainEqual(
      { region: "경기", gu: "수원시", base_month: "20251", sale_price_index: 120.5 },
    );
  });

  it("동명 시군구 — C1 앞 2자리로 구분 (서울 중구 ≠ 부산 중구)", () => {
    const result = parseKabRows([
      makeRow("10002", "중구", "20251", 150.1),
      makeRow("20001", "서구", "20251", 95.3),
      makeRow("20002", "중구", "20251", 88.7),
    ]);
    const seoul = result.matched.find((m) => m.region === "서울" && m.gu === "중구");
    const busan = result.matched.find((m) => m.region === "부산" && m.gu === "중구");
    expect(seoul?.sale_price_index).toBe(150.1);
    expect(busan?.sale_price_index).toBe(88.7);
  });

  it("8개 시도 외 C1 prefix (90xxx) → skipped 증가, matched 미포함", () => {
    const result = parseKabRows([
      makeRow("90001", "가상시", "20251", 100),
      makeRow("10001", "종로구", "20251", 157.97),
    ]);
    expect(result.skipped).toBe(1);
    expect(result.matched).toHaveLength(1);
  });

  it("DT='abc' (숫자 아님) → 무시", () => {
    const result = parseKabRows([makeRow("10001", "종로구", "20251", "abc")]);
    expect(result.matched).toEqual([]);
  });

  it("DT<=0 (이상치 가드) → 무시", () => {
    const result = parseKabRows([makeRow("10001", "종로구", "20251", 0)]);
    expect(result.matched).toEqual([]);
  });

  it("PRD_DE 6자리(YYYYMM) 분기 응답도 허용", () => {
    const result = parseKabRows([makeRow("10001", "종로구", "202501", 157.97)]);
    expect(result.matched[0]?.base_month).toBe("202501");
  });

  it("PRD_DE 비정상 포맷(7자리) → 무시", () => {
    const result = parseKabRows([makeRow("10001", "종로구", "2025Q01", 157.97)]);
    expect(result.matched).toEqual([]);
  });

  it("C1 길이 비정상(3·4자리) → 무시", () => {
    const result = parseKabRows([
      makeRow("100", "이상", "20251", 100),
      makeRow("1001", "이상", "20251", 100),
    ]);
    expect(result.matched).toEqual([]);
  });

  it("같은 시군구 여러 분기 → 모두 보존 (시계열)", () => {
    const result = parseKabRows([
      makeRow("10001", "종로구", "20244", 155.0),
      makeRow("10001", "종로구", "20251", 157.97),
    ]);
    expect(result.matched).toHaveLength(2);
  });

  it("ITM_NM '지수' 외 → 무시", () => {
    const result = parseKabRows([
      makeRow("10001", "종로구", "20251", 157.97, "변동률"),
    ]);
    expect(result.matched).toEqual([]);
  });

  it("8개 시도 동시 처리 — prefix별 region 매핑", () => {
    const sido = [
      ["10", "서울"], ["20", "부산"], ["30", "대구"], ["40", "인천"],
      ["50", "광주"], ["60", "대전"], ["70", "울산"], ["80", "경기"],
    ];
    const rows = sido.map(([px, region], i) =>
      makeRow(`${px}001`, `${region}구`, "20251", 100 + i),
    );
    const result = parseKabRows(rows);
    expect(result.matched).toHaveLength(8);
    expect(result.matched.find((m) => m.region === "서울")?.sale_price_index).toBe(100);
    expect(result.matched.find((m) => m.region === "경기")?.sale_price_index).toBe(107);
    expect(result.unmatched).toEqual([]);
  });
});
