import type { Apt } from "@/types/scoring";

/**
 * 지역별 중위값 계산. sanitize() 의 위험 필드 폴백 재료.
 * 각 필드: null/NaN/음수·0(maint) 제외 후 정렬 중앙값. 빈 배열 → null.
 * region 미지정(null/"") → "기타" 버킷.
 * 짝수 개수: 중앙 2개 평균. 홀수: 중앙값 1개.
 *
 * ⚠️ 세션539 E-1: 여기서 계산하는 5필드(pir/psr/unsoldRate/supplyRatio/maint) 중
 *   **pir·psr·unsoldRate 는 죽은 계산**이다 — `sanitize()`(engine.ts)가 셋 다
 *   `num(apt.X, null)` 로 채워 이 값을 전혀 안 본다(engine.ts:23 주석 참조). 실제로
 *   소비되는 건 `supplyRatio`와 `maint` 둘뿐. 계산 자체는 채점에 영향이 없으니 지워도
 *   안전하지만, 지우는 건 이 세션의 범위 밖이라 표시만 해 둔다.
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
