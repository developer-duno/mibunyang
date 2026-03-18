import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Bar, ScoreBadge, Radar } from "./primitives";

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
