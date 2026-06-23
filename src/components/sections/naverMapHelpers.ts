// Naver Maps 지도 뷰 헬퍼 — SDK 동적 로더 + 상수 (세션 435).
// NaverMapView.tsx 전용. 점 보기 지도만 네이버 지원(색칠·인프라는 카카오 고정).
// 카카오와 좌표/줌 방향이 다름: 네이버 zoom 은 클수록 확대(카카오 level 은 클수록 축소).

export const NAVER_MAP_KEY: string = import.meta.env.VITE_NAVER_MAP_CLIENT_ID || "";

// 네이버 zoom 기준 상수 (카카오 level 과 방향 반대 — 별도 정의).
// 전국 진입 zoom≈7, 시/도 클로즈업≈10, 구/군≈12, 현위치≈14. 카카오 level(13/8/4/6)과 의미 동일·값 반대.
export const NAVER_MAP_DEFAULTS = { lat: 36.5, lng: 127.5, zoom: 7 } as const;
export const NAVER_REGION_FIT_MAX_ZOOM = 12; // 시/도 fit 시 과도 확대 상한(카카오 REGION_FIT_MIN_LEVEL 대응)
export const NAVER_GU_FIT_MAX_ZOOM = 14;     // 구/군 fit 시 상한(카카오 GU_FIT_MIN_LEVEL 대응)
export const NAVER_MY_LOC_ZOOM = 15;         // 현위치 zoom(카카오 MY_LOC_LEVEL 대응)

/**
 * Naver Maps SDK 표면 타입. 외부 SDK 라 느슨하게 선언해 `(window as any)` 캐스트를 이 파일 1곳에 격리.
 * 카카오와 달리 클러스터러는 SDK 내장 아님(MarkerClustering.js 별도) — 1차는 개별 마커라 미포함.
 */
export interface NaverMaps {
  Map: new (..._args: any[]) => any;
  LatLng: new (..._args: any[]) => any;
  LatLngBounds: new (..._args: any[]) => any;
  Marker: new (..._args: any[]) => any;
  Point: new (..._args: any[]) => any;
  Size: new (..._args: any[]) => any;
  Event: {
    addListener: (..._args: unknown[]) => unknown;
    removeListener?: (..._args: unknown[]) => void;
  };
  Position?: Record<string, unknown>;
}

/** window.naver.maps 를 타입 안전하게 반환. SDK 미로드 시 null. */
export function getNaverMaps(): NaverMaps | null {
  const n = (window as unknown as { naver?: { maps?: NaverMaps } }).naver;
  return n?.maps ?? null;
}

/**
 * Naver Maps SDK를 동적 로드 (환경변수 기반). 카카오와 달리 load() 콜백 없이 script onload 시 즉시 사용 가능.
 * 키 미설정 시 reject — 호출처(NaverMapView)가 에러 표시 + 토글은 키 없으면 숨김(MapView 가드).
 */
export function loadNaverMapSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (getNaverMaps()) { resolve(); return; }
    if (!NAVER_MAP_KEY) { reject(new Error("VITE_NAVER_MAP_CLIENT_ID 미설정")); return; }
    const existing = document.querySelector("script[src*='oapi.map.naver.com/openapi/v3/maps']");
    if (existing) {
      if (getNaverMaps()) { resolve(); return; }
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Naver Maps SDK 로드 실패")));
      return;
    }
    const s = document.createElement("script");
    s.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(NAVER_MAP_KEY)}`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Naver Maps SDK 로드 실패"));
    document.head.appendChild(s);
  });
}
