import { memo, useEffect, useRef, useState, Suspense } from "react";
import { useRegionAverages } from "@/hooks/useRegionAverages";
import { geoSidoToDbName } from "@/constants/regionGeoMapping";
import { gr, C, F } from "@/theme";
import { geoJsonFeatureToKakaoPaths } from "@/lib/geoJsonToKakaoPaths";
import { SkeletonText } from "../primitives";
import { ChoroplethLegend } from "./ChoroplethLegend";
import { getKakaoMaps } from "./kakaoMapHelpers";
import { lazyNamed } from "@/utils/lazyNamed";
import type { ChoroplethViewProps } from "@/types/components/ChoroplethView.types";

const ChoroplethSigunguOverlay = lazyNamed(() => import("./ChoroplethSigunguOverlay"), "ChoroplethSigunguOverlay");

/**
 * 시도 GeoJSON 파싱 결과 — 모듈 수준 캐시(컴포넌트 언마운트와 무관하게 살아남는다).
 * 이 컴포넌트는 색칠 모드에서만 렌더되므로 점↔색칠을 오갈 때마다 마운트/언마운트가
 * 반복되는데, 그때마다 143KB 를 다시 받아 파싱하던 것을 없앤다(세션553).
 */
let sidoGeoCache: any = null;

/**
 * 캐시 비우기 — **테스트 격리 전용**이다.
 * 모듈 캐시는 파일 하나를 모든 테스트가 공유하므로, 비우지 않으면 앞 테스트가 채운 값 때문에
 * "fetch 실패 → 에러 표시" 같은 테스트가 통과해 버린다(가드가 껍데기가 된다). 운영 코드는
 * 이 함수를 부르지 않는다 — 행정구역 경계는 세션 중에 바뀌지 않기 때문이다.
 */
export function __resetSidoGeoCacheForTest(): void {
  sidoGeoCache = null;
}

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
 * - 진하기 3단계 — 표본 충분 0.65 / 표본 부족 0.3 / 데이터 없음 0.25(회색).
 *   표본 부족도 **점수 색은 그대로** 두고 진하기만 낮춘다(회색은 "못 쟀다"는 별개 뜻).
 *   문턱 = useRegionAverages 의 MIN_MAP_SAMPLE, 범례가 그 뜻을 손님에게 말해 준다.
 * - 폴리곤 클릭: 그 시도 영역으로 setBounds + onSidoClick(dbName)
 * - hover = min(기본 + 0.2, 0.85) — 기본값에 비례(충분 0.65→0.85 / 부족 0.3→0.5).
 *   고정값이면 흐린 칸이 마우스만 올려도 진해져 표본 가드가 무력해진다.
 */
export const ChoroplethView = memo(function ChoroplethView({
  mapInstance,
  ready,
  filtered,
  onSidoClick,
  isPC,
  isDesktop,
}: ChoroplethViewProps) {
  const polygonsRef = useRef<any[]>([]);
  const [geoData, setGeoData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [level, setLevel] = useState(13);
  const showSigungu = level <= 8;
  // 줌 임계값 디바운스 미적용: level 8↔9 경계 진동은 사용자 의도적 1단계 줌 입출 시에만,
  // 폴리곤 그리기 1회씩이라 실 영향 미미. 향후 UX 잡음 보고 시 hysteresis 적용.
  const { byRegion } = useRegionAverages(filtered);

  // 0. 줌 이벤트 리스너 (level 동기화)
  useEffect(() => {
    if (!ready || !mapInstance) return;
    const kakao = getKakaoMaps();
    if (!kakao?.event) return;
    const handler = () => setLevel((mapInstance as any).getLevel());
    kakao.event.addListener(mapInstance, "zoom_changed", handler);
    const initialSyncId = typeof (mapInstance as any).getLevel === "function" ? window.setTimeout(handler, 0) : null;
    return () => {
      if (initialSyncId != null) window.clearTimeout(initialSyncId);
      // kakao SDK 의 event.removeListener 는 일부 버전 미지원. 옵셔널 호출 가드.
      // 미지원 시 zoom_changed 핸들러는 mapInstance(=페이지) 라이프사이클까지 살아있음.
      if (kakao.event?.removeListener) {
        kakao.event.removeListener(mapInstance, "zoom_changed", handler);
      }
    };
  }, [ready, mapInstance]);

  // 1. GeoJSON fetch — retryKey 증가 시 재시도
  //
  // ⚠️ 이 컴포넌트는 `mode === "choropleth"` 일 때만 렌더되므로 점 보기로 돌아가면
  // **통째로 언마운트**된다. 그래서 캐시가 없으면 색칠을 누를 때마다 143KB 를 다시 받아
  // 다시 파싱한다(사장님 보고: "점↔색칠 번갈아 누르면 굉장히 느려진다", 세션553).
  // 모듈 수준에 파싱 결과를 두면 두 번째부터는 네트워크·파싱이 모두 0 이다.
  // 행정구역 경계는 세션 중에 바뀌지 않으므로 무효화가 필요 없고, 새로고침하면 사라진다.
  useEffect(() => {
    if (sidoGeoCache) {
      setGeoData(sidoGeoCache);
      return;
    }
    let cancelled = false;
    setError(null);
    fetch("/geo/sido.geojson")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        sidoGeoCache = d;
        if (!cancelled) setGeoData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  // 2. 폴리곤 그리기 + cleanup
  useEffect(() => {
    if (!ready || !mapInstance || !geoData) return;
    const kakao = getKakaoMaps();
    if (!kakao?.Polygon) return;

    // 시군구 모드일 땐 시도 폴리곤 전부 cleanup 후 종료
    if (showSigungu) {
      polygonsRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current = [];
      return;
    }

    polygonsRef.current.forEach((p) => p.setMap(null));
    polygonsRef.current = [];

    for (const feature of geoData.features || []) {
      const geoName = feature?.properties?.name;
      const dbName = geoSidoToDbName(geoName);
      if (!dbName) continue;
      const stat = byRegion[dbName];
      const avg = stat?.avg;
      const hasData = Number.isFinite(avg);
      // 표본이 적은 칸 = "단지 1곳 점수 = 그 도 전체" 라는 거짓을 막아야 하는 칸.
      // 예산 필터를 걸면 시도조차 표본 1곳까지 떨어지는 것이 실측됐다.
      //
      // ⚠️ **불확실성은 진하기가 아니라 테두리로 말한다**(사장님 결정, 세션553).
      // 처음엔 흐리게(0.3) 칠했는데 적대검증이 뒤집힘을 실측으로 잡았다 —
      // 흰 배경 합성 밝기로 S(90+) 표본부족 0.812 vs D(<50) 표본충분 0.545, 즉
      // **가장 좋은데 표본이 적은 칸이 가장 나쁜데 표본이 많은 칸보다 두 배 흐렸다**.
      // 지도는 진한 덩어리가 먼저 눈에 들어오므로 "믿지 마라"가 "여기는 나쁘다"로 읽힌다.
      // 진하기 채널에 이미 점수와 "데이터 없음"이 실려 있던 것이 근본 원인이라,
      // 진하기는 점수 전용으로 되돌리고 비어 있던 테두리 채널에 불확실성을 싣는다.
      const thin = hasData && !stat.enough;
      const color = hasData ? gr(avg).c : C.muted;
      const baseOpacity = hasData ? 0.65 : 0.25;
      const paths = geoJsonFeatureToKakaoPaths(feature, kakao);

      for (const path of paths) {
        if (path.length === 0) continue;
        const polygon = new kakao.Polygon({
          path,
          // 표본 부족: 점선 + 굵고 진한 회색 테두리. 카카오 Polygon 이 공식 지원하는
          // strokeStyle("dashed") 를 쓴다. 채움은 건드리지 않는다.
          strokeWeight: thin ? 3 : 1.5,
          strokeColor: thin ? C.muted : C.white,
          strokeOpacity: thin ? 0.95 : 0.9,
          ...(thin ? { strokeStyle: "dashed" } : {}),
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
        // hover 는 baseOpacity 기준으로 올린다(데이터 없는 회색 칸이 과하게 진해지지 않게).
        // 표본 가드가 테두리로 옮겨간 뒤로는 hover 가 가드를 지울 수 없다 — 테두리는 그대로다.
        const hoverOpacity = Math.min(baseOpacity + 0.2, 0.85);
        kakao.event.addListener(polygon, "mouseover", () => polygon.setOptions({ fillOpacity: hoverOpacity }));
        kakao.event.addListener(polygon, "mouseout", () => polygon.setOptions({ fillOpacity: baseOpacity }));
        polygonsRef.current.push(polygon);
      }
    }

    return () => {
      polygonsRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current = [];
    };
  }, [ready, mapInstance, geoData, byRegion, onSidoClick, showSigungu]);

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
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        지도 데이터를 불러올 수 없습니다
        <button
          onClick={() => setRetryKey((k) => k + 1)}
          style={{
            fontSize: F.xs,
            padding: "2px 8px",
            borderRadius: 4,
            border: `1px solid ${C.redBorder}`,
            background: C.white,
            color: C.red,
            cursor: "pointer",
          }}
        >
          재시도
        </button>
      </div>
    );

  if (!geoData)
    return (
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 10,
          width: 160,
          background: "rgba(255,255,255,0.92)",
          padding: "6px 8px",
          borderRadius: 6,
        }}
      >
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
