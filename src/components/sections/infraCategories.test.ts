import { describe, it, expect } from "vitest";
import { INFRA_CATEGORIES } from "./infraCategories";

describe("INFRA_CATEGORIES", () => {
  it("8개 카테고리", () => {
    expect(INFRA_CATEGORIES).toHaveLength(8);
  });

  it("key 가 유니크", () => {
    const keys = INFRA_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(8);
  });

  it("카카오 카테고리 코드 형식 (영문2+숫자1)", () => {
    for (const c of INFRA_CATEGORIES) {
      expect(c.code).toMatch(/^[A-Z]{2}\d$/);
    }
  });

  it("radius 는 양수", () => {
    for (const c of INFRA_CATEGORIES) {
      expect(c.radius).toBeGreaterThan(0);
    }
  });

  it("기존 4개(지하철·병원·마트·학교) + 신규 4개(학원·편의점·약국·카페) 포함", () => {
    const keys = INFRA_CATEGORIES.map((c) => c.key);
    for (const k of ["subway", "hospital", "mart", "school", "academy", "conv", "pharmacy", "cafe"]) {
      expect(keys).toContain(k);
    }
  });
});
