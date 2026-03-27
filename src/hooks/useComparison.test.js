import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useComparison } from './useComparison';

describe('useComparison', () => {
  beforeEach(() => { localStorage.clear(); });

  it('초기 상태: 빈 배열, 비교 패널 닫힘', () => {
    const { result } = renderHook(() => useComparison(vi.fn()));
    expect(result.current.compIds).toEqual([]);
    expect(result.current.showCompOpen).toBe(false);
    expect(result.current.showComp).toBe(false);
  });

  it('토글 추가: 아이템 추가', () => {
    const { result } = renderHook(() => useComparison(vi.fn()));
    act(() => { result.current.toggleComp(1); });
    expect(result.current.compIds).toEqual([1]);
  });

  it('토글 제거: 같은 ID 다시 토글 → 제거', () => {
    const { result } = renderHook(() => useComparison(vi.fn()));
    act(() => { result.current.toggleComp(1); });
    act(() => { result.current.toggleComp(1); });
    expect(result.current.compIds).toEqual([]);
  });

  it('최대 4개: 5번째 추가 시 토스트, 상태 변경 없음', () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useComparison(showToast));
    act(() => { [1, 2, 3, 4].forEach((id) => result.current.toggleComp(id)); });
    expect(result.current.compIds).toHaveLength(4);

    act(() => { result.current.toggleComp(5); });
    expect(result.current.compIds).toHaveLength(4);
    expect(showToast).toHaveBeenCalledWith("비교는 최대 4개까지 가능합니다");
  });

  it('showComp는 파생 상태: showCompOpen=true && compIds>=2', () => {
    const { result } = renderHook(() => useComparison(vi.fn()));
    // 1개만 있으면 false
    act(() => { result.current.toggleComp(1); });
    act(() => { result.current.setShowCompOpen(true); });
    expect(result.current.showComp).toBe(false);

    // 2개 이상이면 true
    act(() => { result.current.toggleComp(2); });
    expect(result.current.showComp).toBe(true);
  });

  it('showCompOpen=false면 compIds 많아도 showComp=false', () => {
    const { result } = renderHook(() => useComparison(vi.fn()));
    act(() => { [1, 2, 3].forEach((id) => result.current.toggleComp(id)); });
    expect(result.current.showComp).toBe(false); // showCompOpen 기본 false
  });

  it('setCompIds 직접 설정', () => {
    const { result } = renderHook(() => useComparison(vi.fn()));
    act(() => { result.current.setCompIds([10, 20]); });
    expect(result.current.compIds).toEqual([10, 20]);
  });

  // --- localStorage 영속화 테스트 ---

  it('localStorage에서 초기값 로드', () => {
    localStorage.setItem('mibunyang_comp', JSON.stringify([100, 200]));
    const { result } = renderHook(() => useComparison(vi.fn()));
    expect(result.current.compIds).toEqual([100, 200]);
  });

  it('compIds 변경 시 localStorage에 저장', () => {
    const { result } = renderHook(() => useComparison(vi.fn()));
    act(() => { result.current.toggleComp(42); });
    expect(JSON.parse(localStorage.getItem('mibunyang_comp'))).toEqual([42]);
  });

  it('크로스탭 동기화: storage 이벤트로 갱신', () => {
    const { result } = renderHook(() => useComparison(vi.fn()));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'mibunyang_comp', newValue: JSON.stringify([7, 8, 9]),
      }));
    });
    expect(result.current.compIds).toEqual([7, 8, 9]);
  });

  it('손상된 localStorage JSON → 빈 배열 폴백', () => {
    localStorage.setItem('mibunyang_comp', '{{{invalid');
    const { result } = renderHook(() => useComparison(vi.fn()));
    expect(result.current.compIds).toEqual([]);
  });

  it('quota exceeded 시 showToast 호출', () => {
    const showToast = vi.fn();
    // localStorage.setItem을 QuotaExceededError로 모킹
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn((key) => {
      if (key === 'mibunyang_comp') {
        const err = new DOMException('quota', 'QuotaExceededError');
        throw err;
      }
    });
    const { result } = renderHook(() => useComparison(showToast));
    act(() => { result.current.toggleComp(1); });
    expect(showToast).toHaveBeenCalledWith('저장 실패: 저장소가 가득 찼습니다');
    Storage.prototype.setItem = origSet;
  });
});
