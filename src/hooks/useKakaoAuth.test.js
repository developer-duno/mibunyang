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

  // 세션 469: initKakaoLogin 2번째 인자(pendingTab)를 sessionStorage 에 저장한다
  it("initKakaoLogin(null, 'map') 은 kakao_pending_tab 을 저장한다", async () => {
    const { result } = await renderKakaoHook();

    act(() => {
      result.current.initKakaoLogin(null, "map");
    });

    expect(sessionStorage.getItem("kakao_pending_tab")).toBe("map");
  });

  // 세션 469: pendingTab 없이 로그인 시작하면 kakao_pending_tab 을 저장하지 않는다
  it("initKakaoLogin 을 pendingTab 없이 호출하면 kakao_pending_tab 미저장", async () => {
    const { result } = await renderKakaoHook();

    act(() => {
      result.current.initKakaoLogin("apt-1");
    });

    expect(sessionStorage.getItem("kakao_pending_tab")).toBeNull();
    expect(sessionStorage.getItem("kakao_pending_detail")).toBe("apt-1");
  });

  // 세션 469: 콜백 성공 시 kakao_pending_tab 을 반환하고 1회용으로 제거한다
  it("콜백 성공 시 kakao_pending_tab 을 pendingTab 으로 반환하고 제거한다", async () => {
    const { result } = await renderKakaoHook();
    sessionStorage.setItem("kakao_oauth_state", "st-1");
    sessionStorage.setItem("kakao_pending_tab", "map");
    setCallbackUrl("code=auth-code&state=st-1");

    /** @type {import('@/types/hooks').KakaoCallbackResult} */
    let response = /** @type {any} */ (undefined);
    await act(async () => {
      response = await result.current.handleKakaoCallback();
    });

    expect(response.ok).toBe(true);
    expect(response.pendingTab).toBe("map");
    expect(sessionStorage.getItem("kakao_pending_tab")).toBeNull();
  });

  // 세션 656: 카카오에서 뒤로 가기(bfcache 복원)로 돌아오면 "처리 중"이 풀린다
  describe("로그인 시작 뒤 굳음 해제 (세션 656)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** @param {boolean} persisted */
    function firePageShow(persisted) {
      const ev = new Event("pageshow");
      Object.defineProperty(ev, "persisted", { value: persisted });
      window.dispatchEvent(ev);
    }

    it("pageshow persisted=true 면 kakaoLoading 이 false 로 돌아오고 다시 누를 수 있다", async () => {
      const { result } = await renderKakaoHook();

      act(() => {
        result.current.initKakaoLogin();
      });
      expect(result.current.kakaoLoading).toBe(true);
      const firstState = sessionStorage.getItem("kakao_oauth_state");

      act(() => {
        firePageShow(true);
      });
      expect(result.current.kakaoLoading).toBe(false);

      act(() => {
        result.current.initKakaoLogin();
      });
      expect(sessionStorage.getItem("kakao_oauth_state")).not.toBe(firstState);
    });

    it("pageshow persisted=false(보통 첫 로드)면 처리 중을 건드리지 않는다", async () => {
      const { result } = await renderKakaoHook();

      act(() => {
        result.current.initKakaoLogin();
      });
      act(() => {
        firePageShow(false);
      });
      expect(result.current.kakaoLoading).toBe(true);
    });

    it("10초가 지나도 페이지가 그대로면 kakaoLoading 이 false 로 돌아온다 (9,999ms 엔 그대로)", async () => {
      vi.useFakeTimers();
      const { result } = await renderKakaoHook();

      act(() => {
        result.current.initKakaoLogin();
      });
      act(() => {
        vi.advanceTimersByTime(9_999);
      });
      expect(result.current.kakaoLoading).toBe(true);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.kakaoLoading).toBe(false);
    });

    it("언마운트하면 10초 타이머와 pageshow 감시를 정리한다", async () => {
      vi.useFakeTimers();
      const removeSpy = vi.spyOn(window, "removeEventListener");
      const { result, unmount } = await renderKakaoHook();

      act(() => {
        result.current.initKakaoLogin();
      });
      expect(vi.getTimerCount()).toBe(1);

      unmount();
      expect(vi.getTimerCount()).toBe(0);
      expect(removeSpy).toHaveBeenCalledWith("pageshow", expect.any(Function));
    });

    it("10초 타이머가 남은 채 다시 시작하면 옛 타이머를 정리해 타이머가 1개만 남는다", async () => {
      vi.useFakeTimers();
      const { result } = await renderKakaoHook();

      act(() => {
        result.current.initKakaoLogin();
      });
      expect(vi.getTimerCount()).toBe(1);

      // 콜백 처리의 finally 가 처리 중을 풀지만 시작 타이머는 그대로 남는다 → 중복 방지 없이 다시 시작 가능
      sessionStorage.setItem("kakao_oauth_state", "st-again");
      setCallbackUrl("code=auth-code&state=st-again");
      await act(async () => {
        await result.current.handleKakaoCallback();
      });
      expect(result.current.kakaoLoading).toBe(false);
      expect(vi.getTimerCount()).toBe(1);

      act(() => {
        result.current.initKakaoLogin();
      });
      expect(result.current.kakaoLoading).toBe(true);
      expect(vi.getTimerCount()).toBe(1);
    });

    it("pageshow persisted=true 뒤에는 10초 타이머가 남지 않는다", async () => {
      vi.useFakeTimers();
      const { result } = await renderKakaoHook();

      act(() => {
        result.current.initKakaoLogin();
      });
      expect(vi.getTimerCount()).toBe(1);

      act(() => {
        firePageShow(true);
      });
      expect(result.current.kakaoLoading).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  // 세션 656: 콜백에서 서버 답이 20초 넘게 없으면 끊고 다시 시도 안내
  describe("콜백 서버 응답 20초 한도 (세션 656)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("20초 동안 답이 없으면 abort 하고 '다시 시도' 토스트·kakaoError·ok:false 를 낸다", async () => {
      vi.useFakeTimers();
      /** @type {AbortSignal | undefined} */
      let seenSignal;
      vi.stubGlobal(
        "fetch",
        vi.fn((_url, /** @type {RequestInit} */ opts) => {
          seenSignal = opts.signal ?? undefined;
          return new Promise((_resolve, reject) => {
            opts.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          });
        })
      );
      const { result, showToast } = await renderKakaoHook();
      sessionStorage.setItem("kakao_oauth_state", "st-slow");
      setCallbackUrl("code=auth-code&state=st-slow");

      /** @type {Promise<import('@/types/hooks').KakaoCallbackResult>} */
      let pending = /** @type {any} */ (undefined);
      act(() => {
        pending = result.current.handleKakaoCallback();
      });
      expect(result.current.kakaoLoading).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(19_999);
      });
      expect(seenSignal?.aborted).toBe(false);
      expect(result.current.kakaoLoading).toBe(true);

      /** @type {import('@/types/hooks').KakaoCallbackResult} */
      let response = /** @type {any} */ (undefined);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
        response = await pending;
      });

      const msg = "로그인 응답이 늦습니다. 다시 시도해주세요.";
      expect(seenSignal?.aborted).toBe(true);
      expect(response.ok).toBe(false);
      expect(response.error).toBe(msg);
      expect(showToast).toHaveBeenCalledWith(msg);
      expect(result.current.kakaoError).toBe(msg);
      expect(result.current.kakaoLoading).toBe(false);
    });

    it("시간 안에 끝나면 한도 타이머를 남기지 않고, 네트워크 실패는 기존 문구 그대로", async () => {
      vi.useFakeTimers();
      const { result, showToast } = await renderKakaoHook();
      sessionStorage.setItem("kakao_oauth_state", "st-ok");
      setCallbackUrl("code=auth-code&state=st-ok");

      await act(async () => {
        await result.current.handleKakaoCallback();
      });
      expect(vi.getTimerCount()).toBe(0);

      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
      sessionStorage.setItem("kakao_oauth_state", "st-net");
      setCallbackUrl("code=auth-code&state=st-net");
      /** @type {import('@/types/hooks').KakaoCallbackResult} */
      let response = /** @type {any} */ (undefined);
      await act(async () => {
        response = await result.current.handleKakaoCallback();
      });
      expect(response.error).toBe("서버 연결에 실패했습니다");
      expect(showToast).toHaveBeenCalledWith("서버 연결에 실패했습니다");
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
