import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepBars } from "./StepBars";

/**
 * 계단 막대 — 세션589 에 층별 매매가 카드(`detail/DataSectionBlock` PriceByFloorBlock)에서 떼어낸 부품.
 * 카드 쪽 글자(제목·건수·문장)는 `DataSectionBlock.test.jsx` 가 그대로 지킨다.
 */

const ITEMS = [
  { label: "1-5층", value: 25000, valueText: "2억 5,000만", sub: "3건" },
  { label: "6-15층", value: 50000, valueText: "5억", sub: "12건" },
  { label: "16층+", value: 100000, valueText: "10억", sub: "7건" },
];

/** 막대(파란 칸)만 — 바탕색(C.blue)으로 집는다 */
const bars = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[style*="background: rgb(37, 99, 235)"]')];

describe("StepBars", () => {
  it("막대 높이는 가장 큰 값 대비 비율이다", () => {
    const { container } = render(<StepBars items={ITEMS} />);
    expect(bars(container).map((b) => b.style.height)).toEqual(["25%", "50%", "100%"]);
  });

  it("값이 아주 작아도 막대가 사라지지 않는다 (최소 8%)", () => {
    const { container } = render(
      <StepBars
        items={[
          { label: "a", value: 1, valueText: "1" },
          { label: "b", value: 1000, valueText: "1,000" },
        ]}
      />
    );
    expect(bars(container).map((b) => b.style.height)).toEqual(["8%", "100%"]);
  });

  it("전부 0 이어도 0 으로 나누지 않는다", () => {
    const { container } = render(<StepBars items={[{ label: "a", value: 0, valueText: "-" }]} />);
    expect(bars(container).map((b) => b.style.height)).toEqual(["8%"]);
  });

  it("막대 위에 값 글자, 아래에 구간 이름과 작은 글자를 적는다", () => {
    render(<StepBars items={ITEMS} />);
    for (const it of ITEMS) {
      expect(screen.getByText(it.valueText)).toBeTruthy();
      expect(screen.getByText(it.label)).toBeTruthy();
      expect(screen.getByText(it.sub)).toBeTruthy();
    }
  });

  it("작은 글자가 없으면 그 줄을 안 그린다", () => {
    const { container } = render(<StepBars items={[{ label: "a", value: 1, valueText: "1" }]} />);
    expect(container.textContent).toBe("1a");
  });

  it("막대 영역 높이는 기본 84px, 바꿀 수 있다", () => {
    const a = render(<StepBars items={ITEMS} />).container.firstElementChild as HTMLElement;
    expect(a.style.height).toBe("84px");
    const b = render(<StepBars items={ITEMS} height={60} />).container.firstElementChild as HTMLElement;
    expect(b.style.height).toBe("60px");
  });

  it("막대 영역은 스크린리더에서 숨긴다 (문장은 감싸는 ChartFrame 이 읽는다)", () => {
    const { container } = render(<StepBars items={ITEMS} />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
});
