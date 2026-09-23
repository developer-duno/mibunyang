// @ts-check
/**
 * _school-place.mjs 테스트 — isSchoolPlace/isElementarySchoolDoc 순수 함수 검증
 *
 * 픽스처는 세션567 카카오 keyword.json "초등학교" 라이브 실측(2026-09-23) 그대로다.
 */
import { describe, it, expect } from "vitest";
import { isSchoolPlace, isElementarySchoolDoc } from "./_school-place.mjs";

describe("isSchoolPlace (기존 이름 화이트리스트 — 그대로 보존)", () => {
  it("정상 초등학교 → true", () => {
    expect(isSchoolPlace("서울초등학교")).toBe(true);
  });
  it("병설유치원 → false", () => {
    expect(isSchoolPlace("인천봉수초등학교 병설유치원")).toBe(false);
  });
  it("분교장은 이름만으로는 false (분류 판정에서 잡아야 함)", () => {
    expect(isSchoolPlace("인천영종초등학교 금산분교장")).toBe(false);
  });
});

describe("isElementarySchoolDoc — 분교장 포함, 개교 예정 제외 (세션567 실측 픽스처)", () => {
  it("금산분교장 — SC4 분류 + 분교장 접미 → true", () => {
    expect(
      isElementarySchoolDoc({
        place_name: "인천영종초등학교 금산분교장",
        category_name: "교육,학문 > 학교 > 초등학교",
      }),
    ).toBe(true);
  });

  it("용문분교장(대전 서구, 2025-09-01 개교) — true", () => {
    expect(
      isElementarySchoolDoc({
        place_name: "탄방초등학교 용문분교장",
        category_name: "교육,학문 > 학교 > 초등학교",
      }),
    ).toBe(true);
  });

  it("개교 예정 학교(미단초중학교 (2028년 3월 예정)) — 분류가 맞아도 false", () => {
    expect(
      isElementarySchoolDoc({
        place_name: "미단초중학교 (2028년 3월 예정)",
        category_name: "교육,학문 > 학교 > 초등학교",
      }),
    ).toBe(false);
  });

  it("가칭 학교도 예정으로 간주해 false", () => {
    expect(
      isElementarySchoolDoc({
        place_name: "(가칭)왕숙1초등학교",
        category_name: "교육,학문 > 학교 > 초등학교",
      }),
    ).toBe(false);
  });

  it("교무실(학교부속시설 분류) — 이름이 분교장이어도 false", () => {
    expect(
      isElementarySchoolDoc({
        place_name: "인천영종초등학교 금산분교장 교무실",
        category_name: "교육,학문 > 학교부속시설",
      }),
    ).toBe(false);
  });

  it("병설유치원(유치원 분류) — false", () => {
    expect(
      isElementarySchoolDoc({
        place_name: "인천윤슬초등학교 병설유치원",
        category_name: "교육,학문 > 유아교육 > 유치원",
      }),
    ).toBe(false);
  });

  it("편의점(초교점) — false", () => {
    expect(
      isElementarySchoolDoc({
        place_name: "세븐일레븐 영종운서초교점",
        category_name: "가정,생활 > 편의점 > 세븐일레븐",
      }),
    ).toBe(false);
  });

  it("교차로(도성초교교차로) — false", () => {
    expect(
      isElementarySchoolDoc({
        place_name: "도성초교교차로",
        category_name: "교통,수송 > 교차로",
      }),
    ).toBe(false);
  });

  it("정상 초등학교(서울도성초등학교, 이름 화이트리스트로 통과) — true", () => {
    expect(
      isElementarySchoolDoc({
        place_name: "서울도성초등학교",
        category_name: "교육,학문 > 학교 > 초등학교",
      }),
    ).toBe(true);
  });

  it("이름이 분교장으로 끝나도 분류가 초등학교가 아니면 false", () => {
    expect(
      isElementarySchoolDoc({
        place_name: "어딘가분교장",
        category_name: "교육,학문 > 학교 > 중학교",
      }),
    ).toBe(false);
  });

  it("category_name 없음 + 이름만으로 판정 (기존 동작 보존)", () => {
    expect(isElementarySchoolDoc({ place_name: "서울초등학교" })).toBe(true);
    expect(isElementarySchoolDoc({ place_name: "인천봉수초등학교 병설유치원" })).toBe(false);
  });

  it("doc 이 null/undefined 여도 예외 없이 false", () => {
    expect(isElementarySchoolDoc(null)).toBe(false);
    expect(isElementarySchoolDoc(undefined)).toBe(false);
  });

  it("이름이 빈 문자열이면 false", () => {
    expect(isElementarySchoolDoc({ place_name: "", category_name: "교육,학문 > 학교 > 초등학교" })).toBe(false);
  });
});
