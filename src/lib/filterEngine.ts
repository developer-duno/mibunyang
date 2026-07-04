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
  subwayOnly?: boolean;
  schoolGoodOnly?: boolean;
  dsrPassOnly?: boolean;
  nonRegulatedOnly?: boolean;
  crimeSafeOnly?: boolean;
  childcareGoodOnly?: boolean;
  parkingGoodOnly?: boolean;
}

/**
 * 공통 base 필터 적용 — filtered useMemo와 filterOptionCounts useMemo에서 공유.
 * 드롭다운 필터(region, gu, moveIn, tier)는 포함하지 않음 (leave-one-out 패턴 때문).
 */
export function applyBaseFilters(list: ScoredApt[], f: FilterState): ScoredApt[] {
  let out = list;
  if (f.showFavOnly) out = out.filter((x) => f.favoriteSet?.has(x.apt.id ?? ""));

  // 예산 범위 (역전 시 자동 스왑)
  const bMinRaw = f.budgetMin !== "" && f.budgetMin != null ? Number(f.budgetMin) : null;
  const bMaxRaw = f.budgetMax !== "" && f.budgetMax != null ? Number(f.budgetMax) : null;
  const bMin = bMinRaw != null && Number.isFinite(bMinRaw) ? bMinRaw : null;
  const bMax = bMaxRaw != null && Number.isFinite(bMaxRaw) ? bMaxRaw : null;
  const effectiveMin = bMin != null && bMax != null && bMin > bMax ? bMax : bMin;
  const effectiveMax = bMin != null && bMax != null && bMin > bMax ? bMin : bMax;
  if (effectiveMin != null) out = out.filter((x) => (x.apt.price ?? 0) >= effectiveMin * MANWON_PER_EUK);
  if (effectiveMax != null) out = out.filter((x) => (x.apt.price ?? 0) <= effectiveMax * MANWON_PER_EUK);

  // 면적·세대수
  if (f.areaMin) out = out.filter((x) => (x.apt.area ?? 0) >= Number(f.areaMin));
  if (f.areaMax) out = out.filter((x) => (x.apt.area ?? Infinity) <= Number(f.areaMax));
  if (f.unitsMin) out = out.filter((x) => (x.apt.units ?? 0) >= Number(f.unitsMin));
  if (f.unitsMax) out = out.filter((x) => (x.apt.units ?? Infinity) <= Number(f.unitsMax));

  // 최소 점수
  if (f.minScore) {
    const ms = Number(f.minScore);
    if (Number.isFinite(ms)) out = out.filter((x) => x.res.total >= ms);
  }

  // 혜택 유무
  if (f.benefitOnly)
    out = out.filter((x) => {
      const benefit = x.res.cats?.benefit as { totalWon?: number } | undefined;
      return (benefit?.totalWon ?? 0) > 0;
    });

  // 역세권만 (≤500m, 9999=역없음 제외) — AptCard 역세권 강조 기준(<=500)과 동일
  if (f.subwayOnly) out = out.filter((x) => x.apt.subwayDist != null && (x.apt.subwayDist as number) <= 500);

  // 학군 양호(A·B)만 — schoolGrade 가 "A"/"B"로 시작 (B+ 포함, null 제외)
  if (f.schoolGoodOnly)
    out = out.filter((x) => {
      const g = x.apt.schoolGrade as string | null | undefined;
      return g != null && (g.startsWith("A") || g.startsWith("B"));
    });

  // DSR 통과만 — dsr40pass===true (false·null 제외, 자금조달 양호 단지)
  if (f.dsrPassOnly) out = out.filter((x) => x.apt.dsr40pass === true);

  // 비규제지역만 — isRegulated !== true (규제지역 제외, 매매·대출 자유)
  if (f.nonRegulatedOnly) out = out.filter((x) => x.apt.isRegulated !== true);

  // 치안 안전만 — crimeSafetyGrade 1~3등급만 통과 (4·5등급 위험 + null 미수집 제외, AptCard 위험배지 >=4 임계 일치)
  if (f.crimeSafeOnly)
    out = out.filter((x) => x.apt.crimeSafetyGrade != null && (x.apt.crimeSafetyGrade as number) <= 3);

  // 육아 인프라 좋은 곳만 — 어린이집 5개+ AND 도보권(≤500m)
  if (f.childcareGoodOnly)
    out = out.filter(
      (x) =>
        x.apt.childcare != null &&
        (x.apt.childcare as number) >= 5 &&
        x.apt.childcareDist != null &&
        (x.apt.childcareDist as number) <= 500
    );

  // 주차 넉넉한 곳만 — parkingRatio ≥ 1.5대/세대 (여유, AptCard "주차 여유" 초록칩 기준과 일치, null 미수집 제외)
  if (f.parkingGoodOnly) out = out.filter((x) => x.apt.parkingRatio != null && (x.apt.parkingRatio as number) >= 1.5);

  return out;
}
