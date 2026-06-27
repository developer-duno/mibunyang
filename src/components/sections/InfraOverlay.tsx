import { memo, useState, useEffect, useRef, useCallback } from "react";
import { C, F } from "@/theme";
import { getKakaoMaps } from "./kakaoMapHelpers";
import { INFRA_CATEGORIES } from "./infraCategories";

const INFRA_MAX_RESULTS = 15;
const INFRA_DEBOUNCE_MS = 500;

type InfraOverlayProps = {
  mapInstance: unknown;
  ready: boolean;
  /** 선택된 단지 좌표 — 있으면 이 단지 기준, 없으면 화면 중앙(getCenter) 기준 (세션 448) */
  selectedApt?: { lat: number | null; lng: number | null } | null;
};

/**
 * InfraOverlay — 지도 위 인프라 마커 토글 (세션 448: 8 카테고리 + 단지 기준 검색)
 * Props:
 *   mapInstance: kakao.maps.Map 인스턴스
 *   ready: boolean — 지도 준비 여부
 *   selectedApt: 선택 단지 좌표(우선 기준점). null/좌표없음이면 화면 중앙 폴백
 *
 * 카카오 Places categorySearch 실시간. 우리 DB엔 주변시설 좌표 미저장이라 실시간만 가능(실측 확정).
 * 카테고리 정의는 infraCategories.ts 단일 출처. 마커는 독립 레이어(KakaoMapView 마커 effect 무관).
 */
export const InfraOverlay = memo(function InfraOverlay({ mapInstance, ready, selectedApt }: InfraOverlayProps) {
  const [active, setActive] = useState<string | null>(null);
  const markersRef = useRef<any[]>([]);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 검색 기준점: 선택 단지 좌표 우선, 없으면 화면 중앙(getCenter) 폴백
  const getSearchCenter = useCallback(() => {
    const kakao = getKakaoMaps();
    if (!kakao) return null;
    if (selectedApt && selectedApt.lat != null && selectedApt.lng != null) {
      return new kakao.LatLng(selectedApt.lat, selectedApt.lng);
    }
    if (!mapInstance) return null;
    return (mapInstance as any).getCenter();
  }, [mapInstance, selectedApt]);

  // 카테고리 마커 검색 + 표시
  const searchAndShow = useCallback((categoryCode: string, emoji: string, radius: number) => {
    const kakao = getKakaoMaps();
    if (!mapInstance || !kakao?.services) return;
    // 기존 마커 제거
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    const center = getSearchCenter();
    if (!center) return;

    const ps = new kakao.services.Places();
    ps.categorySearch(categoryCode, (data: any[], status: string) => {
      if (status !== kakao.services.Status.OK) return;
      const newMarkers = data.map((place: any) => {
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
    }, { location: center, radius, size: INFRA_MAX_RESULTS, sort: kakao.services.SortBy.DISTANCE });
  }, [mapInstance, getSearchCenter]);

  // 활성 카테고리 또는 선택 단지 변경 시 검색
  useEffect(() => {
    if (!ready || !active) {
      markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];
      return;
    }
    const cat = INFRA_CATEGORIES.find(c => c.key === active);
    if (!cat) return;
    searchAndShow(cat.code, cat.emoji, cat.radius);

    // 지도 이동 시 debounce로 재검색
    if (!mapInstance) return;
    const kakao = getKakaoMaps();
    if (!kakao) return;
    // 핸들러를 변수로 — removeListener 는 (target, type, handler) 3인자(카카오 공식). addListener 반환값을
    // 넘기면 production 카카오에서 크래시(Cannot read 'removeListener' of undefined). KakaoMapView 답습.
    const onIdle = () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => searchAndShow(cat.code, cat.emoji, cat.radius), INFRA_DEBOUNCE_MS);
    };
    kakao.event.addListener(mapInstance, "idle", onIdle);
    return () => {
      kakao.event.removeListener?.(mapInstance, "idle", onIdle);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];
    };
  }, [ready, active, mapInstance, searchAndShow, selectedApt?.lat, selectedApt?.lng]);

  const toggle = useCallback((key: string) => {
    setActive(prev => prev === key ? null : key);
  }, []);

  return (
    <div style={{ position: "absolute", top: 8, right: 8, display: "flex", flexDirection: "column", gap: 4, zIndex: 10 }}>
      {INFRA_CATEGORIES.map(cat => (
        <button
          key={cat.key}
          type="button"
          onClick={() => toggle(cat.key)}
          aria-pressed={active === cat.key}
          title={cat.label}
          style={{
            width: 36, height: 36, borderRadius: 8,
            background: active === cat.key ? C.indigo : C.white,
            color: active === cat.key ? C.white : C.text,
            border: `1px solid ${active === cat.key ? C.indigo : C.border}`,
            boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
            cursor: "pointer", fontSize: F.lg,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {cat.emoji}
        </button>
      ))}
    </div>
  );
});
