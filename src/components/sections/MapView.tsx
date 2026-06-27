import { memo } from "react";
import { KakaoMapView } from "./KakaoMapView";
import type { MapViewProps } from "@/types/components/MapView.types";

/**
 * MapView — 카카오 지도 패스스루 (세션 449, 네이버 제거 후 단일화).
 *
 * 세션 435~448 동안 네이버/카카오 provider 토글이 있었으나, 네이버 v3 POI API 부재로
 * 구조적 열위 + 유지비용(두 SDK·줌 좌표계 반대·버그 표면 2배) > 가치로 판단되어 제거.
 * 이 파일은 App·MapEntryWidget 의 import 경로(@/components/sections/MapView)와
 * 번들 async 청크 분리, MapView.test.jsx(카카오 패스스루 검증)를 보존하기 위해 남긴다.
 */
export const MapView = memo(function MapView(props: MapViewProps) {
  return <KakaoMapView {...props} />;
});
