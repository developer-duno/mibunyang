import { describe, it, expect } from "vitest";
import { FILTER_PRESETS } from "./filterPresets";
import { VALID_SORT_KEYS } from "./sortOptions";

// 프리셋 상수 무결성 테스트
describe("FILTER_PRESETS", () => {
  it("프리셋이 1개 이상 존재", () => {
    expect(FILTER_PRESETS.length).toBeGreaterThanOrEqual(1);
  });

  it("모든 프리셋에 key, label, desc, values 필수 필드 존재", () => {
    for (const p of FILTER_PRESETS) {
      expect(typeof p.key).toBe("string");
      expect(typeof p.label).toBe("string");
      expect(typeof p.desc).toBe("string");
      expect(typeof p.values).toBe("object");
    }
  });

  it("key 중복 없음", () => {
    const keys = FILTER_PRESETS.map(p => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("values.sortKey가 있으면 VALID_SORT_KEYS에 포함", () => {
    for (const p of FILTER_PRESETS) {
      if (p.values.sortKey) {
        expect(VALID_SORT_KEYS.has(p.values.sortKey)).toBe(true);
      }
    }
  });

  it("values.builderTier가 있으면 유효 값", () => {
    const validTiers = new Set(["전체", "1군", "2군", "기타"]);
    for (const p of FILTER_PRESETS) {
      if (p.values.builderTier) {
        expect(validTiers.has(p.values.builderTier)).toBe(true);
      }
    }
  });

  it("values.moveInFilter가 있으면 유효 값", () => {
    const validMoveIn = new Set(["전체", "입주예정", "미입주", "입주완료"]);
    for (const p of FILTER_PRESETS) {
      if (p.values.moveInFilter) {
        expect(validMoveIn.has(p.values.moveInFilter)).toBe(true);
      }
    }
  });
});
