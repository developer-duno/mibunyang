import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConsult } from './useConsult';

describe('useConsult', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('초기 상태: 빈 폼', () => {
    const { result } = renderHook(() => useConsult(vi.fn(), []));
    expect(result.current.consultForm.name).toBe("");
    expect(result.current.consultForm.phone).toBe("");
    expect(result.current.consultSubmitted).toBe(false);
  });

  it('이름/연락처 미입력 → 검증 실패 토스트', () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useConsult(showToast, []));
    act(() => { result.current.handleConsultSubmit(); });
    expect(showToast).toHaveBeenCalledWith("이름과 연락처를 입력해주세요");
    expect(result.current.consultSubmitted).toBe(false);
  });

  it('이름만 있고 연락처 없으면 검증 실패', () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useConsult(showToast, []));
    act(() => { result.current.setConsultForm((f) => ({ ...f, name: "홍길동" })); });
    act(() => { result.current.handleConsultSubmit(); });
    expect(showToast).toHaveBeenCalledWith("이름과 연락처를 입력해주세요");
  });

  it('정상 제출 → consultSubmitted=true, 토스트 호출', () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useConsult(showToast, [1, 2]));
    act(() => {
      result.current.setConsultForm((f) => ({ ...f, name: "홍길동", phone: "010-1234-5678" }));
    });
    act(() => { result.current.handleConsultSubmit(); });
    expect(result.current.consultSubmitted).toBe(true);
    expect(showToast).toHaveBeenCalledWith("상담 신청이 완료되었습니다");
  });

  it('제출 시 favoriteIds가 interestedApts에 포함', () => {
    const showToast = vi.fn();
    const favoriteIds = [10, 20, 30];
    const { result } = renderHook(() => useConsult(showToast, favoriteIds));
    act(() => {
      result.current.setConsultForm((f) => ({ ...f, name: "김철수", phone: "010-0000-0000" }));
    });
    act(() => { result.current.handleConsultSubmit(); });
    expect(result.current.submittedConsults[0].interestedApts).toEqual([10, 20, 30]);
  });

  it('제출된 상담은 localStorage에 저장', () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useConsult(showToast, []));
    act(() => {
      result.current.setConsultForm((f) => ({ ...f, name: "이영희", phone: "010-1111-2222" }));
    });
    act(() => { result.current.handleConsultSubmit(); });
    const stored = JSON.parse(localStorage.getItem("mibunyang_consults"));
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("이영희");
  });

  it('localStorage 기존 상담 복원', () => {
    localStorage.setItem("mibunyang_consults", JSON.stringify([{ id: "1", name: "기존" }]));
    const { result } = renderHook(() => useConsult(vi.fn(), []));
    expect(result.current.submittedConsults).toHaveLength(1);
    expect(result.current.submittedConsults[0].name).toBe("기존");
  });
});
