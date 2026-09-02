// @ts-check
/**
 * `fix-sosa-coordinates.mjs` 판정 가드 (세션539 F-1)
 *
 * 이 스크립트는 **남의 좌표를 덮어쓴다.** 판정이 한 칸만 넓어도 멀쩡한 단지를 옮기고,
 * 한 칸만 좁으면 고쳐야 할 곳을 놓친다. 그래서 경계 양쪽을 전부 잠근다.
 *
 * 실측 배경(2026-09-02): `현대 프라힐스 소사역 더프라임` 1~9차 15곳의 주소가 **부천 소사
 * 현진에버빌(별개 단지)의 것**(`소사본동 148-30`)으로 박혀 좌표가 651m 어긋나 있었다.
 * 같은 단지의 `임의공급 10차` 한 곳만 올바른 주소(`70-6`)를 갖고 그 좌표가 네이버 실단지
 * `149270` 과 13m 다.
 */
import { describe, it, expect } from "vitest";
import { isWrongCoordRow } from "./fix-sosa-coordinates.mjs";

/** 네이버 149270 (아파트 160세대) — 스크립트의 기준점과 같은 값 */
const TRUE = { lat: 37.481863, lng: 126.794159 };
/** 현진에버빌 자리 = 오염된 15곳이 물려받은 좌표 (기준점에서 약 651m) */
const WRONG = { lat: 37.4762277086984, lng: 126.792162031052 };
/** 정상인 10차 좌표 (기준점에서 13m) */
const OK = { lat: 37.4817603828845, lng: 126.794086510825 };

describe("isWrongCoordRow — 정정 대상 판정", () => {
  it("이름이 프라힐스·소사 이고 좌표가 멀면 대상", () => {
    expect(isWrongCoordRow({ name: "현대 프라힐스 소사역 더프라임", ...WRONG })).toBe(true);
    expect(isWrongCoordRow({ name: "현대 프라힐스 소사역 더프라임(임의공급 8차)", ...WRONG })).toBe(true);
  });

  it("★ 같은 이름이라도 좌표가 이미 맞으면 대상이 아니다 (10차를 다시 옮기지 않는다)", () => {
    expect(isWrongCoordRow({ name: "현대프라힐스 소사역 더프라임(임의공급 10차)", ...OK })).toBe(false);
  });

  it("★ 같은 좌표를 쓰더라도 **다른 단지**는 대상이 아니다 (현진에버빌은 그 자리가 진짜다)", () => {
    expect(isWrongCoordRow({ name: "부천 소사 현진에버빌", ...WRONG })).toBe(false);
  });

  it("이름이 프라힐스여도 소사가 아니면 대상이 아니다 (동명 계열 오염 차단)", () => {
    expect(isWrongCoordRow({ name: "현대프라힐스 동부산", lat: 35.239336, lng: 129.167999 })).toBe(false);
    expect(isWrongCoordRow({ name: "현대프라힐스 원주혁신", lat: 37.32128, lng: 127.977636 })).toBe(false);
  });

  it("소사 단지여도 프라힐스가 아니면 대상이 아니다", () => {
    expect(isWrongCoordRow({ name: "소사역 한라비발디 프레스티지", ...WRONG })).toBe(false);
    expect(isWrongCoordRow({ name: "월드메르디앙 소사역 아파트 (임의공급 1차)", ...WRONG })).toBe(false);
  });

  it("좌표가 없으면 판정하지 않는다 (모르는 것을 옮기지 않는다)", () => {
    expect(isWrongCoordRow({ name: "현대 프라힐스 소사역 더프라임", lat: null, lng: null })).toBe(false);
    expect(isWrongCoordRow({ name: "현대 프라힐스 소사역 더프라임", lat: 37.48, lng: null })).toBe(false);
  });

  it("이름이 없으면 판정하지 않는다", () => {
    expect(isWrongCoordRow({ name: null, ...WRONG })).toBe(false);
  });

  it("경계: 기준점 바로 옆(수십 m)은 대상이 아니고, 651m 는 대상이다", () => {
    // 위도 0.0009° ≈ 100m — 임계(300m) 안쪽이라 대상 아님
    expect(isWrongCoordRow({ name: "현대 프라힐스 소사역 더프라임", lat: TRUE.lat + 0.0009, lng: TRUE.lng })).toBe(
      false
    );
    // 위도 0.0045° ≈ 500m — 임계 밖이라 대상
    expect(isWrongCoordRow({ name: "현대 프라힐스 소사역 더프라임", lat: TRUE.lat + 0.0045, lng: TRUE.lng })).toBe(
      true
    );
  });
});
