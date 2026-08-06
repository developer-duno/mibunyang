import { useRef, useEffect, useCallback } from "react";
import { fmtPrice } from "@/lib/format";
import type { ScoredApt } from "@/types/hooks";

interface ShareSheetData {
  title: string;
  text: string;
  url: string;
}

interface UseShareCallbacksArgs {
  scoredMap: Map<string, ScoredApt>;
  profile: string;
  compIds: string[];
  compItems: ScoredApt[];
  openShareSheet: (_data: ShareSheetData) => void;
  getShareURL: () => string;
  filterRegion: string;
  budgetMin: string | number | null | "";
  budgetMax: string | number | null | "";
  areaMin: string | number | null | "";
  areaMax: string | number | null | "";
  unitsMin: string | number | null | "";
  unitsMax: string | number | null | "";
  moveInFilter: string;
  minScore: string | number | null | "";
  builderTier: string;
  benefitOnly: boolean;
  /**
   * 로그인 여부 — false 면 단지 공유 문구에서 **점수를 뺀다** (세션 495).
   *
   * 상세 모달이 비로그인에게 점수를 가려도(단계 2-A) 공유 CTA 는 그대로 살아 있어서,
   * 여기서 안 자르면 카카오 피드 description·SMS 본문으로 가린 숫자가 그대로 새 나간다.
   * 카카오/SMS/복사 세 경로가 전부 이 `text` 를 읽으므로 문구 생성 지점 한 곳만 막으면 된다.
   *
   * **선택값이 아니라 필수값**인 게 이 가드의 절반이다 — 배선이 빠지면 typecheck 가 잡는다.
   */
  isLoggedIn: boolean;
}

interface UseShareCallbacksReturn {
  handleShareDetail: (_aptId: string) => void;
  handleShareCompare: () => void;
  handleShareFilters: () => void;
}

/**
 * 공유 콜백 3종 훅
 * handleShareDetail / handleShareCompare / handleShareFilters + scoredMapRef
 */
export function useShareCallbacks({
  scoredMap,
  profile,
  compIds,
  compItems,
  openShareSheet,
  getShareURL,
  filterRegion,
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
  isLoggedIn,
}: UseShareCallbacksArgs): UseShareCallbacksReturn {
  const scoredMapRef = useRef(scoredMap);
  useEffect(() => {
    scoredMapRef.current = scoredMap;
  }, [scoredMap]);

  const handleShareDetail = useCallback(
    (aptId: string) => {
      const item = scoredMapRef.current.get(aptId);
      if (!item) return;
      const base = getShareURL();
      const sep = base.includes("?") ? "&" : "?";
      openShareSheet({
        title: `${item.apt.name} - 미분양 분석`,
        // 비로그인은 점수를 뺀 "단지명 · 가격" — 가린 점수가 공유 경로로 새는 것을 여기서 막는다.
        text: isLoggedIn
          ? `${item.apt.name} ${item.res.total}점 · ${fmtPrice(item.apt.price)}`
          : `${item.apt.name} · ${fmtPrice(item.apt.price)}`,
        url: `${base}${sep}detail=${aptId}&profile=${profile}`,
      });
    },
    [profile, openShareSheet, getShareURL, isLoggedIn]
  );

  const handleShareCompare = useCallback(() => {
    if (compIds.length < 2) return;
    const base = getShareURL();
    const sep = base.includes("?") ? "&" : "?";
    openShareSheet({
      title: `미분양 ${compIds.length}개 단지 비교`,
      text: compItems.map((x) => x.apt.name).join(" vs "),
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
    ]
      .filter(Boolean)
      .join(" · ");
    openShareSheet({
      title: "미분양 필터 공유",
      text: activeFilters || "전체 조건",
      url: getShareURL(),
    });
  }, [
    filterRegion,
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
    openShareSheet,
    getShareURL,
  ]);

  return { handleShareDetail, handleShareCompare, handleShareFilters };
}
