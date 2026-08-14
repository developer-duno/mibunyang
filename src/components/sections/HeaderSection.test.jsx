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
    showComp: false,
    compCount: 0,
    adminLoggedIn: false,
    isLoggedIn: false,
    containerMaxWidth: 520,
  };

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

  /**
   * 세션 513 — 도움말의 미래가치 줄이 옛 산식("교통개발(GTX·KTX)")을 말하고 있었다.
   * 세션511 재설계 후 노선급 표(TRANSIT_GRADE)에 KTX 는 없다 — KTX 거리는 입지 축이 잰다.
   * ⚠️ 도움말 하단 "도시등급별 교통 보정" 각주의 KTX 는 **참**이므로 전체 텍스트로 금지하면
   *    안 된다. 미래가치 줄 하나만 좁혀서 본다.
   */
  describe("도움말 — 미래가치 설명이 실제 산식과 맞는다", () => {
    /** 도움말을 열고 '미래가치' 항목 한 줄의 글자만 뽑는다 */
    function futureRowText() {
      render(<HeaderSection {...defaultProps} />);
      fireEvent.click(screen.getByLabelText("도움말"));
      const label = screen.getByText("미래가치");
      return label.parentElement?.textContent || "";
    }

    it("미래가치 줄에 KTX 가 없다", () => {
      expect(futureRowText()).not.toContain("KTX");
    });

    it("미래가치 줄이 도시개발을 LH 지구 거리로 설명한다", () => {
      expect(futureRowText()).toContain("LH 지구 거리");
    });
  });

  // 통합 홈 (VITE_FEATURE_HOME) — 데스크톱 네비 홈 항목
  describe("VITE_FEATURE_HOME flag", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("ON 데스크톱: '홈' 네비 렌더 + 클릭 시 onNavClick('home')", () => {
      vi.stubEnv("VITE_FEATURE_HOME", "true");
      const onNavClick = vi.fn();
      render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} onNavClick={onNavClick} />);
      fireEvent.click(screen.getByRole("button", { name: "홈" }));
      expect(onNavClick).toHaveBeenCalledWith("home");
    });

    it("ON 데스크톱: 비교·상담은 유지 (D4 — 재배열은 모바일만)", () => {
      vi.stubEnv("VITE_FEATURE_HOME", "true");
      render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} />);
      expect(screen.getByText("비교")).toBeInTheDocument();
      expect(screen.getByText("상담")).toBeInTheDocument();
    });

    it("OFF: '홈' 미노출 (회귀 가드)", () => {
      vi.stubEnv("VITE_FEATURE_HOME", "");
      render(<HeaderSection {...defaultProps} isDesktop={true} containerMaxWidth={1200} />);
      expect(screen.queryByRole("button", { name: "홈" })).toBeNull();
    });
  });
});
