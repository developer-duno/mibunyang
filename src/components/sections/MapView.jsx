import { memo, useRef, useEffect, useState, useCallback } from "react";
import { C, F, gr } from "@/theme";
import { InfraOverlay } from "./InfraOverlay";
import { SelectedAptCard } from "./SelectedAptCard";
import {
  MAP_DEFAULTS, CLUSTER_OPTS, MY_LOC_LEVEL, GEO_TIMEOUT,
  shortPrice, buildMarkerSvg, loadKakaoMapSdk,
} from "./kakaoMapHelpers";

/**
 * MapView — Kakao Map 기반 아파트 지도 뷰
 * Props:
 *   filtered: Array<{apt, res}> — 필터링된 아파트 목록
 *   onDetail: (id) => void — 상세 모달 열기
 *   isPC: boolean
 */
export const MapView = memo(function MapView({ filtered, onDetail, isPC, isDesktop }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const clustererRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState(null);
  const [markerCount, setMarkerCount] = useState(null);
  const [error, setError] = useState(null);

  // Kakao Maps SDK 동적 로드 + 지도 초기화
  useEffect(() => {
    let cancelled = false;
    loadKakaoMapSdk()
      .then(() => {
        if (cancelled) return;
        window.kakao.maps.load(() => {
          if (cancelled || !mapRef.current || mapInstanceRef.current) return;
          const map = new window.kakao.maps.Map(mapRef.current, {
            center: new window.kakao.maps.LatLng(MAP_DEFAULTS.lat, MAP_DEFAULTS.lng),
            level: MAP_DEFAULTS.level,
          });
          map.addControl(new window.kakao.maps.ZoomControl(), window.kakao.maps.ControlPosition.RIGHT);
          mapInstanceRef.current = map;
          clustererRef.current = new window.kakao.maps.MarkerClusterer({
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
      clustererRef.current = null;
    };
  }, []);

  // 마커 업데이트
  useEffect(() => {
    if (!ready || !clustererRef.current) return;
    const kakao = window.kakao.maps;
    clustererRef.current.clear();
    setSelected(null);

    const markers = [];
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

    if (markers.length > 0) {
      const bounds = new kakao.LatLngBounds();
      markers.forEach(m => bounds.extend(m.getPosition()));
      mapInstanceRef.current.setBounds(bounds);
    }
  }, [ready, filtered]);

  const handleInfoClick = useCallback(() => {
    if (selected && onDetail) onDetail(selected.apt.id);
  }, [selected, onDetail]);

  // 현위치 버튼 핸들러
  const myLocMarkerRef = useRef(null);
  const handleMyLocation = useCallback(() => {
    if (!ready || !mapInstanceRef.current || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const kakao = window.kakao.maps;
        const loc = new kakao.LatLng(pos.coords.latitude, pos.coords.longitude);
        if (myLocMarkerRef.current) myLocMarkerRef.current.setPosition(loc);
        else {
          const blueDot = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="#4285F4" stroke="#fff" stroke-width="3"/></svg>')}`;
          myLocMarkerRef.current = new kakao.Marker({
            position: loc,
            image: new kakao.MarkerImage(blueDot, new kakao.Size(20, 20), { offset: new kakao.Point(10, 10) }),
            zIndex: 100,
          });
          myLocMarkerRef.current.setMap(mapInstanceRef.current);
        }
        mapInstanceRef.current.setCenter(loc);
        mapInstanceRef.current.setLevel(MY_LOC_LEVEL);
      },
      () => { /* 권한 거부 시 조용히 무시 */ },
      { enableHighAccuracy: false, timeout: GEO_TIMEOUT },
    );
  }, [ready]);

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
      <InfraOverlay mapInstance={mapInstanceRef.current} ready={ready} />
      {/* 현위치 버튼 */}
      {ready && navigator.geolocation && (
        <button onClick={handleMyLocation} aria-label="현위치" style={{ position: "absolute", bottom: 16, right: 12, width: 36, height: 36, borderRadius: "50%", background: C.white, border: `1px solid ${C.border}`, boxShadow: "0 1px 4px rgba(0,0,0,0.15)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10, fontSize: F.lg }}>
          📍
        </button>
      )}
      {/* 필터 결과 수 오버레이 */}
      <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(255,255,255,0.92)", borderRadius: 8, padding: "4px 10px", fontSize: F.xs, fontWeight: 700, color: C.indigo, boxShadow: "0 1px 4px rgba(0,0,0,0.12)", zIndex: 10 }}>
        {markerCount == null ? `${filtered.length}개 단지` : markerCount === filtered.length ? `${filtered.length}개 단지` : `${markerCount} / ${filtered.length}개 단지`}
      </div>
      {/* 선택된 아파트 정보 카드 */}
      <SelectedAptCard selected={selected} onInfoClick={handleInfoClick} onClose={() => setSelected(null)} />
    </div>
  );
});
