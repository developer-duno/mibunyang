// @ts-check
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FAQSection } from "./FAQSection";

/**
 * FAQ 답변이 **화면과 어긋나지 않는지** 지키는 가드 (세션 513).
 *
 * 사고 기록 — ① JS 문자열 안의 &apos; 는 JSX 엔티티로 해석되지 않아 손님 화면에
 * "&apos;공유&apos;" 글자 그대로 찍혀 있었다(GuideSections 4곳과 같은 결함).
 * ② 혜택 계산 답변이 서브지표 6종을 "모두 만원 단위로 합산합니다"라고 단언했는데
 * 5종(할인·무이자·옵션·발코니·캐시백)은 전 단지 미수집이다 — ScoringEngine 혜택 desc 와
 * 같은 정정([[score-meaning-and-wording-are-a-pair]]).
 *
 * 잔재 검사는 손님이 실제로 읽는 한글 문구로 한다.
 */
describe("FAQSection — 화면에 찍히는 그대로 검사한다", () => {
  /** 화면에 실제로 렌더되는 글자 전체 */
  function faqText() {
    const { container } = render(<FAQSection />);
    return container.textContent || "";
  }

  it('"&apos;" 가 손님 화면에 글자 그대로 찍히지 않는다', () => {
    expect(faqText()).not.toContain("&apos;");
  });

  it('혜택 6종을 "모두 합산"한다고 단언하지 않는다 — 5종은 전 단지 미수집', () => {
    expect(faqText()).not.toContain("모두 만원 단위로 합산");
  });

  it("혜택은 채워진 항목만 말하고, 나머지는 대기 중이라고 말한다", () => {
    expect(faqText()).toContain("자료가 확보되면");
  });
});
