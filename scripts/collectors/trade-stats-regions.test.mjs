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

const { computeRegionJeonseRate, pickLatestPerKey, fetchAllTrades } = await import("./trade-stats-regions.mjs");

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

// ── fetchAllTrades — 고유키 커서 페이징 (세션534) ──────────────
//
// 사고: 옛 구현은 무정렬 `.range()` 로 trades(79만행)를 훑어 저장 집계가 원본의 8% 수준이었다
// (unordered-pagination-loses-rows.md). 고유키(id) 커서로 바꿔 전량 유실 없이 받는다.
// 배선(쿼리를 어떻게 만드는지)이라 mock 으로 잠근다.
describe("fetchAllTrades — 고유키 커서 페이징", () => {
  /**
   * PostgREST 쿼리 빌더 mock. 호출 메서드를 순서대로 기록하고 페이지를 순차 반환한다.
   * @param {Array<Array<Record<string, any>>>} pages
   */
  function makeSb(pages) {
    /** @type {Array<{ method: string, args: any[] }>} */
    const calls = [];
    let page = 0;
    const builder = {
      /** @param {string} s */
      select(s) { calls.push({ method: "select", args: [s] }); return builder; },
      /** @param {string} c @param {any} v */
      gte(c, v) { calls.push({ method: "gte", args: [c, v] }); return builder; },
      /** @param {string} c @param {any} v */
      is(c, v) { calls.push({ method: "is", args: [c, v] }); return builder; },
      /** @param {string} c @param {any} o */
      order(c, o) { calls.push({ method: "order", args: [c, o] }); return builder; },
      /** @param {number} n */
      limit(n) { calls.push({ method: "limit", args: [n] }); return builder; },
      /** @param {string} c @param {any} v */
      gt(c, v) { calls.push({ method: "gt", args: [c, v] }); return builder; },
      /** @param {number} a @param {number} b */
      range(a, b) { calls.push({ method: "range", args: [a, b] }); return builder; },
      /** @param {any} r */
      then(r) { return Promise.resolve({ data: pages[page++] ?? [], error: null }).then(r); },
    };
    const sb = {
      /** @param {string} t */
      from(t) { calls.push({ method: "from", args: [t] }); return builder; },
    };
    return { sb, calls };
  }

  /** @param {number} n @param {number} start */
  const rows = (n, start = 0) =>
    Array.from({ length: n }, (_, i) => ({ id: start + i + 1, region: "서울", gu: "강남구", price: 1, trade_type: "sale", deal_month: "202601" }));

  it("select 에 id 포함 + order(id asc) 로 페이징 — 무정렬 range 를 쓰지 않는다", async () => {
    const { sb, calls } = makeSb([rows(1000), rows(3, 1000)]);
    const out = await fetchAllTrades(/** @type {any} */ (sb), "202601");
    expect(calls.find((c) => c.method === "select")?.args[0]).toBe("id,region,gu,price,trade_type,deal_month");
    const orders = calls.filter((c) => c.method === "order");
    expect(orders.length).toBe(2); // 2페이지 = order 2회
    expect(orders[0].args).toEqual(["id", { ascending: true }]);
    expect(calls.some((c) => c.method === "range")).toBe(false); // 무정렬 OFFSET 금지
    expect(out.length).toBe(1003); // 2페이지 전량
  });

  it("2페이지부터 커서(gt 마지막 id)로 이어받는다 — 오프셋을 안 쓴다", async () => {
    const { sb, calls } = makeSb([rows(1000), rows(2, 1000)]);
    const out = await fetchAllTrades(/** @type {any} */ (sb), "202601");
    const gts = calls.filter((c) => c.method === "gt");
    expect(gts.length).toBe(1); // 1페이지엔 커서 없음, 2페이지에만
    expect(gts[0].args).toEqual(["id", 1000]); // 1페이지 마지막 id
    expect(out.length).toBe(1002);
    expect(new Set(out.map((r) => r.id)).size).toBe(1002); // 중복 0
  });
});
