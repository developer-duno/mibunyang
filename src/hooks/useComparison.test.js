import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useComparison } from './useComparison';

describe('useComparison', () => {
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
});
