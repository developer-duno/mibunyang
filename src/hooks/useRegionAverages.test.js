// @ts-check
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRegionAverages } from "./useRegionAverages";

/** @type {any} */
const cats = {};

describe("useRegionAverages", () => {
  it("빈 배열 → 빈 객체 반환", () => {
    const { result } = renderHook(() => useRegionAverages([]));
    expect(result.current).toEqual({ byRegion: {}, byGu: {} });
  });

  it("단일 단지 → byRegion + byGu 각각 1건, avg = 점수", () => {
    const scored = [{ apt: { region: "서울", gu: "강남구" }, res: { total: 87, cats } }];
    const { result } = renderHook(() => useRegionAverages(scored));
    expect(result.current.byRegion["서울"]).toEqual({ sum: 87, count: 1, avg: 87 });
    expect(result.current.byGu["서울|강남구"]).toMatchObject({
      sum: 87,
      count: 1,
      region: "서울",
      gu: "강남구",
      avg: 87,
    });
  });

  it("같은 구 명칭이 시도 다르면 분리 (서울 강서구 vs 부산 강서구)", () => {
    const scored = [
      { apt: { region: "서울", gu: "강서구" }, res: { total: 80, cats } },
      { apt: { region: "부산", gu: "강서구" }, res: { total: 60, cats } },
    ];
    const { result } = renderHook(() => useRegionAverages(scored));
    expect(result.current.byGu["서울|강서구"].avg).toBe(80);
    expect(result.current.byGu["부산|강서구"].avg).toBe(60);
    expect(Object.keys(result.current.byGu)).toHaveLength(2);
  });

  it("같은 구 다수 단지 → 평균 정수 반올림 (84.6 → 85)", () => {
    const scored = [
      { apt: { region: "경기", gu: "성남시" }, res: { total: 80, cats } },
      { apt: { region: "경기", gu: "성남시" }, res: { total: 85, cats } },
      { apt: { region: "경기", gu: "성남시" }, res: { total: 88, cats } },
      { apt: { region: "경기", gu: "성남시" }, res: { total: 86, cats } },
      { apt: { region: "경기", gu: "성남시" }, res: { total: 84, cats } },
    ];
    const { result } = renderHook(() => useRegionAverages(scored));
    // sum=423, count=5, avg=84.6 → 85
    expect(result.current.byGu["경기|성남시"]).toMatchObject({ sum: 423, count: 5, avg: 85 });
    expect(result.current.byRegion["경기"].avg).toBe(85);
  });

  it("region/gu null 또는 res.total 비숫자 → 스킵 (집계 무영향)", () => {
    const scored = /** @type {any} */ ([
      { apt: { region: "서울", gu: "강남구" }, res: { total: 90, cats } },
      { apt: { region: null, gu: "강남구" }, res: { total: 50, cats } }, // region null
      { apt: { region: "서울", gu: null }, res: { total: 40, cats } }, // gu null → byRegion 만 반영
      { apt: { region: "서울", gu: "서초구" }, res: { total: NaN, cats } }, // total NaN
      { apt: { region: "서울", gu: "송파구" }, res: { total: undefined, cats } }, // total undefined
    ]);
    const { result } = renderHook(() => useRegionAverages(scored));
    // 서울 byRegion: 90 + 40 = 130, count=2, avg=65
    expect(result.current.byRegion["서울"]).toEqual({ sum: 130, count: 2, avg: 65 });
    // byGu: 강남구만 (gu null / total 비숫자 제외)
    expect(Object.keys(result.current.byGu)).toEqual(["서울|강남구"]);
    expect(result.current.byGu["서울|강남구"].avg).toBe(90);
  });
});
