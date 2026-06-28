// @ts-check
/**
 * useLoanRates 훅 테스트 — fetch mock, 로딩/에러 상태, useRef 캐싱
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useLoanRates } from "./useLoanRates";

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

describe("useLoanRates", () => {
  // 정상: 금리 데이터 로드
  it("금리 데이터를 성공적으로 로드한다", async () => {
    const mockData = [{ bank: "테스트은행", product: "대출A", rateMin: 3.5, rateMax: 4.2 }];
    mockFetchSuccess(mockData);

    const { result } = renderHook(() => useLoanRates());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.rates).toEqual(mockData);
    expect(result.current.error).toBeNull();
  });

  // 에러: API 실패
  it("API 실패 시 에러를 설정한다", async () => {
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useLoanRates());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.rates).toEqual([]);
  });

  // 에러: 네트워크 장애
  it("네트워크 장애 시 에러를 설정한다", async () => {
    /** @type {import('vitest').Mock} */ (fetch).mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useLoanRates());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Network error");
  });

  // 정상: 빈 데이터
  it("빈 데이터 응답 시 빈 배열을 반환한다", async () => {
    mockFetchSuccess([]);

    const { result } = renderHook(() => useLoanRates());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.rates).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  // /api/finlife/rates?type=mortgage 엔드포인트 호출 확인
  it("/api/finlife/rates?type=mortgage 엔드포인트를 호출한다", async () => {
    mockFetchSuccess([]);

    renderHook(() => useLoanRates());

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/finlife/rates?type=mortgage"),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  // 기본값 020000 확인
  it("기본값으로 topFinGrpNo=020000을 사용한다", async () => {
    mockFetchSuccess([]);

    renderHook(() => useLoanRates());

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("topFinGrpNo=020000"), expect.any(Object));
    });
  });

  // 금융권역 파라미터 전달 확인
  it("topFinGrpNo 파라미터가 fetch URL에 반영된다", async () => {
    mockFetchSuccess([]);

    renderHook(() => useLoanRates("030300"));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("topFinGrpNo=030300"), expect.any(Object));
    });
  });

  // 다른 금융권역 전환 시 재fetch
  it("다른 금융권역으로 전환 시 새로 fetch한다", async () => {
    mockFetchSuccess([{ bank: "은행A" }]);
    mockFetchSuccess([{ bank: "저축은행B" }]);

    const { result, rerender } = renderHook(({ grp }) => useLoanRates(grp), { initialProps: { grp: "020000" } });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.rates).toEqual([{ bank: "은행A" }]);

    rerender({ grp: "030300" });

    await waitFor(() => {
      expect(result.current.rates).toEqual([{ bank: "저축은행B" }]);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
