// @ts-check
import { describe, it, expect } from "vitest";
import {
  buildMarkerSvg,
  shortPrice,
  MARKER_WITH_PRICE,
  MARKER_NO_PRICE,
  MARKER_WITH_PRICE_SEL,
  MARKER_NO_PRICE_SEL,
} from "./markerSvg";

describe("shortPrice", () => {
  it("1억 이상은 억 단위", () => {
    expect(shortPrice(50000)).toBe("5억");
    expect(shortPrice(55000)).toBe("5.5억");
    expect(shortPrice(10000)).toBe("1억");
  });
  it("1억 미만은 만 단위(천단위 콤마)", () => {
    expect(shortPrice(3000)).toBe("3,000만");
  });
  it("null/0/음수는 빈 문자열", () => {
    expect(shortPrice(null)).toBe("");
    expect(shortPrice(undefined)).toBe("");
    expect(shortPrice(0)).toBe("");
    expect(shortPrice(-1)).toBe("");
  });
});

describe("buildMarkerSvg — 가격배지", () => {
  it("priceLabel 있으면 배지 크기 + 점수·가격·등급색·그림자 포함", () => {
    const m = buildMarkerSvg(75, "#16A34A", "5억");
    expect(m.w).toBe(MARKER_WITH_PRICE.w);
    expect(m.h).toBe(MARKER_WITH_PRICE.h);
    expect(m.svg).toContain("<svg");
    expect(m.svg).toContain("75점");
    expect(m.svg).toContain("5억");
    expect(m.svg).toContain("#16A34A"); // 등급색
    expect(m.svg).toContain("rgba(0,0,0,0.22)"); // 도형 그림자 (디자인 회귀 가드)
    expect(m.svg).toContain('stroke="#fff"'); // 흰 테두리
  });
});

describe("buildMarkerSvg — 무가격 핀", () => {
  it("priceLabel 비면 핀 크기 + 점수만(점 글자 없음)", () => {
    const m = buildMarkerSvg(75, "#16A34A", "");
    expect(m.w).toBe(MARKER_NO_PRICE.w);
    expect(m.h).toBe(MARKER_NO_PRICE.h);
    expect(m.svg).toContain("<svg");
    expect(m.svg).toContain(">75</text>"); // 점수 숫자만 (가격배지는 "75점")
    expect(m.svg).not.toContain("점"); // 무가격은 "점" 미포함
    expect(m.svg).toContain("#16A34A");
    expect(m.svg).toContain('stroke="#fff"');
  });
});

describe("buildMarkerSvg — 선택 강조", () => {
  it("selected=true 가격배지는 일반보다 큰 w/h", () => {
    const sel = buildMarkerSvg(75, "#16A34A", "5억", true);
    expect(sel.w).toBe(MARKER_WITH_PRICE_SEL.w);
    expect(sel.h).toBe(MARKER_WITH_PRICE_SEL.h);
    expect(sel.w).toBeGreaterThan(MARKER_WITH_PRICE.w);
    expect(sel.h).toBeGreaterThan(MARKER_WITH_PRICE.h);
    expect(sel.svg).toContain("75점");
  });
  it("selected=true 무가격핀도 일반보다 큰 w/h", () => {
    const sel = buildMarkerSvg(75, "#16A34A", "", true);
    expect(sel.w).toBe(MARKER_NO_PRICE_SEL.w);
    expect(sel.h).toBe(MARKER_NO_PRICE_SEL.h);
    expect(sel.w).toBeGreaterThan(MARKER_NO_PRICE.w);
  });
});

describe("offset 정합 (h == 핀 끝점, MarkerImage offset.y)", () => {
  it("가격배지 반환 h 가 상수와 일치 (offset=(w/2,h) 핀 끝점)", () => {
    const m = buildMarkerSvg(80, "#2563EB", "3억");
    expect(m.h).toBe(MARKER_WITH_PRICE.h);
    // 꼬리 끝점 y == h: polygon 의 가운데 점 y 가 h 와 같아야 핀 끝이 좌표에 꽂힘
    expect(m.svg).toContain(`${m.w / 2},${m.h}`);
  });
});
