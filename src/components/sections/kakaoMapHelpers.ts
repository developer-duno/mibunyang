// Kakao Maps 지도 뷰 헬퍼 — 마커 SVG 빌더 + SDK 동적 로더 + 상수
// MapView.tsx 전용. 외부 컴포넌트 사용 0.

export const KAKAO_MAP_KEY: string = import.meta.env.VITE_KAKAO_JS_KEY || "";

export const MAP_DEFAULTS = { lat: 36.5, lng: 127.5, level: 13 } as const;
export const CLUSTER_OPTS = { minLevel: 5, gridSize: 60 } as const;
export const MARKER_WITH_PRICE = { w: 52, h: 44 } as const;
export const MARKER_NO_PRICE = { w: 28, h: 36 } as const;
export const MY_LOC_LEVEL = 6;
export const GEO_TIMEOUT = 5000;

/** 만원 → 짧은 가격 문자열 (마커용) */
export function shortPrice(v: number | null | undefined): string {
  if (v == null || v <= 0) return "";
  const eok = v / 10000;
  return eok >= 1 ? `${eok % 1 === 0 ? eok : eok.toFixed(1)}억` : `${v.toLocaleString()}만`;
}

export interface MarkerSvg {
  w: number;
  h: number;
  svg: string;
}

/** 마커 SVG 빌더 — 가격 있으면 배지형, 없으면 핀형 */
export function buildMarkerSvg(total: number, gradeColor: string, priceLabel: string): MarkerSvg {
  if (priceLabel) {
    const { w, h } = MARKER_WITH_PRICE;
    return { w, h, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="34" rx="6" fill="${gradeColor}"/><polygon points="${w / 2 - 5},34 ${w / 2},${h} ${w / 2 + 5},34" fill="${gradeColor}"/><text x="${w / 2}" y="14" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" dy="0.35em">${total}점</text><text x="${w / 2}" y="27" text-anchor="middle" font-size="9" font-weight="600" fill="rgba(255,255,255,0.85)" dy="0.35em">${priceLabel}</text></svg>` };
  }
  const { w, h } = MARKER_NO_PRICE;
  return { w, h, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.3 21.7 0 14 0z" fill="${gradeColor}"/><circle cx="14" cy="13" r="9" fill="#fff"/><text x="14" y="17" text-anchor="middle" font-size="11" font-weight="700" fill="${gradeColor}">${total}</text></svg>` };
}

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
    if (w.kakao?.maps) { resolve(); return; }
    if (!KAKAO_MAP_KEY) { reject(new Error("VITE_KAKAO_JS_KEY 미설정")); return; }
    const existing = document.querySelector("script[src*='dapi.kakao.com/v2/maps']");
    if (existing) {
      if (w.kakao?.maps?.load) { resolve(); return; }
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
