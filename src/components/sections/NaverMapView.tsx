import { memo, useRef, useEffect, useState, useCallback } from "react";
import { C, F, gr } from "@/theme";
import { SelectedAptCard } from "./SelectedAptCard";
import {
  NAVER_MAP_DEFAULTS, NAVER_REGION_FIT_MAX_ZOOM, NAVER_GU_FIT_MAX_ZOOM, NAVER_MY_LOC_ZOOM,
  loadNaverMapSdk, getNaverMaps, loadNaverMarkerClustering, getMarkerClustering,
} from "./naverMapHelpers";
import { shortPrice, buildMarkerSvg } from "./markerSvg";
import type { MapViewProps } from "@/types/components/MapView.types";
import type { Apt } from "@/types/scoring";
import type { ScoringResult } from "@/types/components";

type FilteredItem = { apt: Apt; res: ScoringResult };

/**
 * NaverMapView — 점 보기(단지 마커) 네이버 지도 (세션 435).
 *
 * 카카오 KakaoMapView 의 점 보기 로직을 네이버 v3 API 로 이식. 색칠(choropleth)·인프라 오버레이는
 * 카카오 고정이라 여기 없음(1차 범위 밖). 클러스터는 SDK 내장 아님 → 1차는 개별 마커.
 * markerSvg(공통) 재사용. zoom 방향이 카카오 level 과 반대(클수록 확대)라 fit/클램프 로직 별도.
 *
 * 회귀 0 보장: 이 컴포넌트는 신규라 기존 카카오 경로/테스트에 영향 0. provider 'naver' 일 때만 마운트.
 */
export const NaverMapView = memo(function NaverMapView({ filtered, onDetail, isPC, isDesktop, height, compact, onSelect, getViewport, onViewportChange, deferredRegion, deferredGu, fullscreen, autoLocate }: MapViewProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const markersRef = useRef<unknown[]>([]);
  const markerByIdRef = useRef<Map<string, unknown>>(new Map());
  const myLocMarkerRef = useRef<any>(null);
  // 클러스터러 — 로드 성공 시 마커를 숫자로 묶음. 실패 시 null → 개별 마커 폴백(카카오 동등).
  const clustererRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<FilteredItem | null>(null);
  const [markerCount, setMarkerCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapInstance, setMapInstance] = useState<unknown>(null);

  const compactRef = useRef(compact);
  const getViewportRef = useRef(getViewport);
  const onViewportChangeRef = useRef(onViewportChange);
  useEffect(() => { onViewportChangeRef.current = onViewportChange; });
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; });
  useEffect(() => { onSelectRef.current?.(selected); }, [selected]);
  const onDetailRef = useRef(onDetail);
  useEffect(() => { onDetailRef.current = onDetail; });

  // 첫 마커 fit 1회 가드 + region-fit 직전값 추적 (카카오 KakaoMapView 답습).
  const didFitRef = useRef(false);
  const prevRegionRef = useRef(deferredRegion);
  const prevGuRef = useRef(deferredGu);

  // SDK 로드 + 지도 초기화
  useEffect(() => {
    let cancelled = false;
    let idleCleanup: (() => void) | null = null;
    loadNaverMapSdk()
      .then(() => {
        if (cancelled) return;
        const maps = getNaverMaps();
        if (!maps || !mapRef.current || mapInstanceRef.current) return;
        const vp = getViewportRef.current?.();
        const map = new maps.Map(mapRef.current, {
          center: new maps.LatLng(vp?.lat ?? NAVER_MAP_DEFAULTS.lat, vp?.lng ?? NAVER_MAP_DEFAULTS.lng),
          zoom: vp?.level ?? NAVER_MAP_DEFAULTS.zoom,
          zoomControl: !compactRef.current,
          scrollWheel: !compactRef.current,
        });
        // idle 시 현재 center/zoom 끌어올림 — 뷰포트 보존(카카오와 동일 콜백 시그니처 {lat,lng,level}).
        const onIdle = () => {
          const c = (map as any).getCenter();
          onViewportChangeRef.current?.({ lat: c.lat(), lng: c.lng(), level: (map as any).getZoom() });
        };
        const listener = maps.Event.addListener(map, "idle", onIdle);
        idleCleanup = () => maps.Event.removeListener?.(listener);
        mapInstanceRef.current = map;
        // 클러스터 라이브러리 로드 시도 — 성공 시 마커를 숫자로 묶음(카카오 동등). 실패해도 진행(개별 마커 폴백).
        return loadNaverMarkerClustering()
          .then(() => {
            if (cancelled) return;
            const Clustering = getMarkerClustering();
            if (Clustering) {
              // 카카오 MarkerClusterer 스타일 동등 — 인디고 원 + 흰 테두리 + 개수 텍스트. minClusterSize 2.
              clustererRef.current = new Clustering({
                map, markers: [], disableClickZoom: false, minClusterSize: 2, maxZoom: 11, gridSize: 120,
                icons: [{
                  content: `<div style="width:44px;height:44px;line-height:44px;text-align:center;border-radius:50%;background:${C.indigo};color:#fff;font-weight:700;font-size:13px;border:2px solid rgba(255,255,255,0.85);box-shadow:0 2px 6px rgba(0,0,0,0.3);opacity:0.92;"></div>`,
                  size: { width: 44, height: 44 }, anchor: { x: 22, y: 22 },
                }],
                indexGenerator: [10, 100, 200, 500, 1000],
                stylingFunction: (clusterMarker: any, count: number) => {
                  const el = clusterMarker.getElement().querySelector("div");
                  if (el) el.textContent = String(count);
                },
              });
            }
          })
          .catch(() => { /* 클러스터 로드 실패 → clustererRef null → 개별 마커 폴백 */ })
          .finally(() => {
            if (!cancelled) { setMapInstance(map); setReady(true); }
          });
      })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => {
      cancelled = true;
      if (idleCleanup) idleCleanup();
      // 클러스터러·마커 detach
      if (clustererRef.current) { clustererRef.current.setMarkers([]); clustererRef.current.setMap(null); clustererRef.current = null; }
      for (const m of markersRef.current) (m as any)?.setMap?.(null);
      markersRef.current = [];
      const inst = mapInstanceRef.current as any;
      inst?.destroy?.();
      mapInstanceRef.current = null;
      setMapInstance(null);
    };
  }, []);

  // 마커 업데이트 (개별 마커 — 1차 클러스터 미포함)
  useEffect(() => {
    if (!ready || !mapInstance) return;
    const maps = getNaverMaps();
    if (!maps) return;
    // 기존 마커 detach — 클러스터러 관리 마커는 setMarkers([])로, 폴백은 개별 setMap(null).
    if (clustererRef.current) clustererRef.current.setMarkers([]);
    for (const m of markersRef.current) (m as any)?.setMap?.(null);
    markersRef.current = [];
    markerByIdRef.current = new Map();
    setSelected(null);

    const useCluster = !!clustererRef.current;
    const markers: unknown[] = [];
    for (const item of filtered) {
      const { apt, res } = item;
      if (!apt.lat || !apt.lng) continue;
      const pos = new maps.LatLng(apt.lat, apt.lng);
      const grade = gr(res.total);
      const { w, h, svg } = buildMarkerSvg(res.total, grade.c, shortPrice(apt.price));
      const marker = new maps.Marker({
        position: pos,
        // 클러스터러가 관리할 땐 map 미지정(클러스터러가 setMap 제어). 폴백 시에만 map 직접 부착.
        ...(useCluster ? {} : { map: mapInstance }),
        title: apt.name,
        icon: {
          content: `<img src="data:image/svg+xml,${encodeURIComponent(svg)}" width="${w}" height="${h}" style="display:block" />`,
          anchor: new maps.Point(w / 2, h),
        },
      });
      maps.Event.addListener(marker, "click", () => {
        setSelected(item);
        if (onDetailRef.current && item.apt.id) onDetailRef.current(item.apt.id);
      });
      markers.push(marker);
      if (apt.id) markerByIdRef.current.set(apt.id, marker);
    }
    markersRef.current = markers;
    // 클러스터러가 있으면 마커를 넘겨 숫자로 묶음(카카오 동등). 없으면 위에서 개별 map 부착됨(폴백).
    if (useCluster) clustererRef.current.setMarkers(markers);
    setMarkerCount(markers.length);

    const regionChanged = deferredRegion !== prevRegionRef.current;
    const guChanged = deferredGu !== prevGuRef.current;
    prevRegionRef.current = deferredRegion;
    prevGuRef.current = deferredGu;

    if (markers.length > 0) {
      const m = mapInstance as any;
      // 첫 마커 position 으로 bounds 시드 후 전체 extend (markers.length>0 보장).
      const seedBounds = () => {
        const first = (markers[0] as any).getPosition();
        const bounds = new maps.LatLngBounds(first, first);
        for (const mk of markers) bounds.extend((mk as any).getPosition());
        return bounds;
      };
      if (!didFitRef.current) {
        // 첫 마커 fit 1회 (빈 화면 방지). 네이버 fitBounds(LatLngBounds).
        m.fitBounds(seedBounds());
        didFitRef.current = true;
      } else if ((regionChanged || guChanged) && deferredRegion && deferredRegion !== "전체") {
        // 지역/구 변경 클로즈업 (카카오 KakaoMapView 답습) — fit 후 과도 확대 클램프.
        m.fitBounds(seedBounds());
        // 네이버 zoom 은 클수록 확대 — 단일/소수 단지 과도 확대 상한(카카오와 방향 반대).
        const maxZoom = deferredGu && deferredGu !== "전체" ? NAVER_GU_FIT_MAX_ZOOM : NAVER_REGION_FIT_MAX_ZOOM;
        if (m.getZoom() > maxZoom) m.setZoom(maxZoom);
      }
    }
  }, [ready, filtered, mapInstance, deferredRegion, deferredGu]);

  // 현위치 버튼 핸들러 (카카오 KakaoMapView handleMyLocation 답습 — 네이버 API)
  const handleMyLocation = useCallback(() => {
    if (!ready || !mapInstance || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const maps = getNaverMaps();
        if (!maps || !mapInstanceRef.current) return; // 언마운트 후 콜백 가드
        const loc = new maps.LatLng(pos.coords.latitude, pos.coords.longitude);
        if (myLocMarkerRef.current) myLocMarkerRef.current.setPosition(loc);
        else {
          const blueDot = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="#4285F4" stroke="#fff" stroke-width="3"/></svg>')}`;
          myLocMarkerRef.current = new maps.Marker({
            position: loc,
            map: mapInstanceRef.current,
            icon: { content: `<img src="${blueDot}" width="20" height="20" style="display:block" />`, anchor: new maps.Point(10, 10) },
            zIndex: 100,
          });
        }
        (mapInstance as any).setCenter(loc);
        (mapInstance as any).setZoom(NAVER_MY_LOC_ZOOM);
      },
      () => { /* 권한 거부 시 조용히 무시 */ },
      { enableHighAccuracy: false, timeout: 5000 },
    );
  }, [ready, mapInstance]);

  // GPS 첫 진입 자동 동네 표시 (세션 435) — 카카오 KakaoMapView 와 동일 조건/폴백.
  const autoLocatedRef = useRef(false);
  useEffect(() => {
    if (autoLocatedRef.current) return;
    if (!ready || !mapInstance) return;
    if (compactRef.current && !autoLocate) return;                    // 위젯 기본 제외, autoLocate 면 허용(홈 미니지도)
    if (!navigator.geolocation) return;
    if (deferredRegion && deferredRegion !== "전체") return;
    if (getViewportRef.current?.()) return;
    autoLocatedRef.current = true;
    // 마커 effect(위 선언)가 먼저 첫 fit 수행 → GPS 거부여도 전국 마커 fit 상태(빈화면 0). 성공 시만 동네 이동.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const maps = getNaverMaps();
        if (!maps || !mapInstanceRef.current) return;
        if (deferredRegion && deferredRegion !== "전체") return; // 콜백 사이 지역 선택 시 덮어쓰기 방지
        const loc = new maps.LatLng(pos.coords.latitude, pos.coords.longitude);
        const blueDot = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="#4285F4" stroke="#fff" stroke-width="3"/></svg>')}`;
        myLocMarkerRef.current = new maps.Marker({
          position: loc,
          map: mapInstanceRef.current,
          icon: { content: `<img src="${blueDot}" width="20" height="20" style="display:block" />`, anchor: new maps.Point(10, 10) },
          zIndex: 100,
        });
        (mapInstance as any).setCenter(loc);
        (mapInstance as any).setZoom(NAVER_MY_LOC_ZOOM);
      },
      () => { /* 거부/실패 → 전국 마커 fit 유지(폴백). 조용히 무시 */ },
      { enableHighAccuracy: false, timeout: 5000 },
    );
  }, [ready, mapInstance, deferredRegion, autoLocate]);

  const handleInfoClick = useCallback(() => {
    if (selected && onDetail && selected.apt.id) onDetail(selected.apt.id);
  }, [selected, onDetail]);

  return (
    <div style={{
      position: "relative", width: "100%",
      height: height ?? (isDesktop ? "calc(100dvh - 120px)" : isPC ? "calc(100dvh - 180px)" : "calc(100dvh - 140px)"),
      borderRadius: fullscreen ? 0 : isDesktop ? 12 : 10,
      overflow: "hidden",
      border: fullscreen ? "none" : `1px solid ${C.border}`,
    }}>
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
      {/* 현위치 버튼 */}
      {!compact && ready && navigator.geolocation && (
        <button type="button" onClick={handleMyLocation} aria-label="현위치" style={{ position: "absolute", bottom: 16, right: 12, width: 36, height: 36, borderRadius: "50%", background: C.white, border: `1px solid ${C.border}`, boxShadow: "0 1px 4px rgba(0,0,0,0.15)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10, fontSize: F.lg }}>
          📍
        </button>
      )}
      {/* 좌상단 결과수 */}
      <div style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 6, zIndex: 10 }}>
        <div style={{ background: "rgba(255,255,255,0.92)", borderRadius: 8, padding: "4px 10px", fontSize: F.xs, fontWeight: 700, color: C.indigo, boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}>
          {markerCount == null || markerCount === filtered.length ? `${filtered.length}개 단지` : `${markerCount} / ${filtered.length}개 단지`}
        </div>
      </div>
      <SelectedAptCard selected={selected} onInfoClick={handleInfoClick} onClose={() => setSelected(null)} />
    </div>
  );
});
