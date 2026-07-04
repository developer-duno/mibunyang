// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFilterSort } from "./useFilterSort";

// URL location mock 헬퍼
/** @param {string} search */
function mockLocationSearch(search) {
  Object.defineProperty(window, "location", {
    value: { ...window.location, search, pathname: "/", origin: "https://test.com" },
    writable: true,
    configurable: true,
  });
}

describe("useFilterSort", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    mockLocationSearch("");
  });

  it("기본 상태: 전체/전체/total", () => {
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.filterRegion).toBe("전체");
    expect(result.current.filterGu).toBe("전체");
    expect(result.current.sortKey).toBe("total");
    expect(result.current.budgetMin).toBe("");
    expect(result.current.budgetMax).toBe("");
  });

  it("검색어 기본값은 빈 문자열", () => {
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.searchQuery).toBe("");
  });

  it("handleSearchChange 로 검색어 변경", () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.handleSearchChange("래미안");
    });
    expect(result.current.searchQuery).toBe("래미안");
  });

  it("handleResetAll 이 검색어도 비움", () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.handleSearchChange("래미안");
    });
    expect(result.current.searchQuery).toBe("래미안");
    act(() => {
      result.current.handleResetAll();
    });
    expect(result.current.searchQuery).toBe("");
  });

  it("검색어는 URL 에 동기화하지 않음 (일시적 탐색)", () => {
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.handleSearchChange("래미안");
    });
    // URL 직렬화 대상이 아니므로 검색어로 인한 replaceState 호출 시 search 에 검색어가 안 실림
    const calledWithSearch = replaceSpy.mock.calls.some((c) => String(c[2] ?? "").includes("래미안"));
    expect(calledWithSearch).toBe(false);
  });

  it("localStorage에서 sortKey 복원", () => {
    localStorage.setItem("mibunyang_sort", "price");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.sortKey).toBe("price");
  });

  it('잘못된 sortKey → "total" 폴백', () => {
    localStorage.setItem("mibunyang_sort", "invalid_key");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.sortKey).toBe("total");
  });

  it("sortKey 변경 시 localStorage 저장", () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.setSortKey("price");
    });
    expect(result.current.sortKey).toBe("price");
    expect(localStorage.getItem("mibunyang_sort")).toBe("price");
  });

  it('지역 변경 → 구 "전체" 리셋', () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.handleGuChange("강남구");
    });
    expect(result.current.filterGu).toBe("강남구");
    act(() => {
      result.current.handleRegionChange("서울");
    });
    expect(result.current.filterGu).toBe("전체");
    expect(result.current.filterRegion).toBe("서울");
  });

  it("지역 변경 시 onFilterChange 콜백 호출", () => {
    const onFilterChange = vi.fn();
    const { result } = renderHook(() => useFilterSort({ onFilterChange }));
    act(() => {
      result.current.handleRegionChange("서울");
    });
    expect(onFilterChange).toHaveBeenCalledTimes(1);
  });

  it("예산 변경 시 onFilterChange 콜백 호출", () => {
    const onFilterChange = vi.fn();
    const { result } = renderHook(() => useFilterSort({ onFilterChange }));
    act(() => {
      result.current.handleBudgetMinChange("10000");
    });
    expect(onFilterChange).toHaveBeenCalledTimes(1);
  });

  it("예산 초기화", () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.handleBudgetMinChange("10000");
    });
    act(() => {
      result.current.handleBudgetMaxChange("50000");
    });
    act(() => {
      result.current.handleBudgetReset();
    });
    expect(result.current.budgetMin).toBe("");
    expect(result.current.budgetMax).toBe("");
  });

  it("getShareURL 반환", () => {
    const { result } = renderHook(() => useFilterSort({}));
    expect(typeof result.current.getShareURL).toBe("function");
  });
});

describe("전체 초기화 + 프리셋", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    mockLocationSearch("");
  });

  it("handleResetAll — 모든 필터 기본값 복귀", () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.handleRegionChange("서울");
      result.current.handleBudgetMinChange("3");
      result.current.handleMinScoreChange("50");
      result.current.handleBuilderTierChange("1군");
      result.current.toggleBenefitOnly();
      result.current.handleAreaMinChange("60");
      result.current.handleUnitsMinChange("500");
      result.current.handleMoveInChange("입주예정");
    });
    act(() => {
      result.current.handleResetAll();
    });
    expect(result.current.filterRegion).toBe("전체");
    expect(result.current.filterGu).toBe("전체");
    expect(result.current.sortKey).toBe("total");
    expect(result.current.budgetMin).toBe("");
    expect(result.current.minScore).toBe("");
    expect(result.current.builderTier).toBe("전체");
    expect(result.current.benefitOnly).toBe(false);
    expect(result.current.areaMin).toBe("");
    expect(result.current.unitsMin).toBe("");
    expect(result.current.moveInFilter).toBe("전체");
  });

  it("handleResetAll 시 onFilterChange 콜백 호출", () => {
    const onFilterChange = vi.fn();
    const { result } = renderHook(() => useFilterSort({ onFilterChange }));
    act(() => {
      result.current.handleResetAll();
    });
    expect(onFilterChange).toHaveBeenCalled();
  });

  it("applyPreset — 프리셋 값 적용", () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.applyPreset({
        budgetMax: "5",
        areaMin: "60",
        areaMax: "85",
        benefitOnly: true,
        sortKey: "benefit",
      });
    });
    expect(result.current.budgetMax).toBe("5");
    expect(result.current.areaMin).toBe("60");
    expect(result.current.areaMax).toBe("85");
    expect(result.current.benefitOnly).toBe(true);
    expect(result.current.sortKey).toBe("benefit");
    // 미지정 필드는 기본값
    expect(result.current.budgetMin).toBe("");
    expect(result.current.builderTier).toBe("전체");
  });

  it("applyPreset — 기존 필터 초기화 후 적용", () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.handleRegionChange("서울");
    });
    act(() => {
      result.current.applyPreset({ minScore: "70", builderTier: "1군" });
    });
    expect(result.current.filterRegion).toBe("전체");
    expect(result.current.minScore).toBe("70");
    expect(result.current.builderTier).toBe("1군");
  });

  // 세션 430 회귀 가드 — 역세권 필터 켠 채 커스텀 프리셋 저장 시 subwayOnly 가 담겨야 함
  // (saveCustomPreset snap 객체에 subwayOnly 누락 시 프리셋에 절대 저장 안 되던 결함)
  it("saveCustomPreset — subwayOnly=true 저장 후 applyPreset 으로 복원", () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.toggleSubwayOnly();
    });
    expect(result.current.subwayOnly).toBe(true);
    act(() => {
      result.current.saveCustomPreset("역세권만");
    });
    const saved = /** @type {any} */ (result.current.customPresets.find((p) => p.label === "역세권만"));
    expect(saved?.values.subwayOnly).toBe(true);
    // 끄고 → 프리셋 재적용 → 다시 켜져야 함
    act(() => {
      result.current.toggleSubwayOnly();
    });
    expect(result.current.subwayOnly).toBe(false);
    act(() => {
      result.current.applyPreset(saved.values);
    });
    expect(result.current.subwayOnly).toBe(true);
  });

  it("applyPreset — subwayOnly 적용", () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.applyPreset({ subwayOnly: true });
    });
    expect(result.current.subwayOnly).toBe(true);
  });

  // 세션 461 회귀 가드 — DSR/비규제 토글 + saveCustomPreset snap 객체에 담기는지
  // (snapshot 5군데 누락 시 프리셋에 저장 안 되던 결함, 세션 430 패턴 답습)
  it("toggleDsrPassOnly — 토글 + saveCustomPreset 복원", () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.toggleDsrPassOnly();
    });
    expect(result.current.dsrPassOnly).toBe(true);
    act(() => {
      result.current.saveCustomPreset("DSR만");
    });
    const saved = /** @type {any} */ (result.current.customPresets.find((p) => p.label === "DSR만"));
    expect(saved?.values.dsrPassOnly).toBe(true);
    act(() => {
      result.current.toggleDsrPassOnly();
    });
    expect(result.current.dsrPassOnly).toBe(false);
    act(() => {
      result.current.applyPreset(saved.values);
    });
    expect(result.current.dsrPassOnly).toBe(true);
  });

  it("toggleNonRegulatedOnly — 토글 + applyPreset 적용", () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.toggleNonRegulatedOnly();
    });
    expect(result.current.nonRegulatedOnly).toBe(true);
    act(() => {
      result.current.handleResetAll();
    });
    expect(result.current.nonRegulatedOnly).toBe(false);
    act(() => {
      result.current.applyPreset({ nonRegulatedOnly: true });
    });
    expect(result.current.nonRegulatedOnly).toBe(true);
  });

  it("toggleCrimeSafeOnly — 토글 + 리셋", () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.toggleCrimeSafeOnly();
    });
    expect(result.current.crimeSafeOnly).toBe(true);
    act(() => {
      result.current.handleResetAll();
    });
    expect(result.current.crimeSafeOnly).toBe(false);
  });

  it("toggleChildcareGoodOnly — 토글 + 리셋", () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.toggleChildcareGoodOnly();
    });
    expect(result.current.childcareGoodOnly).toBe(true);
    act(() => {
      result.current.handleResetAll();
    });
    expect(result.current.childcareGoodOnly).toBe(false);
  });

  it("toggleParkingGoodOnly — 토글 + 리셋 (세션 477)", () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.toggleParkingGoodOnly();
    });
    expect(result.current.parkingGoodOnly).toBe(true);
    act(() => {
      result.current.handleResetAll();
    });
    expect(result.current.parkingGoodOnly).toBe(false);
  });

  // 세션 479 회귀 가드 — 치안/육아/주차 필터 켠 채 커스텀 프리셋 저장 시 snap 객체에 담겨야 함
  // (saveCustomPreset snap 에 crimeSafeOnly/childcareGoodOnly/parkingGoodOnly 누락 시
  //  프리셋에 절대 저장 안 되던 결함 — 세션 430 subwayOnly · 세션 461 dsr 와 동일 재발 패턴)
  it("saveCustomPreset — crimeSafeOnly=true 저장 후 applyPreset 으로 복원", () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.toggleCrimeSafeOnly();
    });
    expect(result.current.crimeSafeOnly).toBe(true);
    act(() => {
      result.current.saveCustomPreset("치안만");
    });
    const saved = /** @type {any} */ (result.current.customPresets.find((p) => p.label === "치안만"));
    expect(saved?.values.crimeSafeOnly).toBe(true);
    act(() => {
      result.current.toggleCrimeSafeOnly();
    });
    expect(result.current.crimeSafeOnly).toBe(false);
    act(() => {
      result.current.applyPreset(saved.values);
    });
    expect(result.current.crimeSafeOnly).toBe(true);
  });

  it("saveCustomPreset — childcareGoodOnly=true 저장 후 applyPreset 으로 복원", () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.toggleChildcareGoodOnly();
    });
    expect(result.current.childcareGoodOnly).toBe(true);
    act(() => {
      result.current.saveCustomPreset("육아만");
    });
    const saved = /** @type {any} */ (result.current.customPresets.find((p) => p.label === "육아만"));
    expect(saved?.values.childcareGoodOnly).toBe(true);
    act(() => {
      result.current.toggleChildcareGoodOnly();
    });
    expect(result.current.childcareGoodOnly).toBe(false);
    act(() => {
      result.current.applyPreset(saved.values);
    });
    expect(result.current.childcareGoodOnly).toBe(true);
  });

  it("saveCustomPreset — parkingGoodOnly=true 저장 후 applyPreset 으로 복원", () => {
    const { result } = renderHook(() => useFilterSort({}));
    act(() => {
      result.current.toggleParkingGoodOnly();
    });
    expect(result.current.parkingGoodOnly).toBe(true);
    act(() => {
      result.current.saveCustomPreset("주차만");
    });
    const saved = /** @type {any} */ (result.current.customPresets.find((p) => p.label === "주차만"));
    expect(saved?.values.parkingGoodOnly).toBe(true);
    act(() => {
      result.current.toggleParkingGoodOnly();
    });
    expect(result.current.parkingGoodOnly).toBe(false);
    act(() => {
      result.current.applyPreset(saved.values);
    });
    expect(result.current.parkingGoodOnly).toBe(true);
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

describe("URL 필터 역직렬화 (Phase 2)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("URL에서 areaMin/Max, unitsMin/Max 읽기", () => {
    mockLocationSearch("?amin=60&amax=85&umin=500&umax=2000");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.areaMin).toBe("60");
    expect(result.current.areaMax).toBe("85");
    expect(result.current.unitsMin).toBe("500");
    expect(result.current.unitsMax).toBe("2000");
  });

  it("URL에서 moveInFilter 읽기", () => {
    mockLocationSearch("?movein=입주예정");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.moveInFilter).toBe("입주예정");
  });

  it("잘못된 moveInFilter → 기본값 폴백", () => {
    mockLocationSearch("?movein=잘못된값");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.moveInFilter).toBe("전체");
  });

  it("Phase 1 + Phase 2 복합 URL", () => {
    mockLocationSearch("?region=서울&sort=benefit&bmax=5&amin=60&movein=입주예정");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.filterRegion).toBe("서울");
    expect(result.current.sortKey).toBe("benefit");
    expect(result.current.budgetMax).toBe("5");
    expect(result.current.areaMin).toBe("60");
    expect(result.current.moveInFilter).toBe("입주예정");
  });

  it("NaN areaMin → 기본값 폴백", () => {
    mockLocationSearch("?amin=abc");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.areaMin).toBe("");
  });

  // 세션 461 — DSR/비규제 토글 URL 역직렬화 (?dsr=1 / ?unreg=1)
  it("URL에서 dsrPassOnly, nonRegulatedOnly 읽기", () => {
    mockLocationSearch("?dsr=1&unreg=1");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.dsrPassOnly).toBe(true);
    expect(result.current.nonRegulatedOnly).toBe(true);
  });

  it("dsr/unreg 미지정 → 기본값 false", () => {
    mockLocationSearch("?region=서울");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.dsrPassOnly).toBe(false);
    expect(result.current.nonRegulatedOnly).toBe(false);
  });

  // 세션 475/477 — 치안안전/육아인프라/주차넉넉 토글 URL 역직렬화 (?crimesafe=1 / ?childcare=1 / ?parking=1)
  it("URL에서 crimeSafeOnly, childcareGoodOnly, parkingGoodOnly 읽기", () => {
    mockLocationSearch("?crimesafe=1&childcare=1&parking=1");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.crimeSafeOnly).toBe(true);
    expect(result.current.childcareGoodOnly).toBe(true);
    expect(result.current.parkingGoodOnly).toBe(true);
  });

  it("crimesafe/childcare/parking 미지정 → 기본값 false", () => {
    mockLocationSearch("?region=서울");
    const { result } = renderHook(() => useFilterSort({}));
    expect(result.current.crimeSafeOnly).toBe(false);
    expect(result.current.childcareGoodOnly).toBe(false);
    expect(result.current.parkingGoodOnly).toBe(false);
  });
});
