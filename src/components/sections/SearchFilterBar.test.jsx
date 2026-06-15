// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchFilterBar } from "./SearchFilterBar";

/* 테스트용 기본 props 팩토리 */
/** @returns {any} */
function makeProps(overrides = {}) {
  return {
    filterRegion: "전체",
    onRegionChange: vi.fn(),
    regionOptions: ["전체", "서울", "경기"],
    filterGu: "전체",
    onGuChange: vi.fn(),
    guOptions: ["전체"],
    budgetMin: "",
    onBudgetMinChange: vi.fn(),
    budgetMax: "",
    onBudgetMaxChange: vi.fn(),
    onBudgetReset: vi.fn(),
    sortKey: "total",
    onSortChange: vi.fn(),
    searchQuery: "",
    onSearchChange: vi.fn(),
    isDesktop: false,
    showFavOnly: false,
    onToggleFavOnly: vi.fn(),
    favCount: 0,
    hideNoUnsold: true,
    onToggleHideNoUnsold: vi.fn(),
    filterCollapsed: false,
    onToggleCollapsed: vi.fn(),
    activeFilterCount: 0,
    ...overrides,
  };
}

/* 드롭다운 열기 헬퍼 — aria-expanded 트리거 버튼 클릭 */
function openPanel(/** @type {string} */ label) {
  const buttons = screen.getAllByRole("button");
  const btn = buttons.find(b => b.textContent?.startsWith(label));
  if (btn) fireEvent.click(btn);
}

describe("SearchFilterBar", () => {
  // 드롭다운 트리거 버튼이 렌더링되는지
  it("6개 드롭다운 트리거 버튼이 렌더링됨", () => {
    render(<SearchFilterBar {...makeProps()} />);
    const buttons = screen.getAllByRole("button");
    const labels = ["지역", "금액", "면적", "정렬", "추천", "상세"];
    labels.forEach(label => {
      expect(buttons.some(b => b.textContent.startsWith(label))).toBe(true);
    });
  });

  // 지역 드롭다운 열기 → 시/도 select 렌더링
  it("지역 드롭다운 열면 시/도 select 렌더링", () => {
    render(<SearchFilterBar {...makeProps()} />);
    openPanel("지역");
    expect(screen.getByLabelText("시/도")).toBeInTheDocument();
  });

  // 지역 변경 시 콜백
  it("지역 변경 시 onRegionChange 호출", () => {
    const onRegionChange = vi.fn();
    render(<SearchFilterBar {...makeProps({ onRegionChange })} />);
    openPanel("지역");
    fireEvent.change(screen.getByLabelText("시/도"), { target: { value: "서울" } });
    expect(onRegionChange).toHaveBeenCalledWith("서울");
  });

  // 구/군 select — 전체일 때 disabled
  it("전체 지역일 때 구/군 select가 disabled", () => {
    render(<SearchFilterBar {...makeProps()} />);
    openPanel("지역");
    expect(screen.getByLabelText("구/군")).toBeDisabled();
  });

  // 금액 드롭다운 → 예산 입력 필드
  it("금액 드롭다운 열면 예산 입력 필드 렌더링", () => {
    render(<SearchFilterBar {...makeProps()} />);
    openPanel("금액");
    expect(screen.getByLabelText("최소 예산(억)")).toBeInTheDocument();
    expect(screen.getByLabelText("최대 예산(억)")).toBeInTheDocument();
  });

  // 예산 초기화 버튼 — 예산 값 있을 때만 표시
  it("예산 값이 있으면 초기화 버튼 표시", () => {
    render(<SearchFilterBar {...makeProps({ budgetMin: "3" })} />);
    openPanel("금액");
    expect(screen.getByLabelText("예산 초기화")).toBeInTheDocument();
  });

  it("예산 값이 없으면 초기화 버튼 미표시", () => {
    render(<SearchFilterBar {...makeProps()} />);
    openPanel("금액");
    expect(screen.queryByLabelText("예산 초기화")).toBeNull();
  });

  // 검색 드롭다운 → 단지명 input
  it("검색 드롭다운 열면 단지명 검색 input 렌더링", () => {
    render(<SearchFilterBar {...makeProps()} />);
    openPanel("검색");
    expect(screen.getByLabelText("단지명·지역 검색")).toBeInTheDocument();
  });

  it("검색 input 변경 시 onSearchChange 호출", () => {
    const onSearchChange = vi.fn();
    render(<SearchFilterBar {...makeProps({ onSearchChange })} />);
    openPanel("검색");
    fireEvent.change(screen.getByLabelText("단지명·지역 검색"), { target: { value: "래미안" } });
    expect(onSearchChange).toHaveBeenCalledWith("래미안");
  });

  it("검색어 있으면 활성 칩 표시 + 해제 콜백", () => {
    const onSearchChange = vi.fn();
    render(<SearchFilterBar {...makeProps({ searchQuery: "래미안", activeFilterCount: 1, onSearchChange })} />);
    const chip = screen.getByLabelText("검색어 해제");
    expect(chip).toHaveTextContent("검색: 래미안");
    fireEvent.click(chip);
    expect(onSearchChange).toHaveBeenCalledWith("");
  });

  it("공백만 입력한 검색어는 활성 칩 미표시", () => {
    render(<SearchFilterBar {...makeProps({ searchQuery: "   ", activeFilterCount: 0 })} />);
    expect(screen.queryByLabelText("검색어 해제")).toBeNull();
  });

  // 결과 카운트 배지 표시 (드롭다운 열기 불필요)
  it("filteredLength/scoredLength 배지 표시", () => {
    render(<SearchFilterBar {...makeProps({ filteredLength: 45, scoredLength: 200 })} />);
    expect(screen.getByText(/45 \/ 200개/)).toBeInTheDocument();
  });

  // 결과 0건 시 배지 표시
  it("filteredLength===0이면 배지 렌더링 (0건 표시)", () => {
    render(<SearchFilterBar {...makeProps({ filteredLength: 0, scoredLength: 200 })} />);
    expect(screen.getByText(/0 \/ 200개/)).toBeInTheDocument();
  });

  // 지역 옵션 카운트 표시
  it("시/도 드롭다운에 옵션별 건수 표시", () => {
    const counts = { regionCounts: { "서울": 100, "경기": 50 }, guCounts: {}, moveInCounts: {}, tierCounts: {} };
    render(<SearchFilterBar {...makeProps({ filterOptionCounts: counts })} />);
    openPanel("지역");
    const regionSelect = screen.getByLabelText("시/도");
    const options = regionSelect.querySelectorAll("option");
    const seoulOpt = [...options].find(o => o.textContent.includes("서울"));
    expect(seoulOpt?.textContent).toBe("서울 (100)");
  });

  // 0건 옵션 disabled
  it("0건 옵션이 disabled 처리됨", () => {
    const counts = { regionCounts: { "서울": 100, "경기": 0 }, guCounts: {}, moveInCounts: {}, tierCounts: {} };
    render(<SearchFilterBar {...makeProps({ filterOptionCounts: counts })} />);
    openPanel("지역");
    const regionSelect = screen.getByLabelText("시/도");
    const options = regionSelect.querySelectorAll("option");
    const gyeonggiOpt = [...options].find(o => o.textContent.includes("경기"));
    expect(gyeonggiOpt?.disabled).toBe(true);
  });

  // filterOptionCounts null 안전
  it("filterOptionCounts null이어도 크래시 없이 렌더링", () => {
    render(<SearchFilterBar {...makeProps({ filterOptionCounts: null, filteredLength: 10, scoredLength: 100 })} />);
    openPanel("지역");
    expect(screen.getByLabelText("시/도")).toBeInTheDocument();
  });

  // hideNoUnsold 토글 테스트
  it("hideNoUnsold=true일 때 '완판 포함' 표시", () => {
    render(<SearchFilterBar {...makeProps({ hideNoUnsold: true })} />);
    expect(screen.getByText("완판 포함")).toBeInTheDocument();
  });

  it("hideNoUnsold=false일 때 '미분양만' 표시", () => {
    render(<SearchFilterBar {...makeProps({ hideNoUnsold: false })} />);
    expect(screen.getByText("미분양만")).toBeInTheDocument();
  });

  // ── 활성 필터 칩 키보드 접근성 (a11y 보강) ──────────────────────
  describe("활성 필터 칩 키보드 접근성", () => {
    it("활성 칩이 role=button + tabIndex=0 + aria-label 부여됨", () => {
      render(<SearchFilterBar {...makeProps({
        showFavOnly: true, activeFilterCount: 1, favCount: 3,
      })} />);
      const chip = screen.getByRole("button", { name: "관심 필터 해제" });
      expect(chip.getAttribute("tabindex")).toBe("0");
      expect(chip.tagName).toBe("SPAN");
    });

    it("Enter 키 입력 시 onClick 콜백 호출 (관심 칩)", () => {
      const onToggleFavOnly = vi.fn();
      render(<SearchFilterBar {...makeProps({
        showFavOnly: true, activeFilterCount: 1, onToggleFavOnly,
      })} />);
      const chip = screen.getByRole("button", { name: "관심 필터 해제" });
      fireEvent.keyDown(chip, { key: "Enter" });
      expect(onToggleFavOnly).toHaveBeenCalledTimes(1);
    });

    it("Space 키 입력 시 onClick 콜백 호출 (지역 칩)", () => {
      const onRegionChange = vi.fn();
      render(<SearchFilterBar {...makeProps({
        filterRegion: "서울", activeFilterCount: 1, onRegionChange,
      })} />);
      const chip = screen.getByRole("button", { name: "서울 필터 해제" });
      fireEvent.keyDown(chip, { key: " " });
      expect(onRegionChange).toHaveBeenCalledWith("전체");
    });

    it("다른 키 입력 시 onClick 콜백 미호출 (회귀 가드)", () => {
      const onBudgetReset = vi.fn();
      render(<SearchFilterBar {...makeProps({
        budgetMin: "3", activeFilterCount: 1, onBudgetReset,
      })} />);
      const chip = screen.getByRole("button", { name: "예산 필터 해제" });
      fireEvent.keyDown(chip, { key: "a" });
      fireEvent.keyDown(chip, { key: "Tab" });
      expect(onBudgetReset).not.toHaveBeenCalled();
    });
  });
});
