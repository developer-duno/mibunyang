import { memo, useEffect, useRef, useState } from "react";
import { useRegionAverages } from "@/hooks/useRegionAverages";
import { geoSidoToDbName } from "@/constants/regionGeoMapping";
import { gr, C, F } from "@/theme";
import { geoJsonFeatureToKakaoPaths } from "@/lib/geoJsonToKakaoPaths";
import { SkeletonText } from "../primitives";
import { ChoroplethLegend } from "./ChoroplethLegend";

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
}) {
  const polygonsRef = useRef([]);
  const [geoData, setGeoData] = useState(null);
  const [error, setError] = useState(null);
  const { byRegion } = useRegionAverages(filtered);

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
    const kakao = window.kakao?.maps;
    if (!kakao?.Polygon) return;

    polygonsRef.current.forEach(p => p.setMap(null));
    polygonsRef.current = [];

    for (const feature of geoData.features) {
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
          path.forEach(latlng => bounds.extend(latlng));
          mapInstance.setBounds(bounds);
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
  }, [ready, mapInstance, geoData, byRegion, onSidoClick]);

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

  return <ChoroplethLegend isPC={isPC} isDesktop={isDesktop} />;
});
