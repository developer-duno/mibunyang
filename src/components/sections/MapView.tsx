import { memo, useState, useCallback } from "react";
import { C, F } from "@/theme";
import { KakaoMapView } from "./KakaoMapView";
import { NaverMapView } from "./NaverMapView";
import { NAVER_MAP_KEY } from "./naverMapHelpers";
import type { MapViewProps } from "@/types/components/MapView.types";

type Provider = "kakao" | "naver";
const PROVIDER_KEY = "mibunyang_mapProvider";

function readProvider(): Provider {
  try {
    const v = localStorage.getItem(PROVIDER_KEY);
    return v === "naver" ? "naver" : "kakao"; // 기본 kakao (기존 손님 영향 0)
  } catch { return "kakao"; }
}

/**
 * MapView — 지도 provider 라우터 (세션 435).
 *
 * 점 보기(단지 마커) 지도를 카카오/네이버 중 선택해 렌더 + 손님 전환 토글. 색칠(choropleth)·인프라
 * 오버레이는 카카오 고정(네이버 v3는 폴리곤·로컬검색 API 차이가 커 1차 범위 밖, 사장님 결정 2026-06-23)
 * 이라 KakaoMapView 안에만 있다 → 네이버 선택 시 점 보기만 제공.
 *
 * 토글 노출 조건: 네이버 키 설정됨 + !compact(위젯 미니지도 제외) + !fullscreen 무관(노출).
 * 기본 provider 'kakao' → 기존 카카오 테스트·동작 무손상(회귀 0). 전환 시 컴포넌트 교체(key 로 재마운트).
 */
export const MapView = memo(function MapView(props: MapViewProps) {
  const [provider, setProvider] = useState<Provider>(readProvider);
  const hasNaverKey = !!NAVER_MAP_KEY;
  const showToggle = hasNaverKey && !props.compact;

  const toggle = useCallback((next: Provider) => {
    setProvider(next);
    try { localStorage.setItem(PROVIDER_KEY, next); } catch { /* noop */ }
  }, []);

  // 네이버 키 미설정이면 무조건 카카오(가드) — 토글도 숨김.
  const active: Provider = hasNaverKey ? provider : "kakao";

  const mapEl = active === "naver" ? <NaverMapView {...props} /> : <KakaoMapView {...props} />;

  // 토글 없으면(키 미설정·위젯) 래퍼 없이 그대로 — 기존 테스트의 container.firstChild(지도 루트 div) 가정 보존.
  if (!showToggle) return mapEl;

  return (
    <div style={{ position: "relative" }}>
      {mapEl}
      {showToggle && (
        <div role="group" aria-label="지도 종류 선택" style={{ position: "absolute", top: 8, right: props.compact ? 8 : 48, display: "flex", gap: 0, zIndex: 11, background: "rgba(255,255,255,0.92)", borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}>
          {(["kakao", "naver"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => toggle(p)}
              aria-pressed={active === p ? "true" : "false"}
              style={{
                border: "none",
                background: active === p ? C.indigo : "transparent",
                color: active === p ? C.white : C.indigo,
                padding: "4px 10px",
                fontSize: F.xs,
                fontWeight: 700,
                cursor: "pointer",
                minHeight: 28,
              }}
            >
              {p === "kakao" ? "카카오" : "네이버"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
