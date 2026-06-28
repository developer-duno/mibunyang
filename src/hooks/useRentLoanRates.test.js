// @ts-check
/**
 * useRentLoanRates 훅 테스트 — 전세자금대출 금리 페칭
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useRentLoanRates } from "./useRentLoanRates";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

/**
 * 정상 응답 팩토리
 * @param {any[]} data
 */
function mockFetchSuccess(data = []) {
  /** @type {import('vitest').Mock} */ (fetch).mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ ok: true, data }),
  });
}

describe("useRentLoanRates", () => {
  // 정상: 전세대출 금리 로드
  it("전세대출 금리 데이터를 성공적으로 로드한다", async () => {
    const mockData = [{ bank: "테스트은행", product: "전세대출A", rateMin: 3.8, rateMax: 4.5 }];
    mockFetchSuccess(mockData);

    const { result } = renderHook(() => useRentLoanRates());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.rates).toEqual(mockData);
    expect(result.current.error).toBeNull();
  });

  // /api/finlife/rates?type=rent 엔드포인트 호출 확인
  it("/api/finlife/rates?type=rent 엔드포인트를 호출한다", async () => {
    mockFetchSuccess([]);

    renderHook(() => useRentLoanRates());

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/finlife/rates?type=rent"),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  // 에러: API 실패
  it("API 실패 시 에러를 설정한다", async () => {
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() => useRentLoanRates());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.rates).toEqual([]);
  });
});
