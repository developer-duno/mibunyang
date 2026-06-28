// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DetailPanel } from "./DetailPanel";

/* 테스트용 기본 props 팩토리 */
/** @returns {any} */
function makeProps(overrides = {}) {
  return {
    minScore: "",
    onMinScoreChange: vi.fn(),
    builderTier: "전체",
    onBuilderTierChange: vi.fn(),
    benefitOnly: false,
    onToggleBenefitOnly: vi.fn(),
    subwayOnly: false,
    onToggleSubwayOnly: vi.fn(),
    filterOptionCounts: null,
    ...overrides,
  };
}

describe("DetailPanel", () => {
  // 최소 종합점수 입력 필드 렌더링
  it("최소 종합점수 입력 필드 렌더링", () => {
    render(<DetailPanel {...makeProps()} />);
    expect(screen.getByLabelText("최소 종합점수")).toBeInTheDocument();
  });

  // 점수 입력 변경 시 onMinScoreChange 콜백
  it("점수 입력 변경 시 onMinScoreChange 호출", () => {
    const onMinScoreChange = vi.fn();
    render(<DetailPanel {...makeProps({ onMinScoreChange })} />);
    fireEvent.change(screen.getByLabelText("최소 종합점수"), { target: { value: "70" } });
    expect(onMinScoreChange).toHaveBeenCalledWith("70");
  });

  // 시공사 등급 select 렌더링 + 4개 옵션
  it("시공사 등급 select에 4개 옵션 렌더링", () => {
    render(<DetailPanel {...makeProps()} />);
    const select = screen.getByLabelText("시공사 등급");
    expect(select).toBeInTheDocument();
    const options = select.querySelectorAll("option");
    expect(options).toHaveLength(4);
  });

  // 시공사 등급 변경 시 onBuilderTierChange 콜백
  it("시공사 등급 변경 시 onBuilderTierChange 호출", () => {
    const onBuilderTierChange = vi.fn();
    render(<DetailPanel {...makeProps({ onBuilderTierChange })} />);
    fireEvent.change(screen.getByLabelText("시공사 등급"), { target: { value: "1군" } });
    expect(onBuilderTierChange).toHaveBeenCalledWith("1군");
  });

  // 혜택 토글 버튼 렌더링
  it("혜택 토글 버튼 렌더링", () => {
    render(<DetailPanel {...makeProps()} />);
    expect(screen.getByLabelText("혜택 있는 매물만")).toBeInTheDocument();
  });

  // 혜택 토글 클릭 시 onToggleBenefitOnly 콜백
  it("혜택 토글 클릭 시 onToggleBenefitOnly 호출", () => {
    const onToggleBenefitOnly = vi.fn();
    render(<DetailPanel {...makeProps({ onToggleBenefitOnly })} />);
    fireEvent.click(screen.getByLabelText("혜택 있는 매물만"));
    expect(onToggleBenefitOnly).toHaveBeenCalledTimes(1);
  });

  // benefitOnly=true → aria-pressed="true"
  it("benefitOnly=true이면 aria-pressed=true", () => {
    render(<DetailPanel {...makeProps({ benefitOnly: true })} />);
    expect(screen.getByLabelText("혜택 있는 매물만")).toHaveAttribute("aria-pressed", "true");
  });

  // benefitOnly=false → aria-pressed="false"
  it("benefitOnly=false이면 aria-pressed=false", () => {
    render(<DetailPanel {...makeProps({ benefitOnly: false })} />);
    expect(screen.getByLabelText("혜택 있는 매물만")).toHaveAttribute("aria-pressed", "false");
  });

  // 역세권 토글 버튼 렌더링 (세션 430)
  it("역세권 토글 버튼 렌더링", () => {
    render(<DetailPanel {...makeProps()} />);
    expect(screen.getByLabelText("역세권 매물만(500m 이내)")).toBeInTheDocument();
  });

  // 역세권 토글 클릭 시 onToggleSubwayOnly 콜백 (세션 430)
  it("역세권 토글 클릭 시 onToggleSubwayOnly 호출", () => {
    const onToggleSubwayOnly = vi.fn();
    render(<DetailPanel {...makeProps({ onToggleSubwayOnly })} />);
    fireEvent.click(screen.getByLabelText("역세권 매물만(500m 이내)"));
    expect(onToggleSubwayOnly).toHaveBeenCalledTimes(1);
  });

  // subwayOnly=true → aria-pressed=true + 초기화 버튼 노출 (세션 430)
  it("subwayOnly=true이면 aria-pressed=true이고 초기화 버튼 표시", () => {
    render(<DetailPanel {...makeProps({ subwayOnly: true })} />);
    expect(screen.getByLabelText("역세권 매물만(500m 이내)")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("점수/시공사/혜택/역세권 초기화")).toBeInTheDocument();
  });

  // 초기화 클릭 시 subwayOnly=true면 onToggleSubwayOnly 호출 (세션 430)
  it("초기화 클릭 시 subwayOnly=true면 onToggleSubwayOnly 호출", () => {
    const onToggleSubwayOnly = vi.fn();
    render(<DetailPanel {...makeProps({ subwayOnly: true, onToggleSubwayOnly })} />);
    fireEvent.click(screen.getByLabelText("점수/시공사/혜택/역세권 초기화"));
    expect(onToggleSubwayOnly).toHaveBeenCalledTimes(1);
  });

  // 필터 미설정 시 초기화 버튼 미표시
  it("모든 필터 기본값이면 초기화 버튼 미표시", () => {
    render(<DetailPanel {...makeProps()} />);
    expect(screen.queryByLabelText("점수/시공사/혜택/역세권 초기화")).not.toBeInTheDocument();
  });

  // minScore 설정 시 초기화 버튼 표시
  it("점수 필터 설정 시 초기화 버튼 표시", () => {
    render(<DetailPanel {...makeProps({ minScore: "60" })} />);
    expect(screen.getByLabelText("점수/시공사/혜택/역세권 초기화")).toBeInTheDocument();
  });

  // 초기화 클릭 시 onMinScoreChange("") + onBuilderTierChange("전체") + onToggleBenefitOnly(if benefitOnly) 호출
  it("초기화 클릭 시 모든 필터 초기화 콜백 호출", () => {
    const onMinScoreChange = vi.fn();
    const onBuilderTierChange = vi.fn();
    const onToggleBenefitOnly = vi.fn();
    render(
      <DetailPanel
        {...makeProps({
          minScore: "60",
          benefitOnly: true,
          onMinScoreChange,
          onBuilderTierChange,
          onToggleBenefitOnly,
        })}
      />
    );
    fireEvent.click(screen.getByLabelText("점수/시공사/혜택/역세권 초기화"));
    expect(onMinScoreChange).toHaveBeenCalledWith("");
    expect(onBuilderTierChange).toHaveBeenCalledWith("전체");
    expect(onToggleBenefitOnly).toHaveBeenCalledTimes(1);
  });

  // benefitOnly=false 상태에서 초기화 시 onToggleBenefitOnly 호출 안됨
  it("benefitOnly=false 상태에서 초기화 시 onToggleBenefitOnly 호출 안됨", () => {
    const onToggleBenefitOnly = vi.fn();
    render(<DetailPanel {...makeProps({ minScore: "60", benefitOnly: false, onToggleBenefitOnly })} />);
    fireEvent.click(screen.getByLabelText("점수/시공사/혜택/역세권 초기화"));
    expect(onToggleBenefitOnly).not.toHaveBeenCalled();
  });

  // filterOptionCounts=null이어도 에러 없이 렌더링 (null 안전성)
  it("filterOptionCounts=null이어도 에러 없이 렌더링", () => {
    expect(() => render(<DetailPanel {...makeProps({ filterOptionCounts: null })} />)).not.toThrow();
  });

  // filterOptionCounts.tierCounts 카운트 표시
  it("filterOptionCounts.tierCounts 카운트가 옵션에 표시", () => {
    const counts = { tierCounts: { "1군": 5, "2군": 3, 기타: 2 } };
    render(<DetailPanel {...makeProps({ filterOptionCounts: counts })} />);
    const select = screen.getByLabelText("시공사 등급");
    const options = select.querySelectorAll("option");
    expect(options[1].textContent).toBe("1군 (5)");
    expect(options[2].textContent).toBe("2군 (3)");
    expect(options[3].textContent).toBe("기타 (2)");
  });
});
