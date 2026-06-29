import { describe, it, expect } from "vitest";
import { OVERVIEW_SECTIONS, LOCATION_SECTIONS, PRICE_SECTIONS, PRESALE_SECTIONS, fieldsOf } from "./dataSections";

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

// 세션 459 — 수집/점수반영됐으나 손님 데이터 탭에 미노출이던 필드 노출 (표시 전용).
describe("dataSections 노출 필드 (세션 459 표시 공백 메움)", () => {
  const locationFields = LOCATION_SECTIONS.flatMap(fieldsOf);
  const priceFields = PRICE_SECTIONS.flatMap(fieldsOf);
  const presaleFields = PRESALE_SECTIONS.flatMap(fieldsOf);

  it("입지 탭에 조망·일조·소음(view/sunlight/noise) 노출", () => {
    expect(locationFields).toContain("view");
    expect(locationFields).toContain("sunlight");
    expect(locationFields).toContain("noise");
  });

  it("시세 탭에 주택보급률(housingSupplyLevel) 노출", () => {
    expect(priceFields).toContain("housingSupplyLevel");
  });

  it("분양 탭에 계약해제율·신규공급(cancelRatio6m/newSupply) 노출", () => {
    expect(presaleFields).toContain("cancelRatio6m");
    expect(presaleFields).toContain("newSupply");
  });

  it("분양 안전지표 섹션은 hideWhenEmpty 아님(항상 노출 — 청약경쟁 hide 결합 회피)", () => {
    const safety = PRESALE_SECTIONS.find((s) => s.title === "분양 안전지표");
    expect(safety).toBeDefined();
    expect(safety?.hideWhenEmpty).toBeFalsy();
  });
});
