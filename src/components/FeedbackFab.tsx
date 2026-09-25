import { memo } from "react";
import { C, F } from "@/theme";

type FeedbackFabProps = {
  onClick: () => void;
  /** 데스크톱(≥1024)은 하단 메뉴가 없어 바닥 24px, 그 밖은 하단 메뉴(64px) 위 12px */
  isDesktop: boolean;
  /** 지도 탭 — 지도 오른쪽 아래 "현위치" 버튼(36px, 바닥 16px)을 가리지 않게 그만큼 위로 */
  liftForMap?: boolean;
};

/** 하단 메뉴(BottomNav) 높이 = 위아래 여백 8+8 + 버튼 48 — 토스트도 같은 76px(=64+12)을 쓴다 */
const NAV_CLEARANCE = 76;
const MAP_BUTTON_CLEARANCE = 52; // 현위치 버튼 36 + 간격 16

/**
 * 떠 있는 "의견" 버튼 (세션574) — 모든 화면 오른쪽 아래.
 * z-index 310 = 상세 모달(300) 위, 의견 폼(340)·공유 시트(350)·로그인 모달(9999)·토스트(400) 아래.
 * 관리자 대시보드에서는 App 이 렌더하지 않는다.
 */
export const FeedbackFab = memo(function FeedbackFab({ onClick, isDesktop, liftForMap }: FeedbackFabProps) {
  const base = isDesktop ? 24 : NAV_CLEARANCE;
  const lift = liftForMap ? MAP_BUTTON_CLEARANCE : 0;
  return (
    <button
      type="button"
      data-testid="feedback-fab"
      data-no-print
      aria-label="의견 보내기"
      title="의견 보내기"
      onClick={onClick}
      style={{
        position: "fixed",
        right: isDesktop ? 24 : 16,
        bottom: isDesktop ? base + lift : `calc(${base + lift}px + env(safe-area-inset-bottom, 0px))`,
        zIndex: 310,
        width: 52,
        height: 52,
        borderRadius: "50%",
        border: "none",
        background: C.indigo,
        color: C.white,
        boxShadow: "0 4px 14px rgba(0,0,0,0.22)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        padding: 0,
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <span style={{ fontSize: F.micro, fontWeight: 700, lineHeight: 1 }}>의견</span>
    </button>
  );
});
