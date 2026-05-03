import { memo, useEffect, useRef, useState, lazy, Suspense } from "react";
import { useRegionAverages } from "@/hooks/useRegionAverages";
import { geoSidoToDbName } from "@/constants/regionGeoMapping";
import { gr, C, F } from "@/theme";
import { geoJsonFeatureToKakaoPaths } from "@/lib/geoJsonToKakaoPaths";
import { SkeletonText } from "../primitives";
import { ChoroplethLegend } from "./ChoroplethLegend";
import type { ChoroplethViewProps } from "@/types/components/ChoroplethView.types";

const ChoroplethSigunguOverlay = lazy(() =>
  import("./ChoroplethSigunguOverlay").then(m => ({ default: m.ChoroplethSigunguOverlay }))
);

/**
 * ChoroplethView — 색칠 지도(시도 17개 폴리곤)
 *
 * Props:
 *   mapInstance: kakao.maps.Map | null — MapView 가 만든 지도 인스턴스 (ref.current)
 *   ready: boolean — SDK 로드 완료 여부
 *   filtered: Array<{apt, res}> — 필터링된 단지 (평균 점수 계산용)
 *   onSidoClick: (dbName) => void — 시도 폴리곤 클릭 시 호출 (MapView 가 모드 전환)
 *   isPC, isDesktop: boolean — 반응형
 *
 * - public/geo/sido.geojson 1회 fetch
 * - byRegion[dbName].avg → gr().c 색 매핑, 데이터 없으면 회색
 * - 폴리곤 클릭: 그 시도 영역으로 setBounds + onSidoClick(dbName)
 * - hover: fillOpacity 0.65 → 0.85
 */
export const ChoroplethView = memo(function ChoroplethView({
  mapInstance, ready, filtered, onSidoClick, isPC, isDesktop,
}: ChoroplethViewProps) {
  const polygonsRef = useRef<any[]>([]);
  const [geoData, setGeoData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(13);
  const showSigungu = level <= 8;
  // 줌 임계값 디바운스 미적용: level 8↔9 경계 진동은 사용자 의도적 1단계 줌 입출 시에만,
  // 폴리곤 그리기 1회씩이라 실 영향 미미. 향후 UX 잡음 보고 시 hysteresis 적용.
  const { byRegion } = useRegionAverages(filtered);

  // 0. 줌 이벤트 리스너 (level 동기화)
  useEffect(() => {
    if (!ready || !mapInstance) return;
    const kakao = (window as any).kakao?.maps;
    if (!kakao?.event) return;
    const handler = () => setLevel((mapInstance as any).getLevel());
    kakao.event.addListener(mapInstance, "zoom_changed", handler);
    const initialSyncId = typeof (mapInstance as any).getLevel === "function"
      ? window.setTimeout(handler, 0)
      : null;
    return () => {
      if (initialSyncId != null) window.clearTimeout(initialSyncId);
      // kakao SDK 의 event.removeListener 는 일부 버전 미지원. 옵셔널 호출 가드.
      // 미지원 시 zoom_changed 핸들러는 mapInstance(=페이지) 라이프사이클까지 살아있음.
      if (kakao.event?.removeListener) {
        kakao.event.removeListener(mapInstance, "zoom_changed", handler);
      }
    };
  }, [ready, mapInstance]);

  // 1. GeoJSON 1회 fetch
  useEffect(() => {
    let cancelled = false;
    fetch("/geo/sido.geojson")
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!cancelled) setGeoData(d); })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  // 2. 폴리곤 그리기 + cleanup
  useEffect(() => {
    if (!ready || !mapInstance || !geoData) return;
    const kakao = (window as any).kakao?.maps;
    if (!kakao?.Polygon) return;

    // 시군구 모드일 땐 시도 폴리곤 전부 cleanup 후 종료
    if (showSigungu) {
      polygonsRef.current.forEach(p => p.setMap(null));
      polygonsRef.current = [];
      return;
    }

    polygonsRef.current.forEach(p => p.setMap(null));
    polygonsRef.current = [];

    for (const feature of (geoData.features || [])) {
      const geoName = feature?.properties?.name;
      const dbName = geoSidoToDbName(geoName);
      if (!dbName) continue;
      const stat = byRegion[dbName];
      const avg = stat?.avg;
      const hasData = Number.isFinite(avg);
      const color = hasData ? gr(avg).c : C.muted;
      const baseOpacity = hasData ? 0.65 : 0.25;
      const paths = geoJsonFeatureToKakaoPaths(feature, kakao);

      for (const path of paths) {
        if (path.length === 0) continue;
        const polygon = new kakao.Polygon({
          path,
          strokeWeight: 1.5,
          strokeColor: C.white,
          strokeOpacity: 0.9,
          fillColor: color,
          fillOpacity: baseOpacity,
        });
        polygon.setMap(mapInstance);
        kakao.event.addListener(polygon, "click", () => {
          const bounds = new kakao.LatLngBounds();
          path.forEach((latlng: any) => bounds.extend(latlng));
          (mapInstance as any).setBounds(bounds);
          if (onSidoClick) onSidoClick(dbName);
        });
        kakao.event.addListener(polygon, "mouseover", () => polygon.setOptions({ fillOpacity: 0.85 }));
        kakao.event.addListener(polygon, "mouseout", () => polygon.setOptions({ fillOpacity: baseOpacity }));
        polygonsRef.current.push(polygon);
      }
    }

    return () => {
      polygonsRef.current.forEach(p => p.setMap(null));
      polygonsRef.current = [];
    };
  }, [ready, mapInstance, geoData, byRegion, onSidoClick, showSigungu]);

  if (error) return (
    <div
      role="alert"
      style={{ position: "absolute", top: 8, right: 8, background: C.redLight, color: C.red, padding: "6px 10px", borderRadius: 6, fontSize: F.xs, zIndex: 10, border: `1px solid ${C.redBorder}` }}
    >
      지도 데이터를 불러올 수 없습니다
    </div>
  );

  if (!geoData) return (
    <div style={{ position: "absolute", top: 8, right: 8, zIndex: 10, width: 160, background: "rgba(255,255,255,0.92)", padding: "6px 8px", borderRadius: 6 }}>
      <SkeletonText lines={1} width="100%" />
    </div>
  );

  return (
    <>
      <ChoroplethLegend isPC={isPC} isDesktop={isDesktop} />
      {showSigungu && (
        <Suspense fallback={null}>
          <ChoroplethSigunguOverlay
            mapInstance={mapInstance}
            ready={ready}
            filtered={filtered}
            onGuClick={onSidoClick}
          />
        </Suspense>
      )}
    </>
  );
});
