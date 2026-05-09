// @ts-check
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAdminMode } from './useAdminMode';

describe('useAdminMode', () => {
  /** @type {import('vitest').Mock} */
  let showToast;

  beforeEach(() => {
    showToast = vi.fn();
    localStorage.clear();
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

  it('localStorage에 admin 정보 있으면 관리자 상태', async () => {
    localStorage.setItem("userRole", "admin");
    localStorage.setItem("expertToken", "admin-token");
    const { result } = renderHook(() => useAdminMode(showToast));
    expect(result.current.adminLoggedIn).toBe(true);
  });

  it('마이그레이션: sessionStorage 잔재 → localStorage 자동 이관', async () => {
    // 8e2b5b7 이전 박혀있던 토큰 시뮬레이션
    sessionStorage.setItem("userRole", "admin");
    sessionStorage.setItem("expertToken", "session-token");
    const { result } = renderHook(() => useAdminMode(showToast));
    expect(result.current.adminLoggedIn).toBe(true);
    // localStorage 로 이관
    expect(localStorage.getItem("expertToken")).toBe("session-token");
    expect(localStorage.getItem("userRole")).toBe("admin");
    // sessionStorage 잔재 정리
    expect(sessionStorage.getItem("expertToken")).toBeNull();
    expect(sessionStorage.getItem("userRole")).toBeNull();
  });

  it('유저 조회 성공', async () => {
    localStorage.setItem("userRole", "admin");
    localStorage.setItem("expertToken", "token");
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ ok: true, users: [{ email: "a@b.com", status: "pending" }] }),
    });

    const { result } = renderHook(() => useAdminMode(showToast));
    await waitFor(() => expect(result.current.adminLoading).toBe(false));
    expect(result.current.users).toHaveLength(1);
  });

  it('401 응답 → 로그아웃 + 양쪽 storage 정리 + 토스트', async () => {
    localStorage.setItem("userRole", "admin");
    localStorage.setItem("expertToken", "token");
    // sessionStorage 잔재 시뮬레이션 (마이그레이션 직후 401 만료 시나리오)
    sessionStorage.setItem("userRole", "admin");
    sessionStorage.setItem("expertToken", "stale");
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValue({
      ok: false, status: 401,
      json: () => Promise.resolve({ ok: false }),
    });

    const { result } = renderHook(() => useAdminMode(showToast));
    await waitFor(() => expect(result.current.adminLoading).toBe(false));
    expect(result.current.adminLoggedIn).toBe(false);
    // 양쪽 storage 정리 확인
    expect(localStorage.getItem("expertToken")).toBeNull();
    expect(localStorage.getItem("userRole")).toBeNull();
    expect(sessionStorage.getItem("expertToken")).toBeNull();
    expect(sessionStorage.getItem("userRole")).toBeNull();
    expect(showToast).toHaveBeenCalledWith("관리자 세션이 만료되었습니다");
  });

  it('리뷰 승인 성공 → 토스트 + 유저 재조회', async () => {
    localStorage.setItem("userRole", "admin");
    localStorage.setItem("expertToken", "token");

    // 첫 번째 fetch: 유저 조회
    /** @type {import('vitest').Mock} */ (fetch)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true, users: [{ email: "a@b.com" }] }) })
      // 두 번째 fetch: fetchStats (adminLoggedIn 시 자동 호출)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true, counts: {} }) })
      // 세 번째 fetch: 리뷰
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true, message: "승인 완료" }) })
      // 네 번째 fetch: 재조회
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true, users: [] }) });

    const { result } = renderHook(() => useAdminMode(showToast));
    await waitFor(() => expect(result.current.adminLoading).toBe(false));

    await act(async () => {
      await result.current.handleReview("a@b.com", "approve", "");
    });

    expect(showToast).toHaveBeenCalledWith("승인 완료");
  });

  it('관리자 로그아웃', async () => {
    localStorage.setItem("userRole", "admin");
    localStorage.setItem("expertToken", "token");
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
    const onLogout = vi.fn();
    const { result } = renderHook(() => useAdminMode(showToast));

    await act(async () => { await result.current.handleAdminLogout(onLogout); });

    expect(result.current.adminLoggedIn).toBe(false);
    expect(localStorage.getItem("expertToken")).toBeNull();
    expect(localStorage.getItem("userRole")).toBeNull();
    expect(sessionStorage.getItem("expertToken")).toBeNull();
    expect(sessionStorage.getItem("userRole")).toBeNull();
    expect(onLogout).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("로그아웃되었습니다");
  });

  it('selectedStatus 변경 시 재조회', async () => {
    localStorage.setItem("userRole", "admin");
    localStorage.setItem("expertToken", "token");
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, users: [] }) });

    const { result } = renderHook(() => useAdminMode(showToast));
    await waitFor(() => expect(result.current.adminLoading).toBe(false));

    const callCountBefore = /** @type {import('vitest').Mock} */ (fetch).mock.calls.length;
    act(() => { result.current.setSelectedStatus("approved"); });
    await waitFor(() => expect(/** @type {import('vitest').Mock} */ (fetch).mock.calls.length).toBeGreaterThan(callCountBefore));
  });

  it('토큰 없으면 fetchUsers 스킵', async () => {
    const { result } = renderHook(() => useAdminMode(showToast));
    /** @type {import('vitest').Mock} */ (fetch).mockClear();
    await act(async () => { await result.current.fetchUsers("pending"); });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('검색 시 q 파라미터가 fetch URL에 포함된다', async () => {
    localStorage.setItem("userRole", "admin");
    localStorage.setItem("expertToken", "token");
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, users: [], total: 0 }) });

    const { result } = renderHook(() => useAdminMode(showToast));
    await waitFor(() => expect(result.current.adminLoading).toBe(false));

    /** @type {import('vitest').Mock} */ (fetch).mockClear();
    act(() => { result.current.setSearchQuery("김철수"); });

    // 디바운스 300ms 대기
    await waitFor(() => {
      const calls = /** @type {import('vitest').Mock} */ (fetch).mock.calls;
      const hasSearchParam = calls.some(c => c[0].includes("q="));
      expect(hasSearchParam).toBe(true);
    }, { timeout: 1000 });
  });

  it('검색 변경 시 page가 0으로 리셋된다', async () => {
    localStorage.setItem("userRole", "admin");
    localStorage.setItem("expertToken", "token");
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, users: [{ email: "a@b.com" }], total: 30 }) });

    const { result } = renderHook(() => useAdminMode(showToast));
    await waitFor(() => expect(result.current.adminLoading).toBe(false));

    // 페이지 변경
    act(() => { result.current.handlePageChange(2); });
    expect(result.current.page).toBe(2);

    // 검색 시 page 리셋
    act(() => { result.current.setSearchQuery("test"); });
    expect(result.current.page).toBe(0);
  });

  it('totalUsers 응답 반영', async () => {
    localStorage.setItem("userRole", "admin");
    localStorage.setItem("expertToken", "token");
    /** @type {import('vitest').Mock} */ (fetch).mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, users: [{ email: "a@b.com" }], total: 42 }) });

    const { result } = renderHook(() => useAdminMode(showToast));
    await waitFor(() => expect(result.current.adminLoading).toBe(false));
    expect(result.current.totalUsers).toBe(42);
  });
});
