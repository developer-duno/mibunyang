import { memo } from "react";
import { KakaoMapView } from "./KakaoMapView";
import type { MapViewProps } from "@/types/components/MapView.types";

/**
 * MapView — 지도 provider 라우터 (세션 435).
 *
 * 점 보기(단지 마커) 지도를 카카오/네이버 중 선택해 렌더. 색칠(choropleth)·인프라 오버레이는
 * 카카오 고정이라 KakaoMapView 안에 그대로 남아 있다(네이버 v3는 폴리곤·로컬검색 API 차이가 커
 * 1차 범위 밖, 사장님 결정 2026-06-23).
 *
 * 현 단계(PR1)는 분리만 — provider 'kakao' 고정 패스스루로 동작 0 변화(기존 MapView.test 40건 무수정 green).
 * 네이버 분기·전환 토글은 PR2, GPS 내 동네 자동 표시는 PR3 에서 추가.
 */
export const MapView = memo(function MapView(props: MapViewProps) {
  return <KakaoMapView {...props} />;
});
