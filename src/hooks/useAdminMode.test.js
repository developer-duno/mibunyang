import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAdminMode } from './useAdminMode';

describe('useAdminMode', () => {
  let showToast;

  beforeEach(() => {
    showToast = vi.fn();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, users: [] }),
    }));
  });

  it('초기 상태: 비관리자', () => {
    const { result } = renderHook(() => useAdminMode(showToast));
    expect(result.current.adminLoggedIn).toBe(false);
    expect(result.current.users).toEqual([]);
    expect(result.current.selectedStatus).toBe("pending");
  });

  it('sessionStorage에 admin 정보 있으면 관리자 상태', async () => {
    sessionStorage.setItem("userRole", "admin");
    sessionStorage.setItem("expertToken", "admin-token");
    const { result } = renderHook(() => useAdminMode(showToast));
    expect(result.current.adminLoggedIn).toBe(true);
  });

  it('유저 조회 성공', async () => {
    sessionStorage.setItem("userRole", "admin");
    sessionStorage.setItem("expertToken", "token");
    fetch.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ ok: true, users: [{ email: "a@b.com", status: "pending" }] }),
    });

    const { result } = renderHook(() => useAdminMode(showToast));
    await waitFor(() => expect(result.current.adminLoading).toBe(false));
    expect(result.current.users).toHaveLength(1);
  });

  it('401 응답 → 로그아웃 + 토스트', async () => {
    sessionStorage.setItem("userRole", "admin");
    sessionStorage.setItem("expertToken", "token");
    fetch.mockResolvedValue({
      ok: false, status: 401,
      json: () => Promise.resolve({ ok: false }),
    });

    const { result } = renderHook(() => useAdminMode(showToast));
    await waitFor(() => expect(result.current.adminLoading).toBe(false));
    expect(result.current.adminLoggedIn).toBe(false);
    expect(showToast).toHaveBeenCalledWith("관리자 세션이 만료되었습니다");
  });

  it('리뷰 승인 성공 → 토스트 + 유저 재조회', async () => {
    sessionStorage.setItem("userRole", "admin");
    sessionStorage.setItem("expertToken", "token");

    // 첫 번째 fetch: 유저 조회
    fetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true, users: [{ email: "a@b.com" }] }) })
      // 두 번째 fetch: 리뷰
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true, message: "승인 완료" }) })
      // 세 번째 fetch: 재조회
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true, users: [] }) });

    const { result } = renderHook(() => useAdminMode(showToast));
    await waitFor(() => expect(result.current.adminLoading).toBe(false));

    await act(async () => {
      await result.current.handleReview("a@b.com", "approve", "");
    });

    expect(showToast).toHaveBeenCalledWith("승인 완료");
  });

  it('관리자 로그아웃', async () => {
    sessionStorage.setItem("userRole", "admin");
    sessionStorage.setItem("expertToken", "token");
    fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
    const onLogout = vi.fn();
    const { result } = renderHook(() => useAdminMode(showToast));

    await act(async () => { await result.current.handleAdminLogout(onLogout); });

    expect(result.current.adminLoggedIn).toBe(false);
    expect(sessionStorage.getItem("expertToken")).toBeNull();
    expect(onLogout).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("로그아웃되었습니다");
  });

  it('selectedStatus 변경 시 재조회', async () => {
    sessionStorage.setItem("userRole", "admin");
    sessionStorage.setItem("expertToken", "token");
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, users: [] }) });

    const { result } = renderHook(() => useAdminMode(showToast));
    await waitFor(() => expect(result.current.adminLoading).toBe(false));

    const callCountBefore = fetch.mock.calls.length;
    act(() => { result.current.setSelectedStatus("approved"); });
    await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(callCountBefore));
  });

  it('토큰 없으면 fetchUsers 스킵', async () => {
    const { result } = renderHook(() => useAdminMode(showToast));
    fetch.mockClear();
    await act(async () => { await result.current.fetchUsers("pending"); });
    expect(fetch).not.toHaveBeenCalled();
  });
});
