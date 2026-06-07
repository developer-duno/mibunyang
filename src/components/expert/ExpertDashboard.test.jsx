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
    expandedApt: null,
    setExpandedApt: vi.fn(),
    onSwitchToAdmin: null,
  });

  // 프로필 전환 메뉴는 전역 HeaderSection 담당 — 대시보드 내 중복 제거(세션 383)로 여기선 미렌더.
  it("대시보드 안에 프로필 전환 버튼을 더 이상 표시하지 않는다(전역 HeaderSection 담당)", () => {
    render(<ExpertDashboard {...defaultProps()} />);
    // '실거주' 등 프로필명은 대시보드 헤더 줄에 없음 (전역 헤더로 이동)
    expect(screen.queryByRole("button", { name: "실거주" })).toBeNull();
    expect(screen.queryByRole("button", { name: "투자" })).toBeNull();
  });

  // scored가 비어있을 때 안내 메시지 표시
  it("scored가 비어있으면 안내 메시지를 표시한다", () => {
    render(<ExpertDashboard {...defaultProps()} scored={[]} />);
    expect(screen.getByText(/사이드바에서 단지를 선택/)).toBeTruthy();
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

// 목차 드롭다운(StickyJumpNav variant="dropdown") — 세션 383. 가로 스크롤 칩바 → 단추+세로 목록.
// 요약+9섹션 점프 회귀 가드. behavior:"auto"(smooth 취소 race 수정 답습).
describe("ExpertDashboard 목차 드롭다운", () => {
  /** @returns {any} */
  const props = () => ({
    scored: makeScored(),
    profile: "live",
    expandedApt: null,
    setExpandedApt: vi.fn(),
    onSwitchToAdmin: null,
  });

  const origScrollTo = HTMLElement.prototype.scrollTo;
  afterEach(() => { HTMLElement.prototype.scrollTo = origScrollTo; });

  // 펼치면 10개 항목 = 요약 + FIELD_SECTIONS 9섹션
  const OPTION_LABELS = ["요약", "단지 개요", "가격/시장 지표", "안전도/리스크", "입지/교통/교육/환경", "상품성/건축", "혜택/할인", "미래가치", "네이버 교차검증", "네이버 분양정보"];

  it("드롭다운 펼치면 목차 항목 10개(요약+9섹션)가 모두 렌더됨", () => {
    render(<ExpertDashboard {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /요약/ })); // 단추(기본 active="요약") 펼치기
    for (const label of OPTION_LABELS) {
      expect(screen.getByRole("option", { name: label })).toBeTruthy();
    }
  });

  it("섹션 컨테이너(#sec-summary, #sec-가격 등)가 렌더됨", () => {
    const { container } = render(<ExpertDashboard {...props()} />);
    for (const id of ["sec-summary", "sec-개요", "sec-가격", "sec-안전", "sec-분양"]) {
      expect(container.querySelector(`#${id}`)).toBeTruthy();
    }
  });

  it("항목 클릭 시 컨테이너 scrollTo(behavior:auto) 호출 + 목록 닫힘", () => {
    const scrollToSpy = vi.fn();
    HTMLElement.prototype.scrollTo = scrollToSpy;
    render(<ExpertDashboard {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /요약/ })); // 펼치기
    fireEvent.click(screen.getByRole("option", { name: "안전도/리스크" }));
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    const arg = scrollToSpy.mock.calls[0][0];
    expect(typeof arg.top).toBe("number");
    expect(arg.behavior).toBe("auto"); // smooth→auto (세션 383 점프 취소 버그 수정)
    // 선택 후 목록 닫힘 → option 사라짐
    expect(screen.queryByRole("option", { name: "안전도/리스크" })).toBeNull();
  });

  it("scrollTo 미구현 환경에서도 항목 클릭 무에러", () => {
    HTMLElement.prototype.scrollTo = /** @type {any} */ (undefined);
    render(<ExpertDashboard {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /요약/ })); // 펼치기
    const option = screen.getByRole("option", { name: "가격/시장 지표" });
    expect(() => fireEvent.click(option)).not.toThrow();
  });

  // 프로필 맞춤 강조 (세션 382) — invest 상위 2 = price(가격), risk(안전)
  it("profile='invest' 면 가격·안전 섹션 헤더에 ★ 중점 배지 2개", () => {
    render(<ExpertDashboard {...props()} profile="invest" />);
    // 헤더 배지만 텍스트 "★ 중점" (칩 강조는 테두리라 텍스트 없음)
    expect(screen.getAllByText(/★ 중점/).length).toBe(2);
  });

  it("profile='edu' 면 입지·상품성 강조로 이동", () => {
    render(<ExpertDashboard {...props()} profile="edu" />);
    expect(screen.getAllByText(/★ 중점/).length).toBe(2);
  });
});
