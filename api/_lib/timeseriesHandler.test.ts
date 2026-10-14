import { describe, it, expect } from "vitest";
import { mergeMonthlyRows } from "./timeseriesHandler.js";

const opt = { key: "base_month", value: "unsold_count" } as const;

describe("mergeMonthlyRows — 한 달 한 값(세션635 다)", () => {
  it("같은 달 세 행 → 요청 순서 첫 id(재료 행)의 값", () => {
    const rows = [
      { apartment_id: "ah-1", base_month: "202609", unsold_count: 5 },
      { apartment_id: "ap-9", base_month: "202609", unsold_count: 40 },
      { apartment_id: "ah-2", base_month: "202609", unsold_count: 1 },
    ];
    expect(mergeMonthlyRows(rows, ["ap-9", "ah-1", "ah-2"], opt)).toEqual([
      { apartment_id: "ap-9", base_month: "202609", unsold_count: 40 },
    ]);
  });
  it("첫 id 의 값이 최댓값이 아니어도 첫 id 를 고른다(최댓값 규칙과 구별 — 변이 H1)", () => {
    const rows = [
      { apartment_id: "ah-1", base_month: "202609", unsold_count: 50 },
      { apartment_id: "ap-9", base_month: "202609", unsold_count: 2 },
    ];
    expect(mergeMonthlyRows(rows, ["ap-9", "ah-1"], opt).map((r) => r.unsold_count)).toEqual([2]);
  });
  it("첫 id 가 없는 달은 최댓값(전환 전 달의 반쪽 값 근사)", () => {
    const rows = [
      { apartment_id: "ah-1", base_month: "202606", unsold_count: 20 },
      { apartment_id: "ah-2", base_month: "202606", unsold_count: 3 },
      { apartment_id: "ap-9", base_month: "202609", unsold_count: 40 },
    ];
    expect(mergeMonthlyRows(rows, ["ap-9", "ah-1", "ah-2"], opt).map((r) => [r.base_month, r.unsold_count])).toEqual([
      ["202606", 20],
      ["202609", 40],
    ]);
  });
  it("id 하나면 그대로(순서만 보장)", () => {
    const rows = [
      { apartment_id: "ah-1", base_month: "202609", unsold_count: 5 },
      { apartment_id: "ah-1", base_month: "202608", unsold_count: 7 },
    ];
    expect(mergeMonthlyRows(rows, ["ah-1"], opt).map((r) => r.base_month)).toEqual(["202608", "202609"]);
  });
  it("value 가 null 인 행만 있는 달은 그 행을 둔다(지우지 않는다)", () => {
    const rows = [{ apartment_id: "ah-2", base_month: "202607", unsold_count: null }];
    expect(mergeMonthlyRows(rows, ["ap-9", "ah-2"], opt)).toHaveLength(1);
  });
});
