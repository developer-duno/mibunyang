// @ts-check
/**
 * trade-stats-regions.mjs 테스트 — 시군구별 jeonse_rate 산식 검증
 *
 * 대상: computeRegionJeonseRate, pickLatestPerKey
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    getMibuyangSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    recordCollectorRun: vi.fn(),
    setupGracefulShutdown: () => () => false,
  };
});

const { computeRegionJeonseRate, pickLatestPerKey } = await import("./trade-stats-regions.mjs");

/**
 * @param {string} region
 * @param {string | null} gu
 * @param {string} type "sale" | "jeonse"
 * @param {number} price
 */
function makeTrade(region, gu, type, price) {
  return { region, gu, trade_type: type, price };
}

describe("computeRegionJeonseRate", () => {
  it("표본 충족 시군구 (sale ≥ 3, jeonse ≥ 3) → 산식 적용 % 단위", () => {
    /** @type {Array<Record<string, any>>} */
    const trades = [
      // 서울:강남 sale 10억/10억/10억 (median 100000), jeonse 7억/7억/7억 (median 70000)
      makeTrade("서울", "강남구", "sale", 100000),
      makeTrade("서울", "강남구", "sale", 100000),
      makeTrade("서울", "강남구", "sale", 100000),
      makeTrade("서울", "강남구", "jeonse", 70000),
      makeTrade("서울", "강남구", "jeonse", 70000),
      makeTrade("서울", "강남구", "jeonse", 70000),
    ];
    const rates = computeRegionJeonseRate(trades);
    // 70000 / 100000 = 0.7 → × 1000 = 700 → / 10 = 70.0
    expect(rates.get("서울:강남구")).toBe(70);
  });

  it("sale 부족 (< 3) → NULL skip", () => {
    /** @type {Array<Record<string, any>>} */
    const trades = [
      makeTrade("서울", "강남구", "sale", 100000),
      makeTrade("서울", "강남구", "sale", 100000),
      makeTrade("서울", "강남구", "jeonse", 70000),
      makeTrade("서울", "강남구", "jeonse", 70000),
      makeTrade("서울", "강남구", "jeonse", 70000),
    ];
    const rates = computeRegionJeonseRate(trades);
    expect(rates.has("서울:강남구")).toBe(false);
  });

  it("jeonse 부족 (< 3) → NULL skip", () => {
    /** @type {Array<Record<string, any>>} */
    const trades = [
      makeTrade("서울", "강남구", "sale", 100000),
      makeTrade("서울", "강남구", "sale", 100000),
      makeTrade("서울", "강남구", "sale", 100000),
      makeTrade("서울", "강남구", "jeonse", 70000),
      makeTrade("서울", "강남구", "jeonse", 70000),
    ];
    const rates = computeRegionJeonseRate(trades);
    expect(rates.has("서울:강남구")).toBe(false);
  });

  it("세종 분기 (gu null) → 세종: 키로 통합", () => {
    /** @type {Array<Record<string, any>>} */
    const trades = [
      makeTrade("세종", null, "sale", 80000),
      makeTrade("세종", null, "sale", 80000),
      makeTrade("세종", null, "sale", 80000),
      makeTrade("세종", null, "jeonse", 60000),
      makeTrade("세종", null, "jeonse", 60000),
      makeTrade("세종", null, "jeonse", 60000),
    ];
    const rates = computeRegionJeonseRate(trades);
    // 60000 / 80000 = 0.75 → 75.0
    expect(rates.get("세종:")).toBe(75);
  });

  it("한글 trade_type (sale=매매, jeonse=전세) 답습 호환", () => {
    /** @type {Array<Record<string, any>>} */
    const trades = [
      { region: "부산", gu: "해운대구", trade_type: "매매", price: 50000 },
      { region: "부산", gu: "해운대구", trade_type: "매매", price: 50000 },
      { region: "부산", gu: "매매", price: 50000, trade_type: "매매" },
      { region: "부산", gu: "해운대구", trade_type: "전세", price: 35000 },
      { region: "부산", gu: "해운대구", trade_type: "전세", price: 35000 },
      { region: "부산", gu: "해운대구", trade_type: "전세", price: 35000 },
    ];
    // 정확한 5건 (gu='해운대구' 만 사용) → sale 2건 + jeonse 3건 → sale 부족
    const rates = computeRegionJeonseRate(trades);
    expect(rates.has("부산:해운대구")).toBe(false);
  });

  it("trade_type null (구형 데이터) → sale 로 답습", () => {
    /** @type {Array<Record<string, any>>} */
    const trades = [
      { region: "대구", gu: "수성구", trade_type: null, price: 60000 },
      { region: "대구", gu: "수성구", trade_type: null, price: 60000 },
      { region: "대구", gu: "수성구", trade_type: null, price: 60000 },
      { region: "대구", gu: "수성구", trade_type: "jeonse", price: 45000 },
      { region: "대구", gu: "수성구", trade_type: "jeonse", price: 45000 },
      { region: "대구", gu: "수성구", trade_type: "jeonse", price: 45000 },
    ];
    const rates = computeRegionJeonseRate(trades);
    expect(rates.get("대구:수성구")).toBe(75);
  });

  it("price null 행 → skip", () => {
    /** @type {Array<Record<string, any>>} */
    const trades = [
      makeTrade("인천", "남동구", "sale", 50000),
      makeTrade("인천", "남동구", "sale", 50000),
      makeTrade("인천", "남동구", "sale", 50000),
      { region: "인천", gu: "남동구", trade_type: "jeonse", price: null },
      makeTrade("인천", "남동구", "jeonse", 35000),
      makeTrade("인천", "남동구", "jeonse", 35000),
      makeTrade("인천", "남동구", "jeonse", 35000),
    ];
    const rates = computeRegionJeonseRate(trades);
    // null 제외 sale 3 + jeonse 3 → 35000/50000 = 70.0
    expect(rates.get("인천:남동구")).toBe(70);
  });

  it("region null/gu null (비세종) → skip", () => {
    /** @type {Array<Record<string, any>>} */
    const trades = [
      makeTrade("서울", null, "sale", 100000),
      makeTrade("서울", null, "sale", 100000),
      makeTrade("서울", null, "sale", 100000),
      makeTrade("서울", null, "jeonse", 70000),
      makeTrade("서울", null, "jeonse", 70000),
      makeTrade("서울", null, "jeonse", 70000),
    ];
    const rates = computeRegionJeonseRate(trades);
    // statsKey("서울", null) = null → skip
    expect(rates.size).toBe(0);
  });
});

describe("pickLatestPerKey", () => {
  it("시군구별 가장 최근 recorded_at row 1건만 선택", () => {
    const regions = [
      { id: 1, region: "서울", gu: "강남구", recorded_at: "2026-01-01" },
      { id: 2, region: "서울", gu: "강남구", recorded_at: "2026-05-01" }, // 최신
      { id: 3, region: "서울", gu: "강남구", recorded_at: "2026-03-01" },
      { id: 4, region: "부산", gu: "해운대구", recorded_at: "2026-04-01" },
    ];
    const latest = pickLatestPerKey(regions);
    expect(latest.size).toBe(2);
    expect(latest.get("서울:강남구")).toEqual({ id: 2, recorded_at: "2026-05-01" });
    expect(latest.get("부산:해운대구")).toEqual({ id: 4, recorded_at: "2026-04-01" });
  });

  it("세종 (gu null) → 세종: 키로 통합", () => {
    const regions = [
      { id: 5, region: "세종", gu: null, recorded_at: "2026-05-01" },
    ];
    const latest = pickLatestPerKey(regions);
    expect(latest.get("세종:")).toEqual({ id: 5, recorded_at: "2026-05-01" });
  });

  it("region null → skip", () => {
    const regions = [
      { id: 6, region: "", gu: "강남구", recorded_at: "2026-05-01" },
    ];
    const latest = pickLatestPerKey(regions);
    expect(latest.size).toBe(0);
  });
});
