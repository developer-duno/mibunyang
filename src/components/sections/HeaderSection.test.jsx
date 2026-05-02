import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HeaderSection } from "./HeaderSection";

describe("HeaderSection", () => {
  const defaultProps = {
    profile: "live",
    onProfileChange: vi.fn(),
    apartmentCount: 42,
    isDesktop: false,
    tab: "list",
    onNavClick: vi.fn(),
    showComp: false,
    compCount: 0,
    expertLoggedIn: false,
    containerMaxWidth: 520,
  };

  // 모바일: 타이틀과 단지 수 표시
  it("모바일: 헤더 타이틀과 단지 수를 표시", () => {
    render(<HeaderSection {...defaultProps} />);
    expect(screen.getByText("전국 미분양 비교 엔진")).toBeInTheDocument();
    expect(screen.getByText(/42개 단지/)).toBeInTheDocument();
  });

  // 모바일: v3.0 뱃지
  it("모바일: v3.0 뱃지가 표시됨", () => {
    render(<HeaderSection {...defaultProps} />);
    expect(screen.getByText("v3.0")).toBeInTheDocument();
  });

  // 데스크톱: 상단 바 렌더링
  it("데스크톱: 고정 상단 바에 로고와 네비 표시", () => {
    render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} />);
    expect(screen.getByText("미분양 비교")).toBeInTheDocument();
    expect(screen.getByText(/42개 단지/)).toBeInTheDocument();
    expect(screen.getByText("목록")).toBeInTheDocument();
    expect(screen.getByText("지도")).toBeInTheDocument();
    expect(screen.getByText("상담")).toBeInTheDocument();
    expect(screen.getByText("정보")).toBeInTheDocument();
  });

  // 데스크톱: 모바일 그라디언트 표시 안 함
  it("데스크톱: 모바일 전용 타이틀 미표시", () => {
    render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} />);
    expect(screen.queryByText("전국 미분양 비교 엔진")).not.toBeInTheDocument();
    expect(screen.queryByText("v3.0")).not.toBeInTheDocument();
  });

  // 프로필 버튼 5개 렌더링
  it("5개 프로필 버튼이 렌더링됨", () => {
    render(<HeaderSection {...defaultProps} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(6); // 5개 프로필 + 도움말 버튼
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

  // § 5-5: upcomingCount prop — Feature Flag ON (테스트 env) 기준
  it("§ 5-5: upcomingCount=392 → '📅 곧 분양 392개' 라벨", () => {
    render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} upcomingCount={392} />);
    expect(screen.getByText("📅 곧 분양 392개")).toBeInTheDocument();
  });

  it("§ 5-5: upcomingCount=null → '📅 곧 분양' (숫자 fallback)", () => {
    render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} upcomingCount={null} />);
    expect(screen.getByText("📅 곧 분양")).toBeInTheDocument();
    expect(screen.queryByText(/곧 분양 \d+개/)).not.toBeInTheDocument();
  });

  it("§ 5-5: upcomingCount=0 → '📅 곧 분양' (0건은 N개 미표기)", () => {
    render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} upcomingCount={0} />);
    expect(screen.getByText("📅 곧 분양")).toBeInTheDocument();
  });

  it("§ 5-5: upcomingCount prop 미전달 (undefined) 도 안전", () => {
    expect(() => {
      render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} />);
    }).not.toThrow();
  });

  // 전문가 로그인 상태에서도 '곧 분양' 메뉴 노출 (운영자 본인 사용성 — 세션 168 사용자 보고)
  it("expertLoggedIn=true 분기에도 '📅 곧 분양 N개' 노출", () => {
    render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} expertLoggedIn={true} upcomingCount={392} />);
    expect(screen.getByText("📅 곧 분양 392개")).toBeInTheDocument();
    // 동시에 전문가 전용 메뉴도 그대로
    expect(screen.getByText("대시보드")).toBeInTheDocument();
    expect(screen.getByText("상담목록")).toBeInTheDocument();
    expect(screen.getByText("소비자뷰")).toBeInTheDocument();
  });
});
