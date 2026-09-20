import { memo, useCallback } from "react";
import { isFeatureUpcoming } from "@/constants/featureFlags";
import { trackEvent } from "@/lib/analytics";
import { SkeletonList } from "@/components/primitives";
import { MapEntryWidget } from "./MapEntryWidget";
import { UpcomingWidget } from "./UpcomingWidget";
import { TopPicksWidget } from "./TopPicksWidget";
import { RecentlyViewedWidget } from "./RecentlyViewedWidget";
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
  /** 현황판 가격대 클릭 — 예산 필터(억 단위)를 걸고 목록으로. App 의 setBudget* + handleNavClick 배선 */
  onBudgetNav: (_minEok: number | null, _maxEok: number | null) => void;
  /** 현황판 지역 막대 클릭 — 지역 필터를 걸고 목록으로. App 의 handleRegionChange + handleNavClick 배선 */
  onRegionNav: (_region: string) => void;
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
  onBudgetNav,
  onRegionNav,
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
  // 현황판 클릭 — 어느 칸인지 계측 + 필터 적용 후 목록으로. expandWidget 명명 답습.
  const handleBudgetNav = useCallback(
    (label: string, nav: { minEok: number | null; maxEok: number | null }) => {
      trackEvent("home_market_nav", { cell: label });
      onBudgetNav(nav.minEok, nav.maxEok);
    },
    [onBudgetNav]
  );
  const handleRegionNav = useCallback(
    (region: string) => {
      trackEvent("home_market_nav", { cell: "region:" + region });
      onRegionNav(region);
    },
    [onRegionNav]
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
        <MarketSummaryWidget
          scored={scored}
          dataFreshnessText={dataFreshnessText}
          onBudgetNav={handleBudgetNav}
          onRegionNav={handleRegionNav}
        />
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
