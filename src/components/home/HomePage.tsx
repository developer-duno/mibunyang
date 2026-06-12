import { memo } from "react";
import { isFeatureUpcoming } from "@/constants/featureFlags";
import { SkeletonList } from "@/components/primitives";
import { MapEntryWidget } from "./MapEntryWidget";
import { UpcomingWidget } from "./UpcomingWidget";
import { TopPicksWidget } from "./TopPicksWidget";
import { MarketSummaryWidget } from "./MarketSummaryWidget";
import type { ScoredApt } from "@/types/hooks";
import type { ProfileWeights } from "@/types/scoring";
import type { UpcomingApiResponse } from "@/types/upcoming";

type HomePageProps = {
  scored: ScoredApt[];
  /** 미니지도 입력 — 지도 탭과 동일(필터 적용분) = "크게 보기" 핀 연속성. 잔존 필터·hideNoUnsold 무표시 적용은 수용 (plan 406) */
  filtered: ScoredApt[];
  pw: ProfileWeights;
  upcomingData: UpcomingApiResponse | null;
  upcomingError: boolean;
  onRetryUpcoming: () => void;
  isLoggedIn: boolean;
  isDesktop: boolean;
  isPC: boolean;
  dataLoading: boolean;
  dataFreshnessText: string | null;
  onNavClick: (_k: string) => void;
  onDetail: (_id: string) => void;
  onFav: (_id: string) => void;
  favoriteSet: Set<string>;
  onComp: (_id: string) => void;
  compIds: string[];
};

/**
 * 통합 홈 (D1 C안 위젯판) — spec §1·§2. 위젯 단위 독립.
 * 펼치기는 전부 onNavClick(handleNavClick) 경유. 전문가 위젯 2종은 M2.
 */
export const HomePage = memo(function HomePage({ scored, filtered, pw, upcomingData, upcomingError, onRetryUpcoming, isLoggedIn, isDesktop, isPC, dataLoading, dataFreshnessText, onNavClick, onDetail, onFav, favoriteSet, onComp, compIds }: HomePageProps) {
  const upcomingEnabled = isFeatureUpcoming();
  const pad = isDesktop ? "0 24px" : "0 16px"; // App.tsx L301·L324 list/map 탭 패딩과 통일

  if (dataLoading && scored.length === 0) {
    return (
      <div style={{ padding: pad }}>
        <SkeletonList count={4} columns={1} />
      </div>
    );
  }

  return (
    <div style={{ padding: pad }}>
      <div data-testid="home-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12, alignItems: "start" }}>
        <MapEntryWidget isLoggedIn={isLoggedIn} onExpand={() => onNavClick("map")} filtered={filtered} onDetail={onDetail} />
        {upcomingEnabled && (
          <UpcomingWidget data={upcomingData} error={upcomingError} onRetry={onRetryUpcoming} onExpand={() => onNavClick("upcoming")} />
        )}
        <MarketSummaryWidget scored={scored} dataFreshnessText={dataFreshnessText} />
        <div style={{ gridColumn: "1 / -1" }}>
          <TopPicksWidget scored={scored} pw={pw} onDetail={onDetail} onFav={onFav} favoriteSet={favoriteSet} onComp={onComp} compIds={compIds} isLoggedIn={isLoggedIn} isDesktop={isDesktop} isPC={isPC} onExpand={() => onNavClick("list")} />
        </div>
      </div>
    </div>
  );
});
