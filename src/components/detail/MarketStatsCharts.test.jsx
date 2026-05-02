import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockUseMarketStatsHistory = vi.fn();

vi.mock("@/hooks/useMarketStatsHistory", () => ({
  useMarketStatsHistory: (...args) => mockUseMarketStatsHistory(...args),
}));

vi.mock("@/components/primitives", () => ({
  LineChart: (props) => <div data-testid="line-chart" aria-label={props.yLabel} />,
}));

import { MarketStatsCharts } from "./MarketStatsCharts";

const makeRows = () => [
  { base_month: "202501", avg_price_sqm: 100, price_index: 101, new_supply: 20, initial_sale_rate: 80, land_cost_ratio: 35 },
  { base_month: "202502", avg_price_sqm: 110, price_index: 102, new_supply: 30, initial_sale_rate: 82, land_cost_ratio: 36 },
];

describe("MarketStatsCharts", () => {
  beforeEach(() => {
    mockUseMarketStatsHistory.mockReset();
  });

  it("region이 없으면 렌더링하지 않는다", () => {
    mockUseMarketStatsHistory.mockReturnValue({ data: [], loading: false, error: null, retry: vi.fn() });
    const { container } = render(<MarketStatsCharts region="" gu="" />);
    expect(container.innerHTML).toBe("");
  });

  it("loading 상태를 표시한다", () => {
    mockUseMarketStatsHistory.mockReturnValue({ data: [], loading: true, error: null, retry: vi.fn() });
    render(<MarketStatsCharts region="서울" gu="강남구" />);
    expect(screen.getByText("시장 통계를 불러오는 중...")).toBeTruthy();
  });

  it("error 상태와 재시도를 표시한다", () => {
    const retry = vi.fn();
    mockUseMarketStatsHistory.mockReturnValue({ data: [], loading: false, error: "fail", retry });
    render(<MarketStatsCharts region="서울" gu="강남구" />);
    expect(screen.getByText("시장 통계를 불러올 수 없습니다")).toBeTruthy();
    fireEvent.click(screen.getByText("다시시도"));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("data가 부족하면 안내 상태를 표시한다", () => {
    mockUseMarketStatsHistory.mockReturnValue({ data: [], loading: false, error: null, retry: vi.fn() });
    render(<MarketStatsCharts region="서울" gu="강남구" />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("정상 데이터면 5개 차트를 렌더링한다", () => {
    mockUseMarketStatsHistory.mockReturnValue({ data: makeRows(), loading: false, error: null, retry: vi.fn() });
    render(<MarketStatsCharts region="서울" gu="강남구" />);
    expect(screen.getAllByTestId("line-chart")).toHaveLength(5);
  });
});
