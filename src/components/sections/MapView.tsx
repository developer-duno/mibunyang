import { memo, useRef, useEffect, useState, useCallback, lazy, Suspense } from "react";
import { C, F, gr } from "@/theme";
import { InfraOverlay } from "./InfraOverlay";
import { SelectedAptCard } from "./SelectedAptCard";
import {
  MAP_DEFAULTS, CLUSTER_OPTS, MY_LOC_LEVEL, GEO_TIMEOUT,
  shortPrice, buildMarkerSvg, loadKakaoMapSdk,
} from "./kakaoMapHelpers";
import type { MapViewProps } from "@/types/components/MapView.types";
import type { Apt } from "@/types/scoring";
import type { ScoringResult } from "@/types/components";

type FilteredItem = { apt: Apt; res: ScoringResult };

const ChoroplethView = lazy(() => import("./ChoroplethView").then(m => ({ default: m.ChoroplethView })));

export const MapView = memo(function MapView({ filtered, onDetail, isPC, isDesktop }: MapViewProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const clustererRef = useRef<{ clear: () => void; addMarkers: (_m: unknown[]) => void } | null>(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<FilteredItem | null>(null);
  const [markerCount, setMarkerCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"point" | "choropleth">("point");
  const [mapInstance, setMapInstance] = useState<unknown>(null);

  // Kakao Maps SDK 동적 로드 + 지도 초기화
  useEffect(() => {
    let cancelled = false;
    loadKakaoMapSdk()
      .then(() => {
        if (cancelled) return;
        const kakao = (window as any).kakao;
        kakao.maps.load(() => {
          if (cancelled || !mapRef.current || mapInstanceRef.current) return;
          const map = new kakao.maps.Map(mapRef.current, {
            center: new kakao.maps.LatLng(MAP_DEFAULTS.lat, MAP_DEFAULTS.lng),
            level: MAP_DEFAULTS.level,
          });
          map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
          mapInstanceRef.current = map;
          setMapInstance(map);
          clustererRef.current = new kakao.maps.MarkerClusterer({
            map,
            averageCenter: true,
            minLevel: CLUSTER_OPTS.minLevel,
            disableClickZoom: false,
            gridSize: CLUSTER_OPTS.gridSize,
            styles: [{
              width: "44px", height: "44px", background: C.indigo, borderRadius: "50%",
              color: C.white, textAlign: "center", fontWeight: "700", fontSize: "13px",
              lineHeight: "44px", opacity: "0.9",
            }],
          });
          setReady(true);
        });
      })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => {
      cancelled = true;
      if (clustererRef.current) clustererRef.current.clear();
      mapInstanceRef.current = null;
      setMapInstance(null);
      clustererRef.current = null;
    };
  }, []);

  // 색칠 모드 진입 시 마커/선택 상태 리셋 (event handler 에서 호출 — set-state-in-effect 회피)
  const clearMarkersAndSelection = useCallback(() => {
    clustererRef.current?.clear();
    setSelected(null);
    setMarkerCount(0);
  }, []);

  // 마커 업데이트 — point 모드에서만 동작 (color 모드는 event handler 가 clear 처리)
  useEffect(() => {
    if (!ready || !clustererRef.current || mode !== "point") return;
    const kakao = (window as any).kakao.maps;
    clustererRef.current.clear();
    // filtered 변경 시 이전 선택 정리 — 새 filtered 에서 사라진 단지의 selected 카드가 남는 것 방지
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(null);

    const markers: unknown[] = [];
    for (const item of filtered) {
      const { apt, res } = item;
      if (!apt.lat || !apt.lng) continue;
      const pos = new kakao.LatLng(apt.lat, apt.lng);
      const grade = gr(res.total);
      const { w, h, svg } = buildMarkerSvg(res.total, grade.c, shortPrice(apt.price));
      const marker = new kakao.Marker({
        position: pos,
        title: apt.name,
        image: new kakao.MarkerImage(
          `data:image/svg+xml,${encodeURIComponent(svg)}`,
          new kakao.Size(w, h),
          { offset: new kakao.Point(w / 2, h) }
        ),
      });
      kakao.event.addListener(marker, "click", () => setSelected(item));
      markers.push(marker);
    }
    clustererRef.current.addMarkers(markers);
    setMarkerCount(markers.length);

    if (markers.length > 0 && mapInstance) {
      const bounds = new kakao.LatLngBounds();
      markers.forEach((m: any) => bounds.extend(m.getPosition()));
      (mapInstance as any).setBounds(bounds);
    }
  }, [ready, filtered, mode, mapInstance]);

  // 색칠 모드 폴리곤 클릭 → 점 보기 자동 복귀 (마커는 useEffect 가 재생성하므로 clear 불필요)
  const handleSidoClick = useCallback(() => {
    setMode("point");
  }, []);

  // 모드 토글 버튼 — point→color 전환 시 마커/선택 즉시 정리 (color→point 는 useEffect 가 재생성)
  const handleModeToggle = useCallback(() => {
    setMode(m => {
      if (m === "point") clearMarkersAndSelection();
      return m === "point" ? "choropleth" : "point";
    });
  }, [clearMarkersAndSelection]);

  const handleInfoClick = useCallback(() => {
    if (selected && onDetail && selected.apt.id) onDetail(selected.apt.id);
  }, [selected, onDetail]);

  // 현위치 버튼 핸들러
  const myLocMarkerRef = useRef<any>(null);
  const handleMyLocation = useCallback(() => {
    if (!ready || !mapInstance || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const kakao = (window as any).kakao.maps;
        const loc = new kakao.LatLng(pos.coords.latitude, pos.coords.longitude);
        if (myLocMarkerRef.current) myLocMarkerRef.current.setPosition(loc);
        else {
          const blueDot = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="#4285F4" stroke="#fff" stroke-width="3"/></svg>')}`;
          myLocMarkerRef.current = new kakao.Marker({
            position: loc,
            image: new kakao.MarkerImage(blueDot, new kakao.Size(20, 20), { offset: new kakao.Point(10, 10) }),
            zIndex: 100,
          });
          myLocMarkerRef.current.setMap(mapInstance);
        }
        (mapInstance as any).setCenter(loc);
        (mapInstance as any).setLevel(MY_LOC_LEVEL);
      },
      () => { /* 권한 거부 시 조용히 무시 */ },
      { enableHighAccuracy: false, timeout: GEO_TIMEOUT },
    );
  }, [ready, mapInstance]);

  return (
    <div style={{ position: "relative", width: "100%", height: isDesktop ? "calc(100dvh - 120px)" : isPC ? "calc(100dvh - 180px)" : "calc(100dvh - 140px)", borderRadius: isDesktop ? 12 : 10, overflow: "hidden", border: `1px solid ${C.border}` }}>
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
      {error && (
        <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.9)", zIndex: 20 }}>
          <div style={{ textAlign: "center", color: C.muted, fontSize: F.base }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🗺️</div>
            <div>지도를 불러올 수 없습니다</div>
            <div style={{ fontSize: F.xs, marginTop: 4 }}>{error}</div>
          </div>
        </div>
      )}
      {/* 인프라 오버레이 토글 */}
      <InfraOverlay mapInstance={mapInstance} ready={ready} />
      {/* 현위치 버튼 */}
      {ready && navigator.geolocation && (
        <button onClick={handleMyLocation} aria-label="현위치" style={{ position: "absolute", bottom: 16, right: 12, width: 36, height: 36, borderRadius: "50%", background: C.white, border: `1px solid ${C.border}`, boxShadow: "0 1px 4px rgba(0,0,0,0.15)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10, fontSize: F.lg }}>
          📍
        </button>
      )}
      {/* 좌상단: 결과수 + 모드 토글 */}
      <div style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 6, zIndex: 10 }}>
        <div style={{ background: "rgba(255,255,255,0.92)", borderRadius: 8, padding: "4px 10px", fontSize: F.xs, fontWeight: 700, color: C.indigo, boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}>
          {mode === "choropleth" ? `${filtered.length}개 단지` : markerCount == null ? `${filtered.length}개 단지` : markerCount === filtered.length ? `${filtered.length}개 단지` : `${markerCount} / ${filtered.length}개 단지`}
        </div>
        <button
          onClick={handleModeToggle}
          aria-pressed={mode === "choropleth"}
          aria-label="지도 모드 토글"
          style={{ background: "rgba(255,255,255,0.92)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "4px 10px", fontSize: F.xs, fontWeight: 700, color: C.indigo, cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}
        >
          {mode === "point" ? "🎨 색칠" : "📍 점"}
        </button>
      </div>
      {/* 색칠 모드: ChoroplethView lazy 렌더 */}
      {mode === "choropleth" && (
        <Suspense fallback={null}>
          <ChoroplethView
            mapInstance={mapInstance}
            ready={ready}
            filtered={filtered}
            onSidoClick={handleSidoClick}
            isPC={isPC}
            isDesktop={isDesktop}
          />
        </Suspense>
      )}
      {/* 선택된 아파트 정보 카드 */}
      <SelectedAptCard selected={selected} onInfoClick={handleInfoClick} onClose={() => setSelected(null)} />
    </div>
  );
});
