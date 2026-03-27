import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchFilterBar } from "./SearchFilterBar";
import { catCol, catBg } from "@/theme";

function makeProps(overrides = {}) {
  return {
    searchText: "",
    onSearchChange: vi.fn(),
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
    pw: { location: 40, product: 20, price: 20, risk: 10, benefit: 5, future: 5 },
    catCol,
    catBg,
    isPC: false,
    isDesktop: false,
    ...overrides,
  };
}

describe("SearchFilterBar", () => {
  // 검색 입력 렌더링
  it("검색 입력 필드가 렌더링됨", () => {
    render(<SearchFilterBar {...makeProps()} />);
    expect(screen.getByLabelText("단지 검색")).toBeInTheDocument();
  });

  // 검색어 입력 시 콜백 호출
  it("검색어 입력 시 onSearchChange 호출", () => {
    const onSearchChange = vi.fn();
    render(<SearchFilterBar {...makeProps({ onSearchChange })} />);
    fireEvent.change(screen.getByLabelText("단지 검색"), { target: { value: "현대" } });
    expect(onSearchChange).toHaveBeenCalledWith("현대");
  });

  // 검색어가 있으면 지우기 버튼 표시
  it("검색어가 있으면 지우기 버튼 표시", () => {
    render(<SearchFilterBar {...makeProps({ searchText: "테스트" })} />);
    const clearBtn = screen.getByLabelText("검색어 지우기");
    expect(clearBtn).toBeInTheDocument();
  });

  // 지우기 버튼 클릭 시 빈 문자열로 콜백
  it("지우기 버튼 클릭 시 검색어 초기화", () => {
    const onSearchChange = vi.fn();
    render(<SearchFilterBar {...makeProps({ searchText: "테스트", onSearchChange })} />);
    fireEvent.click(screen.getByLabelText("검색어 지우기"));
    expect(onSearchChange).toHaveBeenCalledWith("");
  });

  // 검색어 없으면 지우기 버튼 미표시
  it("검색어가 없으면 지우기 버튼 미표시", () => {
    render(<SearchFilterBar {...makeProps()} />);
    expect(screen.queryByLabelText("검색어 지우기")).toBeNull();
  });

  // 지역 select 렌더링
  it("시/도 선택이 렌더링됨", () => {
    render(<SearchFilterBar {...makeProps()} />);
    expect(screen.getByLabelText("시/도")).toBeInTheDocument();
  });

  // 지역 변경 시 콜백
  it("지역 변경 시 onRegionChange 호출", () => {
    const onRegionChange = vi.fn();
    render(<SearchFilterBar {...makeProps({ onRegionChange })} />);
    fireEvent.change(screen.getByLabelText("시/도"), { target: { value: "서울" } });
    expect(onRegionChange).toHaveBeenCalledWith("서울");
  });

  // 구/군 select — 전체일 때 disabled
  it("전체 지역일 때 구/군 select가 disabled", () => {
    render(<SearchFilterBar {...makeProps()} />);
    expect(screen.getByLabelText("구/군")).toBeDisabled();
  });

  // 예산 입력
  it("최소/최대 예산 입력 필드 렌더링", () => {
    render(<SearchFilterBar {...makeProps()} />);
    expect(screen.getByLabelText("최소 예산(억)")).toBeInTheDocument();
    expect(screen.getByLabelText("최대 예산(억)")).toBeInTheDocument();
  });

  // 예산 초기화 버튼 — 예산 값 있을 때만 표시
  it("예산 값이 있으면 초기화 버튼 표시", () => {
    render(<SearchFilterBar {...makeProps({ budgetMin: "3" })} />);
    expect(screen.getByLabelText("예산 초기화")).toBeInTheDocument();
  });

  it("예산 값이 없으면 초기화 버튼 미표시", () => {
    render(<SearchFilterBar {...makeProps()} />);
    expect(screen.queryByLabelText("예산 초기화")).toBeNull();
  });

  // 모바일에서 정렬 select 렌더링
  it("모바일(isPC=false)에서 정렬 select 렌더링", () => {
    render(<SearchFilterBar {...makeProps({ isPC: false })} />);
    expect(screen.getByLabelText("정렬 기준")).toBeInTheDocument();
  });

  // 결과 카운트 배지 표시
  it("filteredLength/scoredLength 배지 표시", () => {
    render(<SearchFilterBar {...makeProps({ filteredLength: 45, scoredLength: 200 })} />);
    expect(screen.getByText(/45 \/ 200개/)).toBeInTheDocument();
  });

  // 결과 0건 시 빨간색 배지
  it("filteredLength===0이면 배지 렌더링 (0건 표시)", () => {
    render(<SearchFilterBar {...makeProps({ filteredLength: 0, scoredLength: 200 })} />);
    expect(screen.getByText(/0 \/ 200개/)).toBeInTheDocument();
  });

  // 드롭다운 옵션 카운트 표시 (region)
  it("시/도 드롭다운에 옵션별 건수 표시", () => {
    const counts = { regionCounts: { "서울": 100, "경기": 50 }, guCounts: {}, moveInCounts: { "입주예정": 0, "미입주": 0, "입주완료": 0 }, tierCounts: { "1군": 0, "2군": 0, "기타": 0 } };
    render(<SearchFilterBar {...makeProps({ filterOptionCounts: counts })} />);
    const regionSelect = screen.getByLabelText("시/도");
    expect(regionSelect).toBeInTheDocument();
    // "서울 (100)" 옵션이 존재하는지 확인
    const options = regionSelect.querySelectorAll("option");
    const seoulOpt = [...options].find(o => o.textContent.includes("서울"));
    expect(seoulOpt?.textContent).toBe("서울 (100)");
  });

  // 0건 옵션 disabled
  it("0건 옵션이 disabled 처리됨", () => {
    const counts = { regionCounts: { "서울": 100, "경기": 0 }, guCounts: {}, moveInCounts: { "입주예정": 0, "미입주": 0, "입주완료": 0 }, tierCounts: { "1군": 0, "2군": 0, "기타": 0 } };
    render(<SearchFilterBar {...makeProps({ filterOptionCounts: counts })} />);
    const regionSelect = screen.getByLabelText("시/도");
    const options = regionSelect.querySelectorAll("option");
    const gyeonggiOpt = [...options].find(o => o.textContent.includes("경기"));
    expect(gyeonggiOpt?.disabled).toBe(true);
  });

  // filterOptionCounts null일 때 (로딩 중) 크래시 없음
  it("filterOptionCounts null이어도 크래시 없이 렌더링", () => {
    render(<SearchFilterBar {...makeProps({ filterOptionCounts: null, filteredLength: 10, scoredLength: 100 })} />);
    expect(screen.getByLabelText("시/도")).toBeInTheDocument();
  });
});
