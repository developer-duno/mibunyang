import { memo, useRef, useEffect, useState, useCallback } from "react";
import { C } from "@/theme";
import { gr } from "@/theme";

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

  // Kakao Maps SDK 로드 확인 + 지도 초기화
  useEffect(() => {
    if (!window.kakao?.maps) return;
    window.kakao.maps.load(() => {
      if (!mapRef.current || mapInstanceRef.current) return;
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
    return () => {
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
      const marker = new kakao.Marker({
        position: pos,
        title: apt.name,
        image: new kakao.MarkerImage(
          `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36"><path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.3 21.7 0 14 0z" fill="${grade.c}"/><circle cx="14" cy="13" r="9" fill="#fff"/><text x="14" y="17" text-anchor="middle" font-size="11" font-weight="700" fill="${grade.c}">${res.total}</text></svg>`)}`,
          new kakao.Size(28, 36),
          { offset: new kakao.Point(14, 36) }
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

  return (
    <div style={{ position: "relative", width: "100%", height: isPC ? "calc(100dvh - 180px)" : "calc(100dvh - 140px)", borderRadius: 10, overflow: "hidden", border: `1px solid ${C.border}` }}>
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
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
