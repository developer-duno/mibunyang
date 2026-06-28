// 지도 공용 presentational 조각 (세션 448) — KakaoMapView 의 화면 껍데기 추출(세션 448 당시엔
// NaverMapView 와 공유했고 세션 449 네이버 제거 후 KakaoMapView 단독 소비). SDK 로직(마커·강조·
// 클러스터·줌·choropleth)은 컴포넌트에 그대로 남김. 순수 표현계층이라 동작 보존.

import { memo, forwardRef } from "react";
import type { ReactNode } from "react";
import { C, F } from "@/theme";

/**
 * 현위치 버튼 (📍) — 두 지도의 동일 style 버튼을 1곳으로. 렌더 가드(!compact && ready && geolocation)는
 * 컴포넌트별 상태라 호출처에 그대로 남기고, 버튼 자체만 이 컴포넌트로 교체한다.
 */
export const MyLocationButton = memo(function MyLocationButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="현위치"
      style={{
        position: "absolute",
        bottom: 16,
        right: 12,
        width: 36,
        height: 36,
        borderRadius: "50%",
        background: C.white,
        border: `1px solid ${C.border}`,
        boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
        fontSize: F.lg,
      }}
    >
      📍
    </button>
  );
});

interface MapShellProps {
  isPC?: boolean;
  isDesktop?: boolean;
  /** 루트 높이 오버라이드 — 미전달 시 뷰포트 기준 3분기 calc (두 지도 동일) */
  height?: string;
  /** 전체화면 — 테두리·라운드 제거 (높이 calc 는 불변) */
  fullscreen?: boolean;
  /** SDK 로드 실패 메시지 — truthy 면 에러 오버레이 표시 */
  error: string | null;
  /** mapRef 가 부착될 지도 div 뒤에 오는 컴포넌트별 고유 children (현위치/badge/색칠/오버레이/선택카드) */
  children: ReactNode;
}

/**
 * 지도 루트 컨테이너 + 지도 div + 에러 오버레이 — 두 지도의 return 최외곽이 100% 동일해 추출.
 * mapRef 를 forwardRef 로 받아 내부 지도 div 에 부착한다(두 컴포넌트 모두 `useRef<HTMLDivElement>` → ref=).
 * memo 래핑 안 함(forwardRef 만) — render 트리를 기존과 동일하게 유지(테스트 container.firstChild 가정 보존).
 */
export const MapShell = forwardRef<HTMLDivElement, MapShellProps>(function MapShell(
  { isPC, isDesktop, height, fullscreen, error, children },
  mapRef
) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        // 높이는 두 지도 공통 3분기 calc 유지 — 헤더+필터바+BottomNav 반영 검증값(세션 413~417). 전체화면도
        // 같은 calc(필터바가 지도 위 그대로 차지). 매직넘버 높이 재계산은 잘림 위험이라 calc 불변.
        height: height ?? (isDesktop ? "calc(100dvh - 120px)" : isPC ? "calc(100dvh - 180px)" : "calc(100dvh - 140px)"),
        borderRadius: fullscreen ? 0 : isDesktop ? 12 : 10,
        overflow: "hidden",
        border: fullscreen ? "none" : `1px solid ${C.border}`,
      }}
    >
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
      {error && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255,255,255,0.9)",
            zIndex: 20,
          }}
        >
          <div style={{ textAlign: "center", color: C.muted, fontSize: F.base }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🗺️</div>
            <div>지도를 불러올 수 없습니다</div>
            <div style={{ fontSize: F.xs, marginTop: 4 }}>{error}</div>
          </div>
        </div>
      )}
      {children}
    </div>
  );
});
