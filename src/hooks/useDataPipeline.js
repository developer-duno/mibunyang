import { useState, useMemo, useEffect, useDeferredValue } from "react";
import { PROFILES } from "@/constants/profiles";
import { REGIONS } from "@/constants/regions";
import { calcCats, computeRegionalMedians } from "@/scoring/engine";
import { classifyMoveIn, classifyTier, MOVEIN_VALUES, TIER_VALUES } from "@/lib/classify";
import { applyBaseFilters } from "@/lib/filterEngine";

export const VISIBLE_PAGE_SIZE = 30;

/* ── 정렬 비교 함수 (모듈 레벨 — 클로저 미사용, 매 렌더 재생성 방지) ── */
const SORTERS = {
  total: (a, b) => b.res.total - a.res.total,
  price: (a, b) => a.apt.price - b.apt.price,
  priceScore: (a, b) => b.res.cats.price.total - a.res.cats.price.total,
  location: (a, b) => b.res.cats.location.total - a.res.cats.location.total,
  safe: (a, b) => b.res.cats.risk.total - a.res.cats.risk.total,
  benefit: (a, b) => (b.res.cats.benefit?.totalWon ?? 0) - (a.res.cats.benefit?.totalWon ?? 0),
  newest: (a, b) => (b.apt.updatedAt ?? "").localeCompare(a.apt.updatedAt ?? ""),
};

/**
 * 아파트 데이터 파이프라인: apartments → catsCache → scored → filtered → visible
 * useMemo 13개 + visibleCount useState + reset useEffect
 */
export function useDataPipeline({
  apartments, profile, customWeights,
  filterRegion, filterGu, sortKey, moveInFilter, builderTier,
  showFavOnly, favoriteSet, budgetMin, budgetMax,
  areaMin, areaMax, unitsMin, unitsMax, minScore, benefitOnly,
  hideNoUnsold, compIds, dataUpdatedAt,
}) {
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);

  /* ── useDeferredValue: 필터/정렬 변경 시 UI 반응성 개선 (React 19) ── */
  const deferredRegion = useDeferredValue(filterRegion);
  const deferredGu = useDeferredValue(filterGu);
  const deferredSortKey = useDeferredValue(sortKey);
  const deferredMoveIn = useDeferredValue(moveInFilter);
  const deferredTier = useDeferredValue(builderTier);
  const isFilterPending = deferredRegion !== filterRegion || deferredGu !== filterGu
    || deferredSortKey !== sortKey || deferredMoveIn !== moveInFilter || deferredTier !== builderTier;

  const guOptions = useMemo(() => {
    if (filterRegion === "전체") {
      const gus = new Set(apartments.map(a => a.gu).filter(Boolean));
      return ["전체", ...[...gus].sort()];
    }
    const regionGus = new Set(apartments.filter(a => a.region === filterRegion).map(a => a.gu).filter(Boolean));
    return ["전체", ...[...regionGus].sort()];
  }, [filterRegion, apartments]);

  const catsCache = useMemo(() => {
    const needsFallback = apartments.some(a => !a.catsCache?.price);
    const ctx = needsFallback ? { regionMedians: computeRegionalMedians(apartments) } : null;

    if (import.meta.env.DEV && needsFallback) {
      const missing = apartments.filter(a => !a.catsCache?.price).length;
      console.warn(`[catsCache] ${missing}/${apartments.length} 폴백 (catsCache 누락)`);
      if (missing === apartments.length && apartments.length > 0) {
        console.error("[catsCache] 전체 폴백! API가 catsCache를 반환하지 않음 — 필드명 확인 필요");
      }
    }

    return apartments.map(a => ({
      apt: a,
      cats: (a.catsCache && a.catsCache.price) ? a.catsCache : calcCats(a, ctx),
    }));
  }, [apartments]);

  const scored = useMemo(() => {
    const raw = customWeights[profile];
    const w = (raw && typeof raw === "object" && Object.keys(PROFILES[profile].w).every(k => typeof raw[k] === "number")) ? raw : PROFILES[profile].w;
    return catsCache.map(({ apt, cats }) => {
      const total = Math.round(Math.min(Object.keys(cats).reduce((s, k) => s + cats[k].total * (w[k] ?? 0) / 100, 0), 100));
      return { apt, res: { total, cats, weights: w } };
    });
  }, [catsCache, profile, customWeights]);

  const baseFilterArgs = useMemo(() => ({
    showFavOnly, favoriteSet, budgetMin, budgetMax, areaMin, areaMax,
    unitsMin, unitsMax, minScore, benefitOnly,
  }), [showFavOnly, favoriteSet, budgetMin, budgetMax, areaMin, areaMax, unitsMin, unitsMax, minScore, benefitOnly]);

  const filtered = useMemo(() => {
    let list = applyBaseFilters(scored, baseFilterArgs);
    if (deferredRegion !== "전체") list = list.filter(x => x.apt.region === deferredRegion);
    if (deferredGu !== "전체") list = list.filter(x => x.apt.gu === deferredGu);
    if (deferredMoveIn !== "전체") list = list.filter(x => classifyMoveIn(x.apt) === deferredMoveIn);
    if (deferredTier !== "전체") list = list.filter(x => classifyTier(x.apt) === deferredTier);
    if (hideNoUnsold) list = list.filter(x => (x.apt.unsoldRate ?? 0) > 0);
    return [...list].sort(SORTERS[deferredSortKey] || SORTERS.total);
  }, [scored, baseFilterArgs, deferredRegion, deferredGu, deferredSortKey, deferredMoveIn, deferredTier, hideNoUnsold]);

  useEffect(() => { setVisibleCount(VISIBLE_PAGE_SIZE); }, [filtered]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const scoredMap = useMemo(() => new Map(scored.map(x => [x.apt.id, x])), [scored]);
  const compItems = useMemo(() => compIds.map(id => scoredMap.get(id)).filter(Boolean), [compIds, scoredMap]);
  const pw = useMemo(() => customWeights[profile] ?? PROFILES[profile].w, [profile, customWeights]);

  const activeFilterCount = useMemo(() =>
    [showFavOnly, filterRegion !== "전체", budgetMin, budgetMax, areaMin, areaMax, unitsMin, unitsMax, moveInFilter !== "전체", minScore, builderTier !== "전체", benefitOnly].filter(Boolean).length,
    [showFavOnly, filterRegion, budgetMin, budgetMax, areaMin, areaMax, unitsMin, unitsMax, moveInFilter, minScore, builderTier, benefitOnly]
  );

  const regionOptions = useMemo(() => {
    const rs = new Set(apartments.map(a => a.region).filter(Boolean));
    const order = Object.keys(REGIONS);
    return ["전체", ...order.filter(r => rs.has(r)), ...[...rs].filter(r => !order.includes(r)).sort()];
  }, [apartments]);

  const filterOptionCounts = useMemo(() => {
    if (!scored.length) return null;
    let base = applyBaseFilters(scored, baseFilterArgs);
    if (hideNoUnsold) base = base.filter(x => (x.apt.unsoldRate ?? 0) > 0);
    // 단일 패스 leave-one-out 카운트 (5N→1N 최적화)
    const regionCounts = Object.create(null);
    const guCounts = Object.create(null);
    const moveInCounts = Object.fromEntries(MOVEIN_VALUES.map(v => [v, 0]));
    const tierCounts = Object.fromEntries(TIER_VALUES.map(v => [v, 0]));
    for (const { apt } of base) {
      const mi = classifyMoveIn(apt);
      const ti = classifyTier(apt);
      const matchRegion = deferredRegion === "전체" || apt.region === deferredRegion;
      const matchGu = deferredGu === "전체" || apt.gu === deferredGu;
      const matchMoveIn = deferredMoveIn === "전체" || mi === deferredMoveIn;
      const matchTier = deferredTier === "전체" || ti === deferredTier;
      if (matchMoveIn && matchTier && apt.region) regionCounts[apt.region] = (regionCounts[apt.region] || 0) + 1;
      if (matchRegion && matchMoveIn && matchTier && apt.gu) guCounts[apt.gu] = (guCounts[apt.gu] || 0) + 1;
      if (matchRegion && matchGu && matchTier && mi) moveInCounts[mi]++;
      if (matchRegion && matchGu && matchMoveIn) tierCounts[ti]++;
    }
    return { regionCounts, guCounts, moveInCounts, tierCounts };
  }, [scored, baseFilterArgs, deferredRegion, deferredGu, deferredMoveIn, deferredTier, hideNoUnsold]);

  const dataFreshnessText = dataUpdatedAt ? dataUpdatedAt.slice(0, 10) + " 업데이트" : null;

  return {
    guOptions, catsCache, scored, baseFilterArgs, filtered, visible,
    visibleCount, setVisibleCount,
    scoredMap, compItems, pw,
    activeFilterCount, regionOptions, filterOptionCounts, dataFreshnessText,
    isFilterPending,
  };
}
