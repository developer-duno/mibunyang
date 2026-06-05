// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompletenessDonut } from "./CompletenessDonut";
import { C } from "@/theme";

/** 진행 circle(data-role="progress")의 stroke 색 반환
 * @param {HTMLElement} container */
function progressStroke(container) {
  const circle = container.querySelector('circle[data-role="progress"]');
  return circle?.getAttribute("stroke");
}

describe("CompletenessDonut", () => {
  // 9. pct → 구간별 색 (80 초록 / 50 주황 / 미만 빨강) — C 토큰 비교, hex 하드코딩 금지
  it("pct 구간에 따라 stroke 색이 초록/주황/빨강으로 바뀐다", () => {
    const { container: c90 } = render(<CompletenessDonut pct={90} />);
    expect(progressStroke(c90)).toBe(C.green);
    const { container: c65 } = render(<CompletenessDonut pct={65} />);
    expect(progressStroke(c65)).toBe(C.amber);
    const { container: c30 } = render(<CompletenessDonut pct={30} />);
    expect(progressStroke(c30)).toBe(C.red);
  });

  // 임계 경계값 검증 (80=초록, 50=주황)
  it("경계값 80은 초록, 50은 주황", () => {
    const { container: c80 } = render(<CompletenessDonut pct={80} />);
    expect(progressStroke(c80)).toBe(C.green);
    const { container: c50 } = render(<CompletenessDonut pct={50} />);
    expect(progressStroke(c50)).toBe(C.amber);
  });

  // 10. role="img" + aria-label에 "채움률"·pct·label 포함, "점수" 글자 없음
  it("role=img이고 aria-label에 채움률·pct·label을 담되 '점수'는 없다", () => {
    render(<CompletenessDonut pct={75} label="생활인프라" />);
    const el = screen.getByRole("img");
    const aria = el.getAttribute("aria-label") ?? "";
    expect(aria).toContain("채움률");
    expect(aria).toContain("75%");
    expect(aria).toContain("생활인프라");
    expect(aria).not.toContain("점수");
  });

  // 11. 가운데 "N%" 텍스트
  it("가운데에 'N%' 텍스트를 표시한다", () => {
    render(<CompletenessDonut pct={42} />);
    expect(screen.getByText("42%")).toBeTruthy();
  });
});
