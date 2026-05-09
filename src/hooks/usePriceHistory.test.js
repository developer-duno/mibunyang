// @ts-check
/**
 * usePriceHistory 래퍼 훅 테스트 — useHistoryData에 올바른 엔드포인트 전달 확인
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePriceHistory } from "./usePriceHistory";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(/** @type {Response} */ ({
    ok: true,
    json: () => Promise.resolve({ ok: true, data: [{ price: 50000 }] }),
  }));
});

describe("usePriceHistory", () => {
  // 올바른 엔드포인트 호출
  it("/api/supabase/prices 엔드포인트를 호출한다", async () => {
    const { result } = renderHook(() => usePriceHistory("ah-100"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/supabase/prices"),
      expect.any(Object),
    );
  });

  // 데이터 반환 확인
  it("data, loading, error, retry를 반환한다", async () => {
    const { result } = renderHook(() => usePriceHistory("ah-100"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([{ price: 50000 }]);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.retry).toBe("function");
  });

  // siblingIds 전달 시 apartment_ids 사용
  it("siblingIds 전달 시 apartment_ids 파라미터를 사용한다", async () => {
    renderHook(() => usePriceHistory("ah-1", ["ah-1", "ah-2"]));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("apartment_ids="),
        expect.any(Object),
      );
    });
  });
});
