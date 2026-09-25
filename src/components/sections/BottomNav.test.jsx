// @ts-check
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BottomNav } from "./BottomNav";

/** @returns {any} */
function makeProps(overrides = {}) {
  return {
    tab: "list",
    adminLoggedIn: false,
    onNavClick: vi.fn(),
    containerMaxWidth: 520,
    isDesktop: false,
    ...overrides,
  };
}

/** 네비 버튼 글자 배열 */
function navTexts() {
  return screen.getAllByRole("button").map((b) => b.textContent);
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

  // 세션 577(A-12): 손님 = 목록·지도·(📅 곧 분양)·문의 4탭 — PC 헤더와 같은 배열
  it("손님 + 곧 분양 ON: 목록·지도·📅 곧 분양·문의 4탭", () => {
    vi.stubEnv("VITE_FEATURE_UPCOMING", "true");
    render(<BottomNav {...makeProps()} />);
    expect(navTexts()).toEqual(["목록", "지도", "📅 곧 분양", "문의"]);
    vi.unstubAllEnvs();
  });

  it("손님 + 곧 분양 OFF: 목록·지도·문의 3탭", () => {
    vi.stubEnv("VITE_FEATURE_UPCOMING", "");
    render(<BottomNav {...makeProps()} />);
    expect(navTexts()).toEqual(["목록", "지도", "문의"]);
    vi.unstubAllEnvs();
  });

  // 관리자 로그인 시 — 관리자 네비 (세션 405 — 구 전문가 네비 대체)
  it("관리자 로그인 시 관리자/소비자뷰/지도/로그아웃 표시", () => {
    render(<BottomNav {...makeProps({ adminLoggedIn: true, tab: "admin" })} />);
    expect(navTexts()).toEqual(["관리자", "소비자뷰", "지도", "로그아웃"]);
    expect(screen.getByText("관리자")).toBeInTheDocument();
    expect(screen.getByText("소비자뷰")).toBeInTheDocument();
    expect(screen.getByText("지도")).toBeInTheDocument();
    expect(screen.getByText("로그아웃")).toBeInTheDocument();
    expect(screen.queryByText("대시보드")).toBeNull();
    expect(screen.queryByText("상담목록")).toBeNull();
  });

  // 카카오 손님(토큰 보유, adminLoggedIn=false) = 게스트 네비 — 전문가 네비 오노출 quirk 해소 가드 (세션 405)
  it("카카오 손님은 게스트 네비를 본다 (관리자 항목 미노출)", () => {
    render(<BottomNav {...makeProps({ adminLoggedIn: false })} />);
    expect(screen.getByText("목록")).toBeInTheDocument();
    expect(screen.queryByText("관리자")).toBeNull();
    expect(screen.queryByText("소비자뷰")).toBeNull();
    expect(screen.queryByText("로그아웃")).toBeNull();
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
    const mapBtn = screen.getByText("지도").closest("button");
    expect(mapBtn?.getAttribute("aria-current")).toBeNull();
  });

  // 버튼 클릭 시 onNavClick 호출
  it("네비 버튼 클릭 시 해당 키로 onNavClick 호출", () => {
    const onNavClick = vi.fn();
    render(<BottomNav {...makeProps({ onNavClick })} />);
    fireEvent.click(screen.getByText("문의"));
    expect(onNavClick.mock.calls).toEqual([["inquiry"]]);
  });

  // 문의는 탭이 아니라 모달 — aria-current 가 붙지 않는다
  it("문의 버튼에는 aria-current 없음", () => {
    render(<BottomNav {...makeProps({ tab: "list" })} />);
    expect(screen.getByText("문의").closest("button")?.getAttribute("aria-current")).toBeNull();
  });

  // nav 랜드마크 존재
  it("nav 요소에 aria-label 설정", () => {
    render(<BottomNav {...makeProps()} />);
    expect(screen.getByLabelText("메인 내비게이션")).toBeInTheDocument();
  });

  // 관리자 로그아웃 클릭
  it("로그아웃 클릭 시 onNavClick('logout') 호출", () => {
    const onNavClick = vi.fn();
    render(<BottomNav {...makeProps({ adminLoggedIn: true, tab: "admin", onNavClick })} />);
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

    it("VITE_FEATURE_UPCOMING=true 관리자 로그인 시 '📅 곧 분양' 미표시 (모바일 관리자 네비)", () => {
      vi.stubEnv("VITE_FEATURE_UPCOMING", "true");
      render(<BottomNav {...makeProps({ adminLoggedIn: true, tab: "admin" })} />);
      expect(screen.queryByText("📅 곧 분양")).toBeNull();
    });
  });

  // ── 세션 577(A-12): 홈 깃발(VITE_FEATURE_HOME)을 켜도 홈이 없다 — 손님 4탭 ─────────────
  describe("VITE_FEATURE_HOME flag", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("ON + UPCOMING ON 손님: 4탭(목록·지도·📅 곧 분양·문의), 홈·비교·상담·정보 없음", () => {
      vi.stubEnv("VITE_FEATURE_HOME", "true");
      vi.stubEnv("VITE_FEATURE_UPCOMING", "true");
      render(<BottomNav {...makeProps()} />);
      expect(navTexts()).toEqual(["목록", "지도", "📅 곧 분양", "문의"]);
      for (const t of ["홈", "비교", "상담", "정보"]) expect(screen.queryByText(t)).toBeNull();
    });

    it("ON 관리자: 홈 없이 관리자·소비자뷰·지도·로그아웃", () => {
      vi.stubEnv("VITE_FEATURE_HOME", "true");
      render(<BottomNav {...makeProps({ adminLoggedIn: true, tab: "admin" })} />);
      expect(navTexts()).toEqual(["관리자", "소비자뷰", "지도", "로그아웃"]);
    });
  });
});
