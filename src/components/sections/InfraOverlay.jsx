import { memo, useState, useEffect, useRef, useCallback } from "react";
import { C } from "@/theme";

/**
 * 인프라 카테고리 정의
 * code: Kakao Places 카테고리 그룹 코드
 * emoji: 마커 아이콘
 */
const INFRA_CATEGORIES = [
  { key: "subway", label: "지하철", code: "SW8", emoji: "🚇" },
  { key: "hospital", label: "병원", code: "HP8", emoji: "🏥" },
  { key: "mart", label: "마트", code: "MT1", emoji: "🛒" },
  { key: "school", label: "학교", code: "SC4", emoji: "🏫" },
];

/**
 * InfraOverlay — 지도 위 인프라 마커 토글
 * Props:
 *   mapInstance: kakao.maps.Map 인스턴스
 *   ready: boolean — 지도 준비 여부
 */
export const InfraOverlay = memo(function InfraOverlay({ mapInstance, ready }) {
  const [active, setActive] = useState(null); // 현재 활성 카테고리 key (null = 없음)
  const markersRef = useRef([]);
  const searchDebounceRef = useRef(null);

  // 카테고리 마커 검색 + 표시
  const searchAndShow = useCallback((categoryCode, emoji) => {
    if (!mapInstance || !window.kakao?.maps?.services) return;
    // 기존 마커 제거
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    const kakao = window.kakao.maps;
    const ps = new kakao.services.Places();
    const center = mapInstance.getCenter();

    ps.categorySearch(categoryCode, (data, status) => {
      if (status !== kakao.services.Status.OK) return;
      const newMarkers = data.map(place => {
        const svgIcon = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="13" fill="#fff" stroke="${C.indigo}" stroke-width="2"/><text x="14" y="15" text-anchor="middle" font-size="14" dy="0.35em">${emoji}</text></svg>`)}`;
        const marker = new kakao.Marker({
          position: new kakao.LatLng(place.y, place.x),
          title: place.place_name,
          image: new kakao.MarkerImage(svgIcon, new kakao.Size(28, 28), { offset: new kakao.Point(14, 14) }),
          zIndex: 5,
        });
        marker.setMap(mapInstance);
        return marker;
      });
      markersRef.current = newMarkers;
    }, { location: center, radius: 3000, size: 15, sort: kakao.services.SortBy.DISTANCE });
  }, [mapInstance]);

  // 활성 카테고리 변경 시 검색
  useEffect(() => {
    if (!ready || !active) {
      markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];
      return;
    }
    const cat = INFRA_CATEGORIES.find(c => c.key === active);
    if (!cat) return;
    searchAndShow(cat.code, cat.emoji);

    // 지도 이동 시 debounce로 재검색
    if (!mapInstance) return;
    const kakao = window.kakao.maps;
    const listener = kakao.event.addListener(mapInstance, "idle", () => {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => searchAndShow(cat.code, cat.emoji), 500);
    });
    return () => {
      kakao.event.removeListener(listener);
      clearTimeout(searchDebounceRef.current);
      markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];
    };
  }, [ready, active, mapInstance, searchAndShow]);

  const toggle = useCallback((key) => {
    setActive(prev => prev === key ? null : key);
  }, []);

  return (
    <div style={{ position: "absolute", top: 8, right: 8, display: "flex", flexDirection: "column", gap: 4, zIndex: 10 }}>
      {INFRA_CATEGORIES.map(cat => (
        <button
          key={cat.key}
          onClick={() => toggle(cat.key)}
          aria-pressed={active === cat.key}
          title={cat.label}
          style={{
            width: 36, height: 36, borderRadius: 8,
            background: active === cat.key ? C.indigo : C.white,
            color: active === cat.key ? C.white : C.text,
            border: `1px solid ${active === cat.key ? C.indigo : C.border}`,
            boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
            cursor: "pointer", fontSize: 16,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {cat.emoji}
        </button>
      ))}
    </div>
  );
});
