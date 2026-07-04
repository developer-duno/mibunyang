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
    schoolGoodOnly: false,
    onToggleSchoolGoodOnly: vi.fn(),
    dsrPassOnly: false,
    onToggleDsrPassOnly: vi.fn(),
    nonRegulatedOnly: false,
    onToggleNonRegulatedOnly: vi.fn(),
    crimeSafeOnly: false,
    onToggleCrimeSafeOnly: vi.fn(),
    childcareGoodOnly: false,
    onToggleChildcareGoodOnly: vi.fn(),
    parkingGoodOnly: false,
    onToggleParkingGoodOnly: vi.fn(),
    hospitalNearOnly: false,
    onToggleHospitalNearOnly: vi.fn(),
    parkNearOnly: false,
    onToggleParkNearOnly: vi.fn(),
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
    expect(
      screen.getByLabelText("점수/시공사/혜택/역세권/학군/DSR/규제/치안/육아/주차/병원/공원 초기화")
    ).toBeInTheDocument();
  });

  // 초기화 클릭 시 subwayOnly=true면 onToggleSubwayOnly 호출 (세션 430)
  it("초기화 클릭 시 subwayOnly=true면 onToggleSubwayOnly 호출", () => {
    const onToggleSubwayOnly = vi.fn();
    render(<DetailPanel {...makeProps({ subwayOnly: true, onToggleSubwayOnly })} />);
    fireEvent.click(screen.getByLabelText("점수/시공사/혜택/역세권/학군/DSR/규제/치안/육아/주차/병원/공원 초기화"));
    expect(onToggleSubwayOnly).toHaveBeenCalledTimes(1);
  });

  // 필터 미설정 시 초기화 버튼 미표시
  it("모든 필터 기본값이면 초기화 버튼 미표시", () => {
    render(<DetailPanel {...makeProps()} />);
    expect(
      screen.queryByLabelText("점수/시공사/혜택/역세권/학군/DSR/규제/치안/육아/주차/병원/공원 초기화")
    ).not.toBeInTheDocument();
  });

  // minScore 설정 시 초기화 버튼 표시
  it("점수 필터 설정 시 초기화 버튼 표시", () => {
    render(<DetailPanel {...makeProps({ minScore: "60" })} />);
    expect(
      screen.getByLabelText("점수/시공사/혜택/역세권/학군/DSR/규제/치안/육아/주차/병원/공원 초기화")
    ).toBeInTheDocument();
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
    fireEvent.click(screen.getByLabelText("점수/시공사/혜택/역세권/학군/DSR/규제/치안/육아/주차/병원/공원 초기화"));
    expect(onMinScoreChange).toHaveBeenCalledWith("");
    expect(onBuilderTierChange).toHaveBeenCalledWith("전체");
    expect(onToggleBenefitOnly).toHaveBeenCalledTimes(1);
  });

  // benefitOnly=false 상태에서 초기화 시 onToggleBenefitOnly 호출 안됨
  it("benefitOnly=false 상태에서 초기화 시 onToggleBenefitOnly 호출 안됨", () => {
    const onToggleBenefitOnly = vi.fn();
    render(<DetailPanel {...makeProps({ minScore: "60", benefitOnly: false, onToggleBenefitOnly })} />);
    fireEvent.click(screen.getByLabelText("점수/시공사/혜택/역세권/학군/DSR/규제/치안/육아/주차/병원/공원 초기화"));
    expect(onToggleBenefitOnly).not.toHaveBeenCalled();
  });

  // filterOptionCounts=null이어도 에러 없이 렌더링 (null 안전성)
  it("filterOptionCounts=null이어도 에러 없이 렌더링", () => {
    expect(() => render(<DetailPanel {...makeProps({ filterOptionCounts: null })} />)).not.toThrow();
  });

  // 학군 양호 토글 버튼 렌더링 (세션 459)
  it("학군 양호 토글 버튼 렌더링", () => {
    render(<DetailPanel {...makeProps()} />);
    expect(screen.getByLabelText("학군 양호(A·B등급) 매물만")).toBeInTheDocument();
  });

  // 학군 양호 토글 클릭 시 onToggleSchoolGoodOnly 콜백 (세션 459)
  it("학군 양호 토글 클릭 시 onToggleSchoolGoodOnly 호출", () => {
    const onToggleSchoolGoodOnly = vi.fn();
    render(<DetailPanel {...makeProps({ onToggleSchoolGoodOnly })} />);
    fireEvent.click(screen.getByLabelText("학군 양호(A·B등급) 매물만"));
    expect(onToggleSchoolGoodOnly).toHaveBeenCalledTimes(1);
  });

  // schoolGoodOnly=true → aria-pressed=true + 초기화 버튼 노출 (세션 459)
  it("schoolGoodOnly=true이면 aria-pressed=true이고 초기화 버튼 표시", () => {
    render(<DetailPanel {...makeProps({ schoolGoodOnly: true })} />);
    expect(screen.getByLabelText("학군 양호(A·B등급) 매물만")).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByLabelText("점수/시공사/혜택/역세권/학군/DSR/규제/치안/육아/주차/병원/공원 초기화")
    ).toBeInTheDocument();
  });

  // 초기화 클릭 시 schoolGoodOnly=true면 onToggleSchoolGoodOnly 호출 (세션 459)
  it("초기화 클릭 시 schoolGoodOnly=true면 onToggleSchoolGoodOnly 호출", () => {
    const onToggleSchoolGoodOnly = vi.fn();
    render(<DetailPanel {...makeProps({ schoolGoodOnly: true, onToggleSchoolGoodOnly })} />);
    fireEvent.click(screen.getByLabelText("점수/시공사/혜택/역세권/학군/DSR/규제/치안/육아/주차/병원/공원 초기화"));
    expect(onToggleSchoolGoodOnly).toHaveBeenCalledTimes(1);
  });

  // schoolGoodOnly=false 상태에서 초기화 시 onToggleSchoolGoodOnly 호출 안됨 (세션 459)
  it("schoolGoodOnly=false 상태에서 초기화 시 onToggleSchoolGoodOnly 호출 안됨", () => {
    const onToggleSchoolGoodOnly = vi.fn();
    render(<DetailPanel {...makeProps({ minScore: "60", schoolGoodOnly: false, onToggleSchoolGoodOnly })} />);
    fireEvent.click(screen.getByLabelText("점수/시공사/혜택/역세권/학군/DSR/규제/치안/육아/주차/병원/공원 초기화"));
    expect(onToggleSchoolGoodOnly).not.toHaveBeenCalled();
  });

  // 치안안전 토글 클릭 시 onToggleCrimeSafeOnly 콜백 (세션 475)
  it("치안안전 토글 클릭 시 onToggleCrimeSafeOnly 호출", () => {
    const onToggleCrimeSafeOnly = vi.fn();
    render(<DetailPanel {...makeProps({ onToggleCrimeSafeOnly })} />);
    fireEvent.click(screen.getByLabelText("치안 안전한 동네만(범죄 1~3등급)"));
    expect(onToggleCrimeSafeOnly).toHaveBeenCalledTimes(1);
  });

  // crimeSafeOnly=true → aria-pressed=true + 초기화 시 호출 (세션 475)
  it("crimeSafeOnly=true이면 aria-pressed=true이고 초기화 시 onToggleCrimeSafeOnly 호출", () => {
    const onToggleCrimeSafeOnly = vi.fn();
    render(<DetailPanel {...makeProps({ crimeSafeOnly: true, onToggleCrimeSafeOnly })} />);
    expect(screen.getByLabelText("치안 안전한 동네만(범죄 1~3등급)")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByLabelText("점수/시공사/혜택/역세권/학군/DSR/규제/치안/육아/주차/병원/공원 초기화"));
    expect(onToggleCrimeSafeOnly).toHaveBeenCalledTimes(1);
  });

  // 육아인프라 토글 클릭 시 onToggleChildcareGoodOnly 콜백 (세션 475)
  it("육아인프라 토글 클릭 시 onToggleChildcareGoodOnly 호출", () => {
    const onToggleChildcareGoodOnly = vi.fn();
    render(<DetailPanel {...makeProps({ onToggleChildcareGoodOnly })} />);
    fireEvent.click(screen.getByLabelText("육아 인프라 좋은 곳만(어린이집 5개+ · 500m 이내)"));
    expect(onToggleChildcareGoodOnly).toHaveBeenCalledTimes(1);
  });

  // childcareGoodOnly=true → aria-pressed=true + 초기화 시 호출 (세션 475)
  it("childcareGoodOnly=true이면 aria-pressed=true이고 초기화 시 onToggleChildcareGoodOnly 호출", () => {
    const onToggleChildcareGoodOnly = vi.fn();
    render(<DetailPanel {...makeProps({ childcareGoodOnly: true, onToggleChildcareGoodOnly })} />);
    expect(screen.getByLabelText("육아 인프라 좋은 곳만(어린이집 5개+ · 500m 이내)")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.click(screen.getByLabelText("점수/시공사/혜택/역세권/학군/DSR/규제/치안/육아/주차/병원/공원 초기화"));
    expect(onToggleChildcareGoodOnly).toHaveBeenCalledTimes(1);
  });

  // 주차넉넉 토글 클릭 시 onToggleParkingGoodOnly 콜백 (세션 477)
  it("주차넉넉 토글 클릭 시 onToggleParkingGoodOnly 호출", () => {
    const onToggleParkingGoodOnly = vi.fn();
    render(<DetailPanel {...makeProps({ onToggleParkingGoodOnly })} />);
    fireEvent.click(screen.getByLabelText("주차 넉넉한 곳만(1.5대/세대 이상)"));
    expect(onToggleParkingGoodOnly).toHaveBeenCalledTimes(1);
  });

  // parkingGoodOnly=true → aria-pressed=true + 초기화 시 호출 (세션 477)
  it("parkingGoodOnly=true이면 aria-pressed=true이고 초기화 시 onToggleParkingGoodOnly 호출", () => {
    const onToggleParkingGoodOnly = vi.fn();
    render(<DetailPanel {...makeProps({ parkingGoodOnly: true, onToggleParkingGoodOnly })} />);
    expect(screen.getByLabelText("주차 넉넉한 곳만(1.5대/세대 이상)")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByLabelText("점수/시공사/혜택/역세권/학군/DSR/규제/치안/육아/주차/병원/공원 초기화"));
    expect(onToggleParkingGoodOnly).toHaveBeenCalledTimes(1);
  });

  // 병원가까움 토글 클릭 시 onToggleHospitalNearOnly 콜백 (세션 479)
  it("병원가까움 토글 클릭 시 onToggleHospitalNearOnly 호출", () => {
    const onToggleHospitalNearOnly = vi.fn();
    render(<DetailPanel {...makeProps({ onToggleHospitalNearOnly })} />);
    fireEvent.click(screen.getByLabelText("병원 도보권만(500m 이내)"));
    expect(onToggleHospitalNearOnly).toHaveBeenCalledTimes(1);
  });

  // hospitalNearOnly=true → aria-pressed=true + 초기화 시 호출 (세션 479)
  it("hospitalNearOnly=true이면 aria-pressed=true이고 초기화 시 onToggleHospitalNearOnly 호출", () => {
    const onToggleHospitalNearOnly = vi.fn();
    render(<DetailPanel {...makeProps({ hospitalNearOnly: true, onToggleHospitalNearOnly })} />);
    expect(screen.getByLabelText("병원 도보권만(500m 이내)")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByLabelText("점수/시공사/혜택/역세권/학군/DSR/규제/치안/육아/주차/병원/공원 초기화"));
    expect(onToggleHospitalNearOnly).toHaveBeenCalledTimes(1);
  });

  // 공원가까움 토글 클릭 시 onToggleParkNearOnly 콜백 (세션 479)
  it("공원가까움 토글 클릭 시 onToggleParkNearOnly 호출", () => {
    const onToggleParkNearOnly = vi.fn();
    render(<DetailPanel {...makeProps({ onToggleParkNearOnly })} />);
    fireEvent.click(screen.getByLabelText("공원 도보권만(500m 이내)"));
    expect(onToggleParkNearOnly).toHaveBeenCalledTimes(1);
  });

  // parkNearOnly=true → aria-pressed=true + 초기화 시 호출 (세션 479)
  it("parkNearOnly=true이면 aria-pressed=true이고 초기화 시 onToggleParkNearOnly 호출", () => {
    const onToggleParkNearOnly = vi.fn();
    render(<DetailPanel {...makeProps({ parkNearOnly: true, onToggleParkNearOnly })} />);
    expect(screen.getByLabelText("공원 도보권만(500m 이내)")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByLabelText("점수/시공사/혜택/역세권/학군/DSR/규제/치안/육아/주차/병원/공원 초기화"));
    expect(onToggleParkNearOnly).toHaveBeenCalledTimes(1);
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
