import { memo } from "react";
import { C, F } from "@/theme";
import { WidgetCard } from "./WidgetCard";

type MapEntryWidgetProps = { isLoggedIn: boolean; onExpand: () => void };

/**
 * 홈 지도 위젯 (M1) — 비로그인 = D5 잠금 placeholder / 로그인 = 지도 탭 진입 카드.
 * M2 에서 로그인 분기를 MapView 미니지도 임베드로 교체 (height/onSelect/compact prop 전제).
 * onExpand 는 반드시 handleNavClick("map") — 비로그인 게이트(useAppNavigation L68)가 자동 발화.
 */
export const MapEntryWidget = memo(function MapEntryWidget({ isLoggedIn, onExpand }: MapEntryWidgetProps) {
  return (
    <WidgetCard title="🗺 지도">
      {isLoggedIn ? (
        <>
          <div style={{ fontSize: F.sm, color: C.sub, lineHeight: 1.6 }}>
            전국 단지를 점수 색상 마커·클러스터·인프라 오버레이로 확인하세요.
          </div>
          <button onClick={onExpand} style={{ width: "100%", background: C.blue, border: "none", color: C.white, fontSize: F.base, fontWeight: 700, cursor: "pointer", padding: "12px", borderRadius: 8, minHeight: 44 }}>
            지도 열기
          </button>
        </>
      ) : (
        <button onClick={onExpand} aria-label="로그인하고 지도 열기" style={{ width: "100%", background: C.slate100, border: `1px dashed ${C.border}`, borderRadius: 8, padding: "24px 12px", cursor: "pointer", textAlign: "center", minHeight: 44 }}>
          <div style={{ fontSize: 28, marginBottom: 6 }} aria-hidden="true">🔒</div>
          <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 4 }}>로그인하면 지도가 열려요</div>
          <div style={{ fontSize: F.xs, color: C.muted }}>카카오 로그인 후 점수 지도를 이용할 수 있어요</div>
        </button>
      )}
    </WidgetCard>
  );
});
