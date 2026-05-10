// @ts-check
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BottomNav } from "./BottomNav";

/** @returns {any} */
function makeProps(overrides = {}) {
  return {
    tab: "list",
    expertLoggedIn: false,
    showComp: false,
    onNavClick: vi.fn(),
    containerMaxWidth: 520,
    isDesktop: false,
    ...overrides,
  };
}

describe("BottomNav", () => {
  // 데스크톱에서 숨김 (return null)
  it("데스크톱(isDesktop=true)에서 렌더링하지 않음", () => {
    const { container } = render(<BottomNav {...makeProps({ isDesktop: true })} />);
    expect(container.innerHTML).toBe("");
  });

  // 모바일에서 정상 렌더
  it("모바일(isDesktop=false)에서 nav 렌더링", () => {
    render(<BottomNav {...makeProps({ isDesktop: false })} />);
    expect(screen.getByLabelText("메인 내비게이션")).toBeInTheDocument();
  });

  // 일반 사용자 — 4개 네비 항목 (기존 + 지도 = 5개)
  it("일반 사용자는 목록/비교/상담/정보 표시", () => {
    render(<BottomNav {...makeProps()} />);
    expect(screen.getByText("목록")).toBeInTheDocument();
    expect(screen.getByText("비교")).toBeInTheDocument();
    expect(screen.getByText("상담")).toBeInTheDocument();
    expect(screen.getByText("정보")).toBeInTheDocument();
  });

  // 전문가 로그인 시 — 다른 4개 네비 항목
  it("전문가 로그인 시 대시보드/상담목록/소비자뷰/로그아웃 표시", () => {
    render(<BottomNav {...makeProps({ expertLoggedIn: true, tab: "expert" })} />);
    expect(screen.getByText("대시보드")).toBeInTheDocument();
    expect(screen.getByText("상담목록")).toBeInTheDocument();
    expect(screen.getByText("소비자뷰")).toBeInTheDocument();
    expect(screen.getByText("로그아웃")).toBeInTheDocument();
  });

  // 활성 탭에 aria-current="page"
  it("현재 탭에 aria-current=page 설정", () => {
    render(<BottomNav {...makeProps({ tab: "list" })} />);
    const listBtn = screen.getByText("목록").closest("button");
    expect(listBtn?.getAttribute("aria-current")).toBe("page");
  });

  // 비활성 탭에는 aria-current 없음
  it("비활성 탭에는 aria-current 없음", () => {
    render(<BottomNav {...makeProps({ tab: "list" })} />);
    const infoBtn = screen.getByText("정보").closest("button");
    expect(infoBtn?.getAttribute("aria-current")).toBeNull();
  });

  // 버튼 클릭 시 onNavClick 호출
  it("네비 버튼 클릭 시 해당 키로 onNavClick 호출", () => {
    const onNavClick = vi.fn();
    render(<BottomNav {...makeProps({ onNavClick })} />);
    fireEvent.click(screen.getByText("정보"));
    expect(onNavClick).toHaveBeenCalledWith("info");
  });

  // 비교 탭 — showComp && tab=list일 때 활성
  it("비교 탭은 showComp=true && tab=list일 때 활성 스타일 적용", () => {
    render(<BottomNav {...makeProps({ tab: "list", showComp: true })} />);
    // 비교 버튼에는 aria-current가 "compare"이므로 설정 안됨 (compare는 특수 처리)
    const compBtn = screen.getByText("비교").closest("button");
    // compare는 aria-current 대상 아님 (["compare", "logout"] 제외)
    expect(compBtn?.getAttribute("aria-current")).toBeNull();
  });

  // nav 랜드마크 존재
  it("nav 요소에 aria-label 설정", () => {
    render(<BottomNav {...makeProps()} />);
    expect(screen.getByLabelText("메인 내비게이션")).toBeInTheDocument();
  });

  // 전문가 로그아웃 클릭
  it("로그아웃 클릭 시 onNavClick('logout') 호출", () => {
    const onNavClick = vi.fn();
    render(<BottomNav {...makeProps({ expertLoggedIn: true, tab: "expert", onNavClick })} />);
    fireEvent.click(screen.getByText("로그아웃"));
    expect(onNavClick).toHaveBeenCalledWith("logout");
  });

  // ── upcomingEnabled (Feature Flag) 분기 ─────────────────────────────
  describe("VITE_FEATURE_UPCOMING flag", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("VITE_FEATURE_UPCOMING=true 일반 사용자: '📅 곧 분양' 표시", () => {
      vi.stubEnv("VITE_FEATURE_UPCOMING", "true");
      render(<BottomNav {...makeProps()} />);
      expect(screen.getByText("📅 곧 분양")).toBeInTheDocument();
    });

    it("VITE_FEATURE_UPCOMING=true 클릭 시 onNavClick('upcoming') 호출", () => {
      vi.stubEnv("VITE_FEATURE_UPCOMING", "true");
      const onNavClick = vi.fn();
      render(<BottomNav {...makeProps({ onNavClick })} />);
      fireEvent.click(screen.getByText("📅 곧 분양"));
      expect(onNavClick).toHaveBeenCalledWith("upcoming");
    });

    it("VITE_FEATURE_UPCOMING 미설정 시 '📅 곧 분양' 미표시 (회귀 가드)", () => {
      vi.stubEnv("VITE_FEATURE_UPCOMING", "");
      render(<BottomNav {...makeProps()} />);
      expect(screen.queryByText("📅 곧 분양")).toBeNull();
    });

    it("VITE_FEATURE_UPCOMING=true 전문가 로그인 시 '📅 곧 분양' 미표시", () => {
      vi.stubEnv("VITE_FEATURE_UPCOMING", "true");
      render(<BottomNav {...makeProps({ expertLoggedIn: true, tab: "expert" })} />);
      expect(screen.queryByText("📅 곧 분양")).toBeNull();
    });
  });
});
