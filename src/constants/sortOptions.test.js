// @ts-check
import { describe, it, expect } from "vitest";
import { SORT_OPTIONS, VALID_SORT_KEYS, EXPERT_SORT_OPTIONS } from "./sortOptions";

describe("SORT_OPTIONS", () => {
  // 정렬 옵션 7개 정의 확인
  it("7개 정렬 옵션 정의", () => {
    expect(SORT_OPTIONS).toHaveLength(7);
  });

  // 키 중복 없음 검증
  it("키 중복 없음", () => {
    const keys = SORT_OPTIONS.map(o => o.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // 각 옵션의 필수 필드 존재
  SORT_OPTIONS.forEach(opt => {
    it(`${opt.key}: 필수 필드 존재 (pcLabel, mobileLabel, ac, bg, pas, expert)`, () => {
      expect(typeof opt.pcLabel).toBe("string");
      expect(typeof opt.mobileLabel).toBe("string");
      expect(typeof opt.ac).toBe("string");
      expect(typeof opt.bg).toBe("string");
      expect(typeof opt.pas).toBe("string");
      expect(typeof opt.expert).toBe("boolean");
    });
  });

  // 기존 하드코딩 키 목록과 일치
  it("기존 정렬 키 목록과 일치", () => {
    const expectedKeys = ["total", "price", "priceScore", "location", "safe", "benefit", "newest"];
    expect(SORT_OPTIONS.map(o => o.key)).toEqual(expectedKeys);
  });
});

describe("VALID_SORT_KEYS", () => {
  // Set 타입 확인
  it("Set 타입", () => {
    expect(VALID_SORT_KEYS).toBeInstanceOf(Set);
  });

  // 7개 키 포함
  it("7개 키 포함", () => {
    expect(VALID_SORT_KEYS.size).toBe(7);
  });

  // 유효 키 검증
  it("유효 키 has() 동작", () => {
    expect(VALID_SORT_KEYS.has("total")).toBe(true);
    expect(VALID_SORT_KEYS.has("benefit")).toBe(true);
    expect(VALID_SORT_KEYS.has("invalid")).toBe(false);
    expect(VALID_SORT_KEYS.has("")).toBe(false);
  });
});

describe("EXPERT_SORT_OPTIONS", () => {
  // 전문가용 subset 5개
  it("expert=true인 옵션만 포함 (5개)", () => {
    expect(EXPERT_SORT_OPTIONS).toHaveLength(5);
    expect(EXPERT_SORT_OPTIONS.every(o => o.expert)).toBe(true);
  });

  // benefit, newest 미포함
  it("benefit, newest 미포함", () => {
    const keys = EXPERT_SORT_OPTIONS.map(o => o.key);
    expect(keys).not.toContain("benefit");
    expect(keys).not.toContain("newest");
  });
});
