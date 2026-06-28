import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { AptCard } from "@/components/AptCard";
import { WidgetCard } from "./WidgetCard";
import type { ScoredApt } from "@/types/hooks";
import type { ProfileWeights } from "@/types/scoring";

type RecentlyViewedWidgetProps = {
  recentIds: string[];
  /** id → ScoredApt 복원용 (useDataPipeline scoredMap, O(1)) */
  scoredMap: Map<string, ScoredApt>;
  pw: ProfileWeights;
  onDetail: (_id: string) => void;
  onFav: (_id: string) => void;
  favoriteSet: Set<string>;
  onComp: (_id: string) => void;
  compIds: string[];
  isLoggedIn: boolean;
  isDesktop: boolean;
  onClear: () => void;
};

/**
 * 최근 본 단지 — 최근순(맨 앞 = 가장 최근). onDetail 은 반드시 handleDetailGated(홈 상세 게이트 정책).
 * recentIds 중 데이터 갱신으로 사라진 단지(scoredMap 부재)는 스킵. rank=0 으로 순위 배지 숨김.
 */
export const RecentlyViewedWidget = memo(function RecentlyViewedWidget({
  recentIds,
  scoredMap,
  pw,
  onDetail,
  onFav,
  favoriteSet,
  onComp,
  compIds,
  isLoggedIn,
  isDesktop,
  onClear,
}: RecentlyViewedWidgetProps) {
  const items = useMemo(
    () => recentIds.map((id) => scoredMap.get(id)).filter((x): x is ScoredApt => Boolean(x)),
    [recentIds, scoredMap]
  );

  return (
    <WidgetCard title="👀 최근 본 단지">
      {items.length === 0 ? (
        <div style={{ fontSize: F.sm, color: C.muted, padding: "8px 0" }}>아직 본 단지가 없어요</div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={onClear}
              aria-label="최근 본 단지 지우기"
              style={{
                background: "transparent",
                border: "none",
                color: C.muted,
                fontSize: F.sm,
                fontWeight: 600,
                cursor: "pointer",
                padding: "4px 6px",
                minHeight: 36,
              }}
            >
              지우기
            </button>
          </div>
          <div
            style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4, WebkitOverflowScrolling: "touch" }}
          >
            {items.map((item) => (
              <div key={item.apt.id} style={{ flex: "0 0 auto", width: isDesktop ? 300 : 260 }}>
                <AptCard
                  apt={item.apt}
                  res={item.res}
                  rank={0}
                  onDetail={onDetail}
                  isComp={compIds.includes(item.apt.id ?? "")}
                  onComp={onComp}
                  isFav={favoriteSet.has(item.apt.id ?? "")}
                  onFav={onFav}
                  profileWeights={pw}
                  isDesktop={isDesktop}
                  isLoggedIn={isLoggedIn}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </WidgetCard>
  );
});
