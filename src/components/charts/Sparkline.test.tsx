import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sparkline, sparkPoints, SPARK_H, SPARK_W } from "./Sparkline";

describe("sparkPoints — 큰 값이 위(작은 y)", () => {
  it("최솟값은 아래 끝, 최댓값은 위 끝 · 첫 점 왼쪽 · 끝 점 오른쪽", () => {
    const p = sparkPoints([10, 30, 20]);
    expect(p[0].y).toBeGreaterThan(p[1].y); // 10 이 30 보다 아래
    expect(p[1].y).toBeLessThan(p[2].y);
    expect(p[0].x).toBeLessThan(p[2].x);
    expect(Math.max(...p.map((q) => q.y))).toBeLessThanOrEqual(SPARK_H);
    expect(Math.max(...p.map((q) => q.x))).toBeLessThanOrEqual(SPARK_W);
  });

  it("값이 전부 같으면 가운데 수평선 (0 으로 나누지 않는다)", () => {
    const p = sparkPoints([5, 5, 5]);
    expect(p.every((q) => q.y === SPARK_H / 2)).toBe(true);
  });
});

describe("Sparkline", () => {
  it("점이 2개 미만이면 안 그린다", () => {
    const { container } = render(<Sparkline values={[1]} color="#000" ariaLabel="x" />);
    expect(container.firstChild).toBeNull();
  });

  it("aria-label 한 문장 + 마지막 점 표시가 오른쪽 끝·최신 값 높이에 있다", () => {
    const { container } = render(<Sparkline values={[1, 3, 2]} color="#123456" ariaLabel="평균분양가격 추이" />);
    expect(screen.getByRole("img", { name: "평균분양가격 추이" })).toBeTruthy();
    const last = container.querySelector("[data-spark-last]");
    const pts = sparkPoints([1, 3, 2]);
    expect(Number(last?.getAttribute("x1"))).toBeCloseTo(pts[2].x, 5);
    expect(Number(last?.getAttribute("y1"))).toBeCloseTo(pts[2].y, 5);
  });
});
