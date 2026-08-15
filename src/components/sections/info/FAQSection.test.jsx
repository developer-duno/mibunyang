// @ts-check
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PROFILES } from "@/constants/profiles";
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

  /**
   * 세션514 — 프로필 가중치 안내가 옛 값을 말하고 있었다.
   *
   * "'투자' 프로필은 가격(30%)과 안전(25%)에, '교육' 프로필은 입지(45%)에" — 세 칸 전부 어긋났다
   * (실제 35/30/50). #398(세션513)이 **같은 파일의 다른 줄만** 고치고 이 줄을 놓친 자리다.
   * 이제 `PROFILES` 에서 파생하므로 가중치가 바뀌면 안내문이 저절로 따라온다
   * (GuideSections 가 이미 쓰는 방식 — [[score-meaning-and-wording-are-a-pair]]).
   */
  describe("프로필 가중치 안내는 PROFILES 에서 파생한다", () => {
    it("화면 수치가 실제 가중치와 같다", () => {
      const t = faqText();
      expect(t).toContain(`가격(${PROFILES.invest.w.price}%)`);
      expect(t).toContain(`안전(${PROFILES.invest.w.risk}%)`);
      expect(t).toContain(`입지(${PROFILES.edu.w.location}%)`);
    });

    it("프로필 이름도 손으로 적지 않는다", () => {
      const t = faqText();
      expect(t).toContain(`'${PROFILES.invest.name}' 프로필`);
      expect(t).toContain(`'${PROFILES.edu.name}' 프로필`);
    });

    it("옛 하드코딩 수치가 남아 있지 않다", () => {
      const t = faqText();
      // 되돌리면 red — 세 칸 전부 실제 가중치와 다른 값이었다
      expect(t).not.toContain("가격(30%)");
      expect(t).not.toContain("안전(25%)");
      expect(t).not.toContain("입지(45%)");
    });
  });
});
