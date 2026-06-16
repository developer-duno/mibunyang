// @ts-check
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuth } from './useAuth';

describe('useAuth', () => {
  /** @type {import('vitest').Mock} */
  let showToast;

  beforeEach(() => {
    showToast = vi.fn();
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    // 기본 fetch 모킹 (마운트 시 verify 호출 포함)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ ok: true, user: { email: "test@test.com" } }),
    }));
  });

  it('초기 상태: 로그아웃', () => {
    const { result } = renderHook(() => useAuth(showToast));
    expect(result.current.loggedIn).toBe(false);
    expect(result.current.authError).toBe("");
  });

  it('localStorage에 토큰이 있으면 로그인 상태', () => {
    localStorage.setItem("authToken", "test-token");
    const { result } = renderHook(() => useAuth(showToast));
    expect(result.current.loggedIn).toBe(true);
  });

  // 세션 426: 구 expertToken 만 있을 때 authToken 으로 자동 이관 + 로그인 유지 (마이그레이션 가드)
  it('구 expertToken 만 있으면 authToken 으로 자동 이관하고 로그인 상태를 유지한다', () => {
    localStorage.setItem("expertToken", "legacy-token");
    localStorage.setItem("userRole", "admin");
    const { result } = renderHook(() => useAuth(showToast));
    expect(result.current.loggedIn).toBe(true);
    // 옛 키는 제거되고 새 키로 이관됨
    expect(localStorage.getItem("authToken")).toBe("legacy-token");
    expect(localStorage.getItem("expertToken")).toBeNull();
    expect(localStorage.getItem("userRole")).toBe("admin");
  });

  it('로그인 성공', async () => {
    const { result } = renderHook(() => useAuth(showToast));

    // 폼 입력
    act(() => {
      result.current.setAuthForm({ ...result.current.authForm, email: "a@b.com", password: "12345678" });
    });

    // 로그인 요청 모킹 (다음 fetch 호출이 로그인)
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({ ok: true, token: "abc123", user: { email: "a@b.com" }, role: "admin" }),
    });

    let loginResult;
    await act(async () => {
      loginResult = await result.current.handleLogin();
    });

    expect(loginResult).toEqual({ ok: true, role: "admin" });
    expect(result.current.loggedIn).toBe(true);
    expect(localStorage.getItem("authToken")).toBe("abc123");
    expect(showToast).toHaveBeenCalledWith("로그인되었습니다");
  });

  it('로그인 429 → 에러 메시지', async () => {
    const { result } = renderHook(() => useAuth(showToast));

    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValueOnce({ ok: false, status: 429, json: () => Promise.resolve({}) });

    await act(async () => {
      await result.current.handleLogin();
    });

    expect(result.current.authError).toContain("너무 많습니다");
  });

  it('로그인 실패(비admin 401 등) → 서버 에러 메시지 표시', async () => {
    const { result } = renderHook(() => useAuth(showToast));

    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValueOnce({
      ok: false, status: 401,
      json: () => Promise.resolve({ ok: false, error: "이메일 또는 비밀번호가 일치하지 않습니다" }),
    });

    await act(async () => {
      await result.current.handleLogin();
    });

    expect(result.current.authError).toBe("이메일 또는 비밀번호가 일치하지 않습니다");
  });

  it('네트워크 에러 → "서버 연결 실패"', async () => {
    const { result } = renderHook(() => useAuth(showToast));

    /** @type {import('vitest').Mock} */ (fetch).mockRejectedValueOnce(new Error("network error"));

    await act(async () => {
      await result.current.handleLogin();
    });

    expect(result.current.authError).toBe("서버 연결 실패");
  });

  it('로그아웃 → 양쪽 storage 세션 정리', async () => {
    localStorage.setItem("authToken", "token");
    localStorage.setItem("userRole", "admin");
    // 옛 키 잔재 시뮬레이션 — 로그아웃 시 같이 청소되어야 함
    sessionStorage.setItem("expertToken", "stale");
    sessionStorage.setItem("userRole", "admin");
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
    const onLogout = vi.fn();
    const { result } = renderHook(() => useAuth(showToast));

    await act(async () => { await result.current.handleLogout(onLogout); });

    expect(result.current.loggedIn).toBe(false);
    expect(localStorage.getItem("authToken")).toBeNull();
    expect(localStorage.getItem("expertToken")).toBeNull();
    expect(localStorage.getItem("userRole")).toBeNull();
    expect(sessionStorage.getItem("expertToken")).toBeNull();
    expect(sessionStorage.getItem("userRole")).toBeNull();
    expect(onLogout).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("로그아웃되었습니다");
  });

  // 세션 405: 회원가입(handleExpertSignup)·authMode·authStatus 는 전문가 폐지로 제거됨
  it('가입 API 가 훅에서 제거되었다 (전문가 폐지 가드)', () => {
    const { result } = renderHook(() => useAuth(showToast));
    expect(/** @type {any} */ (result.current).handleExpertSignup).toBeUndefined();
    expect(/** @type {any} */ (result.current).authMode).toBeUndefined();
    expect(/** @type {any} */ (result.current).authStatus).toBeUndefined();
  });

  it('authForm 상태 변경', () => {
    const { result } = renderHook(() => useAuth(showToast));
    act(() => {
      result.current.setAuthForm({ ...result.current.authForm, email: "new@email.com" });
    });
    expect(result.current.authForm.email).toBe("new@email.com");
  });
});
