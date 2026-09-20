import { memo, useEffect, useRef, useState } from "react";
import { gr, C, F } from "@/theme";
import { useRegionAverages } from "@/hooks/useRegionAverages";
import { geoJsonFeatureToKakaoPaths } from "@/lib/geoJsonToKakaoPaths";
import { geoSigunguToByGuKey } from "@/lib/geoJsonGuToDbKey";
import { getKakaoMaps } from "./kakaoMapHelpers";
import type { Apt } from "@/types/scoring";
import type { ScoringResult } from "@/types/components";

type ChoroplethSigunguOverlayProps = {
  mapInstance: unknown;
  ready: boolean;
  filtered: Array<{ apt: Apt; res: ScoringResult }>;
  onGuClick?: (_key: string) => void;
};

/**
 * ChoroplethSigunguOverlay — 색칠 지도 시군구 251 폴리곤 오버레이
 *
 * Props:
 *   mapInstance: kakao.maps.Map | null
 *   ready: boolean
 *   filtered: Array<{apt, res}>
 *   onGuClick: (byGuKey) => void  — 시군구 클릭 시 호출 (MapView 가 모드 전환)
 *
 * - public/geo/sigungu.geojson 1회 fetch (이 컴포넌트 마운트 = 줌 ≥9 시점)
 * - byGu[`${region}|${gu}`].avg → gr().c 색 매핑, 데이터 없으면 회색 0.2
 * - 일반시 12개(고양·부천·성남·수원·안산·안양·용인·전주·창원·천안·청주·포항) 구 합산
 * - 시도보다 옅게 (시도 0.65/0.25 → 시군구 0.55/0.2) 가독성
 * - hover 0.55→0.8, click → setBounds + onGuClick(byGuKey) → 점 보기 복귀
 */
export const ChoroplethSigunguOverlay = memo(function ChoroplethSigunguOverlay({
  mapInstance,
  ready,
  filtered,
  onGuClick,
}: ChoroplethSigunguOverlayProps) {
  const polygonsRef = useRef<any[]>([]);
  const [geoData, setGeoData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const { byGu } = useRegionAverages(filtered);

  // 1. sigungu.geojson 1회 fetch (브라우저 캐시로 2회째 0ms)
  useEffect(() => {
    let cancelled = false;
    fetch("/geo/sigungu.geojson")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (!cancelled) setGeoData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. 폴리곤 그리기 + cleanup
  useEffect(() => {
    if (!ready || !mapInstance || !geoData) return;
    const kakao = getKakaoMaps();
    if (!kakao?.Polygon) return;

    polygonsRef.current.forEach((p) => p.setMap(null));
    polygonsRef.current = [];

    for (const feature of geoData.features || []) {
      const key = geoSigunguToByGuKey(feature);
      if (!key) continue;
      const stat = byGu[key];
      const avg = stat?.avg;
      const hasData = Number.isFinite(avg);
      // 표본이 적은 칸은 흐리게 — 시군구 193칸 중 47칸이 단지 3곳 미만이고,
      // 예산 필터를 걸면 그 비율이 더 오른다(ChoroplethView 와 같은 잣대).
      const thin = hasData && !stat.enough;
      const color = hasData ? gr(avg).c : C.muted;
      const baseOpacity = !hasData ? 0.2 : thin ? 0.25 : 0.55;
      const paths = geoJsonFeatureToKakaoPaths(feature, kakao);

      for (const path of paths) {
        if (path.length === 0) continue;
        const polygon = new kakao.Polygon({
          path,
          strokeWeight: 1,
          strokeColor: C.white,
          strokeOpacity: 0.85,
          fillColor: color,
          fillOpacity: baseOpacity,
        });
        polygon.setMap(mapInstance);
        kakao.event.addListener(polygon, "click", () => {
          const bounds = new kakao.LatLngBounds();
          path.forEach((latlng: any) => bounds.extend(latlng));
          (mapInstance as any).setBounds(bounds);
          if (onGuClick) onGuClick(key);
        });
        // hover 도 baseOpacity 기준으로 올린다 — 고정값이면 흐린 칸이 마우스만 올려도
        // 진해져서 표본 가드가 무력해진다.
        const hoverOpacity = Math.min(baseOpacity + 0.25, 0.8);
        kakao.event.addListener(polygon, "mouseover", () => polygon.setOptions({ fillOpacity: hoverOpacity }));
        kakao.event.addListener(polygon, "mouseout", () => polygon.setOptions({ fillOpacity: baseOpacity }));
        polygonsRef.current.push(polygon);
      }
    }

    return () => {
      polygonsRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current = [];
    };
  }, [ready, mapInstance, geoData, byGu, onGuClick]);

  if (error)
    return (
      <div
        role="alert"
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          background: C.redLight,
          color: C.red,
          padding: "6px 10px",
          borderRadius: 6,
          fontSize: F.xs,
          zIndex: 10,
          border: `1px solid ${C.redBorder}`,
        }}
      >
        시군구 데이터를 불러올 수 없습니다
      </div>
    );

  // 시도 ChoroplethView 가 범례·Skeleton 담당, 시군구 오버레이는 폴리곤만
  return null;
});
