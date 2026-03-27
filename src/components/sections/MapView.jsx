import { memo, useRef, useEffect, useState, useCallback } from "react";
import { C } from "@/theme";
import { gr } from "@/theme";
import { InfraOverlay } from "./InfraOverlay";

const KAKAO_MAP_KEY = import.meta.env.VITE_KAKAO_JS_KEY || "";

/** 만원 → 짧은 가격 문자열 (마커용) */
function shortPrice(v) {
  if (v == null || v <= 0) return "";
  const eok = v / 10000;
  return eok >= 1 ? `${eok % 1 === 0 ? eok : eok.toFixed(1)}억` : `${v.toLocaleString()}만`;
}

/** Kakao Maps SDK를 동적 로드 (환경변수 기반, index.html 하드코딩 제거) */
function loadKakaoMapSdk() {
  return new Promise((resolve, reject) => {
    if (window.kakao?.maps) { resolve(); return; }
    if (!KAKAO_MAP_KEY) { reject(new Error("VITE_KAKAO_JS_KEY 미설정")); return; }
    const existing = document.querySelector("script[src*='dapi.kakao.com/v2/maps']");
    if (existing) { existing.addEventListener("load", () => resolve()); return; }
    const s = document.createElement("script");
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(KAKAO_MAP_KEY)}&libraries=clusterer,services&autoload=false`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Kakao Maps SDK 로드 실패"));
    document.head.appendChild(s);
  });
}

/**
 * MapView — Kakao Map 기반 아파트 지도 뷰
 * Props:
 *   filtered: Array<{apt, res}> — 필터링된 아파트 목록
 *   onDetail: (id) => void — 상세 모달 열기
 *   isPC: boolean
 */
export const MapView = memo(function MapView({ filtered, onDetail, isPC }) {
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
            center: new window.kakao.maps.LatLng(36.5, 127.5),
            level: 13,
          });
          map.addControl(new window.kakao.maps.ZoomControl(), window.kakao.maps.ControlPosition.RIGHT);
          mapInstanceRef.current = map;
          clustererRef.current = new window.kakao.maps.MarkerClusterer({
            map,
            averageCenter: true,
            minLevel: 5,
            disableClickZoom: false,
            gridSize: 60,
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
      const pLabel = shortPrice(apt.price);
      const w = pLabel ? 52 : 28;
      const h = pLabel ? 44 : 36;
      const svg = pLabel
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="34" rx="6" fill="${grade.c}"/><polygon points="${w / 2 - 5},34 ${w / 2},${h} ${w / 2 + 5},34" fill="${grade.c}"/><text x="${w / 2}" y="14" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" dy="0.35em">${res.total}점</text><text x="${w / 2}" y="27" text-anchor="middle" font-size="9" font-weight="600" fill="rgba(255,255,255,0.85)" dy="0.35em">${pLabel}</text></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36"><path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.3 21.7 0 14 0z" fill="${grade.c}"/><circle cx="14" cy="13" r="9" fill="#fff"/><text x="14" y="17" text-anchor="middle" font-size="11" font-weight="700" fill="${grade.c}">${res.total}</text></svg>`;
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

    // 마커가 있으면 범위에 맞게 지도 조정
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
        mapInstanceRef.current.setLevel(6);
      },
      () => { /* 권한 거부 시 조용히 무시 */ },
      { enableHighAccuracy: false, timeout: 5000 },
    );
  }, [ready]);

  return (
    <div style={{ position: "relative", width: "100%", height: isPC ? "calc(100dvh - 180px)" : "calc(100dvh - 140px)", borderRadius: 10, overflow: "hidden", border: `1px solid ${C.border}` }}>
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
      {error && (
        <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.9)", zIndex: 20 }}>
          <div style={{ textAlign: "center", color: C.muted, fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🗺️</div>
            <div>지도를 불러올 수 없습니다</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>{error}</div>
          </div>
        </div>
      )}
      {/* 인프라 오버레이 토글 */}
      <InfraOverlay mapInstance={mapInstanceRef.current} ready={ready} />
      {/* 현위치 버튼 */}
      {ready && navigator.geolocation && (
        <button onClick={handleMyLocation} aria-label="현위치" style={{ position: "absolute", bottom: 16, right: 12, width: 36, height: 36, borderRadius: "50%", background: C.white, border: `1px solid ${C.border}`, boxShadow: "0 1px 4px rgba(0,0,0,0.15)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10, fontSize: 16 }}>
          📍
        </button>
      )}
      {/* 필터 결과 수 오버레이 */}
      <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(255,255,255,0.92)", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, color: C.indigo, boxShadow: "0 1px 4px rgba(0,0,0,0.12)", zIndex: 10 }}>
        {markerCount == null ? `${filtered.length}개 단지` : markerCount === filtered.length ? `${filtered.length}개 단지` : `${markerCount} / ${filtered.length}개 단지`}
      </div>
      {/* 선택된 아파트 정보 카드 */}
      {selected && (
        <div style={{ position: "absolute", bottom: 12, left: 12, right: 12, background: C.white, borderRadius: 10, padding: "10px 12px", boxShadow: "0 2px 12px rgba(0,0,0,0.15)", zIndex: 10, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selected.apt.name}</div>
            <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>
              {[selected.apt.region, selected.apt.gu].filter(Boolean).join(" ")} · {selected.apt.price ? `${(selected.apt.price / 10000).toFixed(1)}억` : "가격 미정"}
            </div>
          </div>
          <div style={{ textAlign: "center", flexShrink: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: gr(selected.res.total).c }}>{selected.res.total}</div>
            <div style={{ fontSize: 9, color: C.muted }}>종합점수</div>
          </div>
          <button onClick={handleInfoClick} style={{ flexShrink: 0, padding: "8px 12px", fontSize: 11, fontWeight: 700, background: C.indigo, color: C.white, border: "none", borderRadius: 6, cursor: "pointer" }}>상세</button>
          <button onClick={() => setSelected(null)} style={{ position: "absolute", top: 6, right: 8, background: "none", border: "none", fontSize: 14, color: C.muted, cursor: "pointer" }}>✕</button>
        </div>
      )}
    </div>
  );
});
