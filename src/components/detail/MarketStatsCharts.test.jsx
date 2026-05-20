// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockUseMarketStatsHistory = vi.fn();

vi.mock("@/hooks/useMarketStatsHistory", () => ({
  useMarketStatsHistory: (/** @type {any[]} */ ...args) => mockUseMarketStatsHistory(...args),
}));

vi.mock("@/components/primitives", () => ({
  LineChart: (/** @type {any} */ props) => <div data-testid="line-chart" aria-label={props.yLabel} />,
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
    mockUseMarketStatsHistory.mockReturnValue({ data: [], loading: false, error: null, retry: vi.fn(), fallback: false });
    const { container } = render(<MarketStatsCharts region="" gu="" />);
    expect(container.innerHTML).toBe("");
  });

  it("loading 상태를 표시한다", () => {
    mockUseMarketStatsHistory.mockReturnValue({ data: [], loading: true, error: null, retry: vi.fn(), fallback: false });
    render(<MarketStatsCharts region="서울" gu="강남구" />);
    expect(screen.getByText("시장 통계를 불러오는 중...")).toBeTruthy();
  });

  it("error 상태와 재시도를 표시한다", () => {
    const retry = vi.fn();
    mockUseMarketStatsHistory.mockReturnValue({ data: [], loading: false, error: "fail", retry, fallback: false });
    render(<MarketStatsCharts region="서울" gu="강남구" />);
    expect(screen.getByText("시장 통계를 불러올 수 없습니다")).toBeTruthy();
    fireEvent.click(screen.getByText("다시시도"));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("data가 부족하면 안내 상태를 표시한다", () => {
    mockUseMarketStatsHistory.mockReturnValue({ data: [], loading: false, error: null, retry: vi.fn(), fallback: false });
    render(<MarketStatsCharts region="서울" gu="강남구" />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("정상 데이터면 5개 차트를 렌더링한다", () => {
    mockUseMarketStatsHistory.mockReturnValue({ data: makeRows(), loading: false, error: null, retry: vi.fn(), fallback: false });
    render(<MarketStatsCharts region="서울" gu="강남구" />);
    expect(screen.getAllByTestId("line-chart")).toHaveLength(5);
  });

  it("18행 모두 null 값만 있으면 안내 박스만 표시한다", () => {
    const nullRows = Array.from({ length: 18 }, (_, i) => ({
      base_month: `2024${String(i + 1).padStart(2, "0")}`,
      avg_price_sqm: null, price_index: null, new_supply: null,
      initial_sale_rate: null, land_cost_ratio: null,
    }));
    mockUseMarketStatsHistory.mockReturnValue({ data: nullRows, loading: false, error: null, retry: vi.fn(), fallback: false });
    render(<MarketStatsCharts region="인천" gu="서구" />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryAllByTestId("line-chart")).toHaveLength(0);
  });

  it("부분 null (1필드만 length>=2) 행이면 그 필드만 차트 렌더", () => {
    const partial = [
      { base_month: "202501", avg_price_sqm: 100, price_index: null, new_supply: null, initial_sale_rate: null, land_cost_ratio: null },
      { base_month: "202502", avg_price_sqm: 110, price_index: null, new_supply: null, initial_sale_rate: null, land_cost_ratio: null },
    ];
    mockUseMarketStatsHistory.mockReturnValue({ data: partial, loading: false, error: null, retry: vi.fn(), fallback: false });
    render(<MarketStatsCharts region="인천" gu="서구" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getAllByTestId("line-chart")).toHaveLength(1);
  });

  it("fallback=true 시 헤더에 시도 평균 표시", () => {
    mockUseMarketStatsHistory.mockReturnValue({ data: makeRows(), loading: false, error: null, retry: vi.fn(), fallback: true });
    render(<MarketStatsCharts region="인천" gu="서구" />);
    expect(screen.getByText(/인천.*시도 평균/)).toBeTruthy();
  });

  it("corner case — 18행 null + 1행만 모든 값 (chartData.length<2) 시 안내 박스", () => {
    const cornerRows = [
      ...Array.from({ length: 18 }, (_, i) => ({
        base_month: `2024${String(i + 1).padStart(2, "0")}`,
        avg_price_sqm: null, price_index: null, new_supply: null,
        initial_sale_rate: null, land_cost_ratio: null,
      })),
      { base_month: "202601", avg_price_sqm: 100, price_index: 101, new_supply: 20, initial_sale_rate: 80, land_cost_ratio: 35 },
    ];
    mockUseMarketStatsHistory.mockReturnValue({ data: cornerRows, loading: false, error: null, retry: vi.fn(), fallback: false });
    render(<MarketStatsCharts region="인천" gu="서구" />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryAllByTestId("line-chart")).toHaveLength(0);
  });
});
