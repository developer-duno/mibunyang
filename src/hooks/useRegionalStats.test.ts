import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRegionalStats } from "./useRegionalStats";
import { NATIONAL_KEY } from "@/scoring/regionalStats";
import type { Apt } from "@/types/scoring";

function apts(n: number): Apt[] {
  return Array.from({ length: n }, (_, i) => ({ region: "서울", price: 100 + i }) as unknown as Apt);
}

describe("useRegionalStats", () => {
  it("지역·전국 분포를 계산한다", () => {
    const { result } = renderHook(() => useRegionalStats(apts(25)));
    expect(result.current?.["서울"].price.n).toBe(25);
    expect(result.current?.[NATIONAL_KEY].price.n).toBe(25);
  });

  it("같은 배열 참조로 다시 그리면 **같은 객체**를 준다", () => {
    // 이게 깨지면 AptCard comparator 의 `prev.regionStats !== next.regionStats` 가
    // 매번 참이 되어 카드 30장이 통째로 다시 그려진다.
    const list = apts(25);
    const { result, rerender } = renderHook(({ a }) => useRegionalStats(a), { initialProps: { a: list } });
    const first = result.current;
    rerender({ a: list });
    expect(result.current).toBe(first);
  });

  it("배열이 바뀌면 다시 계산한다", () => {
    const { result, rerender } = renderHook(({ a }) => useRegionalStats(a), { initialProps: { a: apts(25) } });
    const first = result.current;
    rerender({ a: apts(30) });
    expect(result.current).not.toBe(first);
    expect(result.current?.["서울"].price.n).toBe(30);
  });

  it("빈 배열·null·undefined 는 null (호출처가 미수집으로 처리)", () => {
    expect(renderHook(() => useRegionalStats([])).result.current).toBeNull();
    expect(renderHook(() => useRegionalStats(null)).result.current).toBeNull();
    expect(renderHook(() => useRegionalStats(undefined)).result.current).toBeNull();
  });

  it("catsCache 유무와 무관하게 계산한다 — needsFallback 게이트를 타지 않는다", () => {
    // 운영에서는 catsCache 가 전부 채워져 있어 computeRegionalMedians 가 거의 안 불린다.
    // 편차 막대가 그 게이트에 얹히면 "운영에서만 막대가 안 보이는" 사고가 난다.
    const withCache = apts(25).map((a) => ({ ...a, catsCache: { price: { total: 70 } } }) as unknown as Apt);
    const { result } = renderHook(() => useRegionalStats(withCache));
    expect(result.current?.["서울"].price.n).toBe(25);
  });
});
