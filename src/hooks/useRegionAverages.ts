import { useMemo } from "react";
import type { ScoredApt } from "@/types/hooks";

interface RegionBucket {
  sum: number;
  count: number;
  avg: number;
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
      Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, avg: Math.round(v.sum / v.count) }]));
    const finalizeGu = (m: Record<string, GuAccum>): Record<string, GuBucket> =>
      Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, avg: Math.round(v.sum / v.count) }]));
    return { byRegion: finalizeRegion(byRegion), byGu: finalizeGu(byGu) };
  }, [scored]);
}
