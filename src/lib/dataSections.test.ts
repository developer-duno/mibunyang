import { describe, it, expect } from "vitest";
import { OVERVIEW_SECTIONS, LOCATION_SECTIONS, PRICE_SECTIONS, PRESALE_SECTIONS } from "./dataSections";

describe("dataSections hint", () => {
  it("종합·입지·시세 섹션 6개 모두 hint 가 채워져 있다", () => {
    const all = [...OVERVIEW_SECTIONS, ...LOCATION_SECTIONS, ...PRICE_SECTIONS];
    expect(all).toHaveLength(6);
    for (const s of all) {
      expect(typeof s.hint).toBe("string");
      expect((s.hint ?? "").length).toBeGreaterThan(10);
    }
  });

  it("분양 섹션 hint(세션 411)는 그대로 유지된다", () => {
    expect(PRESALE_SECTIONS.every((s) => (s.hint ?? "").length > 10)).toBe(true);
  });
});
