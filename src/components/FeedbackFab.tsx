import { memo } from "react";
import { C, F } from "@/theme";

type FeedbackFabProps = {
  onClick: () => void;
  /** 데스크톱(≥1024)은 하단 메뉴가 없어 바닥 24px, 그 밖은 하단 메뉴(64px) 위 12px */
  isDesktop: boolean;
  /**
   * 휴대폰(<768)에서 상세 모달이 열려 있다 — 모달 하단 고정 버튼 묶음(상담하기 + 관심·비교·공유 줄) 위로 올린다.
   * App 이 `detailAptId && !isPC` 로 넘긴다(PC 는 모달이 가운데 떠 있어 겹치지 않음 — 실측 오른쪽 24·바닥 24).
   */
  detailOpen?: boolean;
};

/** 하단 메뉴(BottomNav) 높이 = 위아래 여백 8+8 + 버튼 48 — 토스트도 같은 76px(=64+12)을 쓴다 */
const NAV_CLEARANCE = 76;
/**
 * 휴대폰 상세 모달의 하단 CTA 바(DetailModal.tsx `data-testid="detail-cta-bar"`) 높이 + 12px.
 * 바 = 윗선 1 + 위 여백 10 + "이 매물 상담하기" 44 + 간격 8 + 관심·비교·공유 줄 44 + 아래 여백 12 = 119px
 * (+ 안전 영역). 실측(iPhone 13, 390×664): 상담하기 버튼 위끝 y=556 → 바닥에서 108 + 여백 10 + 선 1 = 119 로 일치.
 * DetailModal 의 그 바 패딩·버튼 높이를 바꾸면 이 값도 함께 바꾼다.
 */
const DETAIL_CTA_CLEARANCE = 119 + 12;

/**
 * 떠 있는 "의견" 버튼 (세션574) — 오른쪽 아래.
 * z-index 310 = 상세 모달(300) 위, 의견 폼(340)·공유 시트(350)·로그인 모달(9999)·토스트(400) 아래.
 * 관리자 대시보드·지도 탭에서는 App 이 렌더하지 않는다(지도 탭은 현위치·선택 단지 카드와 겹침 — 사장님 결정).
 */
export const FeedbackFab = memo(function FeedbackFab({ onClick, isDesktop, detailOpen }: FeedbackFabProps) {
  const bottom = isDesktop ? 24 : detailOpen ? DETAIL_CTA_CLEARANCE : NAV_CLEARANCE;
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
        bottom: isDesktop ? bottom : `calc(${bottom}px + env(safe-area-inset-bottom, 0px))`,
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
