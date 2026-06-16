// @ts-check
/**
 * useMarketingConsent 훅 테스트 (세션 427)
 * - openConsent → consentOpen=true
 * - submitConsent → POST /api/auth/kakao-consent + 모달 닫힘
 * - 토큰 없으면 fetch 안 하고 닫음
 * - fetch 실패해도 best-effort (모달 닫힘)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useMarketingConsent } from "./useMarketingConsent";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  delete (/** @type {any} */ (globalThis)).fetch;
});

describe("useMarketingConsent", () => {
  it("openConsent → consentOpen=true", () => {
    const { result } = renderHook(() => useMarketingConsent(vi.fn()));
    expect(result.current.consentOpen).toBe(false);
    act(() => result.current.openConsent());
    expect(result.current.consentOpen).toBe(true);
  });

  it("토큰 없으면 fetch 없이 모달만 닫는다", async () => {
    globalThis.fetch = /** @type {any} */ (vi.fn());
    const { result } = renderHook(() => useMarketingConsent(vi.fn()));
    act(() => result.current.openConsent());
    await act(async () => { await result.current.submitConsent(true); });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.current.consentOpen).toBe(false);
  });

  it("토큰 있으면 POST /api/auth/kakao-consent 호출 + consent 전달", async () => {
    localStorage.setItem("authToken", "tok-1");
    globalThis.fetch = /** @type {any} */ (vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) }));
    const showToast = vi.fn();
    const { result } = renderHook(() => useMarketingConsent(showToast));
    act(() => result.current.openConsent());
    await act(async () => { await result.current.submitConsent(true); });

    const call = /** @type {any} */ (globalThis.fetch).mock.calls[0];
    expect(call[0]).toBe("/api/auth/kakao-consent");
    expect(JSON.parse(call[1].body)).toEqual({ token: "tok-1", consent: true });
    expect(result.current.consentOpen).toBe(false);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("마케팅 수신에 동의하셨습니다"));
  });

  it("consent=false 면 토스트 없이 닫는다", async () => {
    localStorage.setItem("authToken", "tok-1");
    globalThis.fetch = /** @type {any} */ (vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) }));
    const showToast = vi.fn();
    const { result } = renderHook(() => useMarketingConsent(showToast));
    await act(async () => { await result.current.submitConsent(false); });
    expect(JSON.parse(/** @type {any} */ (globalThis.fetch).mock.calls[0][1].body).consent).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
    expect(result.current.consentOpen).toBe(false);
  });

  it("fetch 실패해도 모달은 닫힌다 (best-effort)", async () => {
    localStorage.setItem("authToken", "tok-1");
    globalThis.fetch = /** @type {any} */ (vi.fn().mockRejectedValue(new Error("network")));
    const { result } = renderHook(() => useMarketingConsent(vi.fn()));
    act(() => result.current.openConsent());
    await act(async () => { await result.current.submitConsent(true); });
    expect(result.current.consentOpen).toBe(false);
  });
});
