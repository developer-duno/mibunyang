// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExpertDashboard } from "./ExpertDashboard";
import { makeScoredItem } from "@/__tests__/factories";

// 테스트용 scored 배열 생성
function makeScored(count = 3) {
  return Array.from({ length: count }, (_, i) =>
    makeScoredItem({ id: i + 1, name: `아파트${i + 1}`, region: i === 0 ? "서울" : "경기" })
  );
}

describe("ExpertDashboard", () => {
  /** @returns {any} */
  const defaultProps = () => ({
    scored: makeScored(),
    profile: "live",
    setProfile: vi.fn(),
    expandedApt: null,
    setExpandedApt: vi.fn(),
    onSwitchToAdmin: null,
  });

  // 기본 렌더링 — 프로필 버튼 5개 표시
  it("5개 프로필 버튼을 표시한다", () => {
    render(<ExpertDashboard {...defaultProps()} />);
    expect(screen.getByText("실거주")).toBeTruthy();
    expect(screen.getByText("투자")).toBeTruthy();
    expect(screen.getByText("신혼부부")).toBeTruthy();
    expect(screen.getByText("자녀교육")).toBeTruthy();
    expect(screen.getByText("은퇴")).toBeTruthy();
  });

  // scored가 비어있을 때 안내 메시지 표시
  it("scored가 비어있으면 안내 메시지를 표시한다", () => {
    render(<ExpertDashboard {...defaultProps()} scored={[]} />);
    expect(screen.getByText(/사이드바에서 단지를 선택/)).toBeTruthy();
  });

  // 프로필 클릭 시 setProfile 호출
  it("프로필 버튼 클릭 시 setProfile을 호출한다", () => {
    const props = defaultProps();
    render(<ExpertDashboard {...props} />);
    fireEvent.click(screen.getByText("투자"));
    expect(props.setProfile).toHaveBeenCalledWith("invest");
  });

  // 인쇄 버튼 표시
  it("인쇄 버튼을 표시한다", () => {
    render(<ExpertDashboard {...defaultProps()} />);
    expect(screen.getByLabelText("현재 페이지 인쇄")).toBeTruthy();
  });

  // onSwitchToAdmin이 있으면 관리 버튼 표시
  it("onSwitchToAdmin이 있으면 관리 버튼을 표시한다", () => {
    render(<ExpertDashboard {...defaultProps()} onSwitchToAdmin={vi.fn()} />);
    expect(screen.getByText("관리")).toBeTruthy();
  });

  // onSwitchToAdmin이 null이면 관리 버튼 미표시
  it("onSwitchToAdmin이 null이면 관리 버튼을 표시하지 않는다", () => {
    render(<ExpertDashboard {...defaultProps()} />);
    expect(screen.queryByText("관리")).toBeNull();
  });

  // scored에 데이터가 있으면 첫 번째 아파트가 선택됨
  it("scored에 데이터가 있으면 첫 번째 아파트 정보를 표시한다", () => {
    render(<ExpertDashboard {...defaultProps()} />);
    // ExpertAptHeader에서 아파트 이름 표시 (사이드바에도 같은 이름 존재)
    const elements = screen.getAllByText("아파트1");
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  // expandedApt 지정 시 해당 아파트 선택
  it("expandedApt으로 지정한 아파트를 선택한다", () => {
    const scored = makeScored();
    render(<ExpertDashboard {...defaultProps()} scored={scored} expandedApt={2} />);
    // 사이드바와 헤더 모두에 아파트2가 나타남
    const elements = screen.getAllByText("아파트2");
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });
});
