import { memo } from "react";
import { C, F } from "@/theme";
import { isFeatureUpcoming, isFeatureHome } from "@/constants/featureFlags";
import type { BottomNavProps } from "@/types/upcoming";

export const BottomNav = memo(function BottomNav({
  tab,
  adminLoggedIn,
  showComp,
  onNavClick,
  containerMaxWidth,
  isDesktop,
}: BottomNavProps) {
  if (isDesktop) return null;
  const upcomingEnabled = isFeatureUpcoming();
  const homeEnabled = isFeatureHome();
  // 세션 405: 네비 분기 축 = adminLoggedIn (구 expertLoggedIn = 토큰 보유 — 카카오 손님도 true 라
  // 전문가 네비가 오노출되던 quirk 해소). 카카오 손님 = 게스트 네비, 로그아웃은 InfoPage.
  const navItems = adminLoggedIn
    ? [
        ...(homeEnabled ? [{ l: "홈", k: "home" }] : []),
        { l: "관리자", k: "admin" },
        { l: "소비자뷰", k: "list" },
        { l: "지도", k: "map" },
        { l: "로그아웃", k: "logout" },
      ]
    : homeEnabled
      ? [
          // D4 확정: 홈·목록·지도·📅곧분양·정보 5탭. 비교 = 목록 안 버튼 / 상담 = 정보 페이지 진입
          { l: "홈", k: "home" },
          { l: "목록", k: "list" },
          { l: "지도", k: "map" },
          ...(upcomingEnabled ? [{ l: "📅 곧 분양", k: "upcoming" }] : []),
          { l: "정보", k: "info" },
        ]
      : [
          { l: "목록", k: "list" },
          { l: "지도", k: "map" },
          ...(upcomingEnabled ? [{ l: "📅 곧 분양", k: "upcoming" }] : []),
          { l: "비교", k: "compare" },
          { l: "상담", k: "consult" },
          { l: "정보", k: "info" },
        ];

  return (
    <nav
      aria-label="메인 내비게이션"
      data-no-print
      style={{
        position: "fixed",
        bottom: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: "100%",
        maxWidth: containerMaxWidth,
        background: adminLoggedIn ? C.indigoLight : C.white,
        borderTop: `1px solid ${adminLoggedIn ? C.indigo + "30" : C.border}`,
        padding: "8px 8px calc(8px + env(safe-area-inset-bottom, 0px)) 8px",
        display: "flex",
        justifyContent: "space-around",
        zIndex: 100,
        boxShadow: "0 -2px 10px rgba(0,0,0,0.05)",
        transition: "max-width .3s",
      }}
    >
      {navItems.map((n) => {
        const isActive =
          n.k === "compare" ? showComp && tab === "list" : tab === n.k && !(!homeEnabled && n.k === "list" && showComp);
        const activeColor = adminLoggedIn ? C.indigo : C.blue;
        return (
          <button
            key={n.k}
            aria-current={!["compare", "logout"].includes(n.k) && tab === n.k ? "page" : undefined}
            onClick={() => onNavClick(n.k)}
            style={{
              background: isActive ? (adminLoggedIn ? C.indigo + "14" : C.blueLight) : "transparent",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: isActive ? activeColor : C.muted,
              padding: "10px 14px",
              minHeight: 48,
              transition: "all .2s",
            }}
          >
            <span style={{ fontSize: F.base, fontWeight: isActive ? 800 : 600, letterSpacing: -0.2 }}>{n.l}</span>
          </button>
        );
      })}
    </nav>
  );
});
