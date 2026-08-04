import { describe, it, expect } from "vitest";
import { SORTERS } from "./useDataPipeline";
import type { ScoredApt } from "@/types/hooks";

// 세션 488 감사: 저가순("price")이 가격 미상(null·0)을 0원으로 취급해 맨 위로 올려
// 첫 30개가 전부 "가격 미상"이 되던 사고. 미상은 맨 뒤로 가야 한다.

/** 최소 ScoredApt 목 — price 정렬은 apt.price 와 res.total 만 본다. */
const mk = (price: number | null, total = 50): ScoredApt =>
  ({ apt: { price }, res: { total } }) as unknown as ScoredApt;

function sortPrices(prices: (number | null)[]): (number | null | undefined)[] {
  const items = prices.map((p) => mk(p));
  return [...items].sort(SORTERS.price).map((i) => i.apt.price);
}

describe("SORTERS.price — 저가순 (미상은 맨 뒤)", () => {
  it("실제 가격은 오름차순", () => {
    expect(sortPrices([50000, 29000, 41000])).toEqual([29000, 41000, 50000]);
  });

  it("null 가격은 맨 뒤로 (가장 싼 집으로 오인 금지)", () => {
    expect(sortPrices([null, 41000, 29000])).toEqual([29000, 41000, null]);
  });

  it("0 가격도 미상이므로 맨 뒤로", () => {
    expect(sortPrices([0, 41000, 29000])).toEqual([29000, 41000, 0]);
  });

  it("실가격이 미상보다 항상 앞선다 (첫 자리는 반드시 실제 최저가)", () => {
    const sorted = sortPrices([null, 0, 35000, null, 28000]);
    expect(sorted[0]).toBe(28000);
    expect(sorted[1]).toBe(35000);
    // 뒤 3자리는 전부 미상(null·0)
    expect(sorted.slice(2).every((p) => p == null || p === 0)).toBe(true);
  });

  it("양쪽 미상이면 종합점수 tie-break", () => {
    const a = mk(null, 80);
    const b = mk(0, 40);
    // 둘 다 미상 → total 높은 a 가 앞
    expect([a, b].sort(SORTERS.price)[0]).toBe(a);
  });
});
