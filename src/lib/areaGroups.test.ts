import { describe, it, expect } from "vitest";
import { groupAreaRows } from "./areaGroups";

/** 표본 ah-2020910009(더샵 광교산퍼스트파크) 최근 12개월 — 세션662 지시서 그대로 */
const SALE_009 = [
  { area: 36.63, n: 9, min: 30500, median: 33500, max: 34200, last_month: "202607" },
  { area: 59.74, n: 4, min: 59500, median: 60750, max: 62700, last_month: "202604" },
  { area: 59.99, n: 13, min: 58000, median: 61000, max: 64200, last_month: "202609" },
  { area: 71.29, n: 2, min: 65000, median: 66500, max: 68000, last_month: "202609" },
  { area: 71.5, n: 2, min: 62000, median: 63500, max: 65000, last_month: "202607" },
  { area: 84.98, n: 25, min: 70000, median: 73000, max: 79800, last_month: "202609" },
  { area: 84.99, n: 6, min: 74000, median: 77000, max: 80000, last_month: "202608" },
];
const JEONSE_009 = [
  { area: 36.63, n: 17, min: 19764, median: 20493, max: 24000, last_month: "202608" },
  { area: 59.74, n: 1, min: 35000, median: 35000, max: 35000, last_month: "202609" },
  { area: 59.99, n: 10, min: 30000, median: 35750, max: 39000, last_month: "202608" },
  { area: 71.5, n: 1, min: 42500, median: 42500, max: 42500, last_month: "202607" },
  { area: 84.98, n: 13, min: 42000, median: 46500, max: 53000, last_month: "202607" },
  { area: 84.99, n: 4, min: 45000, median: 47000, max: 49000, last_month: "202608" },
];

const row = (area: number, n: number, min: number, max: number) => ({
  area,
  n,
  min,
  median: null,
  max,
  last_month: "202609",
});

describe("groupAreaRows — 1㎡ 안 사슬로 평형대 묶기 (세션662 👤 결정 6~8)", () => {
  it("표본 009 → 4줄, 건수 합·최저·최고 · 기준 평형 59", () => {
    const rows = groupAreaRows(SALE_009, JEONSE_009, 59.99);
    expect(rows).toEqual([
      {
        key: 36,
        areas: [36.63],
        saleAreas: [36.63],
        sale: { n: 9, min: 30500, max: 34200 },
        jeonse: { n: 17, min: 19764, max: 24000 },
        isBase: false,
      },
      {
        key: 59,
        areas: [59.74, 59.99],
        saleAreas: [59.74, 59.99],
        sale: { n: 17, min: 58000, max: 64200 },
        jeonse: { n: 11, min: 30000, max: 39000 },
        isBase: true,
      },
      {
        key: 71,
        areas: [71.29, 71.5],
        saleAreas: [71.29, 71.5],
        sale: { n: 4, min: 62000, max: 68000 },
        jeonse: { n: 1, min: 42500, max: 42500 },
        isBase: false,
      },
      {
        key: 84,
        areas: [84.98, 84.99],
        saleAreas: [84.98, 84.99],
        sale: { n: 31, min: 70000, max: 80000 },
        jeonse: { n: 17, min: 42000, max: 53000 },
        isBase: false,
      },
    ]);
  });

  it("가운데 값은 내지 않는다", () => {
    for (const r of groupAreaRows(SALE_009, JEONSE_009, 59.99)) {
      expect(r.sale).not.toHaveProperty("median");
      if (r.jeonse) expect(r.jeonse).not.toHaveProperty("median");
    }
  });

  it("빈 배열 · null · 배열 아님 → 빈 결과", () => {
    expect(groupAreaRows([], [], 59.99)).toEqual([]);
    expect(groupAreaRows(null, null, null)).toEqual([]);
    expect(groupAreaRows(undefined, undefined, 59)).toEqual([]);
    expect(groupAreaRows("x", {}, 59)).toEqual([]);
  });

  it("버리는 줄 — 건수 0 · 최저 null · 최고 null (X12)", () => {
    const rows = groupAreaRows(
      [
        row(59.99, 0, 50000, 52000),
        { ...row(71.5, 3, 0, 60000), min: null },
        { ...row(84.99, 3, 70000, 0), max: null },
        row(101.2, 3, 90000, 95000),
      ],
      [],
      null
    );
    expect(rows.map((r) => r.key)).toEqual([101]);
  });

  it("전세 없음 → 모든 줄 jeonse null", () => {
    const rows = groupAreaRows(SALE_009, [], 59.99);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.jeonse === null)).toBe(true);
  });

  it("전세만 있는 평형도 줄(매매 null) · 매매 표가 비어도 전세로 줄 (결정 7)", () => {
    const rows = groupAreaRows(SALE_009.slice(0, 1), JEONSE_009, 36.63);
    expect(rows.map((r) => r.key)).toEqual([36, 59, 71, 84]);
    expect(rows[1].sale).toBeNull();
    expect(rows[1].saleAreas).toEqual([]);
    expect(rows[1].jeonse).toEqual({ n: 11, min: 30000, max: 39000 });
    expect(groupAreaRows([], JEONSE_009, null).map((r) => r.key)).toEqual([36, 59, 71, 84]);
  });

  it("사슬 — 1㎡ 이내면 한 줄(경계 포함) · 이름은 가장 작은 면적의 정수 부분", () => {
    // 59.99·60.01 은 0.02 차이라 한 줄 "59㎡대"(옛 정수부 묶기면 두 줄)
    expect(groupAreaRows([row(59.99, 3, 1, 2), row(60.01, 3, 1, 2)], [], null).map((r) => r.key)).toEqual([59]);
    // 84.98·84.99·85.00 → 84㎡대
    const r84 = groupAreaRows([row(84.98, 1, 1, 2), row(84.99, 1, 1, 2), row(85.0, 1, 1, 2)], [], null);
    expect(r84.map((r) => [r.key, r.areas])).toEqual([[84, [84.98, 84.99, 85]]]);
    // 정확히 1.00 차이는 같은 줄(부동소수 84.98→85.98 도), 1.01 은 다른 줄
    expect(groupAreaRows([row(84.98, 1, 1, 2), row(85.98, 1, 1, 2)], [], null)).toHaveLength(1);
    expect(groupAreaRows([row(59.0, 1, 1, 2), row(60.01, 1, 1, 2)], [], null).map((r) => r.key)).toEqual([59, 60]);
    // 사슬은 이어진다 — 84.0 → 84.9 → 85.8 (처음과 끝은 1.8 차이)
    expect(groupAreaRows([row(84.0, 1, 1, 2), row(84.9, 1, 1, 2), row(85.8, 1, 1, 2)], [], null)).toHaveLength(1);
    // 매매·전세 면적을 합쳐 사슬을 만든다 — 전세 60.5 가 매매 59.8·61.4 를 잇는다
    const mixed = groupAreaRows([row(59.8, 2, 1, 2), row(61.4, 2, 3, 4)], [row(60.5, 1, 5, 5)], null);
    expect(mixed.map((r) => [r.key, r.areas, r.saleAreas])).toEqual([[59, [59.8, 60.5, 61.4], [59.8, 61.4]]]);
  });

  it("★ 기준 면적은 둘째 자리 반올림 뒤 1㎡ 이내 (결정 8)", () => {
    // 84.9976 → 85.00 · 표는 84.98·84.99
    expect(groupAreaRows(SALE_009, JEONSE_009, 84.9976).find((r) => r.isBase)?.key).toBe(84);
    // 59.9976 → 60.00 · 표는 59.74·59.99
    expect(groupAreaRows(SALE_009, JEONSE_009, 59.9976).find((r) => r.isBase)?.key).toBe(59);
    // 74.9987 → 75.00 · 표에 75.0x 만(줄 이름 75) — 옛 정수부 판정(74)이면 ★ 없음
    const r75 = groupAreaRows([row(59.99, 3, 1, 2), row(75.02, 3, 1, 2), row(75.05, 2, 1, 2)], [], 74.9987);
    expect(r75.find((r) => r.isBase)?.key).toBe(75);
    // 표에 85.00 만 있고 대표 84.9976 → ★(옛 정수부 84 ≠ 85 였다)
    expect(groupAreaRows([row(59.99, 3, 1, 2), row(85.0, 3, 1, 2)], [], 84.9976).find((r) => r.isBase)?.key).toBe(85);
  });

  it("★ 1㎡ 경계는 반올림 뒤로 잰다 — 83.9976(→84.00) 과 85.00 은 정확히 1.00 이라 ★", () => {
    const rows = groupAreaRows([row(59.99, 3, 1, 2), row(85.0, 3, 1, 2)], [], 83.9976);
    expect(rows.find((r) => r.isBase)?.key).toBe(85);
    // 위쪽 경계도 — 61.0049(→61.00) 와 60.00 은 정확히 1.00 이라 ★(원값이면 1.0049 로 밖)
    const up = groupAreaRows([row(60.0, 3, 1, 2), row(84.99, 3, 1, 2)], [], 61.0049);
    expect(up.find((r) => r.isBase)?.key).toBe(60);
    // 반올림해도 밖이면 ★ 없음 — 61.0051(→61.01) 과 60.00 은 1.01
    expect(groupAreaRows([row(60.0, 3, 1, 2), row(84.99, 3, 1, 2)], [], 61.0051).some((r) => r.isBase)).toBe(false);
  });

  it("★ 가장 가까운 줄도 반올림 뒤 거리로 — 원값이면 다른 줄이 이긴다", () => {
    // 대표 60.5049(→60.50): 59.50 줄과 61.50 줄이 각 1.00 으로 비김 → 먼저(작은) 줄 59
    //   원값이면 59.50 은 1.0049 로 밖, 61.50 은 0.9951 로 안 → 61 이 된다
    const rows = groupAreaRows([row(59.5, 3, 1, 2), row(61.5, 3, 1, 2)], [], 60.5049);
    expect(rows.map((r) => r.key)).toEqual([59, 61]);
    expect(rows.find((r) => r.isBase)?.key).toBe(59);
  });

  it("★ 후보가 둘이면 가장 가까운 면적의 줄", () => {
    // 대표 60.4 — 59.5 줄(0.9)과 61.2 줄(0.8): 61.2 쪽
    const rows = groupAreaRows([row(59.5, 3, 1, 2), row(61.2, 3, 1, 2)], [], 60.4);
    expect(rows.map((r) => r.key)).toEqual([59, 61]);
    expect(rows.find((r) => r.isBase)?.key).toBe(61);
  });

  it("baseArea 없음(null·0) · 1㎡ 이내 면적 없음 → ★ 없음", () => {
    expect(groupAreaRows(SALE_009, JEONSE_009, null).some((r) => r.isBase)).toBe(false);
    expect(groupAreaRows(SALE_009, JEONSE_009, 0).some((r) => r.isBase)).toBe(false);
    expect(groupAreaRows(SALE_009, JEONSE_009, 101.5).some((r) => r.isBase)).toBe(false);
    expect(groupAreaRows(SALE_009, JEONSE_009, 86.0).some((r) => r.isBase)).toBe(false); // 84.99 와 1.01
  });

  it("면적 오름차순(입력 순서와 무관)", () => {
    const rows = groupAreaRows([...SALE_009].reverse(), JEONSE_009, 59.99);
    expect(rows.map((r) => r.key)).toEqual([36, 59, 71, 84]);
    expect(rows[1].areas).toEqual([59.74, 59.99]);
  });
});
