import { useState, useMemo, useEffect, useDeferredValue } from "react";
import { PROFILES } from "@/constants/profiles";
import { REGIONS } from "@/constants/regions";
import { calcCats, computeRegionalMedians, locationTotalForProfile } from "@/scoring/engine";
import { classifyMoveIn, classifyTier, MOVEIN_VALUES, TIER_VALUES, NOW_YM } from "@/lib/classify";
import { applyBaseFilters } from "@/lib/filterEngine";
import { matchesQuery, normalizeQuery } from "@/lib/searchMatch";
import type { LocationSubWeights } from "@/constants/scoringTiers";
import type { Cats, ProfileWeights } from "@/types/scoring";
import type { UseDataPipelineArgs, UseDataPipelineReturn, ScoredApt, SortKey } from "@/types/hooks";

export const VISIBLE_PAGE_SIZE = 30;

/* ── 정렬 비교 함수 (모듈 레벨 — 클로저 미사용, 매 렌더 재생성 방지) ── */
export const SORTERS: Record<SortKey, (_a: ScoredApt, _b: ScoredApt) => number> = {
  total: (a, b) => b.res.total - a.res.total,
  // 저가순 — 가격 없음(null)·0(미수집)은 맨 뒤로. 예전 `?? 0` 은 미상 단지를 "가장 싼 집"으로
  // 올려 저가순 첫 30개가 전부 "가격 미상"이 되던 사고(세션 488 감사) 정정. 동률·양쪽 미상은 종합점수 tie-break.
  price: (a, b) => {
    const va = a.apt.price && a.apt.price > 0 ? a.apt.price : Infinity;
    const vb = b.apt.price && b.apt.price > 0 ? b.apt.price : Infinity;
    return va === vb ? b.res.total - a.res.total : va - vb;
  },
  priceScore: (a, b) => b.res.cats.price.total - a.res.cats.price.total,
  location: (a, b) => b.res.cats.location.total - a.res.cats.location.total,
  safe: (a, b) => b.res.cats.risk.total - a.res.cats.risk.total,
  benefit: (a, b) => Number(b.res.cats.benefit?.totalWon ?? 0) - Number(a.res.cats.benefit?.totalWon ?? 0),
  newest: (a, b) => String(b.apt.updatedAt ?? "").localeCompare(String(a.apt.updatedAt ?? "")),
  // 미분양 많은 순 (미분양 전문 서비스 관점) — null 은 -1 로 0% 단지보다도 뒤, 동률은 종합점수 tie-break
  unsoldRate: (a, b) => {
    const ra = a.apt.unsoldRate ?? -1,
      rb = b.apt.unsoldRate ?? -1;
    return ra === rb ? b.res.total - a.res.total : rb - ra;
  },
  // 대단지 순 (세대수 많은 순) — 인프라·관리비·환금성 선호, null=0 으로 미보유 단지 뒤로 (세션 423)
  units: (a, b) =>
    Number(a.apt.units ?? 0) === Number(b.apt.units ?? 0)
      ? b.res.total - a.res.total
      : Number(b.apt.units ?? 0) - Number(a.apt.units ?? 0),
  // 입주 빠른순 — "지금 들어갈 집 먼저" (세션 424). 준공완료(즉시입주 가능, 미분양 핵심)→곧 입주예정→미정/null.
  // rank 0=준공완료(completion<NOW, 최근 완공 먼저) / 1=예정(>=NOW, 가까운 미래 먼저) / 2=미정·null(맨뒤).
  // /^\d{6}$/ 로 "미정"(한글)·빈문자열·null 모두 rank 2 일관 처리. 동률은 종합점수 tie-break (units 패턴).
  moveInSoon: (a, b) => {
    const ca = a.apt.completion ?? "",
      cb = b.apt.completion ?? "";
    const ra = /^\d{6}$/.test(ca) ? (ca < NOW_YM ? 0 : 1) : 2;
    const rb = /^\d{6}$/.test(cb) ? (cb < NOW_YM ? 0 : 1) : 2;
    if (ra !== rb) return ra - rb;
    if (ra === 0) return ca === cb ? b.res.total - a.res.total : cb.localeCompare(ca);
    if (ra === 1) return ca === cb ? b.res.total - a.res.total : ca.localeCompare(cb);
    return b.res.total - a.res.total;
  },
  // 역세권 가까운순 (subwayDist 오름차순) — 가까운 단지 먼저. 9999=수집기 "역 없음" sentinel(245건/17%)
  // 이라 null 과 함께 Infinity 로 정규화해 맨뒤. 동률은 종합점수 tie-break (세션 444)
  subwayNear: (a, b) => {
    const norm = (d: number | null | undefined) => (d == null || d >= 9999 ? Infinity : Number(d));
    const da = norm(a.apt.subwayDist),
      db = norm(b.apt.subwayDist);
    return da === db ? b.res.total - a.res.total : da - db;
  },
  // 전세가율 높은순 (jeonseRate 내림차순, 채움률 99.4%) — 전세 끼고 투자(갭) 유리. null=-1 로 맨뒤, 동률은 종합점수 tie-break (세션 444)
  jeonseHigh: (a, b) => {
    const ra = a.apt.jeonseRate ?? -1,
      rb = b.apt.jeonseRate ?? -1;
    return ra === rb ? b.res.total - a.res.total : Number(rb) - Number(ra);
  },
  // 관리비 낮은순 (avgMaintenanceCost 오름차순, 만원, 채움률 71.3%) — 월 고정비 낮은 집 먼저. 실거주·은퇴 프로필 관심.
  // null(미수집 452단지)은 Infinity 로 맨뒤(작은값이 앞이라 subwayNear 패턴 답습). 동률은 종합점수 tie-break (세션 474)
  maintenanceLow: (a, b) => {
    const norm = (c: number | null | undefined) => (c == null ? Infinity : Number(c));
    const ca = norm(a.apt.avgMaintenanceCost),
      cb = norm(b.apt.avgMaintenanceCost);
    return ca === cb ? b.res.total - a.res.total : ca - cb;
  },
  // 치안 안전순 (crimeSafetyGrade 오름차순, 1등급=가장 안전, 채움률 86.9%) — 위험 낮은 동네 먼저. 신혼·교육·은퇴 관심.
  // ⚠️ safe(res.cats.risk.total 종합점수)와 다름 — 이건 원본 치안 등급값 정렬. null(미수집 207단지)은 Infinity 로 맨뒤.
  // 동률은 종합점수 tie-break (subwayNear 패턴 답습, 세션 474)
  crimeSafe: (a, b) => {
    const norm = (g: number | null | undefined) => (g == null ? Infinity : Number(g));
    const ga = norm(a.apt.crimeSafetyGrade),
      gb = norm(b.apt.crimeSafetyGrade);
    return ga === gb ? b.res.total - a.res.total : ga - gb;
  },
  // 주차 넉넉순 (parkingRatio 내림차순, 대/세대, 채움률 90.5%) — 주차 여유 단지 먼저. 실거주 관심.
  // null(미수집 149단지)은 -Infinity 로 맨뒤(큰값이 앞이라 jeonseHigh 패턴 답습). 동률은 종합점수 tie-break (세션 477)
  parkingHigh: (a, b) => {
    const norm = (p: number | null | undefined) => (p == null ? -Infinity : Number(p));
    const pa = norm(a.apt.parkingRatio),
      pb = norm(b.apt.parkingRatio);
    return pa === pb ? b.res.total - a.res.total : pb - pa;
  },
  // 병원 가까운순 (hospitalDist 오름차순, m, 채움률 94.8%) — 응급·의료 접근성 우선. 은퇴·실거주 관심.
  // sentinel 없음(수집 반경 1km 캡, max 989m) → null 만 Infinity 로 맨뒤(subwayNear 의 9999 분기 불필요). 동률은 종합점수 tie-break (세션 479)
  hospitalNear: (a, b) => {
    const norm = (d: number | null | undefined) => (d == null ? Infinity : Number(d));
    const da = norm(a.apt.hospitalDist),
      db = norm(b.apt.hospitalDist);
    return da === db ? b.res.total - a.res.total : da - db;
  },
  // 공원 가까운순 (parkDist 오름차순, m, 채움률 95.0%) — 녹지·산책 접근성 우선. 신혼·실거주 관심.
  // sentinel 없음(수집 반경 1km 캡, max 998m) → null 만 Infinity 로 맨뒤. 동률은 종합점수 tie-break (세션 479)
  parkNear: (a, b) => {
    const norm = (d: number | null | undefined) => (d == null ? Infinity : Number(d));
    const da = norm(a.apt.parkDist),
      db = norm(b.apt.parkDist);
    return da === db ? b.res.total - a.res.total : da - db;
  },
};

/**
 * 아파트 데이터 파이프라인: apartments → catsCache → scored → filtered → visible
 * useMemo 13개 + visibleCount useState + reset useEffect
 */
export function useDataPipeline({
  apartments,
  profile,
  customWeights,
  filterRegion,
  filterGu,
  sortKey,
  moveInFilter,
  builderTier,
  showFavOnly,
  favoriteSet,
  budgetMin,
  budgetMax,
  areaMin,
  areaMax,
  unitsMin,
  unitsMax,
  minScore,
  benefitOnly,
  subwayOnly,
  schoolGoodOnly,
  dsrPassOnly,
  nonRegulatedOnly,
  crimeSafeOnly,
  childcareGoodOnly,
  parkingGoodOnly,
  hospitalNearOnly,
  parkNearOnly,
  searchQuery,
  hideNoUnsold,
  compIds,
  dataUpdatedAt,
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
  const isFilterPending =
    deferredRegion !== filterRegion ||
    deferredGu !== filterGu ||
    deferredSortKey !== sortKey ||
    deferredMoveIn !== moveInFilter ||
    deferredTier !== builderTier ||
    deferredSearch !== searchQuery;

  const guOptions = useMemo<string[]>(() => {
    if (filterRegion === "전체") {
      const gus = new Set(apartments.map((a) => a.gu).filter((g): g is string => Boolean(g)));
      return ["전체", ...[...gus].sort()];
    }
    const regionGus = new Set(
      apartments
        .filter((a) => a.region === filterRegion)
        .map((a) => a.gu)
        .filter((g): g is string => Boolean(g))
    );
    return ["전체", ...[...regionGus].sort()];
  }, [filterRegion, apartments]);

  const catsCache = useMemo(() => {
    const needsFallback = apartments.some((a) => !(a.catsCache as Cats | undefined)?.price);
    const ctx = needsFallback ? { regionMedians: computeRegionalMedians(apartments) } : undefined;

    if (import.meta.env.DEV && needsFallback) {
      const missing = apartments.filter((a) => !(a.catsCache as Cats | undefined)?.price).length;
      console.warn(`[catsCache] ${missing}/${apartments.length} 폴백 (catsCache 누락)`);
      if (missing === apartments.length && apartments.length > 0) {
        console.error("[catsCache] 전체 폴백! API가 catsCache를 반환하지 않음 — 필드명 확인 필요");
      }
    }

    return apartments.map((a) => {
      const cached = a.catsCache as Cats | undefined;
      const cats: Cats = cached && cached.price ? cached : (calcCats(a, ctx) as Cats);
      return { apt: a, cats };
    });
  }, [apartments]);

  const scored = useMemo<ScoredApt[]>(() => {
    const profilesMap = PROFILES as Record<string, { w: ProfileWeights; locW?: LocationSubWeights }>;
    const raw = customWeights[profile];
    const defaultW = profilesMap[profile].w;
    const w: ProfileWeights =
      raw &&
      typeof raw === "object" &&
      Object.keys(defaultW).every((k) => typeof (raw as unknown as Record<string, unknown>)[k] === "number")
        ? (raw as ProfileWeights)
        : defaultW;
    // 입지 내부 비중(세션526 수술 (나)). `catsCache` 는 기준 비중으로 구워져 있어 프로필과 무관하므로,
    // locW 를 가진 프로필만 입지 총점을 다시 계산해 갈아끼운다. 손님이 만지는 커스텀 가중치
    // (customWeights)는 **카테고리 축만** 다루므로 locW 는 프로필 고정값 그대로 쓴다.
    const locW = profilesMap[profile]?.locW;
    return catsCache.map(({ apt, cats }) => {
      // live/invest 는 캐시 객체를 그대로 참조한다(불필요한 clone 0 — 참조 동일성 유지).
      const catsP: Cats = locW
        ? { ...cats, location: { ...cats.location, total: locationTotalForProfile(apt, locW) } }
        : cats;
      const catKeys = Object.keys(catsP) as Array<keyof Cats>;
      const total = Math.round(
        Math.min(
          catKeys.reduce((s, k) => s + (catsP[k].total * (w[k as keyof ProfileWeights] ?? 0)) / 100, 0),
          100
        )
      );
      // res.cats 로 DetailModal·CompareSheet·정렬이 전부 흐르므로 여기 한 곳 교체로 표시·합산이 함께 간다.
      return { apt, res: { total, cats: catsP, weights: w } };
    });
  }, [catsCache, profile, customWeights]);

  const baseFilterArgs = useMemo(
    () => ({
      showFavOnly,
      favoriteSet,
      budgetMin,
      budgetMax,
      areaMin,
      areaMax,
      unitsMin,
      unitsMax,
      minScore,
      benefitOnly,
      subwayOnly,
      schoolGoodOnly,
      dsrPassOnly,
      nonRegulatedOnly,
      crimeSafeOnly,
      childcareGoodOnly,
      parkingGoodOnly,
      hospitalNearOnly,
      parkNearOnly,
    }),
    [
      showFavOnly,
      favoriteSet,
      budgetMin,
      budgetMax,
      areaMin,
      areaMax,
      unitsMin,
      unitsMax,
      minScore,
      benefitOnly,
      subwayOnly,
      schoolGoodOnly,
      dsrPassOnly,
      nonRegulatedOnly,
      crimeSafeOnly,
      childcareGoodOnly,
      parkingGoodOnly,
      hospitalNearOnly,
      parkNearOnly,
    ]
  );

  const filtered = useMemo(() => {
    let list = applyBaseFilters(scored, baseFilterArgs);
    if (deferredRegion !== "전체") list = list.filter((x) => x.apt.region === deferredRegion);
    if (deferredGu !== "전체") list = list.filter((x) => x.apt.gu === deferredGu);
    if (deferredMoveIn !== "전체") list = list.filter((x) => classifyMoveIn(x.apt) === deferredMoveIn);
    if (deferredTier !== "전체") list = list.filter((x) => classifyTier(x.apt) === deferredTier);
    if (normalizedSearch) list = list.filter((x) => matchesQuery(x.apt, normalizedSearch));
    // "미분양만 보기"는 unsold(수)로 — unsoldRate 는 100% 초과 폭발값이 null 로 무력화돼 있을 수 있어
    //   미분양 단지가 목록에서 사라지던 회귀 방지 (세션 445). 잔여 미분양 세대가 있으면 표시.
    if (hideNoUnsold) list = list.filter((x) => Number(x.apt.unsold ?? 0) > 0);
    return [...list].sort(SORTERS[deferredSortKey] || SORTERS.total);
  }, [
    scored,
    baseFilterArgs,
    deferredRegion,
    deferredGu,
    deferredSortKey,
    deferredMoveIn,
    deferredTier,
    normalizedSearch,
    hideNoUnsold,
  ]);

  // filtered 가 새로 생성되면 페이지네이션을 첫 30개로 리셋 — 외부 상태(필터 결과) 동기화의 정당한 effect 사용
  useEffect(() => {
    setVisibleCount(VISIBLE_PAGE_SIZE);
  }, [filtered]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const scoredMap = useMemo(() => new Map<string, ScoredApt>(scored.map((x) => [x.apt.id ?? "", x])), [scored]);
  const compItems = useMemo<ScoredApt[]>(
    () => compIds.map((id) => scoredMap.get(id)).filter((x): x is ScoredApt => Boolean(x)),
    [compIds, scoredMap]
  );
  const pw = useMemo<ProfileWeights>(
    () => customWeights[profile] ?? (PROFILES as Record<string, { w: ProfileWeights }>)[profile].w,
    [profile, customWeights]
  );

  const activeFilterCount = useMemo(
    () =>
      [
        showFavOnly,
        filterRegion !== "전체",
        // 시군구도 별개 필터 — 지역만 세면 "서울 강남구"가 1개로 보인다 (세션524 배선 갭)
        filterGu !== "전체",
        budgetMin,
        budgetMax,
        areaMin,
        areaMax,
        unitsMin,
        unitsMax,
        moveInFilter !== "전체",
        minScore,
        builderTier !== "전체",
        benefitOnly,
        subwayOnly,
        schoolGoodOnly,
        dsrPassOnly,
        nonRegulatedOnly,
        crimeSafeOnly,
        childcareGoodOnly,
        parkingGoodOnly,
        hospitalNearOnly,
        parkNearOnly,
        searchQuery.trim(),
      ].filter(Boolean).length,
    [
      showFavOnly,
      filterRegion,
      filterGu,
      budgetMin,
      budgetMax,
      areaMin,
      areaMax,
      unitsMin,
      unitsMax,
      moveInFilter,
      minScore,
      builderTier,
      benefitOnly,
      subwayOnly,
      schoolGoodOnly,
      dsrPassOnly,
      nonRegulatedOnly,
      crimeSafeOnly,
      childcareGoodOnly,
      parkingGoodOnly,
      hospitalNearOnly,
      parkNearOnly,
      searchQuery,
    ]
  );

  const regionOptions = useMemo<string[]>(() => {
    const rs = new Set(apartments.map((a) => a.region).filter((r): r is string => Boolean(r)));
    const order = Object.keys(REGIONS);
    return ["전체", ...order.filter((r) => rs.has(r)), ...[...rs].filter((r) => !order.includes(r)).sort()];
  }, [apartments]);

  const filterOptionCounts = useMemo(() => {
    if (!scored.length) return null;
    let base = applyBaseFilters(scored, baseFilterArgs);
    // filtered(L140)과 동일하게 unsold(수) 기준 — 카운트 배지가 실제 필터 결과와 일치하도록 (세션 445).
    if (hideNoUnsold) base = base.filter((x) => Number(x.apt.unsold ?? 0) > 0);
    // 단일 패스 leave-one-out 카운트 (5N→1N 최적화)
    const regionCounts = Object.create(null);
    const guCounts = Object.create(null);
    const moveInCounts = Object.fromEntries(MOVEIN_VALUES.map((v) => [v, 0]));
    const tierCounts = Object.fromEntries(TIER_VALUES.map((v) => [v, 0]));
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
    guOptions,
    catsCache,
    scored,
    baseFilterArgs,
    filtered,
    visible,
    visibleCount,
    setVisibleCount,
    scoredMap,
    compItems,
    pw,
    activeFilterCount,
    regionOptions,
    filterOptionCounts,
    dataFreshnessText,
    isFilterPending,
    // 지도 region-fit 신호 (세션 417) — 원시 filterRegion/Gu 가 아니라 deferred 값.
    // 원시값은 한 박자 빨라 filtered 가 아직 옛 지역일 때 fit 이 엉뚱한 곳에 줌되는 stale 함정 회피.
    deferredRegion,
    deferredGu,
  };
}
