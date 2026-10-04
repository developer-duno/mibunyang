import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PositionGauge, positionPct } from "./PositionGauge";

/**
 * 위치 게이지 — 세션589 에 `DetailModal` 에서 떼어낸 부품.
 * 적정가 줄의 모양(문구·경계·색)은 `DetailModal.test.jsx` "적정가 대비 위치 게이지" 묶음이 그대로 지킨다 —
 * 여기는 부품 자신의 산수와 뼈대를 본다.
 */

describe("positionPct — 값 → 눈금 위 위치", () => {
  // 적정가 줄과 같은 눈금: 가운데 0, 오른쪽 끝 +35(저렴), 왼쪽 끝 −35(비쌈)
  it("가운데 값은 50, 양 끝 값은 0 과 100", () => {
    expect(positionPct(0, 0, 35, -35)).toBe(50);
    expect(positionPct(35, 0, 35, -35)).toBe(100);
    expect(positionPct(-35, 0, 35, -35)).toBe(0);
  });

  it("끝을 넘는 값은 끝에 고정된다", () => {
    expect(positionPct(69, 0, 35, -35)).toBe(100);
    expect(positionPct(-182, 0, 35, -35)).toBe(0);
  });

  it("안쪽 값은 가운데에서 그 끝까지의 비율이다", () => {
    expect(positionPct(31.5, 0, 35, -35)).toBe(95);
    expect(positionPct(-31.5, 0, 35, -35)).toBe(5);
  });

  it("두 쪽의 폭이 달라도 각자 비례한다", () => {
    // 오른쪽 폭 20, 왼쪽 폭 40
    expect(positionPct(10, 0, 20, -40)).toBe(75);
    expect(positionPct(-10, 0, 20, -40)).toBe(37.5);
  });

  // PSR 줄: 가운데 1.0(100%), 오른쪽 끝 0.7(낮을수록 유리), 왼쪽 끝 1.2
  it("오른쪽 끝이 가운데보다 작은 눈금(낮을수록 유리)도 된다", () => {
    expect(positionPct(1.0, 1.0, 0.7, 1.2)).toBe(50);
    expect(positionPct(0.7, 1.0, 0.7, 1.2)).toBe(100);
    expect(positionPct(0.38, 1.0, 0.7, 1.2)).toBe(100); // 끝을 넘음
    expect(positionPct(1.2, 1.0, 0.7, 1.2)).toBeCloseTo(0, 10);
    expect(positionPct(9, 1.0, 0.7, 1.2)).toBe(0);
    expect(positionPct(0.85, 1.0, 0.7, 1.2)).toBeCloseTo(75, 10);
    expect(positionPct(1.1, 1.0, 0.7, 1.2)).toBeCloseTo(25, 10);
  });

  it("끝과 가운데가 같으면(폭 0) 가운데에 둔다 — 0 으로 나누지 않는다", () => {
    expect(positionPct(5, 0, 0, 0)).toBe(50);
  });
});

describe("PositionGauge — 뼈대", () => {
  const draw = (pct: number) =>
    render(
      <PositionGauge
        pct={pct}
        color="rgb(1, 2, 3)"
        leftLabel="35% 비쌈"
        centerLabel="+12% 저렴"
        rightLabel="35% 저렴"
      />
    ).container;

  it("점은 pct 위치에, 가운데 선은 50% 에 있다", () => {
    const c = draw(80);
    const dot = c.querySelector<HTMLElement>('[style*="border-radius: 50%"]');
    expect(dot?.style.left).toBe("80%");
    expect(dot?.style.width).toBe("14px");
    expect(dot?.style.background).toBe("rgb(1, 2, 3)");
    expect(c.querySelector<HTMLElement>('[style*="width: 2px"]')?.style.left).toBe("50%");
  });

  it("글자는 왼쪽 끝 · 가운데(값) · 오른쪽 끝 순서, 가운데 글자만 점과 같은 색·굵게", () => {
    const spans = [...draw(80).querySelectorAll("span")];
    expect(spans.map((s) => s.textContent)).toEqual(["35% 비쌈", "+12% 저렴", "35% 저렴"]);
    expect(spans[1].style.color).toBe("rgb(1, 2, 3)");
    expect(spans[1].style.fontWeight).toBe("700");
    expect(spans[0].style.color).toBe("");
  });
});
