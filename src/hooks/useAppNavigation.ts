import { useCallback, useRef, useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import { isFeatureHome } from "@/constants/featureFlags";
import type { UseAppNavigationArgs, UseAppNavigationReturn } from "@/types/hooks";

/**
 * 탭 전환/인증 네비게이션 훅
 * useCallback 7개 + useRef 2개 + useEffect 2개
 */
export function useAppNavigation({
  tab, setTab, auth, admin, consult, detail,
  compIds, setShowCompOpen, showToast,
  budgetMin, budgetMax, isLoggedIn, onLoginRequired,
}: UseAppNavigationArgs): UseAppNavigationReturn {
  // ── useRef (stale closure 방지) ──
  const consultRef = useRef(consult);
  const budgetRef = useRef({ budgetMin, budgetMax });
  useEffect(() => {
    consultRef.current = consult;
  }, [consult]);
  useEffect(() => {
    budgetRef.current = { budgetMin, budgetMax };
  }, [budgetMin, budgetMax]);

  // ── 관리자 로그인 / 공용 로그아웃 (세션 405 — 비밀번호 로그인은 관리자 전용) ──
  const handleAdminLogin = useCallback(async () => {
    const result = await auth.handleLogin();
    if (result?.ok) {
      if (result.role === "admin") {
        localStorage.setItem("userRole", "admin");
        admin.setAdminLoggedIn(true);
        setTab("admin");
      } else {
        // 레거시 비admin 계정 과도기 — 일반 손님 취급 (PR-3 에서 백엔드가 401 로 차단)
        if (result.role) localStorage.setItem("userRole", result.role);
        setTab(isFeatureHome() ? "home" : "list");
      }
    }
  }, [admin, auth, setTab]);

  const handleLogout = useCallback(() => {
    auth.handleLogout(() => { setTab("list"); setShowCompOpen(false); });
  }, [auth, setShowCompOpen, setTab]);

  // ── 탭 전환 ──
  const switchToInfo = useCallback(() => setTab("info"), [setTab]);

  const handleConsultFromDetail = useCallback((aptId: string) => {
    consult.setConsultForm(prev => ({
      ...prev,
      interestedApts: prev.interestedApts.includes(aptId) ? prev.interestedApts : [...prev.interestedApts, aptId],
    }));
    detail.setDetailAptId(null);
    setTab("consult");
  }, [consult, detail, setTab]);

  const handleNavClick = useCallback((k: string) => {
    if (k === "logout") return handleLogout();
    trackEvent("tab_switch", { tab: k, previous_tab: tab });
    if (k === "list") { setTab("list"); setShowCompOpen(false); return; }
    // 비로그인 시 map 차단 (compare는 비로그인 허용)
    if (!isLoggedIn && k === "map") { onLoginRequired?.(); return; }
    if (k === "compare") {
      if (compIds.length < 2) { showToast("카드에서 2개 이상 선택해주세요"); setTab("list"); return; }
      setShowCompOpen(true); setTab("list"); return;
    }
    if (k === "consult") {
      const c = consultRef.current;
      const b = budgetRef.current;
      if (c.consultSubmitted) {
        c.setConsultSubmitted(false);
        c.setConsultForm({ name: "", phone: "", interestedApts: [], budgetMin: "", budgetMax: "", consultType: "방문상담", message: "", consent: false });
      } else {
        c.setConsultForm(prev => ({
          ...prev,
          budgetMin: prev.budgetMin || (b.budgetMin ? String(Number(b.budgetMin) * 10000) : ""),
          budgetMax: prev.budgetMax || (b.budgetMax ? String(Number(b.budgetMax) * 10000) : ""),
        }));
      }
    }
    setTab(k);
  }, [compIds.length, handleLogout, isLoggedIn, onLoginRequired, setShowCompOpen, setTab, showToast, tab]);

  // ── useEffect: verify 실패 시 admin 상태 동기화 ──
  useEffect(() => {
    if (!auth.loggedIn && admin.adminLoggedIn) {
      admin.setAdminLoggedIn(false);
      if (tab === "admin") setTab("list");
    }
  }, [admin, auth.loggedIn, setTab, tab]);

  return {
    handleAdminLogin, handleLogout,
    switchToInfo,
    handleConsultFromDetail,
    handleNavClick,
  };
}
