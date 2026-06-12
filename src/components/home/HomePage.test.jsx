// @ts-check
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomePage } from "./HomePage";

const baseProps = () => ({
  scored: [], pw: /** @type {any} */ ({}),
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
