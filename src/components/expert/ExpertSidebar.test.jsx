// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExpertSidebar } from "./ExpertSidebar";
import { makeScoredItem } from "@/__tests__/factories";

function makeScored(count = 3) {
  return Array.from({ length: count }, (_, i) =>
    makeScoredItem({ id: i + 1, name: `아파트${i + 1}`, region: i === 0 ? "서울" : "경기", gu: "테스트구", area: 84 })
  );
}

describe("ExpertSidebar", () => {
  /** @returns {any} */
  const defaultProps = () => ({
    scored: makeScored(),
    selectedId: 1,
    onSelect: vi.fn(),
    search: "",
    setSearch: vi.fn(),
    regionFilter: "전체",
    setRegionFilter: vi.fn(),
    sort: "total",
    setSort: vi.fn(),
  });

  // 기본 렌더링 — 아파트 목록 표시
  it("아파트 목록을 표시한다", () => {
    render(<ExpertSidebar {...defaultProps()} />);
    expect(screen.getByText("아파트1")).toBeTruthy();
    expect(screen.getByText("아파트2")).toBeTruthy();
    expect(screen.getByText("아파트3")).toBeTruthy();
  });

  // 검색 입력 필드 표시
  it("검색 입력 필드를 표시한다", () => {
    render(<ExpertSidebar {...defaultProps()} />);
    expect(screen.getByLabelText("단지 검색")).toBeTruthy();
  });

  // 검색어 입력 시 setSearch 호출
  it("검색어 입력 시 setSearch를 호출한다", () => {
    const props = defaultProps();
    render(<ExpertSidebar {...props} />);
    fireEvent.change(screen.getByLabelText("단지 검색"), { target: { value: "아파트1" } });
    expect(props.setSearch).toHaveBeenCalledWith("아파트1");
  });

  // 검색 필터링 — search prop으로 필터링 결과 확인
  it("search prop에 의해 목록이 필터링된다", () => {
    const props = defaultProps();
    props.search = "아파트1";
    render(<ExpertSidebar {...props} />);
    expect(screen.getByText("아파트1")).toBeTruthy();
    expect(screen.queryByText("아파트2")).toBeNull();
    expect(screen.queryByText("아파트3")).toBeNull();
  });

  // 지역 필터 선택 표시
  it("지역 필터 셀렉트를 표시한다", () => {
    render(<ExpertSidebar {...defaultProps()} />);
    expect(screen.getByLabelText("지역 필터")).toBeTruthy();
  });

  // 지역 필터 변경 시 setRegionFilter 호출
  it("지역 필터 변경 시 setRegionFilter를 호출한다", () => {
    const props = defaultProps();
    render(<ExpertSidebar {...props} />);
    fireEvent.change(screen.getByLabelText("지역 필터"), { target: { value: "서울" } });
    expect(props.setRegionFilter).toHaveBeenCalledWith("서울");
  });

  // 지역 필터로 목록 필터링
  it("regionFilter가 '서울'이면 서울 아파트만 표시한다", () => {
    const props = defaultProps();
    props.regionFilter = "서울";
    render(<ExpertSidebar {...props} />);
    expect(screen.getByText("아파트1")).toBeTruthy();
    // 아파트2, 3는 경기이므로 미표시
    expect(screen.queryByText("아파트2")).toBeNull();
  });

  // 아파트 클릭 시 onSelect 호출
  it("아파트 항목 클릭 시 onSelect를 호출한다", () => {
    const props = defaultProps();
    render(<ExpertSidebar {...props} />);
    fireEvent.click(screen.getByText("아파트2"));
    expect(props.onSelect).toHaveBeenCalledWith(2);
  });

  // 정렬 기준 셀렉트 표시
  it("정렬 기준 셀렉트를 표시한다", () => {
    render(<ExpertSidebar {...defaultProps()} />);
    expect(screen.getByLabelText("정렬 기준")).toBeTruthy();
  });

  // 검색 결과 없음 표시
  it("검색 결과가 없으면 안내 메시지를 표시한다", () => {
    const props = defaultProps();
    props.search = "없는아파트";
    render(<ExpertSidebar {...props} />);
    expect(screen.getByText("검색 결과 없음")).toBeTruthy();
  });

  // 모바일 모드 — 닫기 버튼 표시
  it("isMobile이면 닫기 버튼을 표시한다", () => {
    const props = defaultProps();
    render(<ExpertSidebar {...props} isMobile onClose={vi.fn()} />);
    expect(screen.getByLabelText("사이드바 닫기")).toBeTruthy();
    expect(screen.getByText("단지 목록")).toBeTruthy();
  });

  // 모바일 닫기 클릭
  it("모바일 닫기 버튼 클릭 시 onClose를 호출한다", () => {
    const onClose = vi.fn();
    render(<ExpertSidebar {...defaultProps()} isMobile onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("사이드바 닫기"));
    expect(onClose).toHaveBeenCalled();
  });
});
