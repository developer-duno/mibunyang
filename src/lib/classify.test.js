// @ts-check
import { describe, it, expect } from "vitest";
import {
  MOVEIN_STATUS, MOVEIN_VALUES, TIER_LABELS, TIER_VALUES,
  classifyMoveIn, classifyTier,
} from "@/lib/classify";

/* ── 상수 무결성 테스트: 값 변경 시 필터/카운트 깨짐 방지 ── */

describe("classify 상수 무결성", () => {
  // MOVEIN_STATUS 값이 정확히 3개이고, 기대 값과 일치하는지
  it("MOVEIN_STATUS는 3개 레이블을 포함", () => {
    expect(MOVEIN_VALUES).toHaveLength(3);
    expect(MOVEIN_VALUES).toContain("입주예정");
    expect(MOVEIN_VALUES).toContain("미입주");
    expect(MOVEIN_VALUES).toContain("입주완료");
  });

  // TIER_LABELS 값이 정확히 3개이고, 기대 값과 일치하는지
  it("TIER_VALUES는 3개 레이블을 포함", () => {
    expect(TIER_VALUES).toHaveLength(3);
    expect(TIER_VALUES).toContain("1군");
    expect(TIER_VALUES).toContain("2군");
    expect(TIER_VALUES).toContain("기타");
  });

  // classifyMoveIn 반환값이 항상 MOVEIN_VALUES 중 하나이거나 null
  it("classifyMoveIn 반환값은 MOVEIN_VALUES 또는 null", () => {
    const validSet = new Set([...MOVEIN_VALUES, null]);
    const cases = [
      { completion: "209912", unsoldRate: 0 },
      { completion: "202001", unsoldRate: 5 },
      { completion: "202001", unsoldRate: 0 },
      { completion: null },
    ];
    for (const apt of cases) {
      expect(validSet.has(classifyMoveIn(/** @type {import('@/types/scoring').Apt} */ (apt)))).toBe(true);
    }
  });

  // 세션 445 R2 회귀: unsoldRate 가 null 로 무력화돼도 unsold(수)가 남으면 미입주.
  //   과거 미입주 판정이 unsoldRate>0 이라 클램프 null 단지가 입주완료로 오분류되던 회귀 방지.
  it("입주월 지남 + unsold>0 + unsoldRate=null → 미입주 (입주완료 오분류 방지)", () => {
    const apt = /** @type {import('@/types/scoring').Apt} */ ({ completion: "202001", unsold: 39, unsoldRate: null });
    expect(classifyMoveIn(apt)).toBe("미입주");
  });

  it("입주월 지남 + unsold=0 → 입주완료", () => {
    const apt = /** @type {import('@/types/scoring').Apt} */ ({ completion: "202001", unsold: 0, unsoldRate: null });
    expect(classifyMoveIn(apt)).toBe("입주완료");
  });

  // classifyTier 반환값이 항상 TIER_VALUES 중 하나
  it("classifyTier 반환값은 TIER_VALUES 중 하나", () => {
    const validSet = new Set(TIER_VALUES);
    const cases = [
      { builder: "현대건설" },
      { builder: "한화건설" },
      { builder: "무명건설" },
      { builder: null },
    ];
    for (const apt of cases) {
      expect(validSet.has(classifyTier(/** @type {import('@/types/scoring').Apt} */ (apt)))).toBe(true);
    }
  });

  // MOVEIN_STATUS 키가 Object.freeze 불변인지 (런타임 변경 방지)
  it("상수 객체의 값은 Object.values와 배열이 동기화됨", () => {
    expect(Object.values(MOVEIN_STATUS)).toEqual(MOVEIN_VALUES);
    expect(Object.values(TIER_LABELS)).toEqual(TIER_VALUES);
  });
});
