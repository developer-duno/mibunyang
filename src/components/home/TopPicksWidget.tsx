import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { AptCard } from "@/components/AptCard";
import { WidgetCard } from "./WidgetCard";
import type { ScoredApt } from "@/types/hooks";
import type { ProfileWeights } from "@/types/scoring";

type TopPicksWidgetProps = {
  scored: ScoredApt[];
  pw: ProfileWeights;
  onDetail: (_id: string) => void;
  onFav: (_id: string) => void;
  favoriteSet: Set<string>;
  onComp: (_id: string) => void;
  compIds: string[];
  isLoggedIn: boolean;
  isDesktop: boolean;
  isPC: boolean;
  onExpand: () => void;
};

/** 추천 TOP 3 — 현재 프로필 점수 상위 3. onDetail 은 반드시 handleDetailGated (홈 상세 게이트 정책) */
export const TopPicksWidget = memo(function TopPicksWidget({
  scored,
  pw,
  onDetail,
  onFav,
  favoriteSet,
  onComp,
  compIds,
  isLoggedIn,
  isDesktop,
  isPC,
  onExpand,
}: TopPicksWidgetProps) {
  const top3 = useMemo(() => [...scored].sort((a, b) => b.res.total - a.res.total).slice(0, 3), [scored]);
  return (
    <WidgetCard title="⭐ 추천 TOP 3" onExpand={onExpand} expandLabel="전체 목록">
      {top3.length === 0 ? (
        <div style={{ fontSize: F.sm, color: C.muted, padding: "8px 0" }}>표시할 단지가 없습니다</div>
      ) : (
        <div
          style={
            isDesktop
              ? { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }
              : isPC
                ? { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0 16px" }
                : undefined
          }
        >
          {top3.map((item, idx) => (
            <AptCard
              key={item.apt.id}
              apt={item.apt}
              res={item.res}
              rank={idx + 1}
              onDetail={onDetail}
              isComp={compIds.includes(item.apt.id ?? "")}
              onComp={onComp}
              isFav={favoriteSet.has(item.apt.id ?? "")}
              onFav={onFav}
              profileWeights={pw}
              isDesktop={isDesktop}
              isLoggedIn={isLoggedIn}
            />
          ))}
        </div>
      )}
    </WidgetCard>
  );
});
