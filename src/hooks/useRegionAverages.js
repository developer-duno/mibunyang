import { useMemo } from "react";

/**
 * 시도/시군구 단위 평균 점수 계산 (Choropleth 색칠 지도용).
 *
 * @param {Array<{apt: {region?: string, gu?: string}, res: {total: number}}>} scored
 * @returns {{ byRegion: Record<string, {sum: number, count: number, avg: number}>,
 *            byGu: Record<string, {sum: number, count: number, region: string, gu: string, avg: number}> }}
 *
 * - region/gu null 인 단지는 스킵
 * - byGu 키는 "{region}|{gu}" 복합 (구 이름 중복 방지: "강서구" 가 서울/부산/제주 동시 존재)
 * - avg 는 정수 반올림
 * - 빈 입력 → { byRegion: {}, byGu: {} }
 */
export function useRegionAverages(scored) {
  return useMemo(() => {
    const byRegion = {};
    const byGu = {};
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
    const finalize = (m) => Object.fromEntries(
      Object.entries(m).map(([k, v]) => [k, { ...v, avg: Math.round(v.sum / v.count) }])
    );
    return { byRegion: finalize(byRegion), byGu: finalize(byGu) };
  }, [scored]);
}
