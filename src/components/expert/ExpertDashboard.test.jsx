// @ts-check
import { describe, it, expect, vi, afterEach } from "vitest";
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

// StickyJumpNav(목차바) — 세션 382. 요약+9섹션 점프 회귀 가드. (소비자 DetailModal 패턴 답습)
describe("ExpertDashboard StickyJumpNav", () => {
  /** @returns {any} */
  const props = () => ({
    scored: makeScored(),
    profile: "live",
    setProfile: vi.fn(),
    expandedApt: null,
    setExpandedApt: vi.fn(),
    onSwitchToAdmin: null,
  });

  const origScrollTo = HTMLElement.prototype.scrollTo;
  afterEach(() => { HTMLElement.prototype.scrollTo = origScrollTo; });

  // 칩 10개 = 요약 + FIELD_SECTIONS 9섹션
  const CHIP_LABELS = ["요약", "단지 개요", "가격/시장 지표", "안전도/리스크", "입지/교통/교육/환경", "상품성/건축", "혜택/할인", "미래가치", "네이버 교차검증", "네이버 분양정보"];

  it("목차바 칩 10개(요약+9섹션)가 모두 렌더됨", () => {
    render(<ExpertDashboard {...props()} />);
    for (const label of CHIP_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("섹션 컨테이너(#sec-summary, #sec-가격 등)가 렌더됨", () => {
    const { container } = render(<ExpertDashboard {...props()} />);
    for (const id of ["sec-summary", "sec-개요", "sec-가격", "sec-안전", "sec-분양"]) {
      expect(container.querySelector(`#${id}`)).toBeTruthy();
    }
  });

  it("칩 클릭 시 컨테이너 scrollTo 호출 + active 전환", () => {
    const scrollToSpy = vi.fn();
    HTMLElement.prototype.scrollTo = scrollToSpy;
    render(<ExpertDashboard {...props()} />);
    const chip = screen.getByRole("button", { name: "안전도/리스크" });
    fireEvent.click(chip);
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    const arg = scrollToSpy.mock.calls[0][0];
    expect(typeof arg.top).toBe("number");
    expect(arg.behavior).toBe("smooth");
    expect(chip).toHaveAttribute("aria-current", "true");
  });

  it("scrollTo 미구현 환경에서도 칩 클릭 무에러", () => {
    HTMLElement.prototype.scrollTo = /** @type {any} */ (undefined);
    render(<ExpertDashboard {...props()} />);
    const chip = screen.getByRole("button", { name: "가격/시장 지표" });
    expect(() => fireEvent.click(chip)).not.toThrow();
  });
});
