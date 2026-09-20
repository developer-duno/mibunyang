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
 * - 시도보다 옅게 (가독성). 진하기 3단계 — 표본 충분 0.55 / 표본 부족 0.25 / 데이터 없음 0.2
 *   (시도는 같은 순서로 0.65 / 0.3 / 0.25. 표본 문턱 = useRegionAverages 의 MIN_MAP_SAMPLE)
 * - hover = min(기본 + 0.25, 0.8) — 기본값에 비례해 올린다. 고정값이면 흐린 칸이
 *   마우스만 올려도 진해져 표본 가드가 무력해진다(표본 충분 0.55→0.8 / 부족 0.25→0.5)
 * - click → setBounds + onGuClick(byGuKey) → 점 보기 복귀
 */
/**
 * 시군구 GeoJSON 파싱 결과 — 모듈 수준 캐시(언마운트와 무관하게 살아남는다).
 * 351KB 라 시도(143KB)보다 파싱이 무겁고, 이 오버레이는 줌 임계를 오갈 때마다
 * 마운트/언마운트되므로 캐시 효과가 가장 크다(세션553).
 */
let sigunguGeoCache: any = null;

/** 캐시 비우기 — **테스트 격리 전용**(운영 코드는 부르지 않는다). ChoroplethView 쪽과 같은 이유. */
export function __resetSigunguGeoCacheForTest(): void {
  sigunguGeoCache = null;
}

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

  // 1. sigungu.geojson fetch — 모듈 캐시 우선
  //
  // 옛 주석은 "브라우저 캐시로 2회째 0ms" 라 했지만, 0ms 인 것은 **네트워크뿐**이고
  // 351KB JSON 파싱은 마운트할 때마다 되풀이됐다. 이 오버레이는 줌 임계(level ≤ 8)를
  // 오갈 때도 마운트/언마운트되므로 줌 한 번에 파싱이 다시 도는 셈이었다(세션553).
  // 파싱 결과를 모듈에 두면 두 번째부터 네트워크·파싱이 모두 0 이다.
  useEffect(() => {
    if (sigunguGeoCache) {
      setGeoData(sigunguGeoCache);
      return;
    }
    let cancelled = false;
    fetch("/geo/sigungu.geojson")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        sigunguGeoCache = d;
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
      // 표본이 적은 칸 — 시군구 193칸 중 47칸이 단지 3곳 미만이고 예산 필터를 걸면 더 오른다.
      // ⚠️ 불확실성은 **테두리 점선**으로 말한다(ChoroplethView 와 같은 잣대, 사장님 결정).
      // 흐리게 칠하던 옛 방식은 적대검증 실측에서 두 가지로 무너졌다:
      //   ① 뒤집힘 — 좋은데 표본 적은 칸이 나쁜데 표본 많은 칸보다 흐려 "나쁜 곳"으로 읽힘
      //   ② 시군구에서는 표본 부족(밝기 0.826~0.880)과 데이터 없음 회색(0.889)이 거의 같아
      //      둘을 눈으로 못 가름 — "색상이 달라 구분된다"던 옛 주석은 실측 없이 쓴 말이었다.
      const thin = hasData && !stat.enough;
      const color = hasData ? gr(avg).c : C.muted;
      const baseOpacity = hasData ? 0.55 : 0.2;
      const paths = geoJsonFeatureToKakaoPaths(feature, kakao);

      for (const path of paths) {
        if (path.length === 0) continue;
        const polygon = new kakao.Polygon({
          path,
          // 시군구는 칸이 작아 시도(3)보다 얇게 — 그래도 기본(1)의 2.5배라 눈에 띈다.
          strokeWeight: thin ? 2.5 : 1,
          strokeColor: thin ? C.muted : C.white,
          strokeOpacity: thin ? 0.95 : 0.85,
          ...(thin ? { strokeStyle: "dashed" } : {}),
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
