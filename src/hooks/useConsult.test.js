import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useConsult } from './useConsult';

// fetch 모킹 팩토리
function mockFetchSuccess(data = {}) {
  return vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ ok: true, ...data }) }));
}
function mockFetchError(error = "서버 오류") {
  return vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ ok: false, error }) }));
}
function mockFetchNetworkError() {
  return vi.fn(() => Promise.reject(new Error("network error")));
}

describe('useConsult', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = mockFetchSuccess();
  });

  // 초기 상태 검증
  it('초기 상태: 빈 폼, 미제출', () => {
    const { result } = renderHook(() => useConsult(vi.fn(), []));
    expect(result.current.consultForm.name).toBe("");
    expect(result.current.consultForm.phone).toBe("");
    expect(result.current.consultSubmitted).toBe(false);
    expect(result.current.submitting).toBe(false);
  });

  // 검증 실패 — 이름/연락처 미입력
  it('이름/연락처 미입력 → 검증 실패 토스트', async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useConsult(showToast, []));
    await act(async () => { await result.current.handleConsultSubmit(); });
    expect(showToast).toHaveBeenCalledWith("이름과 연락처를 입력해주세요");
    expect(result.current.consultSubmitted).toBe(false);
  });

  it('이름만 있고 연락처 없으면 검증 실패', async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useConsult(showToast, []));
    act(() => { result.current.setConsultForm((f) => ({ ...f, name: "홍길동" })); });
    await act(async () => { await result.current.handleConsultSubmit(); });
    expect(showToast).toHaveBeenCalledWith("이름과 연락처를 입력해주세요");
  });

  // API 성공 케이스
  it('정상 제출 → API POST 호출 + consultSubmitted=true', async () => {
    const showToast = vi.fn();
    global.fetch = mockFetchSuccess();
    const { result } = renderHook(() => useConsult(showToast, [1, 2]));
    act(() => {
      result.current.setConsultForm((f) => ({ ...f, name: "홍길동", phone: "010-1234-5678" }));
    });
    await act(async () => { await result.current.handleConsultSubmit(); });
    expect(global.fetch).toHaveBeenCalledWith("/api/consults", expect.objectContaining({ method: "POST" }));
    expect(result.current.consultSubmitted).toBe(true);
    expect(showToast).toHaveBeenCalledWith("상담 신청이 완료되었습니다");
  });

  // API 실패 → localStorage 폴백
  it('API 실패 시 localStorage 폴백 저장', async () => {
    const showToast = vi.fn();
    global.fetch = mockFetchNetworkError();
    const { result } = renderHook(() => useConsult(showToast, [10]));
    act(() => {
      result.current.setConsultForm((f) => ({ ...f, name: "김철수", phone: "010-0000-0000" }));
    });
    await act(async () => { await result.current.handleConsultSubmit(); });
    expect(result.current.consultSubmitted).toBe(true);
    expect(result.current.submittedConsults).toHaveLength(1);
    expect(result.current.submittedConsults[0].name).toBe("김철수");
    expect(showToast).toHaveBeenCalledWith("상담 신청이 저장되었습니다 (오프라인)");
    const stored = JSON.parse(localStorage.getItem("mibunyang_consults"));
    expect(stored).toHaveLength(1);
  });

  // submitting 상태 반환 검증
  it('제출 중 submitting=true 반환', async () => {
    const showToast = vi.fn();
    let resolvePromise;
    global.fetch = vi.fn(() => new Promise(resolve => { resolvePromise = resolve; }));
    const { result } = renderHook(() => useConsult(showToast, []));
    act(() => {
      result.current.setConsultForm((f) => ({ ...f, name: "테스트", phone: "010-1111-2222" }));
    });
    // 제출 시작 → submitting=true
    let submitPromise;
    act(() => { submitPromise = result.current.handleConsultSubmit(); });
    expect(result.current.submitting).toBe(true);
    // resolve 후 submitting=false
    await act(async () => {
      resolvePromise({ json: () => Promise.resolve({ ok: true }) });
      await submitPromise;
    });
    expect(result.current.submitting).toBe(false);
  });

  // 전문가용 fetchConsults 검증
  it('fetchConsults: 서버에서 상담 목록 조회', async () => {
    const mockData = [
      { id: 1, name: "고객A", phone: "010-1111-2222", interestedApts: ["apt1"], submittedAt: "2026-03-20T00:00:00Z" },
    ];
    global.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ ok: true, data: mockData }) }));
    const { result } = renderHook(() => useConsult(vi.fn(), []));
    await act(async () => { await result.current.fetchConsults("test-token"); });
    expect(global.fetch).toHaveBeenCalledWith("/api/consults", expect.objectContaining({
      headers: { Authorization: "Bearer test-token" },
    }));
    expect(result.current.submittedConsults).toHaveLength(1);
    expect(result.current.submittedConsults[0].name).toBe("고객A");
  });

  it('fetchConsults: 네트워크 오류 시 기존 상태 유지', async () => {
    global.fetch = mockFetchNetworkError();
    const { result } = renderHook(() => useConsult(vi.fn(), []));
    await act(async () => { await result.current.fetchConsults("test-token"); });
    expect(result.current.submittedConsults).toHaveLength(0);
  });
});
