import { useRef, useEffect, useCallback } from "react";
import { fmtPrice } from "@/lib/format";

/**
 * 공유 콜백 3종 훅
 * handleShareDetail / handleShareCompare / handleShareFilters + scoredMapRef
 */
export function useShareCallbacks({
  scoredMap, profile, compIds, compItems, openShareSheet, getShareURL,
  filterRegion, budgetMin, budgetMax, areaMin, areaMax,
  unitsMin, unitsMax, moveInFilter, minScore, builderTier, benefitOnly,
}) {
  const scoredMapRef = useRef(scoredMap);
  useEffect(() => { scoredMapRef.current = scoredMap; }, [scoredMap]);

  const handleShareDetail = useCallback((aptId) => {
    const item = scoredMapRef.current.get(aptId);
    if (!item) return;
    const base = getShareURL();
    const sep = base.includes("?") ? "&" : "?";
    openShareSheet({
      title: `${item.apt.name} - 미분양 분석`,
      text: `${item.apt.name} ${item.res.total}점 · ${fmtPrice(item.apt.price)}`,
      url: `${base}${sep}detail=${aptId}&profile=${profile}`,
    });
  }, [profile, openShareSheet, getShareURL]);

  const handleShareCompare = useCallback(() => {
    if (compIds.length < 2) return;
    const base = getShareURL();
    const sep = base.includes("?") ? "&" : "?";
    openShareSheet({
      title: `미분양 ${compIds.length}개 단지 비교`,
      text: compItems.map(x => x.apt.name).join(" vs "),
      url: `${base}${sep}compare=${compIds.join(",")}&profile=${profile}`,
    });
  }, [compIds, compItems, profile, openShareSheet, getShareURL]);

  const handleShareFilters = useCallback(() => {
    const activeFilters = [
      filterRegion !== "전체" && filterRegion,
      budgetMin && `${budgetMin}~${budgetMax || "∞"}억`,
      (areaMin || areaMax) && `면적 ${areaMin || "0"}~${areaMax || "∞"}㎡`,
      (unitsMin || unitsMax) && `세대 ${unitsMin || "0"}~${unitsMax || "∞"}`,
      moveInFilter !== "전체" && moveInFilter,
      minScore && `${minScore}점+`,
      builderTier !== "전체" && builderTier,
      benefitOnly && "혜택",
    ].filter(Boolean).join(" · ");
    openShareSheet({
      title: "미분양 필터 공유",
      text: activeFilters || "전체 조건",
      url: getShareURL(),
    });
  }, [filterRegion, budgetMin, budgetMax, areaMin, areaMax, unitsMin, unitsMax, moveInFilter, minScore, builderTier, benefitOnly, openShareSheet, getShareURL]);

  return { handleShareDetail, handleShareCompare, handleShareFilters };
}
