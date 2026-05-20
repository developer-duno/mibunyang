// @vitest-environment node
// @ts-check
/**
 * supabase/market-stats-history.js 테스트 — region+gu 시계열 API
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_lib/rateLimit.js", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

const mockData = [
  { region: "서울", gu: "강남구", base_month: "202503", price_index: 105.2, avg_price_sqm: 12500, new_supply: 320, initial_sale_rate: 92.5, land_cost_ratio: 35.1 },
  { region: "서울", gu: "강남구", base_month: "202504", price_index: 106.1, avg_price_sqm: 12700, new_supply: 280, initial_sale_rate: 95.3, land_cost_ratio: 35.8 },
];

const mockOrder = vi.fn().mockResolvedValue({ data: mockData, error: null });
const mockQuery = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: mockOrder,
};
vi.mock("../_lib/supabase.js", () => ({
  getSupabase: () => ({ from: vi.fn(() => mockQuery) }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockOrder.mockResolvedValue({ data: mockData, error: null });
});

const { default: handler } = await import("./market-stats-history.js");

function makeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn(), end: vi.fn() };
}

describe("supabase/market-stats-history handler", () => {
  it("GET 이 아닌 메서드는 405", async () => {
    const res = makeRes();
    await handler({ method: "POST", query: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it("region 파라미터 없으면 400 + 한국어 에러", async () => {
    const res = makeRes();
    await handler({ method: "GET", query: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: expect.stringContaining("region") }));
  });

  it("region 20자 초과 / gu 30자 초과 → 400 잘못된 입력", async () => {
    const res = makeRes();
    await handler({ method: "GET", query: { region: "x".repeat(21), gu: "" }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);

    const res2 = makeRes();
    await handler({ method: "GET", query: { region: "서울", gu: "y".repeat(31) }, headers: {} }, res2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  it("정상 region+gu → 200 + 데이터 + fallback:false + Cache-Control", async () => {
    const res = makeRes();
    await handler({ method: "GET", query: { region: "서울", gu: "강남구" }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      data: mockData,
      count: 2,
      fallback: false,
      fetchedAt: expect.any(String),
    }));
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", expect.stringContaining("s-maxage=3600"));
    expect(mockQuery.eq).toHaveBeenCalledWith("region", "서울");
    expect(mockQuery.eq).toHaveBeenCalledWith("gu", "강남구");
    expect(mockQuery.order).toHaveBeenCalledWith("base_month", { ascending: true });
  });

  it("gu 빈 문자열 (시도 단위) → 200 + .eq('gu', '') + fallback:false", async () => {
    const res = makeRes();
    await handler({ method: "GET", query: { region: "서울", gu: "" }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockQuery.eq).toHaveBeenCalledWith("gu", "");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ fallback: false }));
  });

  it("gu='서구' 빈 응답 → gu='' 시도 폴백 + fallback:true", async () => {
    const fallbackRows = [
      { region: "인천", gu: "", base_month: "202501", price_index: null, avg_price_sqm: 100, new_supply: 20, initial_sale_rate: null, land_cost_ratio: 35 },
      { region: "인천", gu: "", base_month: "202502", price_index: null, avg_price_sqm: 110, new_supply: 30, initial_sale_rate: null, land_cost_ratio: 36 },
    ];
    // 1차 (gu="서구"): 빈 응답 → 2차 (gu=""): 시도 데이터
    mockOrder
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: fallbackRows, error: null });
    const res = makeRes();
    await handler({ method: "GET", query: { region: "인천", gu: "서구" }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      data: fallbackRows,
      count: 2,
      fallback: true,
    }));
    expect(mockQuery.eq).toHaveBeenCalledWith("gu", "서구");
    expect(mockQuery.eq).toHaveBeenCalledWith("gu", "");
  });

  it("gu='' (시도 직접 조회) 빈 응답이어도 폴백 발동 X", async () => {
    mockOrder.mockResolvedValueOnce({ data: [], error: null });
    const res = makeRes();
    await handler({ method: "GET", query: { region: "강원", gu: "" }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: [],
      count: 0,
      fallback: false,
    }));
    // 폴백 발동 안 함 → eq("gu", ...) 호출 1회만 (1차 gu="")
    const guCalls = mockQuery.eq.mock.calls.filter((/** @type {any[]} */ c) => c[0] === "gu");
    expect(guCalls).toHaveLength(1);
  });

  it("Supabase error → 500 시장통계 메시지", async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: "DB down" } });
    const res = makeRes();
    await handler({ method: "GET", query: { region: "서울", gu: "강남구" }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      error: expect.stringContaining("시장통계"),
    }));
  });
});
