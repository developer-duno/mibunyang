// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Bar, ScoreBadge, Radar, LineChart, SkeletonBox, SkeletonText, SkeletonList } from "./primitives";
import { niceTicks } from "./LineChart";

describe("Bar", () => {
  // null/undefined value는 0으로 폴백
  it("null value일 때 aria-valuenow=0으로 렌더링", () => {
    render(<Bar value={null} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toBeInTheDocument();
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
  });

  it("정상 값이면 aria-valuenow에 반영", () => {
    render(<Bar value={75} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("75");
  });

  // 100 초과 값은 클램핑
  it("100 초과 값은 width가 100%로 클램핑", () => {
    render(<Bar value={150} />);
    const bar = screen.getByRole("progressbar");
    const inner = bar.querySelector("div");
    expect(inner?.style.width).toBe("100%");
  });

  // 음수 값은 0%로 클램핑
  it("음수 값은 width가 0%로 클램핑", () => {
    render(<Bar value={-10} />);
    const bar = screen.getByRole("progressbar");
    const inner = bar.querySelector("div");
    expect(inner?.style.width).toBe("0%");
  });
});

describe("ScoreBadge", () => {
  // null score는 0으로 폴백
  it("null score일 때 0점 D등급 표시", () => {
    render(<ScoreBadge score={null} />);
    const badge = screen.getByRole("img");
    expect(badge).toHaveAttribute("aria-label", "점수: 0점 (D등급)");
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("D")).toBeInTheDocument();
  });

  it("90점 이상은 S등급", () => {
    render(<ScoreBadge score={95} />);
    expect(screen.getByText("S")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("70점은 B+등급", () => {
    render(<ScoreBadge score={70} />);
    expect(screen.getByText("B+")).toBeInTheDocument();
  });

  it("size prop이 SVG에 반영", () => {
    const { container } = render(<ScoreBadge score={50} size={80} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("80");
    expect(svg?.getAttribute("height")).toBe("80");
  });
});

describe("Radar", () => {
  // 빈 데이터면 null 반환
  it("빈 배열이면 아무것도 렌더링하지 않음", () => {
    const { container } = render(<Radar data={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("null data면 아무것도 렌더링하지 않음", () => {
    const { container } = render(<Radar data={/** @type {any} */ (null)} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("데이터가 있으면 SVG 레이더 차트 렌더링", () => {
    const data = [
      { l: "가격", v: 70 },
      { l: "입지", v: 80 },
      { l: "상품", v: 60 },
    ];
    render(<Radar data={data} />);
    const svg = screen.getByRole("img", { name: "카테고리별 점수 레이더 차트" });
    expect(svg).toBeInTheDocument();
    expect(screen.getByText("가격")).toBeInTheDocument();
    expect(screen.getByText("입지")).toBeInTheDocument();
    expect(screen.getByText("상품")).toBeInTheDocument();
  });

  it("size prop이 SVG에 반영", () => {
    const data = [{ l: "A", v: 50 }, { l: "B", v: 60 }];
    const { container } = render(<Radar data={data} size={200} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("200");
  });
});

describe("niceTicks", () => {
  // 불변식: 항상 min < max 이고 ticks 2개 이상
  it("모든 반환값이 min<max + ticks.length>=2 불변식 만족", () => {
    for (const [a, b] of [[1, 1], [52845, 52845], [0, 1], [100, 120], [1, 5], [0, 0], [3, 3]]) {
      const r = niceTicks(a, b);
      expect(r.min).toBeLessThan(r.max);
      expect(r.ticks.length).toBeGreaterThanOrEqual(2);
    }
  });

  // 작은 정수 동일값 → 값 중앙 + 정수 눈금
  it("niceTicks(1,1) → 정수 눈금 [0,1,2], 1이 중앙", () => {
    const r = niceTicks(1, 1);
    expect(r.ticks).toEqual([0, 1, 2]);
    expect(r.min).toBe(0);
    expect(r.max).toBe(2);
  });

  // 큰 동일값 → 값 중앙 + 위아래 여백 (소수 눈금 정체 방지)
  it("niceTicks(52845,52845) → 3 눈금, 52845가 가운데", () => {
    const r = niceTicks(52845, 52845);
    expect(r.ticks).toContain(52845);
    expect(r.ticks.length).toBe(3);
    expect(r.min).toBeLessThan(52845);
    expect(r.max).toBeGreaterThan(52845);
  });

  // 작은 정수 범위 → 정수 눈금만 (소수 눈금 제거)
  it("niceTicks(0,1) → 정수 눈금 [0,1]", () => {
    expect(niceTicks(0, 1).ticks).toEqual([0, 1]);
  });

  // 미분양 0건 지속 케이스
  it("niceTicks(0,0) → [0,1] 정수 눈금", () => {
    const r = niceTicks(0, 0);
    expect(r.ticks).toEqual([0, 1]);
  });

  // 일반 데이터 → nice step (5 또는 10 배수 간격)
  it("niceTicks(100,120) → 5 단위 nice 눈금", () => {
    const r = niceTicks(100, 120);
    expect(r.ticks).toEqual([100, 105, 110, 115, 120]);
  });

  // 정수 데이터 11 이상 범위 → nice step 적용 (정수 1단위 분기 벗어남)
  it("niceTicks(0,40) → nice step 눈금, 첫 눈금 0", () => {
    const r = niceTicks(0, 40);
    expect(r.ticks[0]).toBe(0);
    expect(r.min).toBe(0);
    expect(r.ticks.length).toBeGreaterThanOrEqual(4);
  });
});

describe("LineChart", () => {
  const chartData = [
    { x: "1월", y: 100, label: "1월: 100" },
    { x: "2월", y: 120, label: "2월: 120" },
    { x: "3월", y: 110, label: "3월: 110" },
  ];

  // 데이터 부족 시 메시지 표시
  it("데이터 1개 이하면 '데이터가 부족합니다' 메시지", () => {
    render(<LineChart data={[{ x: "1월", y: 100 }]} />);
    expect(screen.getByText("데이터가 부족합니다")).toBeInTheDocument();
  });

  // 정상 렌더링
  it("데이터 2개 이상이면 SVG 차트 렌더링", () => {
    const { container } = render(<LineChart data={chartData} yLabel="테스트 차트" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg?.getAttribute("aria-label")).toBe("테스트 차트");
  });

  // title 요소 유지 (접근성)
  it("각 데이터 포인트에 title 요소 존재 (접근성)", () => {
    const { container } = render(<LineChart data={chartData} />);
    const titles = container.querySelectorAll("circle title");
    expect(titles.length).toBe(chartData.length);
    expect(titles[0].textContent).toBe("1월: 100");
  });

  // 투명 hit area circle 존재
  it("투명 hit area circle이 데이터 수만큼 존재", () => {
    const { container } = render(<LineChart data={chartData} />);
    const hitAreas = container.querySelectorAll('circle[data-index]');
    expect(hitAreas.length).toBe(chartData.length);
  });

  // 클릭으로 툴팁 표시 — 활성 dot(r=5) + 툴팁 text(fontWeight=600) 확인
  it("hit area 클릭 시 툴팁 표시", () => {
    const { container } = render(<LineChart data={chartData} />);
    const hitArea = container.querySelector('circle[data-index="1"]');
    fireEvent.click(hitArea ?? document.body);
    // 활성 dot: r=5, stroke=white
    const activeDot = container.querySelector('circle[r="5"]');
    expect(activeDot).toBeInTheDocument();
    // 툴팁 text: fontWeight 600, data-pointlabel 없는 것
    const tooltipText = container.querySelector("text[font-weight='600']:not([data-pointlabel])");
    expect(tooltipText).toBeInTheDocument();
    expect(tooltipText?.textContent).toBe("2월: 120");
  });

  // 같은 포인트 재클릭 시 토글 (dismiss)
  it("같은 포인트 재클릭 시 툴팁 dismiss", () => {
    const { container } = render(<LineChart data={chartData} />);
    const hitArea = container.querySelector('circle[data-index="0"]');
    fireEvent.click(hitArea ?? document.body);
    expect(container.querySelector('circle[r="5"]')).toBeInTheDocument();
    fireEvent.click(hitArea ?? document.body);
    expect(container.querySelector('circle[r="5"]')).toBeNull();
  });

  // 3초 후 자동 dismiss
  it("3초 후 자동 dismiss", () => {
    vi.useFakeTimers();
    const { container } = render(<LineChart data={chartData} />);
    const hitArea = container.querySelector('circle[data-index="1"]');
    fireEvent.click(hitArea ?? document.body);
    expect(container.querySelector('circle[r="5"]')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(container.querySelector('circle[r="5"]')).toBeNull();
    vi.useRealTimers();
  });

  // 모든 값이 동일해도 선이 차트 가운데에 그려진다 (가장자리에 안 붙음)
  it("모든 y 동일 시 선이 차트 가장자리에 붙지 않는다", () => {
    const flat = [
      { x: "1월", y: 52845 },
      { x: "2월", y: 52845 },
    ];
    const { container } = render(<LineChart data={flat} height={160} />);
    const path = container.querySelector("path[stroke]");
    expect(path).toBeInTheDocument();
    const d = path?.getAttribute("d") ?? "";
    const ys = [...d.matchAll(/[ML][\d.]+,([\d.]+)/g)].map(m => parseFloat(m[1]));
    // height 160, pad.t=16, pad.b=28 → 내부 영역 16~132. 가운데 ≈ 74
    for (const y of ys) {
      expect(y).toBeGreaterThan(30);
      expect(y).toBeLessThan(120);
    }
  });

  // 정수 데이터의 Y축 눈금 텍스트에 소수점이 없다
  it("정수 데이터 Y축 눈금에 소수점 라벨 없음", () => {
    const intData = [
      { x: "1월", y: 1 },
      { x: "2월", y: 1 },
    ];
    const { container } = render(<LineChart data={intData} height={160} />);
    const labels = [...container.querySelectorAll("text")]
      .map(t => t.textContent)
      .filter(t => t && /^\d/.test(t));
    for (const l of labels) {
      expect(l).not.toMatch(/\./);
    }
  });

  // 데이터 3개 이하 → 점 반지름 확대 (r=4.5)
  it("데이터 3개 이하면 점 반지름이 4.5", () => {
    const few = [
      { x: "1월", y: 100 },
      { x: "2월", y: 120 },
    ];
    const { container } = render(<LineChart data={few} />);
    const dots = [...container.querySelectorAll("circle")].filter(
      c => c.getAttribute("r") === "4.5" && !c.hasAttribute("data-index")
    );
    expect(dots.length).toBe(2);
  });

  // 데이터 4개 이상 → 점 반지름 기존(r=3)
  it("데이터 4개 이상이면 점 반지름이 3", () => {
    const many = [
      { x: "1월", y: 100 }, { x: "2월", y: 120 },
      { x: "3월", y: 110 }, { x: "4월", y: 130 },
    ];
    const { container } = render(<LineChart data={many} />);
    const dots = [...container.querySelectorAll("circle")].filter(
      c => c.getAttribute("r") === "3" && !c.hasAttribute("data-index")
    );
    expect(dots.length).toBe(4);
  });

  // 데이터 3개 이하 → 각 점에 값 라벨 텍스트 상시 표시
  it("데이터 3개 이하면 각 점 위에 값 라벨 표시", () => {
    const few = [
      { x: "1월", y: 1000 },
      { x: "2월", y: 2000 },
    ];
    const { container } = render(<LineChart data={few} />);
    const valLabels = container.querySelectorAll("text[data-pointlabel]");
    expect(valLabels.length).toBe(2);
    expect(valLabels[0].textContent).toBe("1,000");
    expect(valLabels[1].textContent).toBe("2,000");
  });
});

describe("SkeletonBox", () => {
  it("기본 prop 으로 렌더링", () => {
    const { container } = render(<SkeletonBox />);
    const el = container.querySelector("div[aria-hidden='true']");
    expect(el).toBeInTheDocument();
    expect(/** @type {HTMLElement} */ (el)?.style.animation).toContain("skeleton-pulse");
  });
});

describe("SkeletonText", () => {
  it("lines prop 개수만큼 bar 렌더링 (마지막은 60%)", () => {
    const { container } = render(<SkeletonText lines={4} />);
    const wrapper = container.querySelector("div[aria-hidden='true']");
    expect(wrapper?.children.length).toBe(4);
  });

  it("기본 lines=3 이면 3줄 렌더링", () => {
    const { container } = render(<SkeletonText />);
    const wrapper = container.querySelector("div[aria-hidden='true']");
    expect(wrapper?.children.length).toBe(3);
  });
});

describe("SkeletonList", () => {
  it("count prop 개수만큼 카드 렌더링", () => {
    const { container } = render(<SkeletonList count={5} columns={2} />);
    const grid = container.querySelector("div[aria-hidden='true']");
    expect(grid?.children.length).toBe(5);
    expect(/** @type {HTMLElement} */ (grid)?.style.gridTemplateColumns).toBe("repeat(2, 1fr)");
  });
});
