// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockUseMarketStatsHistory = vi.fn();

vi.mock("@/hooks/useMarketStatsHistory", () => ({
  useMarketStatsHistory: (/** @type {any[]} */ ...args) => mockUseMarketStatsHistory(...args),
}));

import { MarketStatsCharts, baseMonthLabel } from "./MarketStatsCharts";

// 세션591 P4 — 큰 LineChart 5개를 작은 칸 5개(이름·최신 값·작은 추이 선·기준 연월)로 줄였다.
//   칸 = `[data-metric]`, 추이 선 = role="img"(aria-label "… 추이, 최근 …").
const tiles = () => document.querySelectorAll("[data-metric]");
const sparks = () => screen.queryAllByRole("img", { name: /추이, 최근/ });

const makeRows = () => [
  {
    base_month: "202501",
    avg_price_sqm: 100,
    price_index: 101,
    new_supply: 20,
    initial_sale_rate: 80,
    land_cost_ratio: 35,
  },
  {
    base_month: "202502",
    avg_price_sqm: 110,
    price_index: 102,
    new_supply: 30,
    initial_sale_rate: 82,
    land_cost_ratio: 36,
  },
];

describe("MarketStatsCharts", () => {
  beforeEach(() => {
    mockUseMarketStatsHistory.mockReset();
  });

  it("region이 없으면 렌더링하지 않는다", () => {
    mockUseMarketStatsHistory.mockReturnValue({
      data: [],
      loading: false,
      error: null,
      retry: vi.fn(),
      fallback: false,
    });
    const { container } = render(<MarketStatsCharts region="" gu="" />);
    expect(container.innerHTML).toBe("");
  });

  it("loading 상태를 표시한다", () => {
    mockUseMarketStatsHistory.mockReturnValue({
      data: [],
      loading: true,
      error: null,
      retry: vi.fn(),
      fallback: false,
    });
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
    mockUseMarketStatsHistory.mockReturnValue({
      data: [],
      loading: false,
      error: null,
      retry: vi.fn(),
      fallback: false,
    });
    render(<MarketStatsCharts region="서울" gu="강남구" />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  // 세션592: 분양가격지수 칸을 뺐다(원천 2025-10 멈춤) — 5 → 4. 응답에 price_index 가 있어도 안 그린다.
  it("정상 데이터면 작은 칸 4개(추이 선 4개)를 렌더링한다 — 분양가격지수는 없다", () => {
    mockUseMarketStatsHistory.mockReturnValue({
      data: makeRows(),
      loading: false,
      error: null,
      retry: vi.fn(),
      fallback: false,
    });
    render(<MarketStatsCharts region="서울" gu="강남구" />);
    expect(tiles()).toHaveLength(4);
    expect(sparks()).toHaveLength(4);
    expect(screen.queryByText(/분양가격지수/)).toBeNull();
    for (const label of ["평균분양가격", "신규공급 세대수", "초기분양율", "택지비율"])
      expect(screen.getByText(label)).toBeTruthy();
  });

  // 세션593 — 세션592 검사관 변이 M14(auto-fit → auto-fill)가 살아남았던 자리.
  // auto-fill 이면 PC 폭에서 5칸 자리를 잡아 오른쪽에 빈 칸 하나 폭이 남는다(세션592 캡처).
  // ⚠️ 변이 대상: auto-fill 로 바꾸면 빨강.
  it("칸 배치는 auto-fit — 4칸이 한 줄을 채운다 (세션593)", () => {
    mockUseMarketStatsHistory.mockReturnValue({
      data: makeRows(),
      loading: false,
      error: null,
      retry: vi.fn(),
      fallback: false,
    });
    render(<MarketStatsCharts region="서울" gu="강남구" />);
    const grid = /** @type {HTMLElement} */ (screen.getByTestId("market-charts-grid"));
    expect(grid.style.display).toBe("grid");
    expect(grid.style.gridTemplateColumns).toBe("repeat(auto-fit, minmax(120px, 1fr))");
  });

  it("price_index 만 값이 있으면 그릴 것이 없어 안내 박스 (세션592)", () => {
    const rows = makeRows().map((r) => ({
      ...r,
      avg_price_sqm: null,
      new_supply: null,
      initial_sale_rate: null,
      land_cost_ratio: null,
    }));
    mockUseMarketStatsHistory.mockReturnValue({
      data: rows,
      loading: false,
      error: null,
      retry: vi.fn(),
      fallback: false,
    });
    render(<MarketStatsCharts region="서울" gu="강남구" />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(tiles()).toHaveLength(0);
  });

  // E16 — 옛 x축은 월(두 자리)만 적어 연도가 섞여 읽혔다. 칸마다 최신 값과 그 기준 연·월을 적는다.
  it("칸마다 이름 · 최신 값 · 단위 · '연.월 기준' 글자를 적는다 (E16)", () => {
    mockUseMarketStatsHistory.mockReturnValue({
      data: makeRows(),
      loading: false,
      error: null,
      retry: vi.fn(),
      fallback: false,
    });
    render(<MarketStatsCharts region="서울" gu="강남구" />);
    const first = /** @type {HTMLElement} */ (document.querySelector('[data-metric="avg_price_sqm"]'));
    expect(first).toHaveTextContent("평균분양가격");
    expect(first).toHaveTextContent("110");
    expect(first).toHaveTextContent("천원/㎡");
    expect(first).toHaveTextContent("2025.02 기준");
    expect(screen.getByRole("img", { name: "평균분양가격 추이, 최근 110 천원/㎡ (2025.02 기준)" })).toBeTruthy();
  });

  it("baseMonthLabel — 월간 '202608' → '2026.08' · 형식 밖(달 13 포함)은 빈 글자", () => {
    expect(baseMonthLabel("202608")).toBe("2026.08");
    expect(baseMonthLabel("202608", "M")).toBe("2026.08");
    expect(baseMonthLabel("202613")).toBe("");
    expect(baseMonthLabel("2026-08")).toBe("");
    expect(baseMonthLabel(undefined)).toBe("");
  });

  // 보완 F1 — 초기분양률(KOSIS DT_41401N_008)은 분기 자료라 base_month 뒤 자리가 분기 번호다(운영 DB: 01~04 뿐).
  it("baseMonthLabel 분기 — '202602' → '2026년 2분기' · 5자리 '20262' 도 같은 뜻", () => {
    expect(baseMonthLabel("202602", "Q")).toBe("2026년 2분기");
    expect(baseMonthLabel("202504", "Q")).toBe("2025년 4분기");
    expect(baseMonthLabel("20262", "Q")).toBe("2026년 2분기");
  });

  it("baseMonthLabel 분기인데 뒤 자리가 01~04 가 아니거나 모양을 모르면 생략한다 (틀린 분기를 말하지 않는다)", () => {
    expect(baseMonthLabel("202607", "Q")).toBe("");
    expect(baseMonthLabel("20265", "Q")).toBe("");
    expect(baseMonthLabel("2026Q2", "Q")).toBe("");
    expect(baseMonthLabel(null, "Q")).toBe("");
  });

  it("초기분양율 칸은 분기로, 다른 칸은 달로 적는다 (화면 글자·aria 둘 다)", () => {
    mockUseMarketStatsHistory.mockReturnValue({
      data: [
        { base_month: "202601", avg_price_sqm: 100, initial_sale_rate: 50.5 },
        { base_month: "202602", avg_price_sqm: 110, initial_sale_rate: 80.8 },
      ],
      loading: false,
      error: null,
      retry: vi.fn(),
      fallback: false,
    });
    render(<MarketStatsCharts region="경기" gu="" />);
    const rate = /** @type {HTMLElement} */ (document.querySelector('[data-metric="initial_sale_rate"]'));
    expect(rate).toHaveTextContent("2026년 2분기 기준");
    expect(rate).not.toHaveTextContent("2026.02");
    expect(screen.getByRole("img", { name: "초기분양율 추이, 최근 80.8 % (2026년 2분기 기준)" })).toBeTruthy();
    const price = /** @type {HTMLElement} */ (document.querySelector('[data-metric="avg_price_sqm"]'));
    expect(price).toHaveTextContent("2026.02 기준");
  });

  // 세션 411 — ? 도움말. 차트 4개(세션592 — 분양가격지수 뺌) + 상단 "지역 시장 추이" = ? 5개. line-chart 개수 불변.
  it("정상 데이터면 ? 도움말 5개(차트 4 + 상단 1) 표시, line-chart 개수 불변", () => {
    mockUseMarketStatsHistory.mockReturnValue({
      data: makeRows(),
      loading: false,
      error: null,
      retry: vi.fn(),
      fallback: false,
    });
    render(<MarketStatsCharts region="서울" gu="강남구" />);
    expect(screen.getAllByLabelText(/풀이 보기$/)).toHaveLength(5);
    expect(sparks()).toHaveLength(4); // ? 추가해도 추이 선 개수 불변
  });

  it("초기분양율 ? 클릭 시 '보는 법' 설명(role=tooltip) 표시", () => {
    mockUseMarketStatsHistory.mockReturnValue({
      data: makeRows(),
      loading: false,
      error: null,
      retry: vi.fn(),
      fallback: false,
    });
    render(<MarketStatsCharts region="서울" gu="강남구" />);
    fireEvent.click(screen.getByLabelText("초기분양율 풀이 보기"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/미분양 위험/);
  });

  it("정상 데이터면 차트들이 반응형 grid 컨테이너에 담긴다", () => {
    mockUseMarketStatsHistory.mockReturnValue({
      data: makeRows(),
      loading: false,
      error: null,
      retry: vi.fn(),
      fallback: false,
    });
    render(<MarketStatsCharts region="서울" gu="강남구" />);
    const grid = /** @type {HTMLElement} */ (screen.getByTestId("market-charts-grid"));
    expect(grid.style.display).toBe("grid");
    expect(grid.style.gridTemplateColumns).toContain("minmax");
  });

  it("18행 모두 null 값만 있으면 안내 박스만 표시한다", () => {
    const nullRows = Array.from({ length: 18 }, (_, i) => ({
      base_month: `2024${String(i + 1).padStart(2, "0")}`,
      avg_price_sqm: null,
      price_index: null,
      new_supply: null,
      initial_sale_rate: null,
      land_cost_ratio: null,
    }));
    mockUseMarketStatsHistory.mockReturnValue({
      data: nullRows,
      loading: false,
      error: null,
      retry: vi.fn(),
      fallback: false,
    });
    render(<MarketStatsCharts region="인천" gu="서구" />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(tiles()).toHaveLength(0);
    expect(sparks()).toHaveLength(0);
  });

  it("부분 null (1필드만 length>=2) 행이면 그 필드만 차트 렌더", () => {
    const partial = [
      {
        base_month: "202501",
        avg_price_sqm: 100,
        price_index: null,
        new_supply: null,
        initial_sale_rate: null,
        land_cost_ratio: null,
      },
      {
        base_month: "202502",
        avg_price_sqm: 110,
        price_index: null,
        new_supply: null,
        initial_sale_rate: null,
        land_cost_ratio: null,
      },
    ];
    mockUseMarketStatsHistory.mockReturnValue({
      data: partial,
      loading: false,
      error: null,
      retry: vi.fn(),
      fallback: false,
    });
    render(<MarketStatsCharts region="인천" gu="서구" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(tiles()).toHaveLength(1);
    expect(sparks()).toHaveLength(1);
  });

  it("fallback=true 시 헤더에 시도 평균 표시", () => {
    mockUseMarketStatsHistory.mockReturnValue({
      data: makeRows(),
      loading: false,
      error: null,
      retry: vi.fn(),
      fallback: true,
    });
    render(<MarketStatsCharts region="인천" gu="서구" />);
    expect(screen.getByText(/인천.*시도 평균/)).toBeTruthy();
  });

  it("corner case — 18행 null + 1행만 모든 값 (chartData.length<2) 시 안내 박스", () => {
    const cornerRows = [
      ...Array.from({ length: 18 }, (_, i) => ({
        base_month: `2024${String(i + 1).padStart(2, "0")}`,
        avg_price_sqm: null,
        price_index: null,
        new_supply: null,
        initial_sale_rate: null,
        land_cost_ratio: null,
      })),
      {
        base_month: "202601",
        avg_price_sqm: 100,
        price_index: 101,
        new_supply: 20,
        initial_sale_rate: 80,
        land_cost_ratio: 35,
      },
    ];
    mockUseMarketStatsHistory.mockReturnValue({
      data: cornerRows,
      loading: false,
      error: null,
      retry: vi.fn(),
      fallback: false,
    });
    render(<MarketStatsCharts region="인천" gu="서구" />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(tiles()).toHaveLength(0);
    expect(sparks()).toHaveLength(0);
  });
});
