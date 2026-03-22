import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFilterSort } from './useFilterSort';

describe('useFilterSort', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('기본 상태: 전체/전체/total', () => {
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.filterRegion).toBe("전체");
    expect(result.current.filterGu).toBe("전체");
    expect(result.current.sortKey).toBe("total");
    expect(result.current.searchText).toBe("");
    expect(result.current.budgetMin).toBe("");
    expect(result.current.budgetMax).toBe("");
  });

  it('localStorage에서 sortKey 복원', () => {
    localStorage.setItem("mibunyang_sort", "price");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.sortKey).toBe("price");
  });

  it('잘못된 sortKey → "total" 폴백', () => {
    localStorage.setItem("mibunyang_sort", "invalid_key");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.sortKey).toBe("total");
  });

  it('sortKey 변경 시 localStorage 저장', () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => { result.current.setSortKey("price"); });
    expect(result.current.sortKey).toBe("price");
    expect(localStorage.getItem("mibunyang_sort")).toBe("price");
  });

  it('지역 변경 → 구 "전체" 리셋', () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => { result.current.handleGuChange("강남구"); });
    expect(result.current.filterGu).toBe("강남구");
    act(() => { result.current.handleRegionChange("서울"); });
    expect(result.current.filterGu).toBe("전체");
    expect(result.current.filterRegion).toBe("서울");
  });

  it('지역 변경 시 onFilterChange 콜백 호출', () => {
    const onFilterChange = vi.fn();
    const { result } = renderHook(() => useFilterSort({ onFilterChange }));
    act(() => { result.current.handleRegionChange("서울"); });
    expect(onFilterChange).toHaveBeenCalledTimes(1);
  });

  it('예산 변경 시 onFilterChange 콜백 호출', () => {
    const onFilterChange = vi.fn();
    const { result } = renderHook(() => useFilterSort({ onFilterChange }));
    act(() => { result.current.handleBudgetMinChange("10000"); });
    expect(onFilterChange).toHaveBeenCalledTimes(1);
  });

  it('예산 초기화', () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => { result.current.handleBudgetMinChange("10000"); });
    act(() => { result.current.handleBudgetMaxChange("50000"); });
    act(() => { result.current.handleBudgetReset(); });
    expect(result.current.budgetMin).toBe("");
    expect(result.current.budgetMax).toBe("");
  });

  it('검색어 변경', () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => { result.current.handleSearchChange("힐스테이트"); });
    expect(result.current.searchText).toBe("힐스테이트");
  });
});
