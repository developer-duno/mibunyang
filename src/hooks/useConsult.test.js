// @ts-check
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConsult } from './useConsult';

// fetch 모킹 팩토리
function mockFetchSuccess(data = {}) {
  return vi.fn(() => Promise.resolve(/** @type {Response} */ ({
    json: () => Promise.resolve({ ok: true, ...data }),
  })));
}
function mockFetchNetworkError() {
  return vi.fn(() => Promise.reject(new Error("network error")));
}

describe('useConsult', () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.fetch = mockFetchSuccess();
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

  // PIPA §15: 개인정보 동의 미체크 시 제출 차단 (fetch 미호출)
  it('동의 미체크 시 검증 실패 + fetch 미호출', async () => {
    const showToast = vi.fn();
    globalThis.fetch = mockFetchSuccess();
    const { result } = renderHook(() => useConsult(showToast, ["1"]));
    act(() => { result.current.setConsultForm((f) => ({ ...f, name: "홍길동", phone: "010-1234-5678", consent: false })); });
    await act(async () => { await result.current.handleConsultSubmit(); });
    expect(showToast).toHaveBeenCalledWith("개인정보 수집·이용 동의가 필요합니다");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.current.consultSubmitted).toBe(false);
  });

  // API 성공 케이스
  it('정상 제출 → API POST 호출 + consultSubmitted=true', async () => {
    const showToast = vi.fn();
    globalThis.fetch = mockFetchSuccess();
    const { result } = renderHook(() => useConsult(showToast, ["1", "2"]));
    act(() => {
      result.current.setConsultForm((f) => ({ ...f, name: "홍길동", phone: "010-1234-5678", consent: true }));
    });
    await act(async () => { await result.current.handleConsultSubmit(); });
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/consults", expect.objectContaining({ method: "POST" }));
    expect(result.current.consultSubmitted).toBe(true);
    expect(showToast).toHaveBeenCalledWith("상담 신청이 완료되었습니다");
  });

  // API 실패 → localStorage 폴백
  it('API 실패 시 localStorage 폴백 저장', async () => {
    const showToast = vi.fn();
    globalThis.fetch = mockFetchNetworkError();
    const { result } = renderHook(() => useConsult(showToast, ["10"]));
    act(() => {
      result.current.setConsultForm((f) => ({ ...f, name: "김철수", phone: "010-0000-0000", consent: true }));
    });
    await act(async () => { await result.current.handleConsultSubmit(); });
    expect(result.current.consultSubmitted).toBe(true);
    expect(result.current.submittedConsults).toHaveLength(1);
    // 마스킹된 이름/전화 확인 (localStorage 폴백에만 적용)
    expect(result.current.submittedConsults[0].name).toBe("김**");
    expect(result.current.submittedConsults[0].phone).toBe("010-****-0000");
    expect(showToast).toHaveBeenCalledWith("상담 신청이 저장되었습니다 (오프라인)");
    const stored = JSON.parse(localStorage.getItem("mibunyang_consults") ?? "[]");
    expect(stored).toHaveLength(1);
  });

  // submitting 상태 반환 검증
  it('제출 중 submitting=true 반환', async () => {
    const showToast = vi.fn();
    /** @type {(value: any) => void} */
    let resolvePromise;
    globalThis.fetch = /** @type {typeof fetch} */ (vi.fn(() => new Promise(resolve => { resolvePromise = resolve; })));
    const { result } = renderHook(() => useConsult(showToast, []));
    act(() => {
      result.current.setConsultForm((f) => ({ ...f, name: "테스트", phone: "010-1111-2222", consent: true }));
    });
    // 제출 시작 → submitting=true
    /** @type {Promise<any> | undefined} */
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

  // 세션 405: 서버 상담 목록 조회는 AdminConsults(관리자 대시보드)로 이관 — 훅에서 제거 가드
  it('fetchConsults 가 훅에서 제거되었다 (AdminConsults 이관 가드)', () => {
    const { result } = renderHook(() => useConsult(vi.fn(), []));
    expect(/** @type {any} */ (result.current).fetchConsults).toBeUndefined();
    // 오프라인 폴백 저장소는 보존
    expect(Array.isArray(result.current.submittedConsults)).toBe(true);
  });
});
