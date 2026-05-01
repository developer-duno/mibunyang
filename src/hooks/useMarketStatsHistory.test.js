import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useMarketStatsHistory } from "./useMarketStatsHistory";

const SAMPLE = [
  { region: "서울", gu: "강남구", base_month: "202503", price_index: 105.2 },
  { region: "서울", gu: "강남구", base_month: "202504", price_index: 106.1 },
];

describe("useMarketStatsHistory", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, data: SAMPLE, count: 2 }),
    }));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("region+gu 정상 fetch → data 채워지고 loading false", async () => {
    const { result } = renderHook(() => useMarketStatsHistory("서울", "강남구"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(SAMPLE);
    expect(result.current.error).toBe(null);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("region=%EC%84%9C%EC%9A%B8&gu=%EA%B0%95%EB%82%A8%EA%B5%AC"),
      expect.any(Object),
    );
  });

  it("region 빈 문자열 → fetch 호출 0 (early return)", async () => {
    const { result } = renderHook(() => useMarketStatsHistory("", "강남구"));
    // microtask flush
    await new Promise(r => setTimeout(r, 0));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.current.data).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("429 응답 → 한국어 에러 메시지", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 429 }));
    const { result } = renderHook(() => useMarketStatsHistory("서울", "강남구"));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toContain("잠시 후 다시");
    expect(result.current.loading).toBe(false);
  });

  it("retry() 호출 → fetch 재호출 (tick +1)", async () => {
    const { result } = renderHook(() => useMarketStatsHistory("서울", "강남구"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    act(() => { result.current.retry(); });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
  });
});
