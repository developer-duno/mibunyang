// @ts-check
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HeaderSection } from "./HeaderSection";

describe("HeaderSection", () => {
  /** @type {any} */
  const defaultProps = {
    profile: "live",
    onProfileChange: vi.fn(),
    apartmentCount: 42,
    isDesktop: false,
    tab: "list",
    onNavClick: vi.fn(),
    adminLoggedIn: false,
    isLoggedIn: false,
    containerMaxWidth: 520,
    // 도움말(?) 패널 = InfoPage (세션 577)
    onAdminLoginClick: vi.fn(),
    onKakaoLogin: vi.fn(),
    kakaoLoading: false,
    onLogout: vi.fn(),
  };

  const PROFILE_NAMES = ["실거주", "투자", "신혼부부", "자녀교육", "은퇴"];
  /** 데스크톱 헤더의 네비 버튼 글자 배열 — 프로필·도움말(글자 없음)·로그아웃 버튼은 뺀다 */
  function navTexts() {
    return screen
      .getAllByRole("button")
      .map((b) => b.textContent || "")
      .filter((t) => t !== "" && t !== "로그아웃" && !PROFILE_NAMES.includes(t));
  }

  afterEach(() => vi.unstubAllEnvs());

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
    expect(screen.getByText("문의")).toBeInTheDocument();
  });

  // 세션 577(A-12): 손님 메뉴 = 목록·지도·(📅 곧 분양)·문의 4개 — 휴대폰 BottomNav 와 같은 배열
  it("데스크톱 손님 + 곧 분양 ON: 네비 = 목록·지도·📅 곧 분양·문의", () => {
    vi.stubEnv("VITE_FEATURE_UPCOMING", "true");
    render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} />);
    expect(navTexts()).toEqual(["목록", "지도", "📅 곧 분양", "문의"]);
  });

  it("데스크톱 손님 + 곧 분양 OFF: 네비 = 목록·지도·문의", () => {
    vi.stubEnv("VITE_FEATURE_UPCOMING", "");
    render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} />);
    expect(navTexts()).toEqual(["목록", "지도", "문의"]);
  });

  it("데스크톱 '문의' 클릭 → onNavClick('inquiry') + 문의에는 aria-current 없음", () => {
    const onNavClick = vi.fn();
    render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} onNavClick={onNavClick} />);
    const btn = screen.getByRole("button", { name: "문의" });
    fireEvent.click(btn);
    expect(onNavClick.mock.calls).toEqual([["inquiry"]]);
    expect(btn.getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("button", { name: "목록" }).getAttribute("aria-current")).toBe("page");
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
    expect(investBtn?.getAttribute("aria-pressed")).toBe("true");

    const liveBtn = screen.getByText("실거주").closest("button");
    expect(liveBtn?.getAttribute("aria-pressed")).toBe("false");
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

  // § 5-5: upcomingCount prop — VITE_FEATURE_UPCOMING 은 stubEnv 로 명시적으로 켠다.
  // CI(ci.yml Test 스텝 env 주입)에만 기대면 로컬 실행이 4건 빨강 (세션 494, BottomNav.test.jsx 패턴)
  it("§ 5-5: upcomingCount=392 → '📅 곧 분양 392개' 라벨", () => {
    vi.stubEnv("VITE_FEATURE_UPCOMING", "true");
    render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} upcomingCount={392} />);
    expect(screen.getByText("📅 곧 분양 392개")).toBeInTheDocument();
  });

  it("§ 5-5: upcomingCount=null → '📅 곧 분양' (숫자 fallback)", () => {
    vi.stubEnv("VITE_FEATURE_UPCOMING", "true");
    render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} upcomingCount={null} />);
    expect(screen.getByText("📅 곧 분양")).toBeInTheDocument();
    expect(screen.queryByText(/곧 분양 \d+개/)).not.toBeInTheDocument();
  });

  it("§ 5-5: upcomingCount=0 → '📅 곧 분양' (0건은 N개 미표기)", () => {
    vi.stubEnv("VITE_FEATURE_UPCOMING", "true");
    render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} upcomingCount={0} />);
    expect(screen.getByText("📅 곧 분양")).toBeInTheDocument();
  });

  it("§ 5-5: upcomingCount prop 미전달 (undefined) 도 안전", () => {
    expect(() => {
      render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} />);
    }).not.toThrow();
  });

  // 관리자 로그인 상태에서도 '곧 분양' 메뉴 노출 (운영자 본인 사용성 — 세션 168 답습, 세션 405 admin 축 전환)
  it("adminLoggedIn=true 분기에도 '📅 곧 분양 N개' 노출 + 관리자 네비", () => {
    vi.stubEnv("VITE_FEATURE_UPCOMING", "true");
    render(
      <HeaderSection
        {...defaultProps}
        isDesktop={true}
        containerMaxWidth={1200}
        adminLoggedIn={true}
        isLoggedIn={true}
        upcomingCount={392}
      />
    );
    expect(screen.getByText("📅 곧 분양 392개")).toBeInTheDocument();
    // 관리자 네비 (구 전문가 메뉴 대체)
    expect(screen.getByText("관리자")).toBeInTheDocument();
    expect(screen.getByText("소비자뷰")).toBeInTheDocument();
    expect(screen.queryByText("대시보드")).toBeNull();
    expect(screen.queryByText("상담목록")).toBeNull();
  });

  // 데스크톱 로그아웃 — isLoggedIn(공용 토큰 축) 게이트 (카카오 손님 포함, 세션 405 적대검증 보존)
  it("카카오 손님(isLoggedIn=true, adminLoggedIn=false)도 데스크톱 로그아웃 버튼이 보인다", () => {
    render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} isLoggedIn={true} />);
    expect(screen.getByText("로그아웃")).toBeInTheDocument();
    // 네비는 게스트 분기 (관리자 항목 미노출)
    expect(screen.queryByText("관리자")).toBeNull();
  });

  // 세션 577(A-12): 도움말(?) 패널 본문 = InfoPage 그대로 (정보 탭 폐지)
  describe("도움말 패널 = InfoPage", () => {
    it("비로그인: 소개·FAQ·카카오 로그인·관리자 로그인 링크가 보이고 전문가 상담 카드는 없다", () => {
      render(<HeaderSection {...defaultProps} />);
      fireEvent.click(screen.getByLabelText("도움말"));
      expect(screen.getByText("미분양 아파트 비교 엔진")).toBeInTheDocument();
      expect(screen.getByText("자주 묻는 질문")).toBeInTheDocument();
      expect(screen.getByText("카카오로 시작하기")).toBeInTheDocument();
      expect(screen.getByText("관리자 로그인")).toBeInTheDocument();
      expect(screen.queryByText("전문가 상담 신청")).toBeNull();
    });

    it("로그인: 패널 안에 로그아웃 버튼 + 클릭 시 onLogout", () => {
      const onLogout = vi.fn();
      render(<HeaderSection {...defaultProps} isLoggedIn={true} onLogout={onLogout} />);
      fireEvent.click(screen.getByLabelText("도움말"));
      fireEvent.click(screen.getByText("로그아웃"));
      expect(onLogout).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("카카오로 시작하기")).toBeNull();
    });

    it("'관리자 로그인' 링크 → 패널이 닫히고 onAdminLoginClick 1회", () => {
      const onAdminLoginClick = vi.fn();
      render(<HeaderSection {...defaultProps} onAdminLoginClick={onAdminLoginClick} />);
      fireEvent.click(screen.getByLabelText("도움말"));
      fireEvent.click(screen.getByText("관리자 로그인"));
      expect(onAdminLoginClick).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("자주 묻는 질문")).toBeNull();
    });
  });

  // 세션 577(A-12): 홈 깃발(VITE_FEATURE_HOME)을 켜도 메뉴에 홈이 없다 — 손님 4개 그대로
  it("VITE_FEATURE_HOME=true 여도 홈·비교·상담·정보 미노출 + 손님 4개", () => {
    vi.stubEnv("VITE_FEATURE_HOME", "true");
    vi.stubEnv("VITE_FEATURE_UPCOMING", "true");
    render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} />);
    expect(navTexts()).toEqual(["목록", "지도", "📅 곧 분양", "문의"]);
    for (const t of ["홈", "비교", "상담", "정보"]) expect(screen.queryByText(t)).toBeNull();
  });
});
