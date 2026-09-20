import { useMemo } from "react";
import type { ScoredApt } from "@/types/hooks";

/**
 * 이 칸(시도·시군구)의 평균을 색으로 칠해도 되는 최소 단지 수.
 *
 * 1~2곳의 점수를 그 지역 전체의 색으로 칠하면 "그 지역이 원래 그렇다"는 거짓이 된다.
 * 실측(2026-09-21 라이브): 필터 없이도 시군구 193칸 중 32칸이 단지 1곳, 47칸이 3곳 미만.
 * 예산 필터를 걸면 더 심해져 10억+ 구간에서는 **시도**조차 표본 1곳까지 떨어진다.
 * 그래서 시군구·시도 두 지도가 같은 문턱을 공유한다.
 *
 * 값이 3인 이유 = 지도의 쓸모와 정직함의 균형. 5로 올리면 10억+ 필터에서 시군구 91%가
 * 흐려져 지도가 통째로 회색이 되고, 2로 내리면 "2곳 평균"이 그대로 진하게 통과한다.
 * (scoring 의 MIN_REGION_SAMPLE=20 은 점수 기준선을 만드는 잣대라 목적이 다르다 —
 *  거기선 표본이 부족하면 전국 기준으로 갈아타지만, 지도는 갈아탈 대상이 없다.)
 */
export const MIN_MAP_SAMPLE = 3;

interface RegionBucket {
  sum: number;
  count: number;
  avg: number;
  /** count >= MIN_MAP_SAMPLE — false 면 색을 흐리게 칠한다(평균은 그대로 둔다) */
  enough: boolean;
}
interface GuBucket extends RegionBucket {
  region: string;
  gu: string;
}

export interface UseRegionAveragesReturn {
  byRegion: Record<string, RegionBucket>;
  byGu: Record<string, GuBucket>;
}

type RegionAccum = { sum: number; count: number };
type GuAccum = RegionAccum & { region: string; gu: string };

/**
 * 시도/시군구 단위 평균 점수 계산 (Choropleth 색칠 지도용).
 *
 * - region/gu null 인 단지는 스킵
 * - byGu 키는 "{region}|{gu}" 복합 (구 이름 중복 방지: "강서구" 가 서울/부산/제주 동시 존재)
 * - avg 는 정수 반올림
 * - 빈 입력 → { byRegion: {}, byGu: {} }
 * - enough: 표본이 MIN_MAP_SAMPLE 이상인가 — 소비처가 이걸로 색 진하기를 가른다.
 *   평균 자체는 표본이 적어도 그대로 준다(지우면 클릭·툴팁이 쓸 값이 사라진다).
 */
export function useRegionAverages(scored: ScoredApt[]): UseRegionAveragesReturn {
  return useMemo(() => {
    const byRegion: Record<string, RegionAccum> = {};
    const byGu: Record<string, GuAccum> = {};
    for (const { apt, res } of scored) {
      const total = res?.total;
      if (!Number.isFinite(total) || !apt?.region) continue;
      byRegion[apt.region] ??= { sum: 0, count: 0 };
      byRegion[apt.region].sum += total;
      byRegion[apt.region].count++;
      if (apt.gu) {
        const key = `${apt.region}|${apt.gu}`;
        byGu[key] ??= { sum: 0, count: 0, region: apt.region, gu: apt.gu };
        byGu[key].sum += total;
        byGu[key].count++;
      }
    }
    const finalizeRegion = (m: Record<string, RegionAccum>): Record<string, RegionBucket> =>
      Object.fromEntries(
        Object.entries(m).map(([k, v]) => [
          k,
          { ...v, avg: Math.round(v.sum / v.count), enough: v.count >= MIN_MAP_SAMPLE },
        ])
      );
    const finalizeGu = (m: Record<string, GuAccum>): Record<string, GuBucket> =>
      Object.fromEntries(
        Object.entries(m).map(([k, v]) => [
          k,
          { ...v, avg: Math.round(v.sum / v.count), enough: v.count >= MIN_MAP_SAMPLE },
        ])
      );
    return { byRegion: finalizeRegion(byRegion), byGu: finalizeGu(byGu) };
  }, [scored]);
}
