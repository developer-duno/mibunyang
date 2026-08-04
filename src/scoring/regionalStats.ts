import type { Apt } from "@/types/scoring";
import { isSentinel } from "@/constants/sentinels";
import { DEVIATION_FIELD_NAMES } from "@/constants/deviationFields";

/**
 * 한 (지역 × 필드) 의 분포 요약.
 *
 * `computeRegionalMedians` 는 중위값 하나만 낸다. 편차 막대는 그것만으로 못 그린다 —
 * "이 단지가 어느 위치인가"(백분위)와 "그 지역이 애초에 서로 다르긴 한가"(mad·distinct)가
 * 있어야 거짓 막대를 막을 수 있다. 그래서 별도 계산부를 둔다.
 *
 * ⚠️ `computeRegionalMedians` 는 **건드리지 않는다** — 그쪽은 점수 폴백(`sanitize`)이
 * 쓰는 계산이라, 여기서 손대면 표현계층 변경이 점수에 새어 들어간다.
 */
export type FieldStat = {
  /** 오름차순 유효값 (센티널·null 제외) */
  sorted: number[];
  n: number;
  median: number;
  /** 중위절대편차 — 0 이면 그 지역이 사실상 한 값이다 */
  mad: number;
  distinct: number;
};

/** region → field → stat. 전국 버킷의 키는 `NATIONAL_KEY`. */
export type RegionalStats = Record<string, Record<string, FieldStat>>;

/** 전국 폴백 버킷의 지역 키 (실제 시도명과 겹치지 않게 기호 사용) */
export const NATIONAL_KEY = "__national__";

/** 지역 표본이 이보다 적으면 그 지역 기준을 쓰지 않는다 (G1) */
export const MIN_REGION_SAMPLE = 20;
/** 전국 기준으로도 못 그리는 하한 (G1) */
export const MIN_ANY_SAMPLE = 8;

function median(sortedAsc: number[]): number {
  const m = sortedAsc.length >> 1;
  return sortedAsc.length % 2 ? sortedAsc[m] : (sortedAsc[m - 1] + sortedAsc[m]) / 2;
}

function buildStat(values: number[]): FieldStat | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const med = median(sorted);
  const devs = sorted.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  return {
    sorted,
    n: sorted.length,
    median: med,
    mad: median(devs),
    distinct: new Set(sorted).size,
  };
}

/**
 * 값 0이 "실제 0"이 아니라 "미수집"인 필드 — 물리적으로 0일 수 없는 값들.
 * (평당가·소득부담·전세가율·관리비·전용률은 0이면 곧 데이터 없음.)
 * ⚠️ `unsoldRate`(0%=완판=유효)·`subwayDist`(자체 센티널)·`parkingRatio`(0도 가능)는 제외 —
 *    이들에서 0은 진짜 값이므로 미수집으로 바꾸면 안 된다.
 */
const ZERO_MEANS_MISSING = new Set(["pp", "pir", "jeonseRate", "avgMaintenanceCost", "exclusiveRatio"]);

/** 편차 계산에 쓸 수 있는 값인가 — null·NaN·센티널·("없음=0" 필드의) 0 제외 */
export function usableValue(field: string, raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (isSentinel(field, n)) return null;
  if (n === 0 && ZERO_MEANS_MISSING.has(field)) return null;
  return n;
}

/**
 * 시도별 + 전국 분포를 한 번에 계산한다.
 *
 * 대조군을 **시도로 고정**하는 이유 — 구 단위는 실측 213그룹·중앙 5단지라
 * 중위값이 단지 하나에 흔들린다. 시도는 17개 중 20 미만이 제주(16) 하나뿐이다.
 */
export function computeRegionalStats(
  apartments: readonly Apt[],
  fields: readonly string[] = DEVIATION_FIELD_NAMES
): RegionalStats {
  const buckets: Record<string, Record<string, number[]>> = {};
  const push = (regionKey: string, field: string, v: number) => {
    buckets[regionKey] ??= {};
    (buckets[regionKey][field] ??= []).push(v);
  };

  for (const apt of apartments) {
    const region = ((apt as unknown as Record<string, unknown>).region as string) || "기타";
    for (const field of fields) {
      const v = usableValue(field, (apt as unknown as Record<string, unknown>)[field]);
      if (v == null) continue;
      push(region, field, v);
      push(NATIONAL_KEY, field, v);
    }
  }

  const out: RegionalStats = {};
  for (const [regionKey, byField] of Object.entries(buckets)) {
    const stats: Record<string, FieldStat> = {};
    for (const [field, values] of Object.entries(byField)) {
      const s = buildStat(values);
      if (s) stats[field] = s;
    }
    out[regionKey] = stats;
  }
  return out;
}

/**
 * 이 값이 분포에서 몇 % 지점인가 (0~100).
 *
 * 동점을 절반으로 나눠 세는 mid-rank 방식이다. 점수·값이 정수라 동점이 대량으로
 * 생기는 데이터인데(세션 486 실측: 같은 점수 132곳), 단순히 "이하 개수"로 세면
 * 동점 집단 전체가 분포의 오른쪽 끝으로 밀려 "전국 1위"류의 과장이 된다.
 */
export function percentileOf(stat: FieldStat | undefined | null, value: number): number | null {
  if (!stat || stat.n === 0 || !Number.isFinite(value)) return null;
  if (stat.n === 1) return 50;
  let below = 0;
  let equal = 0;
  for (const v of stat.sorted) {
    if (v < value) below++;
    else if (v === value) equal++;
    else break; // 오름차순이라 더 볼 필요 없음
  }
  return ((below + equal / 2) / stat.n) * 100;
}
