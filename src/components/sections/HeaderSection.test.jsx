import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HeaderSection } from "./HeaderSection";

describe("HeaderSection", () => {
  const defaultProps = {
    profile: "live",
    onProfileChange: vi.fn(),
    apartmentCount: 42,
  };

  // 타이틀과 단지 수 표시
  it("헤더 타이틀과 단지 수를 표시", () => {
    render(<HeaderSection {...defaultProps} />);
    expect(screen.getByText("전국 미분양 비교 엔진")).toBeInTheDocument();
    expect(screen.getByText(/42개 단지/)).toBeInTheDocument();
  });

  // v3.0 뱃지
  it("v3.0 뱃지가 표시됨", () => {
    render(<HeaderSection {...defaultProps} />);
    expect(screen.getByText("v3.0")).toBeInTheDocument();
  });

  // 프로필 버튼 5개 렌더링
  it("5개 프로필 버튼이 렌더링됨", () => {
    render(<HeaderSection {...defaultProps} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(5);
    expect(screen.getByText("실거주")).toBeInTheDocument();
    expect(screen.getByText("투자")).toBeInTheDocument();
    expect(screen.getByText("신혼부부")).toBeInTheDocument();
    expect(screen.getByText("자녀교육")).toBeInTheDocument();
    expect(screen.getByText("은퇴")).toBeInTheDocument();
  });

  // 현재 프로필 활성 상태 (aria-pressed)
  it("현재 프로필 버튼에 aria-pressed=true", () => {
    render(<HeaderSection {...defaultProps} profile="invest" />);
    const investBtn = screen.getByText("투자").closest("button");
    expect(investBtn.getAttribute("aria-pressed")).toBe("true");

    const liveBtn = screen.getByText("실거주").closest("button");
    expect(liveBtn.getAttribute("aria-pressed")).toBe("false");
  });

  // 프로필 버튼 클릭 시 onProfileChange 호출
  it("프로필 버튼 클릭 시 해당 키로 콜백 호출", () => {
    const onChange = vi.fn();
    render(<HeaderSection {...defaultProps} onProfileChange={onChange} />);
    fireEvent.click(screen.getByText("투자"));
    expect(onChange).toHaveBeenCalledWith("invest");
  });

  // apartmentCount 0일 때
  it("단지 수 0일 때도 정상 렌더링", () => {
    render(<HeaderSection {...defaultProps} apartmentCount={0} />);
    expect(screen.getByText(/0개 단지/)).toBeInTheDocument();
  });
});
