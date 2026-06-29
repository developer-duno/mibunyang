// @ts-check
/**
 * usePresaleDetail 훅 테스트 (세션 459) — SPA 캐시·429 분기·AbortController·_clearPresaleDetailCache 커버.
 * useHistoryData.test.js 패턴 답습 (fetch spy + renderHook + waitFor).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePresaleDetail, _clearPresaleDetailCache } from "./usePresaleDetail";

/**
 * @param {any} body
 * @returns {any} fetch Response mock
 */
function okResponse(body) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

describe("usePresaleDetail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _clearPresaleDetailCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // apartmentId 없으면 fetch 안 함 + 빈 상태
  it("apartmentId=null이면 fetch 호출 안 하고 빈 상태", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => usePresaleDetail(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.schedule).toBeNull();
    expect(result.current.units).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  // 정상 응답 시 schedule + units 반환
  it("정상 응답 시 schedule·units 반환", async () => {
    const schedule = { house_manage_no: "h1", tot_supply: 100 };
    const units = [{ house_manage_no: "h1", model_no: "m1" }];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse({ ok: true, schedule, units }));

    const { result } = renderHook(() => usePresaleDetail("ah-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.schedule).toEqual(schedule);
    expect(result.current.units).toEqual(units);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      "/api/supabase/presale-detail?apartment_id=ah-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  // schedule/units 누락 시 null/빈 배열 폴백
  it("응답에 schedule/units 누락 시 null·[] 폴백", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse({ ok: true }));
    const { result } = renderHook(() => usePresaleDetail("ah-empty"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.schedule).toBeNull();
    expect(result.current.units).toEqual([]);
  });

  // 캐시 적중: 같은 id 두 번째 마운트는 재fetch 안 함
  it("같은 apartmentId 재마운트 시 캐시 적중(재fetch 없음)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okResponse({ ok: true, schedule: { house_manage_no: "h1" }, units: [] }));

    const first = renderHook(() => usePresaleDetail("ah-cache"));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = renderHook(() => usePresaleDetail("ah-cache"));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.schedule).toEqual({ house_manage_no: "h1" });
    // 캐시 적중이므로 fetch 호출 횟수 변화 없음
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // _clearPresaleDetailCache 후에는 재fetch 발생
  it("_clearPresaleDetailCache 후 같은 id 재마운트 시 재fetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okResponse({ ok: true, schedule: null, units: [] }));

    const first = renderHook(() => usePresaleDetail("ah-clear"));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    _clearPresaleDetailCache();

    const second = renderHook(() => usePresaleDetail("ah-clear"));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  // 429 → 전용 안내 메시지
  it("429 응답 시 '요청이 너무 많습니다' 에러", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      /** @type {any} */ ({ ok: false, status: 429, json: () => Promise.resolve({}) })
    );
    const { result } = renderHook(() => usePresaleDetail("ah-429"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/요청이 너무 많습니다/);
  });

  // 그 외 비정상 status → "API 오류 (N)"
  it("500 응답 시 'API 오류 (500)' 에러", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      /** @type {any} */ ({ ok: false, status: 500, json: () => Promise.resolve({}) })
    );
    const { result } = renderHook(() => usePresaleDetail("ah-500"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("API 오류 (500)");
  });

  // json.ok=false → json.error 메시지 사용
  it("json.ok=false면 json.error 메시지 사용", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse({ ok: false, error: "조회 실패함" }));
    const { result } = renderHook(() => usePresaleDetail("ah-jsonfail"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("조회 실패함");
  });

  // AbortError 는 에러로 노출하지 않음(언마운트 정리)
  it("AbortError는 error 상태로 노출하지 않음", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(abortErr);
    const { result } = renderHook(() => usePresaleDetail("ah-abort"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
  });
});
