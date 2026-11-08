// @ts-check
import { describe, it, expect } from "vitest";
import { MOVEIN_STATUS, MOVEIN_VALUES, TIER_LABELS, TIER_VALUES, classifyMoveIn, classifyTier } from "@/lib/classify";

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

  // 4경우 전수 + null/undefined 미상 처리 (백로그 A-10 2차 E1, 세션573 — cardChips.ts 와 같은 판정)
  describe("4경우 전수 — 준공 전 / 완료 / 미입주 / 미상(null)", () => {
    it("준공 전(완료 이전 연월) → 입주예정", () => {
      const apt = /** @type {import('@/types/scoring').Apt} */ ({ completion: "209912", unsold: null });
      expect(classifyMoveIn(apt)).toBe("입주예정");
    });

    it("입주월 지남 + unsold>0 → 미입주", () => {
      const apt = /** @type {import('@/types/scoring').Apt} */ ({ completion: "202001", unsold: 12 });
      expect(classifyMoveIn(apt)).toBe("미입주");
    });

    it("입주월 지남 + unsold=0 → 입주완료", () => {
      const apt = /** @type {import('@/types/scoring').Apt} */ ({ completion: "202001", unsold: 0 });
      expect(classifyMoveIn(apt)).toBe("입주완료");
    });

    it("입주월 지남 + unsold=null(모름) → null — '입주완료'로 단정하지 않는다", () => {
      const apt = /** @type {import('@/types/scoring').Apt} */ ({ completion: "202001", unsold: null });
      expect(classifyMoveIn(apt)).toBeNull();
    });

    it("입주월 지남 + unsold=undefined(필드 자체 없음) → 같은 미상 처리, null", () => {
      const apt = /** @type {import('@/types/scoring').Apt} */ ({ completion: "202001" });
      expect(classifyMoveIn(apt)).toBeNull();
    });
  });

  // 👤 D3(세션691 11/04) — 지자체 명단 등재·수 비공개는 「미입주」에도 넣는다(Q8 과 같은 셈법 · 세션692 PR-4)
  describe("명단 비공개 등재(unsoldListedHidden) — D3", () => {
    /** @param {Record<string, unknown>} o */
    const a = (o) =>
      /** @type {import('@/types/scoring').Apt} */ (
        /** @type {unknown} */ ({ completion: "202412", unsold: null, unsoldRate: null, ...o })
      );
    it("brief 예시: 준공 202412 · unsold null · hidden true → 미입주 / hidden false → null", () => {
      expect(classifyMoveIn(a({ unsoldListedHidden: true }))).toBe("미입주");
      expect(classifyMoveIn(a({ unsoldListedHidden: false }))).toBeNull();
    });
    it('칸 없음·null·문자열 "true" 는 비공개 아님 → null(VIEW 가 참이라 한 것만)', () => {
      expect(classifyMoveIn(a({}))).toBeNull();
      expect(classifyMoveIn(a({ unsoldListedHidden: null }))).toBeNull();
      expect(classifyMoveIn(a({ unsoldListedHidden: "true" }))).toBeNull();
    });
    it("준공 전이면 hidden 이어도 입주예정 · 준공 없으면 null", () => {
      expect(classifyMoveIn(a({ completion: "209912", unsoldListedHidden: true }))).toBe("입주예정");
      expect(classifyMoveIn(a({ completion: null, unsoldListedHidden: true }))).toBeNull();
    });
    it("숫자가 있는 행은 옛 판정 그대로(hidden 칸 무관): 0 → 입주완료 · 3 → 미입주", () => {
      expect(classifyMoveIn(a({ unsold: 0, unsoldListedHidden: false }))).toBe("입주완료");
      expect(classifyMoveIn(a({ unsold: 3, unsoldListedHidden: false }))).toBe("미입주");
    });
  });

  // classifyTier 반환값이 항상 TIER_VALUES 중 하나
  it("classifyTier 반환값은 TIER_VALUES 중 하나", () => {
    const validSet = new Set(TIER_VALUES);
    const cases = [{ builder: "현대건설" }, { builder: "한화건설" }, { builder: "무명건설" }, { builder: null }];
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
