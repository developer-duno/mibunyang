// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// fetchStaticApartments 모킹
vi.mock("@/services/staticDataApi", () => ({
  fetchStaticApartments: vi.fn(),
}));

import { useApartmentData } from "./useApartmentData";
import { fetchStaticApartments } from "@/services/staticDataApi";

describe("useApartmentData", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("성공 시 아파트 데이터와 dataUpdatedAt 반환", async () => {
    /** @type {import('vitest').Mock} */ (fetchStaticApartments).mockResolvedValue({
      data: [{ id: 1 }],
      dataUpdatedAt: "2026-01-01",
    });
    const { result } = renderHook(() => useApartmentData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.apartments).toEqual([{ id: 1, siblingIds: [1] }]);
    expect(result.current.dataUpdatedAt).toBe("2026-01-01");
    expect(result.current.error).toBeNull();
  });

  it("3회 모두 실패 → 에러 상태", async () => {
    /** @type {import('vitest').Mock} */ (fetchStaticApartments).mockRejectedValue(new Error("서버 오류"));

    const { result } = renderHook(() => useApartmentData());
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 15000 });
    expect(result.current.error).toBe("서버 오류");
    expect(result.current.apartments).toEqual([]);
  }, 20000);

  it("dataUpdatedAt 없으면 null", async () => {
    /** @type {import('vitest').Mock} */ (fetchStaticApartments).mockResolvedValue({ data: [{ id: 1 }] });
    const { result } = renderHook(() => useApartmentData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dataUpdatedAt).toBeNull();
  });

  it("retry 함수 존재", async () => {
    /** @type {import('vitest').Mock} */ (fetchStaticApartments).mockResolvedValue({ data: [] });
    const { result } = renderHook(() => useApartmentData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(typeof result.current.retry).toBe("function");
  });

  it("초기 로딩 상태 = true", () => {
    /** @type {import('vitest').Mock} */ (fetchStaticApartments).mockReturnValue(new Promise(() => {})); // 영원히 대기
    const { result } = renderHook(() => useApartmentData());
    expect(result.current.loading).toBe(true);
    expect(result.current.apartments).toEqual([]);
  });

  // 세션664: 효과의 AbortSignal 을 fetchStaticApartments 에 넘겨야 정리 때 HTTP 요청까지 끊긴다
  // (안 넘기면 StrictMode 의 버린 첫 요청이 살아 남아 목록 응답이 두 번 오고 첫 카드가 두 배 늦다).
  it("효과의 AbortSignal 을 넘기고, 언마운트하면 그 신호가 끊긴다", () => {
    /** @type {import('vitest').Mock} */ (fetchStaticApartments).mockReturnValue(new Promise(() => {}));
    const { unmount } = renderHook(() => useApartmentData());
    const signal = /** @type {import('vitest').Mock} */ (fetchStaticApartments).mock.calls.at(-1)?.[0];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
