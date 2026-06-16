// @ts-check
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HomePage } from "./HomePage";
import { trackEvent } from "@/lib/analytics";

// M3: analytics 격리 — trackEvent 호출만 검증 (벤더 @vercel/analytics 무력화)
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const baseProps = () => ({
  scored: [], filtered: [], pw: /** @type {any} */ ({}),
  upcomingData: null, upcomingError: false, onRetryUpcoming: vi.fn(),
  isLoggedIn: false, isDesktop: false, isPC: false,
  dataLoading: false, dataFreshnessText: null,
  onNavClick: vi.fn(), onMarketNav: vi.fn(), onDetail: vi.fn(),
  onFav: vi.fn(), favoriteSet: new Set(), onComp: vi.fn(), compIds: [],
  recentIds: [], scoredMap: new Map(), onClearRecent: vi.fn(),
});

/** 최소 ScoredApt — RecentlyViewedWidget 카드 렌더용 (TopPicksWidget.test 답습) */
function makeScored(/** @type {string} */ id, /** @type {string} */ name) {
  const cat = (/** @type {string} */ label, /** @type {number} */ t) => ({ label, total: t, subs: [] });
  return /** @type {any} */ ({
    apt: { id, name, region: "경기", gu: "수원시", price: 50000, area: 84, noxious: [] },
    res: { total: 80, cats: { price: cat("가격", 70), location: cat("입지", 60), product: cat("상품성", 55), benefit: { label: "혜택", total: 50, subs: [], totalWon: 0 }, risk: cat("안전", 65), future: cat("미래", 45) } },
  });
}

describe("HomePage", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("로딩 중(apartments 미도착): 전체 스켈레톤", () => {
    const { container } = render(<HomePage {...baseProps()} dataLoading={true} />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(screen.queryByText("📊 시장 요약")).toBeNull();
  });
  it("위젯 그리드: 지도·추천·시장요약 렌더 + auto-fit minmax (세션387 답습)", () => {
    const { container } = render(<HomePage {...baseProps()} />);
    expect(screen.getByText("🗺 지도")).toBeInTheDocument();
    expect(screen.getByText("⭐ 추천 TOP 3")).toBeInTheDocument();
    expect(screen.getByText("📊 시장 요약")).toBeInTheDocument();
    const grid = container.querySelector('[data-testid="home-grid"]');
    expect(grid && /** @type {HTMLElement} */ (grid).style.gridTemplateColumns).toContain("minmax");
  });
  it("VITE_FEATURE_UPCOMING OFF: 곧분양 위젯 미노출 (이중 플래그 의존)", () => {
    vi.stubEnv("VITE_FEATURE_UPCOMING", "");
    render(<HomePage {...baseProps()} />);
    expect(screen.queryByText("📅 곧 분양")).toBeNull();
  });
  it("VITE_FEATURE_UPCOMING ON: 곧분양 위젯 노출", () => {
    vi.stubEnv("VITE_FEATURE_UPCOMING", "true");
    render(<HomePage {...baseProps()} />);
    expect(screen.getByText("📅 곧 분양")).toBeInTheDocument();
  });

  it("최근 본 단지 없음(recentIds=[]): 위젯 미노출", () => {
    render(<HomePage {...baseProps()} />);
    expect(screen.queryByText("👀 최근 본 단지")).toBeNull();
  });

  it("최근 본 단지 있음(scoredMap 매칭): 위젯 노출 + 카드 렌더", () => {
    const s = makeScored("a1", "최근단지");
    render(<HomePage {...baseProps()} recentIds={["a1"]} scoredMap={new Map([["a1", s]])} />);
    expect(screen.getByText("👀 최근 본 단지")).toBeInTheDocument();
    expect(screen.getByText(/최근단지/)).toBeInTheDocument();
  });

  it("최근 본 id 가 scoredMap 에 전부 없으면(삭제된 단지) 위젯 미노출", () => {
    render(<HomePage {...baseProps()} recentIds={["gone-1"]} scoredMap={new Map()} />);
    expect(screen.queryByText("👀 최근 본 단지")).toBeNull();
  });
});

describe("HomePage analytics (M3)", () => {
  afterEach(() => { vi.unstubAllEnvs(); /** @type {any} */ (trackEvent).mockClear(); });

  it("추천 위젯 '전체 목록' 클릭 → home_widget_expand{toppicks} + onNavClick(list)", () => {
    const onNavClick = vi.fn();
    render(<HomePage {...baseProps()} onNavClick={onNavClick} />);
    fireEvent.click(screen.getByText("전체 목록 →"));
    expect(trackEvent).toHaveBeenCalledWith("home_widget_expand", { widget: "toppicks" });
    expect(onNavClick).toHaveBeenCalledWith("list");
  });

  it("지도 위젯 '크게 보기'(로그인) 클릭 → home_widget_expand{map} + onNavClick(map)", () => {
    const onNavClick = vi.fn();
    render(<HomePage {...baseProps()} isLoggedIn={true} onNavClick={onNavClick} />);
    fireEvent.click(screen.getByText("크게 보기 →"));
    expect(trackEvent).toHaveBeenCalledWith("home_widget_expand", { widget: "map" });
    expect(onNavClick).toHaveBeenCalledWith("map");
  });

  it("곧분양 위젯 '전체 일정' 클릭 → home_widget_expand{upcoming} + onNavClick(upcoming)", () => {
    vi.stubEnv("VITE_FEATURE_UPCOMING", "true");
    const onNavClick = vi.fn();
    render(<HomePage {...baseProps()} onNavClick={onNavClick} />);
    fireEvent.click(screen.getByText("전체 일정 →"));
    expect(trackEvent).toHaveBeenCalledWith("home_widget_expand", { widget: "upcoming" });
    expect(onNavClick).toHaveBeenCalledWith("upcoming");
  });

  it("시장요약 '미분양률 중위' 칸 클릭 → home_market_nav{미분양률 중위} + onMarketNav(list, unsoldRate)", () => {
    const onMarketNav = vi.fn();
    // scored=[] 로 추천 위젯의 AptCard 렌더 회피(시장요약 칸 nav 는 값과 무관하게 항상 button)
    render(<HomePage {...baseProps()} onMarketNav={onMarketNav} />);
    fireEvent.click(screen.getByRole("button", { name: /미분양률 중위/ }));
    expect(trackEvent).toHaveBeenCalledWith("home_market_nav", { cell: "미분양률 중위" });
    expect(onMarketNav).toHaveBeenCalledWith("list", "unsoldRate");
  });

  it("home-grid 가 320px 안전 minmax(min(300px,100%),1fr) 적용", () => {
    const { container } = render(<HomePage {...baseProps()} />);
    const grid = /** @type {HTMLElement} */ (container.querySelector('[data-testid="home-grid"]'));
    expect(grid.style.gridTemplateColumns).toContain("min(300px, 100%)");
  });
});
