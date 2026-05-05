import type { ScoredApt } from "@/types/hooks";

/** 억 → 만원 변환 (사용자 입력 억 단위 × 10000 = DB 만원 단위) */
const MANWON_PER_EUK = 10000;

/**
 * filterEngine.test.js 가 string ("4") + 빈 문자열 ("") + null 모두 fixture 로 사용 →
 * useDataPipeline 의 number|null 흐름 + test 의 string 흐름 동시 수용.
 */
export interface FilterState {
  showFavOnly?: boolean;
  favoriteSet?: Set<string>;
  budgetMin?: string | number | null;
  budgetMax?: string | number | null;
  areaMin?: string | number | null;
  areaMax?: string | number | null;
  unitsMin?: string | number | null;
  unitsMax?: string | number | null;
  minScore?: string | number | null;
  benefitOnly?: boolean;
}

/**
 * 공통 base 필터 적용 — filtered useMemo와 filterOptionCounts useMemo에서 공유.
 * 드롭다운 필터(region, gu, moveIn, tier)는 포함하지 않음 (leave-one-out 패턴 때문).
 */
export function applyBaseFilters(list: ScoredApt[], f: FilterState): ScoredApt[] {
  let out = list;
  if (f.showFavOnly) out = out.filter(x => f.favoriteSet?.has(x.apt.id ?? ""));

  // 예산 범위 (역전 시 자동 스왑)
  const bMinRaw = f.budgetMin !== "" && f.budgetMin != null ? Number(f.budgetMin) : null;
  const bMaxRaw = f.budgetMax !== "" && f.budgetMax != null ? Number(f.budgetMax) : null;
  const bMin = bMinRaw != null && Number.isFinite(bMinRaw) ? bMinRaw : null;
  const bMax = bMaxRaw != null && Number.isFinite(bMaxRaw) ? bMaxRaw : null;
  const effectiveMin = (bMin != null && bMax != null && bMin > bMax) ? bMax : bMin;
  const effectiveMax = (bMin != null && bMax != null && bMin > bMax) ? bMin : bMax;
  if (effectiveMin != null) out = out.filter(x => (x.apt.price ?? 0) >= effectiveMin * MANWON_PER_EUK);
  if (effectiveMax != null) out = out.filter(x => (x.apt.price ?? 0) <= effectiveMax * MANWON_PER_EUK);

  // 면적·세대수
  if (f.areaMin) out = out.filter(x => (x.apt.area ?? 0) >= Number(f.areaMin));
  if (f.areaMax) out = out.filter(x => (x.apt.area ?? Infinity) <= Number(f.areaMax));
  if (f.unitsMin) out = out.filter(x => (x.apt.units ?? 0) >= Number(f.unitsMin));
  if (f.unitsMax) out = out.filter(x => (x.apt.units ?? Infinity) <= Number(f.unitsMax));

  // 최소 점수
  if (f.minScore) { const ms = Number(f.minScore); if (Number.isFinite(ms)) out = out.filter(x => x.res.total >= ms); }

  // 혜택 유무
  if (f.benefitOnly) out = out.filter(x => {
    const benefit = x.res.cats?.benefit as { totalWon?: number } | undefined;
    return (benefit?.totalWon ?? 0) > 0;
  });

  return out;
}
