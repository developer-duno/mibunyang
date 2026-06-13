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
  onNavClick: vi.fn(), onDetail: vi.fn(),
  onFav: vi.fn(), favoriteSet: new Set(), onComp: vi.fn(), compIds: [],
});

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

  it("home-grid 가 320px 안전 minmax(min(300px,100%),1fr) 적용", () => {
    const { container } = render(<HomePage {...baseProps()} />);
    const grid = /** @type {HTMLElement} */ (container.querySelector('[data-testid="home-grid"]'));
    expect(grid.style.gridTemplateColumns).toContain("min(300px, 100%)");
  });
});
