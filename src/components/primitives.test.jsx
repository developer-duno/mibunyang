import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Bar, ScoreBadge, Radar, LineChart } from "./primitives";

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
    expect(inner.style.width).toBe("100%");
  });

  // 음수 값은 0%로 클램핑
  it("음수 값은 width가 0%로 클램핑", () => {
    render(<Bar value={-10} />);
    const bar = screen.getByRole("progressbar");
    const inner = bar.querySelector("div");
    expect(inner.style.width).toBe("0%");
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
    expect(svg.getAttribute("width")).toBe("80");
    expect(svg.getAttribute("height")).toBe("80");
  });
});

describe("Radar", () => {
  // 빈 데이터면 null 반환
  it("빈 배열이면 아무것도 렌더링하지 않음", () => {
    const { container } = render(<Radar data={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("null data면 아무것도 렌더링하지 않음", () => {
    const { container } = render(<Radar data={null} />);
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
    expect(svg.getAttribute("width")).toBe("200");
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
    expect(svg.getAttribute("aria-label")).toBe("테스트 차트");
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
    fireEvent.click(hitArea);
    // 활성 dot: r=5, stroke=white
    const activeDot = container.querySelector('circle[r="5"]');
    expect(activeDot).toBeInTheDocument();
    // 툴팁 text: fontWeight 600
    const tooltipText = container.querySelector("text[font-weight='600']");
    expect(tooltipText).toBeInTheDocument();
    expect(tooltipText.textContent).toBe("2월: 120");
  });

  // 같은 포인트 재클릭 시 토글 (dismiss)
  it("같은 포인트 재클릭 시 툴팁 dismiss", () => {
    const { container } = render(<LineChart data={chartData} />);
    const hitArea = container.querySelector('circle[data-index="0"]');
    fireEvent.click(hitArea);
    expect(container.querySelector('circle[r="5"]')).toBeInTheDocument();
    fireEvent.click(hitArea);
    expect(container.querySelector('circle[r="5"]')).toBeNull();
  });

  // 3초 후 자동 dismiss
  it("3초 후 자동 dismiss", () => {
    vi.useFakeTimers();
    const { container } = render(<LineChart data={chartData} />);
    const hitArea = container.querySelector('circle[data-index="1"]');
    fireEvent.click(hitArea);
    expect(container.querySelector('circle[r="5"]')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(container.querySelector('circle[r="5"]')).toBeNull();
    vi.useRealTimers();
  });
});
