import { memo } from "react";
import { C } from "@/theme";

/**
 * BottomNav - 하단 내비게이션 바
 * Props:
 *   tab: string - 현재 활성 탭
 *   expertLoggedIn: boolean - 전문가 로그인 상태
 *   showComp: boolean - 비교 시트 표시 여부
 *   onNavClick: (key: string) => void - 네비 버튼 클릭 핸들러
 *   containerMaxWidth: number - 컨테이너 최대 너비
 */
export const BottomNav = memo(function BottomNav({ tab, expertLoggedIn, showComp, onNavClick, containerMaxWidth }) {
  const navItems = expertLoggedIn
    ? [{ l: "대시보드", k: "expert" }, { l: "상담목록", k: "expertConsults" }, { l: "소비자뷰", k: "list" }, { l: "로그아웃", k: "logout" }]
    : [{ l: "목록", k: "list" }, { l: "지도", k: "map" }, { l: "비교", k: "compare" }, { l: "상담", k: "consult" }, { l: "정보", k: "info" }];

  return (
    <nav aria-label="메인 내비게이션" data-no-print style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: containerMaxWidth, background: expertLoggedIn ? C.indigoLight : C.white, borderTop: `1px solid ${expertLoggedIn ? C.indigo + "30" : C.border}`, padding: "8px 8px calc(8px + env(safe-area-inset-bottom, 0px)) 8px", display: "flex", justifyContent: "space-around", zIndex: 100, boxShadow: "0 -2px 10px rgba(0,0,0,0.05)", transition: "max-width .3s" }}>
      {navItems.map(n => {
        const isActive = n.k === "compare" ? (showComp && tab === "list") : (tab === n.k && !(n.k === "list" && showComp));
        const activeColor = expertLoggedIn ? C.indigo : C.blue;
        return (
          <button key={n.k} aria-current={(!["compare", "logout"].includes(n.k) && tab === n.k) ? "page" : undefined} onClick={() => onNavClick(n.k)} style={{
            background: isActive ? (expertLoggedIn ? C.indigo + "14" : C.blueLight) : "transparent",
            border: "none", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            color: isActive ? activeColor : C.muted, padding: "10px 14px", minHeight: 48, transition: "all .2s"
          }}>
            <span style={{ fontSize: 13, fontWeight: isActive ? 800 : 600, letterSpacing: -0.2 }}>{n.l}</span>
          </button>
        );
      })}
    </nav>
  );
});
