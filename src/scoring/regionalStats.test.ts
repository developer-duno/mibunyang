import { describe, it, expect } from "vitest";
import {
  computeRegionalStats,
  percentileOf,
  usableValue,
  NATIONAL_KEY,
  MIN_REGION_SAMPLE,
  MIN_ANY_SAMPLE,
  type FieldStat,
} from "./regionalStats";
import type { Apt } from "@/types/scoring";

/** 최소 필드만 가진 가짜 단지 */
function apt(region: string, fields: Record<string, unknown>): Apt {
  return { region, ...fields } as unknown as Apt;
}

/** sorted 배열로 FieldStat 을 직접 만든다 (percentileOf 단위 테스트용) */
function stat(values: number[]): FieldStat {
  const sorted = [...values].sort((a, b) => a - b);
  const med = (arr: number[]) => {
    const m = arr.length >> 1;
    return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2;
  };
  const m = med(sorted);
  return {
    sorted,
    n: sorted.length,
    median: m,
    mad: med(sorted.map((v) => Math.abs(v - m)).sort((a, b) => a - b)),
    distinct: new Set(sorted).size,
  };
}

describe("usableValue", () => {
  it("숫자는 그대로", () => {
    expect(usableValue("price", 50000)).toBe(50000);
    expect(usableValue("price", "50000")).toBe(50000);
  });

  it("0 은 유효한 값이다 (falsy 오판 방지)", () => {
    expect(usableValue("unsoldRate", 0)).toBe(0);
  });

  it("null·undefined·NaN 은 제외", () => {
    expect(usableValue("price", null)).toBeNull();
    expect(usableValue("price", undefined)).toBeNull();
    expect(usableValue("price", "비공개")).toBeNull();
  });

  it("센티널은 제외 — 값이 있는 척하는 미수집", () => {
    expect(usableValue("subwayDist", 9999)).toBeNull();
    expect(usableValue("subwayDist", 340)).toBe(340);
    expect(usableValue("ktxDist", 99)).toBeNull();
  });

  it("0 이 불가능한 필드(평당가·소득부담·전세가율·관리비·전용률)의 0 은 미수집으로 제외 (세션 488)", () => {
    // 평당가 0 → "100% 싸요" 로 오도되던 262단지 사고 정정
    expect(usableValue("pp", 0)).toBeNull();
    expect(usableValue("pir", 0)).toBeNull();
    expect(usableValue("jeonseRate", 0)).toBeNull();
    expect(usableValue("avgMaintenanceCost", 0)).toBeNull();
    expect(usableValue("exclusiveRatio", 0)).toBeNull();
    // 0 이 진짜 값인 필드는 그대로 유지 (완판·주차 0 등)
    expect(usableValue("unsoldRate", 0)).toBe(0);
    expect(usableValue("parkingRatio", 0)).toBe(0);
    // 미수집 처리는 0 에만 — 실제 값은 통과
    expect(usableValue("pp", 1500)).toBe(1500);
  });
});

describe("computeRegionalStats", () => {
  const rows: Apt[] = [
    apt("서울", { price: 100, unsoldRate: 10 }),
    apt("서울", { price: 200, unsoldRate: 20 }),
    apt("서울", { price: 300, unsoldRate: 30 }),
    apt("경기", { price: 50, unsoldRate: 5 }),
    apt("경기", { price: 150, unsoldRate: null }),
  ];

  it("시도별로 나누고 전국 버킷도 함께 만든다", () => {
    const s = computeRegionalStats(rows, ["price"]);
    expect(s["서울"].price.n).toBe(3);
    expect(s["경기"].price.n).toBe(2);
    expect(s[NATIONAL_KEY].price.n).toBe(5);
  });

  it("중위값·정렬·distinct 를 낸다", () => {
    const s = computeRegionalStats(rows, ["price"]);
    expect(s["서울"].price.median).toBe(200);
    expect(s["서울"].price.sorted).toEqual([100, 200, 300]);
    expect(s["서울"].price.distinct).toBe(3);
  });

  it("짝수 개면 중앙 두 값의 평균", () => {
    const s = computeRegionalStats(rows, ["price"]);
    expect(s["경기"].price.median).toBe(100); // (50+150)/2
  });

  it("null 은 그 필드에서만 빠진다 (행 전체를 버리지 않는다)", () => {
    const s = computeRegionalStats(rows, ["price", "unsoldRate"]);
    expect(s["경기"].price.n).toBe(2);
    expect(s["경기"].unsoldRate.n).toBe(1);
  });

  it("region 이 비면 '기타' 버킷", () => {
    const s = computeRegionalStats([apt("", { price: 10 })], ["price"]);
    expect(s["기타"].price.n).toBe(1);
  });

  it("센티널은 분포에서 빠진다 — 안 그러면 중위값이 9999 쪽으로 끌려간다", () => {
    const withSentinel = [
      apt("서울", { subwayDist: 300 }),
      apt("서울", { subwayDist: 500 }),
      apt("서울", { subwayDist: 9999 }),
    ];
    const s = computeRegionalStats(withSentinel, ["subwayDist"]);
    expect(s["서울"].subwayDist.n).toBe(2);
    expect(s["서울"].subwayDist.median).toBe(400);
  });

  it("전부 같은 값이면 mad 0 — G2 가 이걸 보고 막대를 지운다", () => {
    const same = Array.from({ length: 30 }, () => apt("경기", { popGrowth: -0.5 }));
    const s = computeRegionalStats(same, ["popGrowth"]);
    expect(s["경기"].popGrowth.mad).toBe(0);
    expect(s["경기"].popGrowth.distinct).toBe(1);
  });

  it("유효값이 하나도 없는 필드는 아예 키가 안 생긴다", () => {
    const s = computeRegionalStats([apt("서울", { supplyRatio: null })], ["supplyRatio"]);
    expect(s["서울"]?.supplyRatio).toBeUndefined();
  });

  it("빈 배열이면 빈 객체", () => {
    expect(computeRegionalStats([], ["price"])).toEqual({});
  });

  it("임계 상수는 설계값 그대로 (G1 근거: 17시도 중 20 미만은 제주 16 하나)", () => {
    expect(MIN_REGION_SAMPLE).toBe(20);
    expect(MIN_ANY_SAMPLE).toBe(8);
  });
});

describe("percentileOf", () => {
  it("최솟값은 0 쪽, 최댓값은 100 쪽", () => {
    const s = stat([10, 20, 30, 40, 50]);
    expect(percentileOf(s, 10)).toBeLessThan(20);
    expect(percentileOf(s, 50)).toBeGreaterThan(80);
  });

  it("중앙값은 50", () => {
    expect(percentileOf(stat([10, 20, 30, 40, 50]), 30)).toBe(50);
  });

  it("동점은 절반씩 나눠 센다 — 동점 집단이 통째로 끝으로 밀리지 않게", () => {
    // 90 이 5개 중 3개. 단순 '이하 개수' 방식이면 100 이 나와 "전국 1위" 과장이 된다.
    const s = stat([10, 20, 90, 90, 90]);
    expect(percentileOf(s, 90)).toBe(70); // (2 + 3/2) / 5 * 100
    expect(percentileOf(s, 90)).toBeLessThan(100);
  });

  it("분포에 없는 값도 위치를 낸다", () => {
    expect(percentileOf(stat([10, 20, 30, 40]), 25)).toBe(50);
    expect(percentileOf(stat([10, 20, 30, 40]), 0)).toBe(0);
    expect(percentileOf(stat([10, 20, 30, 40]), 999)).toBe(100);
  });

  it("표본 1개면 50 (한쪽으로 단정하지 않는다)", () => {
    expect(percentileOf(stat([42]), 42)).toBe(50);
    expect(percentileOf(stat([42]), 1)).toBe(50);
  });

  it("전부 같은 값이면 50", () => {
    expect(percentileOf(stat([7, 7, 7, 7]), 7)).toBe(50);
  });

  it("stat 이 없거나 값이 숫자가 아니면 null", () => {
    expect(percentileOf(null, 10)).toBeNull();
    expect(percentileOf(undefined, 10)).toBeNull();
    expect(percentileOf(stat([1, 2, 3]), NaN)).toBeNull();
  });
});
