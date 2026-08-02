import { useMemo } from "react";
import type { Apt } from "@/types/scoring";
import { computeRegionalStats, type RegionalStats } from "@/scoring/regionalStats";

/**
 * 편차 막대가 쓸 지역 분포를 **상시** 계산한다.
 *
 * 왜 별도 훅인가 — 기존 `computeRegionalMedians` 는 `useDataPipeline.ts:174` 에서
 * `needsFallback`(= `catsCache` 가 없는 단지가 하나라도 있을 때)일 때만 불린다.
 * 운영에서는 `catsCache` 가 전부 채워져 있어 **거의 안 불린다**. 그 게이트에 편차
 * 막대를 얹으면 "운영에서는 막대가 안 보이는데 로컬에서는 보이는" 사고가 난다.
 *
 * 반환은 `useMemo` 로 참조가 안정적이다 — `AptCard` 의 memo comparator 가
 * 이 참조를 그대로 비교하므로(`prev.regionStats !== next.regionStats`),
 * 매 렌더 새 객체를 만들면 카드 30장이 통째로 다시 그려진다.
 */
export function useRegionalStats(apartments: readonly Apt[] | null | undefined): RegionalStats | null {
  return useMemo(() => {
    if (!apartments || apartments.length === 0) return null;
    return computeRegionalStats(apartments);
  }, [apartments]);
}
