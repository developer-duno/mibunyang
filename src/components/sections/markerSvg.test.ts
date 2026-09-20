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

// KakaoMapView 의 MarkerImage 캐시는 "그림을 정하는 값이 (점수, 가격라벨) 둘뿐" 이라는
// 전제 위에 서 있다. 이 전제가 깨지면(예: 지역·면적 등이 그림에 끼어들면) 서로 다른 단지가
// 같은 그림을 공유해 **엉뚱한 마커**가 된다. 그래서 전제 자체를 여기서 못 박는다.
describe("마커 그림의 결정 인자 (KakaoMapView MarkerImage 캐시의 전제)", () => {
  it("같은 (점수, 가격라벨) 이면 SVG 가 완전히 같다 — 캐시 재사용이 안전한 근거", () => {
    const a = buildMarkerSvg(72, "#16A34A", "5.2억");
    const b = buildMarkerSvg(72, "#16A34A", "5.2억");
    expect(b.svg).toBe(a.svg);
    expect(b.w).toBe(a.w);
    expect(b.h).toBe(a.h);
  });

  it("점수가 다르면 SVG 가 다르다 — 캐시 키에 점수가 반드시 들어가야 하는 근거", () => {
    // ① 같은 등급 안에서 점수만 1 차이 (색은 같고 글자만 다르다)
    const a = buildMarkerSvg(72, "#16A34A", "5.2억");
    const b = buildMarkerSvg(73, "#16A34A", "5.2억");
    expect(b.svg).not.toBe(a.svg);
    // ② 등급이 갈리는 경우 (색까지 다르다) — 호출부가 gr(total).c 로 색을 함께 바꾼다
    const c = buildMarkerSvg(72, "#16A34A", "5.2억");
    const d = buildMarkerSvg(55, "#EA580C", "5.2억");
    expect(d.svg).not.toBe(c.svg);
  });

  it("가격라벨이 다르면 SVG 가 다르다 — 캐시 키에 가격이 반드시 들어가야 하는 근거", () => {
    const a = buildMarkerSvg(72, "#16A34A", "5.2억");
    const b = buildMarkerSvg(72, "#16A34A", "7.9억");
    expect(b.svg).not.toBe(a.svg);
  });

  it("선택 강조본은 일반본과 다르다 — 강조는 캐시를 쓰지 않는다(공유 객체 오염 방지)", () => {
    const normal = buildMarkerSvg(72, "#16A34A", "5.2억", false);
    const sel = buildMarkerSvg(72, "#16A34A", "5.2억", true);
    expect(sel.svg).not.toBe(normal.svg);
  });
});
