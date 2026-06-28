import { memo, useCallback } from "react";
import { isFeatureUpcoming } from "@/constants/featureFlags";
import { trackEvent } from "@/lib/analytics";
import { SkeletonList } from "@/components/primitives";
import { MapEntryWidget } from "./MapEntryWidget";
import { UpcomingWidget } from "./UpcomingWidget";
import { TopPicksWidget } from "./TopPicksWidget";
import { RecentlyViewedWidget } from "./RecentlyViewedWidget";
import { MarketSummaryWidget } from "./MarketSummaryWidget";
import type { ScoredApt, SortKey } from "@/types/hooks";
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
  /** 시장 요약 칸 클릭 — 탭 이동 + (옵션) 정렬 적용. App 의 setSortKey + handleNavClick 배선 */
  onMarketNav: (_target: string, _sort?: SortKey) => void;
  onDetail: (_id: string) => void;
  onFav: (_id: string) => void;
  favoriteSet: Set<string>;
  onComp: (_id: string) => void;
  compIds: string[];
  /** 최근 본 단지 — id 배열(최근순) + id→ScoredApt 복원 Map + 지우기 */
  recentIds: string[];
  scoredMap: Map<string, ScoredApt>;
  onClearRecent: () => void;
};

/**
 * 통합 홈 (D1 C안 위젯판) — spec §1·§2. 위젯 단위 독립.
 * 펼치기는 전부 onNavClick(handleNavClick) 경유. 전문가 위젯 2종은 M2.
 */
export const HomePage = memo(function HomePage({
  scored,
  filtered,
  pw,
  upcomingData,
  upcomingError,
  onRetryUpcoming,
  isLoggedIn,
  isDesktop,
  isPC,
  dataLoading,
  dataFreshnessText,
  onNavClick,
  onMarketNav,
  onDetail,
  onFav,
  favoriteSet,
  onComp,
  compIds,
  recentIds,
  scoredMap,
  onClearRecent,
}: HomePageProps) {
  const upcomingEnabled = isFeatureUpcoming();
  const pad = isDesktop ? "0 24px" : "0 16px"; // App.tsx L301·L324 list/map 탭 패딩과 통일
  // 최근 본 단지: 데이터에 살아있는 단지가 1개+ 일 때만 위젯 노출 (빈 위젯 자리 차지 방지)
  const hasRecent = recentIds.some((id) => scoredMap.has(id));

  // 홈 위젯 계측 (M3) — 펼치기는 어느 위젯인지, 상세 진입은 홈 출처 표시. 기존 trackEvent 명명 규칙 답습.
  const expandWidget = useCallback(
    (widget: string, target: string) => {
      trackEvent("home_widget_expand", { widget });
      onNavClick(target);
    },
    [onNavClick]
  );
  const handleDetail = useCallback(
    (id: string) => {
      trackEvent("home_detail_open", {});
      onDetail(id);
    },
    [onDetail]
  );
  // 시장 요약 칸 클릭 — 어느 칸인지 계측 + 탭 이동(+정렬). expandWidget 명명 답습.
  const handleMarketNav = useCallback(
    (cell: string, nav: { target: string; sort?: SortKey }) => {
      trackEvent("home_market_nav", { cell });
      onMarketNav(nav.target, nav.sort);
    },
    [onMarketNav]
  );

  if (dataLoading && scored.length === 0) {
    return (
      <div style={{ padding: pad }}>
        <SkeletonList count={4} columns={1} />
      </div>
    );
  }

  return (
    <div style={{ padding: pad }}>
      <div
        data-testid="home-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))",
          gap: 12,
          alignItems: "start",
        }}
      >
        <MapEntryWidget
          isLoggedIn={isLoggedIn}
          onExpand={() => expandWidget("map", "map")}
          filtered={filtered}
          onDetail={handleDetail}
        />
        {upcomingEnabled && (
          <UpcomingWidget
            data={upcomingData}
            error={upcomingError}
            onRetry={onRetryUpcoming}
            onExpand={() => expandWidget("upcoming", "upcoming")}
          />
        )}
        <MarketSummaryWidget scored={scored} dataFreshnessText={dataFreshnessText} onCellNav={handleMarketNav} />
        {hasRecent && (
          <div style={{ gridColumn: "1 / -1" }}>
            <RecentlyViewedWidget
              recentIds={recentIds}
              scoredMap={scoredMap}
              pw={pw}
              onDetail={handleDetail}
              onFav={onFav}
              favoriteSet={favoriteSet}
              onComp={onComp}
              compIds={compIds}
              isLoggedIn={isLoggedIn}
              isDesktop={isDesktop}
              onClear={onClearRecent}
            />
          </div>
        )}
        <div style={{ gridColumn: "1 / -1" }}>
          <TopPicksWidget
            scored={scored}
            pw={pw}
            onDetail={handleDetail}
            onFav={onFav}
            favoriteSet={favoriteSet}
            onComp={onComp}
            compIds={compIds}
            isLoggedIn={isLoggedIn}
            isDesktop={isDesktop}
            isPC={isPC}
            onExpand={() => expandWidget("toppicks", "list")}
          />
        </div>
      </div>
    </div>
  );
});
