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
});
