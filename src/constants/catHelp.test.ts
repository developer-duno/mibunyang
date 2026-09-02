import { describe, it, expect } from "vitest";
import { catHelp } from "./catHelp";

describe("catHelp", () => {
  it("6개 카테고리 전부 비어있지 않은 설명을 반환한다", () => {
    for (const k of ["price", "location", "product", "risk", "benefit", "future"]) {
      const text = catHelp(k);
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("price 설명은 '적정가' 개념을 쉬운 말로 담는다", () => {
    expect(catHelp("price")).toContain("적정");
  });

  it("risk 설명은 '위험/안전' 개념을 담는다", () => {
    expect(catHelp("risk")).toMatch(/위험|안전/);
  });

  it("정의되지 않은 키는 빈 문자열을 반환한다 (HelpHint 가 자동 미표시)", () => {
    expect(catHelp("unknown")).toBe("");
    expect(catHelp("")).toBe("");
  });

  // 세션539 A-4: 옛 benefit 문구("중도금 무이자·발코니 확장 같은 분양 혜택이 얼마나
  // 있는지")는 100% 미수집(1,646곳 전부 null, scoreBenefit.ts:50 주석)인 항목만 예시로
  // 들었다. 금액이 있는 곳은 전부 '관리비 절감' 단독(scoreBenefit.ts:58 주석) — 형제
  // 문구(FAQSection.tsx:80·ScoringEngine.tsx:56)는 이미 이 실측대로 정정돼 있었다.
  describe("benefit 설명 (세션539 A-4)", () => {
    it("실제로 채워지는 '관리비 절감'을 담는다", () => {
      expect(catHelp("benefit")).toContain("관리비 절감");
    });

    it("미수집 5종(중도금 무이자·발코니 확장 등)을 확정형으로 말하지 않는다", () => {
      const t = catHelp("benefit");
      // 언급하더라도 반드시 "자료가 확보되면" 류의 유보 표현이 같은 문장에 있어야 한다 —
      // 유보 없이 "얼마나 있는지 보는 항목"처럼 확정형으로 되돌리면 이 단언이 깨진다.
      for (const word of ["중도금 무이자", "발코니 확장", "분양가 할인", "옵션 무상", "캐시백"]) {
        if (t.includes(word)) expect(t).toMatch(/확보되면/);
      }
    });
  });
});
