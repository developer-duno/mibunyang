import { memo, useState, useRef, useEffect, lazy, Suspense } from "react";
import { C, F } from "@/theme";
import { WidgetCard } from "./WidgetCard";
import type { ScoredApt } from "@/types/hooks";

// App.tsx 와 동일 모듈 경로 dynamic import → 동일 async chunk 공유 (메인 번들 무영향).
// ⚠️ MapView.tsx 의 값 정적 import 금지 — 1건이라도 생기면 chunk 인라인되어 분리 무효 (plan 함정 박제).
const MapView = lazy(() => import("@/components/sections/MapView").then(m => ({ default: m.MapView })));

// 스켈레톤·Suspense fallback·지도 전부 동일 높이 = CLS 0.
// spec 하한 ~260px + SelectedAptCard ~64px 점유 고려 → 280px.
const MAP_HEIGHT = "280px";

type MapEntryWidgetProps = {
  isLoggedIn: boolean;
  onExpand: () => void;
  filtered: ScoredApt[];
  onDetail: (_id: string) => void;
};

/** 진입 전 + Suspense fallback 공용 스켈레톤 (AptListSection skeleton-pulse 답습) */
function MapSkeleton() {
  return (
    <>
      <style>{`@keyframes skeleton-pulse { 0%{opacity:1} 50%{opacity:0.4} 100%{opacity:1} }`}</style>
      <div aria-label="지도 불러오는 중" style={{ height: MAP_HEIGHT, background: C.slate100, borderRadius: 10, border: `1px solid ${C.border}`, animation: "skeleton-pulse 1.5s ease-in-out infinite" }} />
    </>
  );
}

/**
 * 홈 지도 위젯 (M2) — 비로그인 = D5 잠금 placeholder / 로그인 = MapView 미니지도 임베드
 * (compact + height, 뷰포트 진입 시 lazy 마운트 — LoadMoreSentinel 패턴 답습).
 * 핀 클릭 → SelectedAptCard(지도 내부) → "상세" = onDetail(handleDetailGated) 경유.
 * onExpand 는 반드시 handleNavClick("map") — 비로그인 게이트(useAppNavigation L68)가 자동 발화.
 */
export const MapEntryWidget = memo(function MapEntryWidget({ isLoggedIn, onExpand, filtered, onDetail }: MapEntryWidgetProps) {
  const [mapVisible, setMapVisible] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // 뷰포트 진입 시 1회만 지도 마운트 (이후 disconnect — 스크롤 이탈해도 유지)
  useEffect(() => {
    if (!isLoggedIn || mapVisible) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setMapVisible(true);
        obs.disconnect();
      }
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [isLoggedIn, mapVisible]);

  return (
    <WidgetCard title="🗺 지도" onExpand={isLoggedIn ? onExpand : undefined} expandLabel="크게 보기">
      {isLoggedIn ? (
        <div ref={sentinelRef} data-testid="map-widget">
          {mapVisible ? (
            <Suspense fallback={<MapSkeleton />}>
              <MapView filtered={filtered} onDetail={onDetail} compact height={MAP_HEIGHT} />
            </Suspense>
          ) : (
            <MapSkeleton />
          )}
        </div>
      ) : (
        <button onClick={onExpand} aria-label="로그인하고 지도 열기" style={{ width: "100%", background: C.slate100, border: `1px dashed ${C.border}`, borderRadius: 8, padding: "24px 12px", cursor: "pointer", textAlign: "center", minHeight: 44 }}>
          <div style={{ fontSize: 28, marginBottom: 6 }} aria-hidden="true">🔒</div>
          <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 4 }}>로그인하면 지도가 열려요</div>
          <div style={{ fontSize: F.xs, color: C.muted }}>카카오 로그인 후 점수 지도를 이용할 수 있어요</div>
        </button>
      )}
    </WidgetCard>
  );
});
