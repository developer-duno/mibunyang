import type { Apt } from "@/types/scoring";

/**
 * 지역별 중위값 계산. sanitize() 의 위험 필드 폴백 재료.
 * 각 필드: null/NaN/음수·0(maint) 제외 후 정렬 중앙값. 빈 배열 → null.
 * region 미지정(null/"") → "기타" 버킷.
 * 짝수 개수: 중앙 2개 평균. 홀수: 중앙값 1개.
 */
export type RegionalMedians = Record<
  string,
  {
    pir: number | null;
    psr: number | null;
    unsoldRate: number | null;
    supplyRatio: number | null;
    maint: number | null;
  }
>;

type Bucket = {
  pir: number[];
  psr: number[];
  unsoldRate: number[];
  supplyRatio: number[];
  maint: number[];
};

export function computeRegionalMedians(apartments: Apt[]): RegionalMedians {
  const groups: Record<string, Bucket> = {};
  for (const apt of apartments) {
    const r = (apt.region as string) || "기타";
    if (!groups[r]) groups[r] = { pir: [], psr: [], unsoldRate: [], supplyRatio: [], maint: [] };
    if (apt.pir != null && Number.isFinite(Number(apt.pir))) groups[r].pir.push(Number(apt.pir));
    if (apt.psr != null && Number.isFinite(Number(apt.psr))) groups[r].psr.push(Number(apt.psr));
    if (apt.unsoldRate != null && Number.isFinite(Number(apt.unsoldRate)))
      groups[r].unsoldRate.push(Number(apt.unsoldRate));
    if (apt.supplyRatio != null && Number.isFinite(Number(apt.supplyRatio)))
      groups[r].supplyRatio.push(Number(apt.supplyRatio));
    if (apt.avgMaintenanceCost != null && apt.avgMaintenanceCost > 0)
      groups[r].maint.push(Number(apt.avgMaintenanceCost));
  }
  const median = (arr: number[]): number | null => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const result: RegionalMedians = {};
  for (const [r, g] of Object.entries(groups)) {
    result[r] = {
      pir: median(g.pir),
      psr: median(g.psr),
      unsoldRate: median(g.unsoldRate),
      supplyRatio: median(g.supplyRatio),
      maint: median(g.maint),
    };
  }
  return result;
}
