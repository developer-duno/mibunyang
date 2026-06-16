import { useState, useMemo, useEffect, useDeferredValue } from "react";
import { PROFILES } from "@/constants/profiles";
import { REGIONS } from "@/constants/regions";
import { calcCats, computeRegionalMedians } from "@/scoring/engine";
import { classifyMoveIn, classifyTier, MOVEIN_VALUES, TIER_VALUES, NOW_YM } from "@/lib/classify";
import { applyBaseFilters } from "@/lib/filterEngine";
import { matchesQuery, normalizeQuery } from "@/lib/searchMatch";
import type { Cats, ProfileWeights } from "@/types/scoring";
import type { UseDataPipelineArgs, UseDataPipelineReturn, ScoredApt, SortKey } from "@/types/hooks";

export const VISIBLE_PAGE_SIZE = 30;

/* ── 정렬 비교 함수 (모듈 레벨 — 클로저 미사용, 매 렌더 재생성 방지) ── */
const SORTERS: Record<SortKey, (_a: ScoredApt, _b: ScoredApt) => number> = {
  total: (a, b) => b.res.total - a.res.total,
  price: (a, b) => (a.apt.price ?? 0) - (b.apt.price ?? 0),
  priceScore: (a, b) => b.res.cats.price.total - a.res.cats.price.total,
  location: (a, b) => b.res.cats.location.total - a.res.cats.location.total,
  safe: (a, b) => b.res.cats.risk.total - a.res.cats.risk.total,
  benefit: (a, b) => (Number(b.res.cats.benefit?.totalWon ?? 0)) - (Number(a.res.cats.benefit?.totalWon ?? 0)),
  newest: (a, b) => String(b.apt.updatedAt ?? "").localeCompare(String(a.apt.updatedAt ?? "")),
  // 미분양 많은 순 (미분양 전문 서비스 관점) — null 은 -1 로 0% 단지보다도 뒤, 동률은 종합점수 tie-break
  unsoldRate: (a, b) => {
    const ra = a.apt.unsoldRate ?? -1, rb = b.apt.unsoldRate ?? -1;
    return ra === rb ? b.res.total - a.res.total : rb - ra;
  },
  // 대단지 순 (세대수 많은 순) — 인프라·관리비·환금성 선호, null=0 으로 미보유 단지 뒤로 (세션 423)
  units: (a, b) => (Number(a.apt.units ?? 0) === Number(b.apt.units ?? 0)) ? b.res.total - a.res.total : Number(b.apt.units ?? 0) - Number(a.apt.units ?? 0),
  // 입주 빠른순 — "지금 들어갈 집 먼저" (세션 424). 준공완료(즉시입주 가능, 미분양 핵심)→곧 입주예정→미정/null.
  // rank 0=준공완료(completion<NOW, 최근 완공 먼저) / 1=예정(>=NOW, 가까운 미래 먼저) / 2=미정·null(맨뒤).
  // /^\d{6}$/ 로 "미정"(한글)·빈문자열·null 모두 rank 2 일관 처리. 동률은 종합점수 tie-break (units 패턴).
  moveInSoon: (a, b) => {
    const ca = a.apt.completion ?? "", cb = b.apt.completion ?? "";
    const ra = /^\d{6}$/.test(ca) ? (ca < NOW_YM ? 0 : 1) : 2;
    const rb = /^\d{6}$/.test(cb) ? (cb < NOW_YM ? 0 : 1) : 2;
    if (ra !== rb) return ra - rb;
    if (ra === 0) return ca === cb ? b.res.total - a.res.total : cb.localeCompare(ca);
    if (ra === 1) return ca === cb ? b.res.total - a.res.total : ca.localeCompare(cb);
    return b.res.total - a.res.total;
  },
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
  searchQuery, hideNoUnsold, compIds, dataUpdatedAt,
}: UseDataPipelineArgs): UseDataPipelineReturn {
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);

  /* ── useDeferredValue: 필터/정렬 변경 시 UI 반응성 개선 (React 19) ── */
  const deferredRegion = useDeferredValue(filterRegion);
  const deferredGu = useDeferredValue(filterGu);
  const deferredSortKey = useDeferredValue(sortKey);
  const deferredMoveIn = useDeferredValue(moveInFilter);
  const deferredTier = useDeferredValue(builderTier);
  const deferredSearch = useDeferredValue(searchQuery);
  const normalizedSearch = useMemo(() => normalizeQuery(deferredSearch), [deferredSearch]);
  const isFilterPending = deferredRegion !== filterRegion || deferredGu !== filterGu
    || deferredSortKey !== sortKey || deferredMoveIn !== moveInFilter || deferredTier !== builderTier
    || deferredSearch !== searchQuery;

  const guOptions = useMemo<string[]>(() => {
    if (filterRegion === "전체") {
      const gus = new Set(apartments.map(a => a.gu).filter((g): g is string => Boolean(g)));
      return ["전체", ...[...gus].sort()];
    }
    const regionGus = new Set(apartments.filter(a => a.region === filterRegion).map(a => a.gu).filter((g): g is string => Boolean(g)));
    return ["전체", ...[...regionGus].sort()];
  }, [filterRegion, apartments]);

  const catsCache = useMemo(() => {
    const needsFallback = apartments.some(a => !(a.catsCache as Cats | undefined)?.price);
    const ctx = needsFallback ? { regionMedians: computeRegionalMedians(apartments) } : undefined;

    if (import.meta.env.DEV && needsFallback) {
      const missing = apartments.filter(a => !(a.catsCache as Cats | undefined)?.price).length;
      console.warn(`[catsCache] ${missing}/${apartments.length} 폴백 (catsCache 누락)`);
      if (missing === apartments.length && apartments.length > 0) {
        console.error("[catsCache] 전체 폴백! API가 catsCache를 반환하지 않음 — 필드명 확인 필요");
      }
    }

    return apartments.map(a => {
      const cached = a.catsCache as Cats | undefined;
      const cats: Cats = (cached && cached.price) ? cached : (calcCats(a, ctx) as Cats);
      return { apt: a, cats };
    });
  }, [apartments]);

  const scored = useMemo<ScoredApt[]>(() => {
    const profilesMap = PROFILES as Record<string, { w: ProfileWeights }>;
    const raw = customWeights[profile];
    const defaultW = profilesMap[profile].w;
    const w: ProfileWeights = (
      raw && typeof raw === "object"
      && Object.keys(defaultW).every(k => typeof (raw as unknown as Record<string, unknown>)[k] === "number")
    ) ? (raw as ProfileWeights) : defaultW;
    return catsCache.map(({ apt, cats }) => {
      const catKeys = Object.keys(cats) as Array<keyof Cats>;
      const total = Math.round(Math.min(
        catKeys.reduce((s, k) => s + cats[k].total * (w[k as keyof ProfileWeights] ?? 0) / 100, 0),
        100
      ));
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
    if (normalizedSearch) list = list.filter(x => matchesQuery(x.apt, normalizedSearch));
    if (hideNoUnsold) list = list.filter(x => (x.apt.unsoldRate ?? 0) > 0);
    return [...list].sort(SORTERS[deferredSortKey] || SORTERS.total);
  }, [scored, baseFilterArgs, deferredRegion, deferredGu, deferredSortKey, deferredMoveIn, deferredTier, normalizedSearch, hideNoUnsold]);

  // filtered 가 새로 생성되면 페이지네이션을 첫 30개로 리셋 — 외부 상태(필터 결과) 동기화의 정당한 effect 사용
  useEffect(() => { setVisibleCount(VISIBLE_PAGE_SIZE); }, [filtered]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const scoredMap = useMemo(() => new Map<string, ScoredApt>(scored.map(x => [x.apt.id ?? "", x])), [scored]);
  const compItems = useMemo<ScoredApt[]>(() => compIds.map(id => scoredMap.get(id)).filter((x): x is ScoredApt => Boolean(x)), [compIds, scoredMap]);
  const pw = useMemo<ProfileWeights>(() => customWeights[profile] ?? (PROFILES as Record<string, { w: ProfileWeights }>)[profile].w, [profile, customWeights]);

  const activeFilterCount = useMemo(() =>
    [showFavOnly, filterRegion !== "전체", budgetMin, budgetMax, areaMin, areaMax, unitsMin, unitsMax, moveInFilter !== "전체", minScore, builderTier !== "전체", benefitOnly, searchQuery.trim()].filter(Boolean).length,
    [showFavOnly, filterRegion, budgetMin, budgetMax, areaMin, areaMax, unitsMin, unitsMax, moveInFilter, minScore, builderTier, benefitOnly, searchQuery]
  );

  const regionOptions = useMemo<string[]>(() => {
    const rs = new Set(apartments.map(a => a.region).filter((r): r is string => Boolean(r)));
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
    // 지도 region-fit 신호 (세션 417) — 원시 filterRegion/Gu 가 아니라 deferred 값.
    // 원시값은 한 박자 빨라 filtered 가 아직 옛 지역일 때 fit 이 엉뚱한 곳에 줌되는 stale 함정 회피.
    deferredRegion, deferredGu,
  };
}
