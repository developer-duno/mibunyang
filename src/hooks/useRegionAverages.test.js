// @ts-check
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRegionAverages, MIN_MAP_SAMPLE } from "./useRegionAverages";

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
    // 단지 1곳 → 평균은 그대로 주되 enough=false (지도가 흐리게 칠한다)
    expect(result.current.byRegion["서울"]).toEqual({ sum: 87, count: 1, avg: 87, enough: false });
    expect(result.current.byGu["서울|강남구"]).toMatchObject({
      sum: 87,
      count: 1,
      region: "서울",
      gu: "강남구",
      avg: 87,
      enough: false,
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
    expect(result.current.byRegion["서울"]).toEqual({ sum: 130, count: 2, avg: 65, enough: false });
    // byGu: 강남구만 (gu null / total 비숫자 제외)
    expect(Object.keys(result.current.byGu)).toEqual(["서울|강남구"]);
    expect(result.current.byGu["서울|강남구"].avg).toBe(90);
  });

  // ─────────────────────────────────────────────────────────────────
  // 표본 가드 (MIN_MAP_SAMPLE) — 색칠 지도가 "단지 1곳 점수 = 그 지역"이라는
  // 거짓을 칠하지 않게 막는다. 경계를 정면으로 겨냥한다(문턱 미만/정확히/초과).
  // ─────────────────────────────────────────────────────────────────
  describe("표본 가드 enough", () => {
    /**
     * 같은 구에 단지 n 곳을 만든다 (점수는 전부 80 — 평균이 흔들리지 않게)
     * @param {number} n
     */
    const nApts = (n) =>
      Array.from({ length: n }, () => ({ apt: { region: "경기", gu: "수원시" }, res: { total: 80, cats } }));

    it("문턱 미만(2곳)이면 enough=false — 시군구·시도 둘 다", () => {
      const { result } = renderHook(() => useRegionAverages(nApts(MIN_MAP_SAMPLE - 1)));
      expect(result.current.byGu["경기|수원시"].enough).toBe(false);
      expect(result.current.byRegion["경기"].enough).toBe(false);
    });

    it("문턱과 같으면(3곳) enough=true — 경계 포함(>=)", () => {
      const { result } = renderHook(() => useRegionAverages(nApts(MIN_MAP_SAMPLE)));
      expect(result.current.byGu["경기|수원시"].enough).toBe(true);
      expect(result.current.byRegion["경기"].enough).toBe(true);
    });

    it("문턱 초과(4곳)면 enough=true", () => {
      const { result } = renderHook(() => useRegionAverages(nApts(MIN_MAP_SAMPLE + 1)));
      expect(result.current.byGu["경기|수원시"].enough).toBe(true);
    });

    it("표본이 적어도 avg 는 지우지 않는다 (클릭·툴팁이 쓸 값)", () => {
      const { result } = renderHook(() => useRegionAverages(nApts(1)));
      expect(result.current.byGu["경기|수원시"].enough).toBe(false);
      expect(result.current.byGu["경기|수원시"].avg).toBe(80);
    });

    it("시도는 충분한데 그 안의 시군구는 부족할 수 있다 (두 축이 독립)", () => {
      const scored = [
        { apt: { region: "경기", gu: "수원시" }, res: { total: 80, cats } },
        { apt: { region: "경기", gu: "성남시" }, res: { total: 70, cats } },
        { apt: { region: "경기", gu: "용인시" }, res: { total: 60, cats } },
      ];
      const { result } = renderHook(() => useRegionAverages(scored));
      expect(result.current.byRegion["경기"].enough).toBe(true); // 시도 3곳 = 충분
      expect(result.current.byGu["경기|수원시"].enough).toBe(false); // 각 구는 1곳
    });
  });
});
