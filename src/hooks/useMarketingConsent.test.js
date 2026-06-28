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
  delete (/** @type {any} */ (globalThis).fetch);
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
    await act(async () => {
      await result.current.submitConsent(true);
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.current.consentOpen).toBe(false);
  });

  it("토큰 있으면 POST /api/auth/kakao-consent 호출 + consent 전달", async () => {
    localStorage.setItem("authToken", "tok-1");
    globalThis.fetch = /** @type {any} */ (vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) }));
    const showToast = vi.fn();
    const { result } = renderHook(() => useMarketingConsent(showToast));
    act(() => result.current.openConsent());
    await act(async () => {
      await result.current.submitConsent(true);
    });

    const call = /** @type {any} */ (globalThis.fetch).mock.calls[0];
    expect(call[0]).toBe("/api/auth/kakao-consent");
    expect(JSON.parse(call[1].body)).toEqual({ token: "tok-1", consent: true });
    expect(result.current.consentOpen).toBe(false);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("마케팅 수신에 동의하셨습니다"));
  });

  it("consent=false 면 거부 토스트를 보여주고 닫는다 (D3 — 토글 피드백)", async () => {
    localStorage.setItem("authToken", "tok-1");
    globalThis.fetch = /** @type {any} */ (vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) }));
    const showToast = vi.fn();
    const { result } = renderHook(() => useMarketingConsent(showToast));
    await act(async () => {
      await result.current.submitConsent(false);
    });
    expect(JSON.parse(/** @type {any} */ (globalThis.fetch).mock.calls[0][1].body).consent).toBe(false);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("마케팅 수신을 거부하셨습니다"));
    expect(result.current.consentOpen).toBe(false);
    expect(result.current.consentMarketing).toBe(false);
  });

  it("submit 성공 시 consentMarketing 상태 + localStorage 갱신 (D3)", async () => {
    localStorage.setItem("authToken", "tok-1");
    globalThis.fetch = /** @type {any} */ (vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) }));
    const { result } = renderHook(() => useMarketingConsent(vi.fn()));
    await act(async () => {
      await result.current.submitConsent(true);
    });
    expect(result.current.consentMarketing).toBe(true);
    expect(localStorage.getItem("mibunyang_consent_marketing")).toBe("true");
    await act(async () => {
      await result.current.submitConsent(false);
    });
    expect(result.current.consentMarketing).toBe(false);
    expect(localStorage.getItem("mibunyang_consent_marketing")).toBe("false");
  });

  it("initConsent 로 현재 상태 초기화 + localStorage 영속, 복원 (D3)", async () => {
    localStorage.setItem("mibunyang_consent_marketing", "true");
    const { result } = renderHook(() => useMarketingConsent(vi.fn()));
    // 초기 상태가 localStorage 에서 복원됨
    expect(result.current.consentMarketing).toBe(true);
    // initConsent 로 서버값 동기화
    act(() => result.current.initConsent(false));
    expect(result.current.consentMarketing).toBe(false);
    expect(localStorage.getItem("mibunyang_consent_marketing")).toBe("false");
    // null = 미선택 → 키 제거
    act(() => result.current.initConsent(null));
    expect(result.current.consentMarketing).toBe(null);
    expect(localStorage.getItem("mibunyang_consent_marketing")).toBe(null);
  });

  it("submit 실패(ok:false) 면 상태 유지 + 재시도 토스트 (best-effort, D3)", async () => {
    localStorage.setItem("authToken", "tok-1");
    globalThis.fetch = /** @type {any} */ (vi.fn().mockResolvedValue({ json: async () => ({ ok: false }) }));
    const showToast = vi.fn();
    const { result } = renderHook(() => useMarketingConsent(showToast));
    await act(async () => {
      await result.current.submitConsent(true);
    });
    // ok:false 면 consentMarketing 미갱신 (null 유지) + 무피드백 방지 토스트 (D3)
    expect(result.current.consentMarketing).toBe(null);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("잠시 후 다시 시도해주세요"));
  });

  it("fetch 실패해도 모달은 닫히고 재시도 토스트 (best-effort, D3)", async () => {
    localStorage.setItem("authToken", "tok-1");
    globalThis.fetch = /** @type {any} */ (vi.fn().mockRejectedValue(new Error("network")));
    const showToast = vi.fn();
    const { result } = renderHook(() => useMarketingConsent(showToast));
    act(() => result.current.openConsent());
    await act(async () => {
      await result.current.submitConsent(true);
    });
    expect(result.current.consentOpen).toBe(false);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("잠시 후 다시 시도해주세요"));
  });
});
