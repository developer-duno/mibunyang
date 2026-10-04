// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// 네트워크만 끊는다 — 작은 추이 선 칸은 진짜로 그린다(MarketStatsCharts.test.jsx 가 칸 자체를 본다).
const mockUseMarketStatsHistory = vi.fn();
vi.mock("@/hooks/useMarketStatsHistory", () => ({
  useMarketStatsHistory: (/** @type {any[]} */ ...args) => mockUseMarketStatsHistory(...args),
}));

import { RegionStats, REGION_GAUGES, popGrowthColor } from "./RegionStats";
import { C } from "@/theme";
import { REGION_STATS_FIELDS } from "@/constants/regionStatsFields";
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

/** 목업 단지(ap-6028162 평촌롯데캐슬르씨엘) 값 — 기본 지역 = 경기 수원시 */
const apt = (over = {}) =>
  /** @type {any} */ (
    makeApt({
      cancelRatio6m: 0.5,
      popGrowth: 0.4,
      netMigration: 5106,
      housingSupplyLevel: 99.4,
      fertilityRate: 0.931,
      doctorsPer1k: 3.4,
      hospitalBedsPer1k: 7.1,
      recentTrades6m: 3114,
      ...over,
    })
  );

/** 렌더된 눈금 점의 위치(style left %) — 인자 순서가 뒤집혀도 순수 함수 시험은 초록이라 화면으로 본다 */
function dotLeft(/** @type {string} */ field, /** @type {number} */ v) {
  const { container, unmount } = render(<RegionStats apt={apt({ [field]: v })} />);
  const g = container.querySelector(`[data-testid="region-gauge"][data-field="${field}"]`);
  const dot = [...(g?.querySelectorAll("div") ?? [])].find(
    (d) => /** @type {HTMLElement} */ (d).style.borderRadius === "50%"
  );
  const pct = parseFloat(/** @type {HTMLElement | undefined} */ (dot)?.style.left ?? "NaN");
  unmount();
  return pct;
}

describe("RegionStats — 접힘 없는 묶음 (세션591 P4)", () => {
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

  it("펼치기 버튼 없이 제목·'이 단지 값 아님' 문구·추이 칸·눈금·작은 글자 줄이 바로 보인다", () => {
    render(<RegionStats apt={apt()} />);
    expect(screen.queryByRole("button", { expanded: false })).toBeNull();
    expect(screen.getByText("이 단지 값이 아니라 수원시·경기 통계예요")).toBeTruthy();
    expect(screen.getByTestId("market-charts-grid")).toBeTruthy();
    expect(screen.getAllByTestId("region-gauge")).toHaveLength(4);
    expect(screen.getByTestId("region-small-line")).toBeTruthy();
  });

  it("구를 모르는 단지는 '{region} 전체 통계'로 축약하고, 시·군·구 줄도 시·도 이름으로 읽는다 (빈 접두 방지)", () => {
    render(<RegionStats apt={apt({ gu: null })} />);
    expect(screen.getByText("이 단지 값이 아니라 경기 전체 통계예요")).toBeTruthy();
    expect(screen.getByText(/^경기 계약해제율/)).toBeTruthy();
    expect(screen.getByText(/경기 합계출산율/)).toBeTruthy();
  });

  it("눈금 4개 = 계약해제율 · 주택보급률 · 인구 증감 · 6개월 거래 (순서 고정)", () => {
    expect(REGION_GAUGES.map((g) => g.field)).toEqual([
      "cancelRatio6m",
      "housingSupplyLevel",
      "popGrowth",
      "recentTrades6m",
    ]);
  });

  it("눈금 제목 = 동네 접두 + 값 + 판정 글자(점수표 밴드 이름)", () => {
    render(<RegionStats apt={apt()} />);
    expect(screen.getByText("수원시 계약해제율 0.5% · 적음")).toBeTruthy();
    expect(screen.getByText("경기 주택보급률 99.4% · 적정")).toBeTruthy();
    expect(screen.getByText("경기 인구 증감 +0.4%")).toBeTruthy();
    expect(screen.getByText("수원시 6개월 거래 3,114건 · 활발")).toBeTruthy();
  });

  it("양 끝 글자는 점수표 경계 — 계약해제율 많음 5%/적음 0.7% · 보급률 부족 96%/과잉 104% · 인구 -2%/+1% · 거래 침체 1,050건/활발 2,450건", () => {
    render(<RegionStats apt={apt()} />);
    for (const t of ["많음 5%", "적음 0.7%", "부족 96%", "과잉 104%", "-2%", "+1%", "침체 1,050건", "활발 2,450건"])
      expect(screen.getByText(t), t).toBeTruthy();
  });

  it("판정 글자 경계 — 계약해제율 1.2 적음 · 1.21 보통 · 1.61 많음 · 거래 1,649 한산 · 1,650 보통", () => {
    const { unmount } = render(<RegionStats apt={apt({ cancelRatio6m: 1.2, recentTrades6m: 1649 })} />);
    expect(screen.getByText("수원시 계약해제율 1.2% · 적음")).toBeTruthy();
    expect(screen.getByText("수원시 6개월 거래 1,649건 · 한산")).toBeTruthy();
    unmount();
    const r2 = render(<RegionStats apt={apt({ cancelRatio6m: 1.21, recentTrades6m: 1650 })} />);
    expect(screen.getByText("수원시 계약해제율 1.21% · 보통")).toBeTruthy();
    expect(screen.getByText("수원시 6개월 거래 1,650건 · 보통")).toBeTruthy();
    r2.unmount();
    render(<RegionStats apt={apt({ cancelRatio6m: 1.61 })} />);
    expect(screen.getByText("수원시 계약해제율 1.61% · 많음")).toBeTruthy();
  });
});

describe("RegionStats — 눈금 방향 (렌더된 점 위치, 오른쪽 = 유리)", () => {
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

  it("계약해제율 — 낮을수록 오른쪽: 1.2 가운데 · 0.7↓ 오른쪽 끝 · 5↑ 왼쪽 끝", () => {
    expect(dotLeft("cancelRatio6m", 1.2)).toBe(50);
    expect(dotLeft("cancelRatio6m", 0.5)).toBe(100);
    expect(dotLeft("cancelRatio6m", 4.4)).toBeLessThan(10);
    expect(dotLeft("cancelRatio6m", 5)).toBe(0);
    expect(dotLeft("cancelRatio6m", 1.5)).toBeLessThan(dotLeft("cancelRatio6m", 1.0));
  });

  it("6개월 거래 — 많을수록 오른쪽: 1,650 가운데 · 2,450↑ 오른쪽 끝 · 1,050↓ 왼쪽 끝", () => {
    expect(dotLeft("recentTrades6m", 1650)).toBe(50);
    expect(dotLeft("recentTrades6m", 3114)).toBe(100);
    expect(dotLeft("recentTrades6m", 900)).toBe(0);
    expect(dotLeft("recentTrades6m", 2000)).toBeGreaterThan(50);
  });

  it("인구 증감 — 0 이 가운데 · 플러스는 오른쪽 · +1%↑ 오른쪽 끝 · -2%↓ 왼쪽 끝", () => {
    expect(dotLeft("popGrowth", 0)).toBe(50);
    expect(dotLeft("popGrowth", 0.4)).toBeGreaterThan(50);
    expect(dotLeft("popGrowth", -0.4)).toBeLessThan(50);
    expect(dotLeft("popGrowth", 1.5)).toBe(100);
    expect(dotLeft("popGrowth", -3)).toBe(0);
  });

  it("주택보급률 — 적정 구간 한가운데(98.5)가 가운데 · 부족 96↓ 왼쪽 끝 · 과잉 104↑ 오른쪽 끝", () => {
    expect(dotLeft("housingSupplyLevel", 98.5)).toBe(50);
    expect(dotLeft("housingSupplyLevel", 93.9)).toBe(0);
    expect(dotLeft("housingSupplyLevel", 114.4)).toBe(100);
    expect(dotLeft("housingSupplyLevel", 99.4)).toBeGreaterThan(50);
  });

  // 보완 F4 — 끝 안쪽 값을 정확값으로. 끝 숫자를 점 계산에서만 바꾸는 변이는 끝 점·방향 시험으로는 안 잡힌다.
  //   기대값은 positionPct 정의(가운데 50 · 각 끝까지 따로 비례 · ±50)로 직접 계산했다:
  //   보급률 99.4 → 50 + (99.4−98.5)/(104−98.5)×50 = 58.1818… · 97 → 50 − (98.5−97)/(98.5−96)×50 = 20
  //   인구 0.4 → 50 + 0.4/1×50 = 70 · −1 → 50 − 1/2×50 = 25
  //   거래 2,050 → 50 + 400/800×50 = 75 · 1,350 → 50 − 300/600×50 = 25
  it("끝 안쪽 비례 — 보급률 99.4→58.18 · 97→20 / 인구 +0.4→70 · −1→25 / 거래 2,050→75 · 1,350→25", () => {
    expect(dotLeft("housingSupplyLevel", 99.4)).toBeCloseTo(58.1818, 3);
    expect(dotLeft("housingSupplyLevel", 97)).toBeCloseTo(20, 6);
    expect(dotLeft("popGrowth", 0.4)).toBeCloseTo(70, 6);
    expect(dotLeft("popGrowth", -1)).toBeCloseTo(25, 6);
    expect(dotLeft("recentTrades6m", 2050)).toBeCloseTo(75, 6);
    expect(dotLeft("recentTrades6m", 1350)).toBeCloseTo(25, 6);
  });
});

describe("RegionStats — 색 (보완 F3·F5)", () => {
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

  /** 눈금 제목 글자색(jsdom 은 rgb 로 돌려준다) */
  const titleColor = (/** @type {string} */ field, /** @type {number} */ v) => {
    const { container, unmount } = render(<RegionStats apt={apt({ [field]: v })} />);
    const g = container.querySelector(`[data-testid="region-gauge"][data-field="${field}"]`);
    const c = /** @type {HTMLElement | null} */ (g?.firstElementChild ?? null)?.style.color ?? "";
    unmount();
    return c;
  };
  const RED = "rgb(220, 38, 38)"; // C.red #DC2626
  const GREEN = "rgb(22, 163, 74)"; // C.green #16A34A
  const BLUE = "rgb(37, 99, 235)"; // C.blue #2563EB

  // 점수 탭(scoreFuture POP_GROWTH_TIERS · subContext 인구 문구)은 −0.3 이상 0.5 미만을 "보합", 0.5 이상을 "유입 활발",
  //   −0.3 미만을 "유출 주의"로 본다. 옛 코드는 음수면 전부 빨강이라 보합 구간(−0.3~0)까지 빨갛게 칠했다.
  it("인구 증감 색은 점수 탭 판정과 같은 경계 — −0.31 빨강 · −0.3 중립 · 0 중립 · 0.49 중립 · 0.5 초록", () => {
    expect(popGrowthColor(-0.31)).toBe(C.red);
    expect(popGrowthColor(-0.3)).toBe(C.blue);
    expect(popGrowthColor(0)).toBe(C.blue);
    expect(popGrowthColor(0.49)).toBe(C.blue);
    expect(popGrowthColor(0.5)).toBe(C.green);
    expect(popGrowthColor(-2.5)).toBe(C.red);
  });

  it("렌더된 인구 증감 제목 색 — −0.4 빨강 · −0.2 중립 · 0.7 초록", () => {
    expect(titleColor("popGrowth", -0.4)).toBe(RED);
    expect(titleColor("popGrowth", -0.2)).toBe(BLUE);
    expect(titleColor("popGrowth", 0.7)).toBe(GREEN);
  });

  // 보완 F5 — 계약해제율 표의 마지막 경계(5) 위는 tier 밖 경로(CANCEL_RATIO_HIGH_LABEL)다.
  it("계약해제율 6% (표의 마지막 경계 5 초과) → '많음' · 빨강 · 왼쪽 끝", () => {
    render(<RegionStats apt={apt({ cancelRatio6m: 6 })} />);
    expect(screen.getByText("수원시 계약해제율 6% · 많음")).toBeTruthy();
    expect(titleColor("cancelRatio6m", 6)).toBe(RED);
    expect(dotLeft("cancelRatio6m", 6)).toBe(0);
  });
});

describe("RegionStats — 작은 글자 줄 · 값 없음", () => {
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

  it("눈금 아래 작은 글자 한 줄 = 순이동 · 출산율 · 의사 수 · 병상 수 (FIELD_META 포맷 그대로)", () => {
    render(<RegionStats apt={apt()} />);
    expect(screen.getByTestId("region-small-line")).toHaveTextContent(
      "경기 순이동 +5,106명 · 수원시 합계출산율 0.931명 · 수원시 의사수 천명당 3.4명 · 수원시 병상수 천명당 7.1개"
    );
  });

  it("작은 글자 줄은 값이 있는 것만 — 빈 값을 '미수집'으로 늘어놓지 않는다", () => {
    render(<RegionStats apt={apt({ fertilityRate: null, doctorsPer1k: null })} />);
    const line = screen.getByTestId("region-small-line");
    expect(line).not.toHaveTextContent("합계출산율");
    expect(line).not.toHaveTextContent("의사수");
    expect(line).not.toHaveTextContent("미수집");
    expect(line).toHaveTextContent("병상수");
  });

  it("값이 없는 눈금은 그리지 않는다", () => {
    render(<RegionStats apt={apt({ cancelRatio6m: null, recentTrades6m: null })} />);
    const fields = screen.getAllByTestId("region-gauge").map((g) => g.getAttribute("data-field"));
    expect(fields).toEqual(["housingSupplyLevel", "popGrowth"]);
  });

  it("지역통계 7필드 전부가 눈금이나 작은 글자 줄 어느 한 곳에 닿는다 (조용히 사라지는 필드 없음)", () => {
    const { container } = render(<RegionStats apt={apt()} />);
    for (const f of REGION_STATS_FIELDS) {
      expect(container.querySelector(`[data-field="${f}"]`), `${f} 가 화면 어디에도 없다`).not.toBeNull();
    }
  });

  it("값이 전부 없고 지역도 모르면 묶음 자체를 안 그린다", () => {
    const empty = {
      region: null,
      gu: null,
      cancelRatio6m: null,
      popGrowth: null,
      netMigration: null,
      housingSupplyLevel: null,
      fertilityRate: null,
      doctorsPer1k: null,
      hospitalBedsPer1k: null,
      recentTrades6m: null,
    };
    const { container } = render(<RegionStats apt={apt(empty)} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("RegionStats — 형태", () => {
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

  // 도넛은 "이 **단지** 자료가 얼마나 모였나"를 뜻하는 기호다. 지역값에 그리면 한 기호가
  // 두 뜻을 갖게 돼, 이 묶음이 하려는 구분(단지값 ≠ 지역값)을 스스로 흐린다.
  it("채움률 도넛은 그리지 않는다 (단지 자료 기호를 지역값에 쓰지 않는다)", () => {
    render(<RegionStats apt={apt()} />);
    expect(screen.queryByRole("img", { name: /채움률/ })).toBeNull();
  });

  it("헤더에 ? 도움말이 있고, 어느 줄이 시·도이고 시·군·구인지 설명한다", () => {
    render(<RegionStats apt={apt()} />);
    fireEvent.click(screen.getByLabelText("이 지역 통계 풀이 보기"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/시·군·구 단위/);
    expect(screen.getByRole("tooltip")).toHaveTextContent(/계약해제율/);
  });

  it("화면 글자·aria 어디에도 '점수' 낱말이 없다 (지역값은 점수가 아니다 — 비로그인에도 보인다)", () => {
    const { container } = render(<RegionStats apt={apt()} />);
    expect(container.textContent).not.toContain("점수");
    for (const el of container.querySelectorAll("[aria-label]"))
      expect(el.getAttribute("aria-label")).not.toContain("점수");
  });
});
