// @ts-check
import { describe, it, expect } from "vitest";
import { isMonthOnly, monthKey, monthLabel, groupUpcoming } from "./upcomingGroups";

describe("isMonthOnly", () => {
  it("YYYY-MM (하이픈 월-only) → true", () => {
    expect(isMonthOnly("2026-04")).toBe(true);
  });
  it("YYYY.MM (점 월-only) → true", () => {
    expect(isMonthOnly("2026.04")).toBe(true);
  });
  it("YYYY-MM-DD (일자 있음) → false", () => {
    expect(isMonthOnly("2026-04-05")).toBe(false);
  });
  it("null/미정 → false", () => {
    expect(isMonthOnly(null)).toBe(false);
    expect(isMonthOnly("미정")).toBe(false);
  });
});

describe("monthKey", () => {
  it("일자 있는 날짜 → 앞 YYYY-MM", () => {
    expect(monthKey("2026-04-05")).toBe("2026-04");
  });
  it("월-only(점) → YYYY-MM 정규화", () => {
    expect(monthKey("2026.04")).toBe("2026-04");
  });
  it("파싱 불가 → null", () => {
    expect(monthKey("하반기")).toBeNull();
    expect(monthKey(null)).toBeNull();
  });
});

describe("monthLabel", () => {
  it("올해면 'N월 예정'", () => {
    expect(monthLabel("2026-04", 2026)).toBe("4월 예정");
  });
  it("다른 해면 'YYYY년 N월 예정'", () => {
    expect(monthLabel("2027-03", 2026)).toBe("2027년 3월 예정");
  });
});

describe("groupUpcoming", () => {
  const today = new Date(2026, 6, 3); // 2026-07-03

  it("일자 확정 + 7일 이내 → 청약 임박 그룹, 임박 순 정렬", () => {
    const items = [
      { id: "a", presaleRecruitDate: "2026-07-08" }, // D-5
      { id: "b", presaleRecruitDate: "2026-07-04" }, // D-1
    ];
    const groups = groupUpcoming(/** @type {any} */ (items), today);
    expect(groups[0].key).toBe("imminent");
    expect(groups[0].label).toContain("청약 임박");
    expect(groups[0].items.map((x) => x.id)).toEqual(["b", "a"]); // 가까운 날 먼저
  });

  it("월-only 는 임박 그룹에 안 들어가고 월 그룹으로", () => {
    const items = [{ id: "m", presaleRecruitDate: "2026-07" }];
    const groups = groupUpcoming(/** @type {any} */ (items), today);
    expect(groups.find((g) => g.key === "imminent")).toBeUndefined();
    const monthGroup = groups.find((g) => g.key === "month:2026-07");
    expect(monthGroup).toBeTruthy();
    expect(monthGroup?.items[0].id).toBe("m");
  });

  it("미래 월이 과거 월보다 먼저 정렬", () => {
    const items = [
      { id: "past", presaleRecruitDate: "2026-05" },
      { id: "fut", presaleRecruitDate: "2026-09" },
    ];
    const groups = groupUpcoming(/** @type {any} */ (items), today);
    const keys = groups.map((g) => g.key);
    expect(keys.indexOf("month:2026-09")).toBeLessThan(keys.indexOf("month:2026-05"));
  });

  it("파싱 불가 날짜 → 일정 미정 그룹 (맨 끝)", () => {
    const items = [
      { id: "ok", presaleRecruitDate: "2026-08" },
      { id: "none", presaleRecruitDate: "미정" },
    ];
    const groups = groupUpcoming(/** @type {any} */ (items), today);
    const last = groups[groups.length - 1];
    expect(last.key).toBe("etc");
    expect(last.items[0].id).toBe("none");
  });

  it("일자 있지만 8일 이후 → 임박 아니라 월 그룹", () => {
    const items = [{ id: "far", presaleRecruitDate: "2026-07-20" }]; // D-17
    const groups = groupUpcoming(/** @type {any} */ (items), today);
    expect(groups.find((g) => g.key === "imminent")).toBeUndefined();
    expect(groups.find((g) => g.key === "month:2026-07")).toBeTruthy();
  });

  it("빈 배열 → 빈 그룹", () => {
    expect(groupUpcoming([], today)).toEqual([]);
  });

  it("오늘(D-0) 청약도 임박 그룹", () => {
    const items = [{ id: "t", presaleRecruitDate: "2026-07-03" }];
    const groups = groupUpcoming(/** @type {any} */ (items), today);
    expect(groups[0].key).toBe("imminent");
  });
});
