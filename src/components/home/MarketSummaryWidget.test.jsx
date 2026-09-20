// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MarketSummaryWidget, buildRegionBars, buildBudgetBuckets } from "./MarketSummaryWidget";

/**
 * @param {string} id
 * @param {number | null} price 만원 단위
 * @param {number | null} unsoldRate
 * @param {{ region?: string | null }} [extra]
 */
const mk = (id, price, unsoldRate, extra = {}) =>
  /** @type {any} */ ({
    apt: {
      id,
      name: `n${id}`,
      region: "region" in extra ? extra.region : "경기",
      price,
      unsoldRate,
    },
    res: { total: 50, cats: {} },
  });

describe("buildBudgetBuckets — 가격대별 단지 수 (중위값을 내지 않는다)", () => {
  it("5구간으로 나눈다 — 경계는 BudgetPanel 프리셋(3/5/7/10억)과 같다", () => {
    const buckets = buildBudgetBuckets([]);
    expect(buckets.map((b) => b.label)).toEqual(["3억 미만", "3~5억", "5~7억", "7~10억", "10억 이상"]);
    // 경계가 프리셋에서 벗어나면 현황판과 목록의 예산 버튼이 서로 다른 말을 한다
    expect(buckets.map((b) => b.maxEok)).toEqual([3, 5, 7, 10, null]);
    expect(buckets.map((b) => b.minEok)).toEqual([null, 3, 5, 7, 10]);
  });
  it("경계값은 위 구간에 들어간다 (3억 = '3~5억')", () => {
    const buckets = buildBudgetBuckets([mk("1", 30000, 5)]);
    expect(buckets.find((b) => b.label === "3억 미만")?.count).toBe(0);
    expect(buckets.find((b) => b.label === "3~5억")?.count).toBe(1);
  });
  it("가격 없는 단지는 어느 구간에도 안 들어간다 — '3억 미만'에 쓸어 담지 않는다", () => {
    const buckets = buildBudgetBuckets([mk("1", null, 5), mk("2", 0, 5), mk("3", 40000, 5)]);
    expect(buckets.find((b) => b.label === "3억 미만")?.count).toBe(0);
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(1); // 유효한 1곳만
  });
  it("양 끝 구간이 열려 있다 (2억·30억도 센다)", () => {
    const buckets = buildBudgetBuckets([mk("1", 20000, 5), mk("2", 300000, 5)]);
    expect(buckets.find((b) => b.label === "3억 미만")?.count).toBe(1);
    expect(buckets.find((b) => b.label === "10억 이상")?.count).toBe(1);
  });
  it("구간 합계 = 가격 있는 단지 수 (겹치거나 새지 않는다)", () => {
    const scored = [20000, 30000, 49999, 50000, 69999, 70000, 99999, 100000, 250000].map((p, i) => mk(String(i), p, 5));
    const buckets = buildBudgetBuckets(scored);
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(scored.length);
  });
});

describe("MarketSummaryWidget — 가격대 구간", () => {
  it("구간별 단지 수를 보여준다", () => {
    const scored = [mk("1", 20000, 5), mk("2", 40000, 5), mk("3", 40000, 5)];
    render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} />);
    expect(screen.getByText("3억 미만")).toBeInTheDocument();
    expect(screen.getByText("2곳")).toBeInTheDocument(); // 3~5억
  });
  it("⚠️ 중위값을 내지 않는다 — '중위' 라는 가격 문구가 화면에 없다", () => {
    // 되돌려서 평당가/분양가 중위 칸을 부활시키면 red.
    const scored = [mk("1", 30000, 10), mk("2", 50000, 20)];
    render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} />);
    expect(screen.queryByText(/평당가 중위/)).toBeNull();
    expect(screen.queryByText(/분양가 중위/)).toBeNull();
    expect(screen.queryByText(/미분양률 중위$/)).toBeNull(); // 칸 라벨로서의 '미분양률 중위'
  });
  it("전국 단지 수·갱신일은 한 줄로 남는다", () => {
    render(<MarketSummaryWidget scored={[mk("1", 30000, 5)]} dataFreshnessText="오늘 06:00 업데이트" />);
    expect(screen.getByText(/전국 1개 단지 · 오늘 06:00 업데이트/)).toBeInTheDocument();
  });
  it("갱신일이 없으면 '갱신일 정보 없음' — 빈칸을 거짓으로 채우지 않는다", () => {
    render(<MarketSummaryWidget scored={[mk("1", 30000, 5)]} dataFreshnessText={null} />);
    expect(screen.getByText(/갱신일 정보 없음/)).toBeInTheDocument();
  });
  it("점수 파생 지표 미노출 (원시값만 — 비로그인 공개 안전)", () => {
    render(<MarketSummaryWidget scored={[mk("1", 30000, 10)]} dataFreshnessText={null} />);
    expect(screen.queryByText(/평균 점수/)).toBeNull();
  });
  it("빈 scored: 모든 구간 0곳, 막대 없음", () => {
    render(<MarketSummaryWidget scored={[]} dataFreshnessText={null} />);
    expect(screen.getAllByText("0곳").length).toBe(5);
    expect(screen.queryByText(/지역별 미분양률/)).toBeNull();
  });

  describe("가격대 클릭 동선 (onBudgetNav)", () => {
    const scored = [mk("1", 20000, 5), mk("2", 40000, 5)];
    it("'3~5억' 클릭 → 그 예산 범위로", () => {
      const onBudgetNav = vi.fn();
      render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} onBudgetNav={onBudgetNav} />);
      fireEvent.click(screen.getByLabelText(/^3~5억/));
      expect(onBudgetNav).toHaveBeenCalledWith("3~5억", { minEok: 3, maxEok: 5 });
    });
    it("'3억 미만' 은 최소값이 없다 (null)", () => {
      const onBudgetNav = vi.fn();
      render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} onBudgetNav={onBudgetNav} />);
      fireEvent.click(screen.getByLabelText(/^3억 미만/));
      expect(onBudgetNav).toHaveBeenCalledWith("3억 미만", { minEok: null, maxEok: 3 });
    });
    it("'10억 이상' 은 최대값이 없다 (null)", () => {
      const onBudgetNav = vi.fn();
      render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} onBudgetNav={onBudgetNav} />);
      fireEvent.click(screen.getByLabelText(/^10억 이상/));
      expect(onBudgetNav).toHaveBeenCalledWith("10억 이상", { minEok: 10, maxEok: null });
    });
    it("onBudgetNav 미전달 시 구간은 정적 (button 아님)", () => {
      render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} />);
      expect(screen.queryAllByRole("button").length).toBe(0);
    });
  });
});

describe("buildRegionBars — 지역별 미분양률 (PR-5)", () => {
  it("미분양률 중위 높은 순으로 정렬", () => {
    const scored = [
      mk("1", 30000, 5, { region: "서울" }),
      mk("2", 30000, 30, { region: "부산" }),
      mk("3", 30000, 15, { region: "대구" }),
    ];
    expect(buildRegionBars(scored).map((b) => b.region)).toEqual(["부산", "대구", "서울"]);
  });
  it("표본 20곳 미만이면 smallSample — 값은 감추지 않는다", () => {
    const scored = [
      ...Array.from({ length: 20 }, (_, i) => mk(`g${i}`, 30000, 5, { region: "경기" })),
      mk("j1", 30000, 60, { region: "제주" }),
      mk("j2", 30000, 50, { region: "제주" }),
    ];
    const bars = buildRegionBars(scored);
    const jeju = bars.find((b) => b.region === "제주");
    const gg = bars.find((b) => b.region === "경기");
    expect(jeju?.smallSample).toBe(true);
    expect(jeju?.sampleN).toBe(2);
    expect(jeju?.medUnsoldRate).toBe(60); // 값을 감추거나 깎지 않는다
    expect(gg?.smallSample).toBe(false);
    expect(gg?.sampleN).toBe(20); // 경계값 20 은 충분한 표본
  });
  it("sampleN 은 '값이 있는 단지 수' — count 와 다르다", () => {
    const scored = [mk("1", 30000, 10, { region: "서울" }), mk("2", 30000, null, { region: "서울" })];
    const seoul = buildRegionBars(scored)[0];
    expect(seoul.count).toBe(2);
    expect(seoul.sampleN).toBe(1);
  });
  it("미분양률 값이 하나도 없는 지역은 맨 뒤 + medUnsoldRate null", () => {
    const scored = [mk("1", 30000, null, { region: "강원" }), mk("2", 30000, 5, { region: "서울" })];
    const bars = buildRegionBars(scored);
    expect(bars[bars.length - 1].region).toBe("강원");
    expect(bars[bars.length - 1].medUnsoldRate).toBeNull();
    expect(bars[bars.length - 1].smallSample).toBe(false); // 값이 없으면 표본 표식도 없다
  });
  it("region 없는 단지는 어느 막대에도 안 들어간다", () => {
    const scored = [mk("1", 30000, 10, { region: null }), mk("2", 30000, 5, { region: "서울" })];
    const bars = buildRegionBars(scored);
    expect(bars.length).toBe(1);
    expect(bars[0].region).toBe("서울");
  });
});

describe("지역 막대 렌더·클릭 (onRegionNav)", () => {
  const scored = [
    ...Array.from({ length: 20 }, (_, i) => mk(`g${i}`, 30000, 5, { region: "경기" })),
    mk("j1", 30000, 60, { region: "제주" }),
  ];
  it("표본 적은 지역은 'N곳 기준' 을 함께 적는다", () => {
    render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} />);
    expect(screen.getByText(/1곳 기준/)).toBeInTheDocument();
  });
  it("표본 충분한 지역에는 표식이 없다", () => {
    render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} />);
    expect(screen.queryByText(/20곳 기준/)).toBeNull();
  });
  it("막대 클릭 → 그 지역으로", () => {
    const onRegionNav = vi.fn();
    render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} onRegionNav={onRegionNav} />);
    fireEvent.click(screen.getByLabelText(/^제주 미분양률/));
    expect(onRegionNav).toHaveBeenCalledWith("제주");
  });
  it("onRegionNav 미전달 시 막대는 정적 (button 아님)", () => {
    render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} />);
    expect(screen.queryByLabelText(/^제주 미분양률/)).toBeNull();
  });
  it("표본 적은 지역의 aria-label 에도 'N곳 기준' 이 들어간다 (화면 낭독기)", () => {
    const onRegionNav = vi.fn();
    render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} onRegionNav={onRegionNav} />);
    expect(screen.getByLabelText(/제주 미분양률 중위 60\.0% \(1곳 기준\)/)).toBeInTheDocument();
  });
});

describe("표본 적은 지역 맨 아래 + 상위 5개만 (세션552 화면 실측 반영)", () => {
  /** 표본 충분한 지역 6개(각 20곳) + 표본 적은 제주(2곳, 미분양률 최고) */
  const many = (/** @type {string} */ region, /** @type {number} */ n, /** @type {number} */ rate) =>
    Array.from({ length: n }, (_, i) => mk(`${region}${i}`, 30000, rate, { region }));
  const scored = [
    ...many("경기", 20, 4),
    ...many("서울", 20, 5),
    ...many("인천", 20, 6),
    ...many("부산", 20, 7),
    ...many("대구", 20, 8),
    ...many("광주", 20, 9),
    ...many("제주", 2, 60), // 미분양률은 최고지만 표본 2곳
  ];

  it("표본 적은 지역은 미분양률이 최고여도 맨 아래 — 순위를 독차지하지 않는다", () => {
    const bars = buildRegionBars(scored);
    expect(bars[bars.length - 1].region).toBe("제주");
    expect(bars[0].region).toBe("광주"); // 표본 충분한 것 중 가장 높은 9%
  });

  it("처음에는 상위 5개만 보인다 — 17개를 다 펴면 홈을 독차지한다", () => {
    render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} />);
    expect(screen.getByText("광주")).toBeInTheDocument();
    expect(screen.queryByText("제주")).toBeNull(); // 6번째 이하는 접혀 있다
    expect(screen.getByText(/지역 2개 더 보기/)).toBeInTheDocument();
  });

  it("'더 보기' 를 누르면 나머지가 펼쳐진다", () => {
    render(<MarketSummaryWidget scored={scored} dataFreshnessText={null} />);
    fireEvent.click(screen.getByText(/지역 2개 더 보기/));
    expect(screen.getByText("제주")).toBeInTheDocument();
    expect(screen.getByText(/접기/)).toBeInTheDocument();
  });

  it("지역이 5개 이하면 '더 보기' 가 없다", () => {
    const few = [...many("경기", 20, 4), ...many("서울", 20, 5)];
    render(<MarketSummaryWidget scored={few} dataFreshnessText={null} />);
    expect(screen.queryByText(/더 보기/)).toBeNull();
  });
});
