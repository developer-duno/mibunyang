import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useExpertMode } from './useExpertMode';

describe('useExpertMode', () => {
  let showToast;

  beforeEach(() => {
    showToast = vi.fn();
    sessionStorage.clear();
    vi.restoreAllMocks();
    // 기본 fetch 모킹 (마운트 시 verify 호출 포함)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ ok: true, user: { email: "test@test.com" } }),
    }));
  });

  it('초기 상태: 로그아웃', () => {
    const { result } = renderHook(() => useExpertMode(showToast));
    expect(result.current.expertLoggedIn).toBe(false);
    expect(result.current.authMode).toBe("login");
    expect(result.current.authError).toBe("");
  });

  it('sessionStorage에 토큰이 있으면 로그인 상태', () => {
    sessionStorage.setItem("expertToken", "test-token");
    const { result } = renderHook(() => useExpertMode(showToast));
    expect(result.current.expertLoggedIn).toBe(true);
  });

  it('로그인 성공', async () => {
    const { result } = renderHook(() => useExpertMode(showToast));

    // 폼 입력
    act(() => {
      result.current.setAuthForm({ ...result.current.authForm, email: "a@b.com", password: "12345678" });
    });

    // 로그인 요청 모킹 (다음 fetch 호출이 로그인)
    fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({ ok: true, token: "abc123", user: { email: "a@b.com" }, role: "expert" }),
    });

    let loginResult;
    await act(async () => {
      loginResult = await result.current.handleExpertLogin();
    });

    expect(loginResult).toEqual({ ok: true, role: "expert" });
    expect(result.current.expertLoggedIn).toBe(true);
    expect(sessionStorage.getItem("expertToken")).toBe("abc123");
  });

  it('로그인 429 → 에러 메시지', async () => {
    const { result } = renderHook(() => useExpertMode(showToast));

    fetch.mockResolvedValueOnce({ ok: false, status: 429, json: () => Promise.resolve({}) });

    await act(async () => {
      await result.current.handleExpertLogin();
    });

    expect(result.current.authError).toContain("너무 많습니다");
  });

  it('로그인 실패 PENDING 상태', async () => {
    const { result } = renderHook(() => useExpertMode(showToast));

    fetch.mockResolvedValueOnce({
      ok: true, status: 403,
      json: () => Promise.resolve({ ok: false, statusCode: "PENDING", error: "승인 대기 중" }),
    });

    await act(async () => {
      await result.current.handleExpertLogin();
    });

    expect(result.current.authStatus).toBe("pending");
  });

  it('로그인 실패 REJECTED 상태', async () => {
    const { result } = renderHook(() => useExpertMode(showToast));

    fetch.mockResolvedValueOnce({
      ok: true, status: 403,
      json: () => Promise.resolve({ ok: false, statusCode: "REJECTED", error: "가입 거부됨" }),
    });

    await act(async () => {
      await result.current.handleExpertLogin();
    });

    expect(result.current.authStatus).toBe("rejected");
  });

  it('네트워크 에러 → "서버 연결 실패"', async () => {
    const { result } = renderHook(() => useExpertMode(showToast));

    fetch.mockRejectedValueOnce(new Error("network error"));

    await act(async () => {
      await result.current.handleExpertLogin();
    });

    expect(result.current.authError).toBe("서버 연결 실패");
  });

  it('로그아웃 → 세션 정리', async () => {
    sessionStorage.setItem("expertToken", "token");
    sessionStorage.setItem("userRole", "expert");
    fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
    const onLogout = vi.fn();
    const { result } = renderHook(() => useExpertMode(showToast));

    await act(async () => { await result.current.handleExpertLogout(onLogout); });

    expect(result.current.expertLoggedIn).toBe(false);
    expect(sessionStorage.getItem("expertToken")).toBeNull();
    expect(sessionStorage.getItem("userRole")).toBeNull();
    expect(onLogout).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("로그아웃되었습니다");
  });

  it('회원가입 성공', async () => {
    const { result } = renderHook(() => useExpertMode(showToast));

    fetch.mockResolvedValueOnce({
      ok: true, status: 201,
      json: () => Promise.resolve({ ok: true }),
    });

    let signupResult;
    await act(async () => {
      signupResult = await result.current.handleExpertSignup();
    });

    expect(signupResult).toBe(true);
    expect(result.current.authMode).toBe("login");
  });

  it('회원가입 429 → 에러', async () => {
    const { result } = renderHook(() => useExpertMode(showToast));

    fetch.mockResolvedValueOnce({ ok: false, status: 429, json: () => Promise.resolve({}) });

    await act(async () => {
      await result.current.handleExpertSignup();
    });

    expect(result.current.authError).toContain("너무 많습니다");
  });

  it('authForm 상태 변경', () => {
    const { result } = renderHook(() => useExpertMode(showToast));
    act(() => {
      result.current.setAuthForm({ ...result.current.authForm, email: "new@email.com" });
    });
    expect(result.current.authForm.email).toBe("new@email.com");
  });

  it('authMode 변경 (login ↔ signup)', () => {
    const { result } = renderHook(() => useExpertMode(showToast));
    act(() => { result.current.setAuthMode("signup"); });
    expect(result.current.authMode).toBe("signup");
  });
});
