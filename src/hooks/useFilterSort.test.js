import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFilterSort } from './useFilterSort';

// URL location mock 헬퍼
function mockLocationSearch(search) {
  Object.defineProperty(window, "location", {
    value: { ...window.location, search, pathname: "/", origin: "https://test.com" },
    writable: true, configurable: true,
  });
}

describe('useFilterSort', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    mockLocationSearch("");
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

  it('getShareURL 반환', () => {
    const { result } = renderHook(() => useFilterSort({}));
    expect(typeof result.current.getShareURL).toBe("function");
  });
});

describe("URL 필터 역직렬화 (Phase 1)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("URL에서 region, sort 읽기", () => {
    mockLocationSearch("?region=서울&sort=price");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.filterRegion).toBe("서울");
    expect(result.current.sortKey).toBe("price");
  });

  it("URL에서 budgetMin/Max, minScore 읽기", () => {
    mockLocationSearch("?bmin=3&bmax=7&score=60");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.budgetMin).toBe("3");
    expect(result.current.budgetMax).toBe("7");
    expect(result.current.minScore).toBe("60");
  });

  it("URL에서 builderTier, benefitOnly 읽기", () => {
    mockLocationSearch("?tier=1군&benefit=1");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.builderTier).toBe("1군");
    expect(result.current.benefitOnly).toBe(true);
  });

  it("URL 우선순위: URL > localStorage", () => {
    localStorage.setItem("mibunyang_sort", "price");
    mockLocationSearch("?sort=location");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.sortKey).toBe("location");
  });

  it("잘못된 sort 키 → 기본값 폴백", () => {
    mockLocationSearch("?sort=__proto__");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.sortKey).toBe("total");
  });

  it("NaN budgetMin → 기본값 폴백", () => {
    mockLocationSearch("?bmin=abc");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.budgetMin).toBe("");
  });

  it("minScore > 100 → 100 클램핑", () => {
    mockLocationSearch("?score=150");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.minScore).toBe("100");
  });

  it("잘못된 builderTier → 기본값 폴백", () => {
    mockLocationSearch("?tier=4군");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.builderTier).toBe("전체");
  });

  it("benefitOnly 비유효값 → false", () => {
    mockLocationSearch("?benefit=true");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.benefitOnly).toBe(false);
  });

  it("빈 URL 파라미터 → 기본값", () => {
    mockLocationSearch("?bmin=&sort=&score=");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.budgetMin).toBe("");
    expect(result.current.sortKey).toBe("total");
    expect(result.current.minScore).toBe("");
  });
});
