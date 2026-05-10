// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useHistoryData } from "./useHistoryData";

describe("useHistoryData", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 정상 케이스: API 호출 후 데이터 반환
  it("정상 응답 시 data 배열 반환", async () => {
    const mockData = [{ id: 1, value: 100 }, { id: 2, value: 200 }];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(/** @type {Response} */ ({
      ok: true,
      json: () => Promise.resolve({ ok: true, data: mockData }),
    }));

    const { result } = renderHook(() =>
      useHistoryData("/api/supabase/prices", "ah-123")
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      "/api/supabase/prices?apartment_id=ah-123",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  // 에러 케이스: API 실패 시 error 상태
  it("API 에러 시 error 메시지 설정", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(/** @type {Response} */ ({
      ok: false,
      status: 500,
    }));

    const { result } = renderHook(() =>
      useHistoryData("/api/supabase/unsold-history", "ah-456")
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBe("API 오류 (500)");
  });

  // siblingIds 복수 조회
  it("siblingIds 전달 시 apartment_ids 파라미터 사용", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(/** @type {Response} */ ({
      ok: true,
      json: () => Promise.resolve({ ok: true, data: [] }),
    }));

    const { result } = renderHook(() =>
      useHistoryData("/api/supabase/prices", "ah-1", ["ah-1", "ah-2", "ah-3"])
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("apartment_ids="),
      expect.any(Object)
    );
  });

  // apartmentId 없으면 fetch 하지 않음
  it("apartmentId 없으면 API 호출 안 함", () => {
    vi.spyOn(globalThis, "fetch");
    renderHook(() => useHistoryData("/api/supabase/prices", null));
    expect(fetch).not.toHaveBeenCalled();
  });

  // 429 응답 시 한국어 전용 메시지
  it("429 응답 시 한국어 재시도 안내 메시지를 설정한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(/** @type {Response} */ ({ ok: false, status: 429 }));

    const { result } = renderHook(() =>
      useHistoryData("/api/supabase/prices", "ah-999")
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("요청이 너무 많습니다. 잠시 후 다시 시도해주세요");
  });
});
