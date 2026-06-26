// @ts-check
import { describe, it, expect } from "vitest";
import { SORT_OPTIONS, VALID_SORT_KEYS } from "./sortOptions";

describe("SORT_OPTIONS", () => {
  // 정렬 옵션 12개 정의 확인 (세션 415: 미분양많은순 / 세션 423: 대단지순 / 세션 424: 입주빠른순 / 세션 444: 역세권순·전세율순 추가)
  it("12개 정렬 옵션 정의", () => {
    expect(SORT_OPTIONS).toHaveLength(12);
  });

  // 키 중복 없음 검증
  it("키 중복 없음", () => {
    const keys = SORT_OPTIONS.map(o => o.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // 각 옵션의 필수 필드 존재
  SORT_OPTIONS.forEach(opt => {
    it(`${opt.key}: 필수 필드 존재 (pcLabel, mobileLabel, ac, bg, pas)`, () => {
      expect(typeof opt.pcLabel).toBe("string");
      expect(typeof opt.mobileLabel).toBe("string");
      expect(typeof opt.ac).toBe("string");
      expect(typeof opt.bg).toBe("string");
      expect(typeof opt.pas).toBe("string");
    });
  });

  // 하드코딩 키 목록과 일치 (세션 415: unsoldRate / 세션 423: units / 세션 424: moveInSoon / 세션 444: subwayNear·jeonseHigh 추가)
  it("정렬 키 목록과 일치", () => {
    const expectedKeys = ["total", "price", "priceScore", "location", "safe", "benefit", "newest", "unsoldRate", "units", "moveInSoon", "subwayNear", "jeonseHigh"];
    expect(SORT_OPTIONS.map(o => o.key)).toEqual(expectedKeys);
  });
});

describe("VALID_SORT_KEYS", () => {
  // Set 타입 확인
  it("Set 타입", () => {
    expect(VALID_SORT_KEYS).toBeInstanceOf(Set);
  });

  // 12개 키 포함 (세션 415: unsoldRate / 세션 423: units / 세션 424: moveInSoon / 세션 444: subwayNear·jeonseHigh 추가)
  it("12개 키 포함", () => {
    expect(VALID_SORT_KEYS.size).toBe(12);
  });

  // 유효 키 검증
  it("유효 키 has() 동작", () => {
    expect(VALID_SORT_KEYS.has("total")).toBe(true);
    expect(VALID_SORT_KEYS.has("benefit")).toBe(true);
    expect(VALID_SORT_KEYS.has("unsoldRate")).toBe(true);
    expect(VALID_SORT_KEYS.has("units")).toBe(true);
    expect(VALID_SORT_KEYS.has("moveInSoon")).toBe(true);
    expect(VALID_SORT_KEYS.has("subwayNear")).toBe(true);
    expect(VALID_SORT_KEYS.has("jeonseHigh")).toBe(true);
    expect(VALID_SORT_KEYS.has("invalid")).toBe(false);
    expect(VALID_SORT_KEYS.has("")).toBe(false);
  });
});
