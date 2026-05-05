import { useCallback, useRef, useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import type { UseAppNavigationArgs, UseAppNavigationReturn } from "@/types/hooks";
import type { Apt } from "@/types/scoring";

/**
 * 탭 전환/인증 네비게이션 훅
 * useCallback 7개 + useRef 2개 + useEffect 2개
 */
export function useAppNavigation({
  tab, setTab, expert, admin, consult, detail,
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

  // ── 전문가 로그인/로그아웃 ──
  const handleExpertLogin = useCallback(async () => {
    const result = await expert.handleExpertLogin();
    if (result?.ok) {
      if (result.role === "admin") {
        localStorage.setItem("userRole", "admin");
        admin.setAdminLoggedIn(true);
        setTab("admin");
      } else {
        localStorage.setItem("userRole", "expert");
        setTab("expert");
      }
    }
  }, [admin, expert, setTab]);

  const handleExpertLogout = useCallback(() => {
    expert.handleExpertLogout(() => { setTab("list"); setShowCompOpen(false); });
  }, [expert, setShowCompOpen, setTab]);

  // ── 탭 전환 ──
  const switchToAdmin = useCallback(() => setTab("admin"), [setTab]);
  const switchToExpert = useCallback(() => setTab("expert"), [setTab]);
  const switchToInfo = useCallback(() => setTab("info"), [setTab]);

  const handleExpertView = useCallback((apt: Apt) => {
    expert.setExpertExpandedApt(apt.id ?? null);
    setTab("expert");
  }, [expert, setTab]);

  const handleConsultFromDetail = useCallback((aptId: string) => {
    consult.setConsultForm(prev => ({
      ...prev,
      interestedApts: prev.interestedApts.includes(aptId) ? prev.interestedApts : [...prev.interestedApts, aptId],
    }));
    detail.setDetailAptId(null);
    setTab("consult");
  }, [consult, detail, setTab]);

  const handleNavClick = useCallback((k: string) => {
    if (k === "logout") return handleExpertLogout();
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
        c.setConsultForm({ name: "", phone: "", interestedApts: [], budgetMin: "", budgetMax: "", consultType: "방문상담", message: "" });
      } else {
        c.setConsultForm(prev => ({
          ...prev,
          budgetMin: prev.budgetMin || (b.budgetMin ? String(Number(b.budgetMin) * 10000) : ""),
          budgetMax: prev.budgetMax || (b.budgetMax ? String(Number(b.budgetMax) * 10000) : ""),
        }));
      }
    }
    setTab(k);
  }, [compIds.length, handleExpertLogout, isLoggedIn, onLoginRequired, setShowCompOpen, setTab, showToast, tab]);

  // ── useEffect: verify 실패 시 admin 상태 동기화 ──
  useEffect(() => {
    if (!expert.expertLoggedIn && admin.adminLoggedIn) {
      admin.setAdminLoggedIn(false);
      if (tab === "admin" || tab === "expert") setTab("list");
    }
  }, [admin, expert.expertLoggedIn, setTab, tab]);

  // ── useEffect: 전문가 로그인 시 상담 목록 서버 조회 ──
  useEffect(() => {
    if (expert.expertLoggedIn && tab === "expertConsults") {
      const token = localStorage.getItem("expertToken");
      if (token) consult.fetchConsults(token);
    }
  }, [consult, expert.expertLoggedIn, tab]);

  return {
    handleExpertLogin, handleExpertLogout,
    switchToAdmin, switchToExpert, switchToInfo,
    handleExpertView, handleConsultFromDetail,
    handleNavClick,
  };
}
