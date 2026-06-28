// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

async function renderKakaoHook(showToast = vi.fn(), restKey = "test-rest-key") {
  vi.resetModules();
  vi.stubEnv("VITE_KAKAO_REST_API_KEY", restKey);
  const { useKakaoAuth } = await import("./useKakaoAuth");
  return { showToast, ...renderHook(() => useKakaoAuth(showToast)) };
}

/** @param {string} params */
function setCallbackUrl(params) {
  window.history.pushState(null, "", `/oauth/kakao/callback?${params}`);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  sessionStorage.clear();
  window.history.pushState(null, "", "/");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        ok: true,
        token: "access-token",
        refreshToken: "refresh-token",
        user: { id: "kakao-user" },
        role: "user",
      }),
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("useKakaoAuth", () => {
  it("state가 일치하면 API를 호출하고 sessionStorage state를 1회용으로 제거한다", async () => {
    const { result } = await renderKakaoHook();
    sessionStorage.setItem("kakao_oauth_state", "state-123");
    setCallbackUrl("code=auth-code&state=state-123");

    /** @type {import('@/types/hooks').KakaoCallbackResult} */
    let response = /** @type {any} */ (undefined);
    await act(async () => {
      response = await result.current.handleKakaoCallback();
    });

    expect(response.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/kakao",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining('"code":"auth-code"'),
      })
    );
    expect(sessionStorage.getItem("kakao_oauth_state")).toBeNull();
  });

  it("state가 불일치하면 fail-fast 하고 API를 호출하지 않는다", async () => {
    const { result } = await renderKakaoHook();
    sessionStorage.setItem("kakao_oauth_state", "saved-state");
    setCallbackUrl("code=auth-code&state=url-state");

    /** @type {import('@/types/hooks').KakaoCallbackResult} */
    let response = /** @type {any} */ (undefined);
    await act(async () => {
      response = await result.current.handleKakaoCallback();
    });

    expect(response.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("저장된 state가 없으면 fail-fast 하고 API를 호출하지 않는다", async () => {
    const { result } = await renderKakaoHook();
    setCallbackUrl("code=auth-code&state=url-state");

    /** @type {import('@/types/hooks').KakaoCallbackResult} */
    let response = /** @type {any} */ (undefined);
    await act(async () => {
      response = await result.current.handleKakaoCallback();
    });

    expect(response.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("URL state가 없으면 fail-fast 하고 API를 호출하지 않는다", async () => {
    const { result } = await renderKakaoHook();
    sessionStorage.setItem("kakao_oauth_state", "saved-state");
    setCallbackUrl("code=auth-code");

    /** @type {import('@/types/hooks').KakaoCallbackResult} */
    let response = /** @type {any} */ (undefined);
    await act(async () => {
      response = await result.current.handleKakaoCallback();
    });

    expect(response.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("카카오 에러 파라미터가 있으면 빠르게 반환한다", async () => {
    const { result, showToast } = await renderKakaoHook();
    setCallbackUrl("error=access_denied&error_description=denied");

    /** @type {import('@/types/hooks').KakaoCallbackResult} */
    let response = /** @type {any} */ (undefined);
    await act(async () => {
      response = await result.current.handleKakaoCallback();
    });

    expect(response.ok).toBe(false);
    expect(response.error).toBe("denied");
    expect(showToast).toHaveBeenCalledWith("denied");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("initKakaoLogin은 32자 hex state를 생성한다", async () => {
    const { result } = await renderKakaoHook();

    act(() => {
      result.current.initKakaoLogin();
    });

    expect(sessionStorage.getItem("kakao_oauth_state")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("state 검증 후 sessionStorage state를 명시적으로 제거한다", async () => {
    const { result } = await renderKakaoHook();
    sessionStorage.setItem("kakao_oauth_state", "one-time-state");
    setCallbackUrl("code=auth-code&state=one-time-state");

    await act(async () => {
      await result.current.handleKakaoCallback();
    });

    expect(sessionStorage.getItem("kakao_oauth_state")).toBeNull();
  });

  it("중복 클릭 시 sessionStorage state를 재생성하지 않는다", async () => {
    const { result } = await renderKakaoHook();

    act(() => {
      result.current.initKakaoLogin();
    });
    const firstState = sessionStorage.getItem("kakao_oauth_state");

    act(() => {
      result.current.initKakaoLogin();
    });
    const secondState = sessionStorage.getItem("kakao_oauth_state");

    expect(firstState).toMatch(/^[0-9a-f]{32}$/);
    expect(secondState).toBe(firstState);
  });

  it("requires the public VITE_KAKAO_REST_API_KEY client id for login start", async () => {
    const { result, showToast } = await renderKakaoHook(vi.fn(), "");

    act(() => {
      result.current.initKakaoLogin();
    });

    expect(sessionStorage.getItem("kakao_oauth_state")).toBeNull();
    expect(showToast).toHaveBeenCalled();
  });
});
