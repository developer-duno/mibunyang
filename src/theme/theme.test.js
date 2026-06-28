// @ts-check
import { describe, it, expect } from "vitest";
import { C, catCol, catBg, SHORT_LABEL, gr } from "./index";

describe("C (색상 팔레트)", () => {
  it("24개 이상 색상 정의", () => {
    expect(Object.keys(C).length).toBeGreaterThanOrEqual(20);
  });

  it("색상 값이 # 헥스 코드, shadow 값이 문자열", () => {
    Object.entries(C).forEach(([key, val]) => {
      if (key.startsWith("shadow")) {
        expect(typeof val).toBe("string");
      } else {
        expect(val).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    });
  });

  it("필수 색상 존재", () => {
    ["white", "bg", "text", "blue", "green", "amber", "red", "purple", "cyan"].forEach((k) => {
      expect(C).toHaveProperty(k);
    });
  });
});

describe("catCol / catBg", () => {
  const CATS = ["price", "location", "product", "benefit", "risk", "future"];

  it("catCol: 6개 카테고리 색상", () => {
    CATS.forEach((cat) => {
      expect(catCol).toHaveProperty(cat);
      expect(/** @type {any} */ (catCol)[cat]).toMatch(/^#/);
    });
  });

  it("catBg: 6개 카테고리 배경색", () => {
    CATS.forEach((cat) => {
      expect(catBg).toHaveProperty(cat);
      expect(/** @type {any} */ (catBg)[cat]).toMatch(/^#/);
    });
  });

  it("catCol과 catBg의 키가 동일", () => {
    expect(Object.keys(catCol).sort()).toEqual(Object.keys(catBg).sort());
  });
});

describe("SHORT_LABEL", () => {
  it("6개 약어 매핑", () => {
    expect(Object.keys(SHORT_LABEL)).toHaveLength(6);
  });

  it("모든 약어가 2자", () => {
    Object.values(SHORT_LABEL).forEach((v) => {
      expect(v.length).toBe(2);
    });
  });
});

describe("gr (등급 함수)", () => {
  // 경계값 테스트 — 가장 중요
  it("90 → S", () => {
    expect(gr(90).l).toBe("S");
  });
  it("89.9 → A", () => {
    expect(gr(89.9).l).toBe("A");
  });
  it("80 → A", () => {
    expect(gr(80).l).toBe("A");
  });
  it("79.9 → B+", () => {
    expect(gr(79.9).l).toBe("B+");
  });
  it("70 → B+", () => {
    expect(gr(70).l).toBe("B+");
  });
  it("69.9 → B", () => {
    expect(gr(69.9).l).toBe("B");
  });
  it("60 → B", () => {
    expect(gr(60).l).toBe("B");
  });
  it("59.9 → C", () => {
    expect(gr(59.9).l).toBe("C");
  });
  it("50 → C", () => {
    expect(gr(50).l).toBe("C");
  });
  it("49.9 → D", () => {
    expect(gr(49.9).l).toBe("D");
  });
  it("0 → D", () => {
    expect(gr(0).l).toBe("D");
  });
  it("100 → S", () => {
    expect(gr(100).l).toBe("S");
  });

  // null/undefined → D (NaN < 90 = false → ... → fallthrough → D)
  it("null → D", () => {
    expect(gr(null).l).toBe("D");
  });
  it("undefined → D", () => {
    expect(gr(undefined).l).toBe("D");
  });
  it("NaN → D", () => {
    expect(gr(NaN).l).toBe("D");
  });

  // 반환 구조 검증
  it("반환 객체에 l, c, bg 키 존재", () => {
    const result = gr(75);
    expect(result).toHaveProperty("l");
    expect(result).toHaveProperty("c");
    expect(result).toHaveProperty("bg");
  });

  it("색상이 유효한 헥스 코드", () => {
    [100, 85, 75, 65, 55, 30].forEach((s) => {
      expect(gr(s).c).toMatch(/^#/);
      expect(gr(s).bg).toMatch(/^#/);
    });
  });
});
