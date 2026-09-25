import { useCallback, useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import type { UseAppNavigationArgs, UseAppNavigationReturn } from "@/types/hooks";

/**
 * 탭 전환/인증 네비게이션 훅
 * 세션 577(A-12): 상담 탭·정보 탭이 사라져 consult/budget ref·switchToInfo·handleConsultFromDetail 삭제.
 * "문의"(k="inquiry")는 탭이 아니라 문의 모달 열기(onOpenInquiry) — setTab 을 부르지 않는다.
 */
export function useAppNavigation({
  tab,
  setTab,
  auth,
  admin,
  compIds,
  setShowCompOpen,
  showToast,
  isLoggedIn,
  onLoginRequired,
  onOpenInquiry,
}: UseAppNavigationArgs): UseAppNavigationReturn {
  // ── 관리자 로그인 / 공용 로그아웃 (세션 405 — 비밀번호 로그인은 관리자 전용) ──
  const handleAdminLogin = useCallback(async () => {
    const result = await auth.handleLogin();
    if (result?.ok) {
      if (result.role === "admin") {
        localStorage.setItem("userRole", "admin");
        admin.setAdminLoggedIn(true);
        setTab("admin");
      } else {
        // 레거시 비admin 계정 과도기 — 일반 손님 취급 (PR-3 에서 백엔드가 401 로 차단). 착지 = 목록(세션 577)
        if (result.role) localStorage.setItem("userRole", result.role);
        setTab("list");
      }
    }
  }, [admin, auth, setTab]);

  const handleLogout = useCallback(() => {
    auth.handleLogout(() => {
      setTab("list");
      setShowCompOpen(false);
    });
  }, [auth, setShowCompOpen, setTab]);

  const handleNavClick = useCallback(
    (k: string) => {
      if (k === "logout") return handleLogout();
      trackEvent("tab_switch", { tab: k, previous_tab: tab });
      // 문의 = 모달 열기 — 탭은 그대로(aria-current 없음)
      if (k === "inquiry") {
        onOpenInquiry();
        return;
      }
      if (k === "list") {
        setTab("list");
        setShowCompOpen(false);
        return;
      }
      // 비로그인 시 map 차단 (compare는 비로그인 허용)
      if (!isLoggedIn && k === "map") {
        onLoginRequired?.();
        return;
      }
      if (k === "compare") {
        if (compIds.length < 2) {
          showToast("카드에서 2개 이상 선택해주세요");
          setTab("list");
          return;
        }
        setShowCompOpen(true);
        setTab("list");
        return;
      }
      setTab(k);
    },
    [compIds.length, handleLogout, isLoggedIn, onLoginRequired, onOpenInquiry, setShowCompOpen, setTab, showToast, tab]
  );

  // ── useEffect: verify 실패 시 admin 상태 동기화 ──
  useEffect(() => {
    if (!auth.loggedIn && admin.adminLoggedIn) {
      admin.setAdminLoggedIn(false);
      if (tab === "admin") setTab("list");
    }
  }, [admin, auth.loggedIn, setTab, tab]);

  return {
    handleAdminLogin,
    handleLogout,
    handleNavClick,
  };
}
