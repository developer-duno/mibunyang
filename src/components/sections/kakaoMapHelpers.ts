// Kakao Maps 지도 뷰 헬퍼 — 마커 SVG 빌더 + SDK 동적 로더 + 상수
// MapView.tsx 전용. 외부 컴포넌트 사용 0.

export const KAKAO_MAP_KEY: string = import.meta.env.VITE_KAKAO_JS_KEY || "";

export const MAP_DEFAULTS = { lat: 36.5, lng: 127.5, level: 13 } as const;
export const CLUSTER_OPTS = { minLevel: 5, gridSize: 60 } as const;
export const MY_LOC_LEVEL = 6;
export const GEO_TIMEOUT = 5000;

// 마커 SVG 빌더·가격 포맷·크기 상수는 markerSvg.ts(순수 모듈, import.meta.env 0)로 분리(세션 416).

/**
 * Kakao Maps SDK 표면 타입. 외부 SDK 라 정밀 타입 정의 불가 —
 * 생성자/메서드를 느슨하게 선언해 `(window as any)` 캐스트를 이 파일 1곳에 격리.
 * 생성자 인자는 `...args: any[]` — 타입 격리 목적이지 호출부 인자 강제 narrow 가 아님.
 */
export interface KakaoMaps {
  Map: new (..._args: any[]) => any;
  LatLng: new (..._args: any[]) => any;
  LatLngBounds: new (..._args: any[]) => any;
  Marker: new (..._args: any[]) => any;
  MarkerImage: new (..._args: any[]) => any;
  MarkerClusterer: new (..._args: any[]) => any;
  Polygon: new (..._args: any[]) => any;
  Size: new (..._args: any[]) => any;
  Point: new (..._args: any[]) => any;
  ZoomControl: new (..._args: any[]) => any;
  ControlPosition: { RIGHT: number };
  event: {
    // addListener/removeListener 는 kakao 버전마다 인자 수가 다르다 → rest 파라미터.
    // removeListener 는 일부 버전 미지원이라 옵셔널(?:).
    addListener: (..._args: unknown[]) => unknown;
    removeListener?: (..._args: unknown[]) => void;
  };
  services: {
    Places: new (..._args: any[]) => any;
    Status: { OK: string };
    SortBy: { DISTANCE: string };
  };
  load: (_callback: () => void) => void;
}

/** window.kakao.maps 를 타입 안전하게 반환. SDK 미로드 시 null. */
export function getKakaoMaps(): KakaoMaps | null {
  const k = (window as unknown as { kakao?: { maps?: KakaoMaps } }).kakao;
  return k?.maps ?? null;
}

/** Kakao Maps SDK를 동적 로드 (환경변수 기반, index.html 하드코딩 제거) */
export function loadKakaoMapSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as Window & { kakao?: { maps?: { load?: unknown } } };
    if (w.kakao?.maps) {
      resolve();
      return;
    }
    if (!KAKAO_MAP_KEY) {
      reject(new Error("VITE_KAKAO_JS_KEY 미설정"));
      return;
    }
    const existing = document.querySelector("script[src*='dapi.kakao.com/v2/maps']");
    if (existing) {
      if (w.kakao?.maps?.load) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Kakao Maps SDK 로드 실패")));
      return;
    }
    const s = document.createElement("script");
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(KAKAO_MAP_KEY)}&libraries=clusterer,services&autoload=false`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Kakao Maps SDK 로드 실패"));
    document.head.appendChild(s);
  });
}
