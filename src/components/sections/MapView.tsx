import { memo, useRef, useEffect, useState, useCallback, lazy, Suspense } from "react";
import { C, F, gr } from "@/theme";
import { InfraOverlay } from "./InfraOverlay";
import { SelectedAptCard } from "./SelectedAptCard";
import {
  MAP_DEFAULTS, CLUSTER_OPTS, MY_LOC_LEVEL, GEO_TIMEOUT,
  shortPrice, buildMarkerSvg, loadKakaoMapSdk, getKakaoMaps,
} from "./kakaoMapHelpers";
import type { MapViewProps } from "@/types/components/MapView.types";
import type { Apt } from "@/types/scoring";
import type { ScoringResult } from "@/types/components";

type FilteredItem = { apt: Apt; res: ScoringResult };

const ChoroplethView = lazy(() => import("./ChoroplethView").then(m => ({ default: m.ChoroplethView })));

export const MapView = memo(function MapView({ filtered, onDetail, isPC, isDesktop, height, compact, onSelect, getViewport, onViewportChange }: MapViewProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const clustererRef = useRef<{ clear: () => void; addMarkers: (_m: unknown[]) => void } | null>(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<FilteredItem | null>(null);
  const [markerCount, setMarkerCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"point" | "choropleth">("point");
  const [mapInstance, setMapInstance] = useState<unknown>(null);

  // compact 는 마운트 시 고정 — init effect(deps []) 안에서 읽으므로 ref 캡처.
  // deps 에 compact 를 넣으면 cleanup 이 JS ref 만 해제(지도 destroy API 없음)하고
  // 같은 div 에 두 번째 지도가 중첩 생성되는 함정 (plan 함정 박제).
  const compactRef = useRef(compact);

  // onSelect 미러 — selected 감시 단일 지점으로 4개 setSelected 경로 전부 커버.
  // 마커 effect deps 에 onSelect 를 넣으면 인라인 콜백 전달 시 마커 전체 재생성 → ref 격리.
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; });
  useEffect(() => { onSelectRef.current?.(selected); }, [selected]);

  // 뷰포트 보존 (M3) — getViewport()는 init effect(deps [])에서 1회 호출하므로 compactRef 답습 캡처.
  // onViewportChange 도 ref 미러(onSelectRef 답습) — idle 리스너 deps 오염/마커 재생성 방지.
  const getViewportRef = useRef(getViewport);
  const onViewportChangeRef = useRef(onViewportChange);
  useEffect(() => { onViewportChangeRef.current = onViewportChange; });
  // 첫 마커 렌더 1회만 자동 fit. viewport(복원값)는 init effect 의 초기 center/level 에만 사용.
  // ⚠️ didFitRef 를 viewport 로 시드하지 않는 이유(맹점 4): 탭 나가기 전 부산 보다가 경기 필터로
  // 바꾸고 재진입하면, 복원된 부산 center + fit 생략 = 경기 마커가 화면 밖 빈 지도. 재마운트는 항상
  // 첫 마커 fit 1회를 허용해 빈 화면 방지. 같은 마운트 내 filtered 변경은 didFitRef true 라 fit 생략(B-1).
  const didFitRef = useRef(false);

  // Kakao Maps SDK 동적 로드 + 지도 초기화
  useEffect(() => {
    let cancelled = false;
    // idle 리스너 cleanup 용 — addListener 와 동일 (map, handler) 참조로 removeListener.
    let idleCleanup: (() => void) | null = null;
    loadKakaoMapSdk()
      .then(() => {
        if (cancelled) return;
        const maps = getKakaoMaps();
        if (!maps) return;
        maps.load(() => {
          if (cancelled || !mapRef.current || mapInstanceRef.current) return;
          const vp = getViewportRef.current?.();
          const map = new maps.Map(mapRef.current, {
            center: new maps.LatLng(vp?.lat ?? MAP_DEFAULTS.lat, vp?.lng ?? MAP_DEFAULTS.lng),
            level: vp?.level ?? MAP_DEFAULTS.level,
          });
          // idle(팬/줌 종료) 시 현재 center/level 끌어올림 — 탭 전환/언마운트 간 보존.
          const onIdle = () => {
            const c = (map as any).getCenter();
            onViewportChangeRef.current?.({ lat: c.getLat(), lng: c.getLng(), level: (map as any).getLevel() });
          };
          maps.event.addListener(map, "idle", onIdle);
          // removeListener 는 일부 kakao 버전 미지원 → 옵셔널 가드 (ChoroplethView 답습).
          idleCleanup = () => maps.event.removeListener?.(map, "idle", onIdle);
          if (compactRef.current) {
            // 위젯 모드: 줌 컨트롤 생략 + 휠 줌 차단 (280px 위젯이 홈 페이지 스크롤을 가로채는 것 방지)
            map.setZoomable(false);
          } else {
            map.addControl(new maps.ZoomControl(), maps.ControlPosition.RIGHT);
          }
          mapInstanceRef.current = map;
          setMapInstance(map);
          clustererRef.current = new maps.MarkerClusterer({
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
      if (idleCleanup) idleCleanup();
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
    const kakao = getKakaoMaps();
    if (!kakao) return;
    clustererRef.current.clear();
    // filtered 변경 시 이전 선택 정리 — 새 filtered 에서 사라진 단지의 selected 카드가 남는 것 방지
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

    // 첫 마커 렌더 1회만 자동 fit (M3) — 이후 filtered 변경은 마커만 갱신해
    // 사용자가 수동 조작한 지도 위치가 전국으로 튕기는 것 방지. viewport 복원 시 didFitRef 시드 true.
    if (markers.length > 0 && mapInstance && !didFitRef.current) {
      const bounds = new kakao.LatLngBounds();
      markers.forEach((m: any) => bounds.extend(m.getPosition()));
      (mapInstance as any).setBounds(bounds);
      didFitRef.current = true;
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
        const kakao = getKakaoMaps();
        if (!kakao) return;
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
    <div style={{ position: "relative", width: "100%", height: height ?? (isDesktop ? "calc(100dvh - 120px)" : isPC ? "calc(100dvh - 180px)" : "calc(100dvh - 140px)"), borderRadius: isDesktop ? 12 : 10, overflow: "hidden", border: `1px solid ${C.border}` }}>
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
      {/* 인프라 오버레이 토글 — compact(위젯) 모드에선 숨김 */}
      {!compact && <InfraOverlay mapInstance={mapInstance} ready={ready} />}
      {/* 현위치 버튼 */}
      {!compact && ready && navigator.geolocation && (
        <button onClick={handleMyLocation} aria-label="현위치" style={{ position: "absolute", bottom: 16, right: 12, width: 36, height: 36, borderRadius: "50%", background: C.white, border: `1px solid ${C.border}`, boxShadow: "0 1px 4px rgba(0,0,0,0.15)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10, fontSize: F.lg }}>
          📍
        </button>
      )}
      {/* 좌상단: 결과수 + 모드 토글 */}
      <div style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 6, zIndex: 10 }}>
        <div style={{ background: "rgba(255,255,255,0.92)", borderRadius: 8, padding: "4px 10px", fontSize: F.xs, fontWeight: 700, color: C.indigo, boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}>
          {mode === "choropleth" ? `${filtered.length}개 단지` : markerCount == null ? `${filtered.length}개 단지` : markerCount === filtered.length ? `${filtered.length}개 단지` : `${markerCount} / ${filtered.length}개 단지`}
        </div>
        {/* 모드토글 — compact 에선 숨김 (point 모드 고정 진입로 차단). 결과수 badge 는 유지 (spec 숨김 목록 미포함) */}
        {!compact && (
          <button
            onClick={handleModeToggle}
            aria-pressed={mode === "choropleth"}
            aria-label="지도 모드 토글"
            style={{ background: "rgba(255,255,255,0.92)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "4px 10px", fontSize: F.xs, fontWeight: 700, color: C.indigo, cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}
          >
            {mode === "point" ? "🎨 색칠" : "📍 점"}
          </button>
        )}
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
