// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// 그래프 자체는 이 PR 의 변경 대상이 아니다(무변경 재사용). 네트워크만 끊고 마운트 여부만 본다.
const mockUseMarketStatsHistory = vi.fn();
vi.mock("@/hooks/useMarketStatsHistory", () => ({
  useMarketStatsHistory: (/** @type {any[]} */ ...args) => mockUseMarketStatsHistory(...args),
}));
vi.mock("@/components/primitives", () => ({
  LineChart: (/** @type {any} */ props) => <div data-testid="line-chart" aria-label={props.yLabel} />,
}));

import { RegionStats } from "./RegionStats";
import { makeApt } from "@/__tests__/factories";

const rows = () =>
  [1, 2].map((i) => ({
    base_month: `20250${i}`,
    avg_price_sqm: 100 * i,
    price_index: 100 + i,
    new_supply: 10 * i,
    initial_sale_rate: 80 + i,
    land_cost_ratio: 30 + i,
  }));

/** 지역통계 7종이 모두 채워진 단지 (기본 지역 = 경기 수원시) */
const apt = (over = {}) =>
  /** @type {any} */ (
    makeApt({
      popGrowth: 0.3,
      netMigration: 500,
      housingSupplyLevel: 101.2,
      fertilityRate: 0.9,
      doctorsPer1k: 2.5,
      hospitalBedsPer1k: 12,
      recentTrades6m: 20,
      ...over,
    })
  );

describe("RegionStats", () => {
  beforeEach(() => {
    mockUseMarketStatsHistory.mockReset();
    mockUseMarketStatsHistory.mockReturnValue({
      data: rows(),
      loading: false,
      error: null,
      retry: vi.fn(),
      fallback: false,
    });
  });

  // ── 닫힘: "이 단지 값이 아니다"를 열기 전에 먼저 말한다 ──
  it("닫힌 상태에서 제목과 '이 단지 값이 아니라 {gu}·{region} 통계' 문구를 보여준다", () => {
    render(<RegionStats apt={apt()} />);
    expect(screen.getByText(/이 지역 통계/)).toBeTruthy();
    expect(screen.getByText("이 단지 값이 아니라 수원시·경기 통계예요")).toBeTruthy();
  });

  it("구를 모르는 단지는 '{region} 전체 통계'로 축약한다", () => {
    render(<RegionStats apt={apt({ gu: null })} />);
    expect(screen.getByText("이 단지 값이 아니라 경기 전체 통계예요")).toBeTruthy();
  });

  it("닫힌 상태에서는 7행도 그래프도 안 그린다", () => {
    render(<RegionStats apt={apt()} />);
    expect(screen.queryByText(/인구증감률/)).toBeNull();
    expect(screen.queryAllByTestId("line-chart")).toHaveLength(0);
  });

  // ── 열림 ──
  it("열면 지역 시장 추이 그래프와 7행이 함께 보인다", () => {
    render(<RegionStats apt={apt()} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getAllByTestId("line-chart")).toHaveLength(5);
    for (const label of [
      "경기 인구증감률",
      "경기 순이동",
      "경기 주택보급률",
      "수원시 합계출산율",
      "수원시 의사수",
      "수원시 병상수",
      "수원시 최근 6개월 거래",
    ]) {
      expect(screen.getByText(label), `${label} 행이 없다`).toBeTruthy();
    }
  });

  it("값은 FIELD_META 포맷 그대로 쓴다 (표기 규칙을 두 벌로 적지 않는다)", () => {
    render(<RegionStats apt={apt()} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("+0.3%")).toBeTruthy(); // popGrowth
    expect(screen.getByText("+500명")).toBeTruthy(); // netMigration
    expect(screen.getByText("20건")).toBeTruthy(); // recentTrades6m
  });

  it("구를 모르면 시·군·구 4행도 시·도 이름으로 읽는다 (빈 접두 방지)", () => {
    render(<RegionStats apt={apt({ gu: null })} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("경기 합계출산율")).toBeTruthy();
    expect(screen.getByText("경기 최근 6개월 거래")).toBeTruthy();
  });

  it("값이 없는 행도 자리를 지키고 '미수집'으로 적는다", () => {
    render(<RegionStats apt={apt({ fertilityRate: null })} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("수원시 합계출산율")).toBeTruthy();
    expect(screen.getAllByText("미수집").length).toBeGreaterThan(0);
  });

  // ── 형태 ──
  it("aria-expanded 가 클릭으로 바뀐다", () => {
    render(<RegionStats apt={apt()} />);
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("Enter·Space 로도 펼칠 수 있다", () => {
    render(<RegionStats apt={apt()} />);
    fireEvent.keyDown(screen.getByRole("button", { expanded: false }), { key: "Enter" });
    expect(screen.getByText("경기 인구증감률")).toBeTruthy();
  });

  // 도넛은 "이 **단지** 자료가 얼마나 모였나"를 뜻하는 기호다. 지역값에 그리면 한 기호가
  // 두 뜻을 갖게 돼, 이 서랍이 하려는 구분(단지값 ≠ 지역값)을 스스로 흐린다.
  it("채움률 도넛은 그리지 않는다 (단지 자료 기호를 지역값에 쓰지 않는다)", () => {
    render(<RegionStats apt={apt()} />);
    expect(screen.queryByRole("img", { name: /채움률/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.queryByRole("img", { name: /채움률/ })).toBeNull();
  });

  it("헤더에 ? 도움말이 있고, 어느 줄이 시·도이고 시·군·구인지 설명한다", () => {
    render(<RegionStats apt={apt()} />);
    fireEvent.click(screen.getByLabelText("이 지역 통계 풀이 보기"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/시·군·구 단위/);
  });
});
