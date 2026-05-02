// App.jsx — useDataPipeline + useAppNavigation 추출로 520줄 → ~250줄
import { useState, useEffect, useCallback, useTransition, lazy, Suspense } from "react";
import { PROFILES } from "@/constants/profiles";
import { C } from "@/theme";

const CompareSheet = lazy(() => import("@/components/CompareSheet").then(m => ({ default: m.CompareSheet })));
const DetailModal = lazy(() => import("@/components/DetailModal").then(m => ({ default: m.DetailModal })));
const ConsultForm = lazy(() => import("@/components/ConsultForm").then(m => ({ default: m.ConsultForm })));
const ExpertDashboard = lazy(() => import("@/components/expert/ExpertDashboard").then(m => ({ default: m.ExpertDashboard })));
const AdminDashboard = lazy(() => import("@/components/admin/AdminDashboard").then(m => ({ default: m.AdminDashboard })));
const MapView = lazy(() => import("@/components/sections/MapView").then(m => ({ default: m.MapView })));
const UpcomingPage = lazy(() => import("@/components/UpcomingPage").then(m => ({ default: m.UpcomingPage })));
import { useToast } from "@/hooks/useToast";
import { useFilterSort } from "@/hooks/useFilterSort";
import { useComparison, MAX_COMPARE } from "@/hooks/useComparison";
import { useFavorites } from "@/hooks/useFavorites";
import { useDetailModal } from "@/hooks/useDetailModal";
import { useConsult } from "@/hooks/useConsult";
import { useExpertMode } from "@/hooks/useExpertMode";
import { useAdminMode } from "@/hooks/useAdminMode";
import { useApartmentData } from "@/hooks/useApartmentData";
import { useShare } from "@/hooks/useShare";
import { useResponsive } from "@/hooks/useResponsive";
import { useDataPipeline, VISIBLE_PAGE_SIZE } from "@/hooks/useDataPipeline";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { useKakaoAuth } from "@/hooks/useKakaoAuth";
import { useLoginGate } from "@/hooks/useLoginGate";
import { useShareCallbacks } from "@/hooks/useShareCallbacks";
import { useKakaoCallbackEffect } from "@/hooks/useKakaoCallbackEffect";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

import { ShareSheet } from "@/components/ShareSheet";
import { LoginPromptModal } from "@/components/LoginPromptModal";
import { InfoPage } from "@/components/sections/InfoPage";
import { BottomNav } from "@/components/sections/BottomNav";
import { HeaderSection } from "@/components/sections/HeaderSection";
import { ExpertLoginForm } from "@/components/sections/ExpertLoginForm";
import { SearchFilterBar } from "@/components/sections/SearchFilterBar";
import { AptListSection } from "@/components/sections/AptListSection";
import { trackEvent } from "@/lib/analytics";

export default function App() {
  // ── useState + useTransition ──
  const [profile, setProfileRaw] = useState(() => {
    try { const v = localStorage.getItem("mibunyang_profile"); return v && PROFILES[v] ? v : "live"; } catch { return "live"; }
  });
  const [isPending, startTransition] = useTransition();
  const setProfile = useCallback((k) => { startTransition(() => setProfileRaw(k)); try { localStorage.setItem("mibunyang_profile", k); } catch { /* noop: localStorage 쿼터/접근 실패 무시 */ } trackEvent("profile_change", { profile: k }); }, [startTransition]);
  const [customWeights, setCustomWeights] = useState(() => {
    try { const v = localStorage.getItem("mibunyang_customWeights"); return v ? JSON.parse(v) : {}; } catch { return {}; }
  });
  const saveCustomWeights = useCallback((cw) => {
    setCustomWeights(cw);
    try { localStorage.setItem("mibunyang_customWeights", JSON.stringify(cw)); } catch { /* noop: localStorage 쿼터/접근 실패 무시 */ }
  }, []);
  const [hideNoUnsold, setHideNoUnsold] = useState(true);
  const toggleHideNoUnsold = useCallback(() => setHideNoUnsold(v => !v), []);
  const [tab, setTab] = useState(() => {
    if (window.location.pathname.startsWith("/oauth/kakao/callback")) return "kakaoCallback";
    if (window.location.pathname.startsWith("/upcoming")) {
      // Feature Flag OFF 시 메인으로 fallback (URL도 /로 정리)
      if (import.meta.env.VITE_FEATURE_UPCOMING !== "true") {
        try { window.history.replaceState(null, "", "/"); } catch { /* noop */ }
        return "list";
      }
      return "upcoming";
    }
    // 8e2b5b7 이전 sessionStorage 잔재 자동 마이그레이션 (1회성)
    let token = localStorage.getItem("expertToken");
    let role = localStorage.getItem("userRole");
    if (!token) {
      try {
        const sToken = sessionStorage.getItem("expertToken");
        const sRole = sessionStorage.getItem("userRole");
        if (sToken) {
          localStorage.setItem("expertToken", sToken);
          if (sRole) localStorage.setItem("userRole", sRole);
          sessionStorage.removeItem("expertToken");
          sessionStorage.removeItem("userRole");
          token = sToken;
          role = sRole;
        }
      } catch { /* storage 접근 실패 시 무시 */ }
    }
    if (!token) return "list";
    if (role === "admin") return "admin";
    if (role === "expert") return "expert";
    return "list";
  });
  // ── 커스텀 훅 13개 ──
  const { isPC, isDesktop } = useResponsive();
  const { toast, showToast } = useToast();
  const { favoriteIds, favoriteSet, setFavoriteIds, toggleFavorite } = useFavorites(showToast);
  const detail = useDetailModal(tab);
  const closeDetail = useCallback(() => detail.setDetailAptId(null), [detail]);
  const { filterRegion, filterGu, sortKey, setSortKey, handleRegionChange, handleGuChange, budgetMin, handleBudgetMinChange, budgetMax, handleBudgetMaxChange, handleBudgetReset, showFavOnly, toggleFavOnly, areaMin, handleAreaMinChange, areaMax, handleAreaMaxChange, unitsMin, handleUnitsMinChange, unitsMax, handleUnitsMaxChange, handleAreaUnitsReset, moveInFilter, handleMoveInChange, minScore, handleMinScoreChange, builderTier, handleBuilderTierChange, benefitOnly, toggleBenefitOnly, getShareURL, handleResetAll, applyPreset, customPresets, saveCustomPreset, deleteCustomPreset, filterHistory, applyHistory, clearHistory, undo, redo, canUndo, canRedo, isSortPending } = useFilterSort({ onFilterChange: closeDetail });
  const { compIds, setCompIds, showComp, showCompOpen, setShowCompOpen, toggleComp } = useComparison(showToast);
  const consult = useConsult(showToast, favoriteIds);
  const expert = useExpertMode(showToast);
  const kakao = useKakaoAuth(showToast);
  const admin = useAdminMode(showToast);

  // 로그인 여부 파생 (카카오 또는 전문가)
  const isLoggedIn = expert.expertLoggedIn;
  const { apartments, loading: dataLoading, error: dataError, retry: retryData, dataUpdatedAt } = useApartmentData();
  const { openShareSheet, closeShareSheet, shareKakao, shareSMS, shareCopy, shareSheetOpen, isMobile } = useShare(showToast);

  // ── 데이터 파이프라인 ──
  const {
    guOptions, scored, filtered, visible,
    visibleCount, setVisibleCount,
    scoredMap, compItems, pw,
    activeFilterCount, regionOptions, filterOptionCounts, dataFreshnessText,
    isFilterPending,
  } = useDataPipeline({
    apartments, profile, customWeights,
    filterRegion, filterGu, sortKey, moveInFilter, builderTier,
    showFavOnly, favoriteSet, budgetMin, budgetMax,
    areaMin, areaMax, unitsMin, unitsMax, minScore, benefitOnly,
    hideNoUnsold, compIds, dataUpdatedAt,
  });

  // ── 비로그인 게이트 (LoginPromptModal 관련 3 state + 3 핸들러) ──
  const {
    showLoginPrompt, setShowLoginPrompt,
    loginTrigger, setLoginTrigger,
    handleDetailGated, handleKakaoFromPrompt, handleExpertFromPrompt,
  } = useLoginGate({ isLoggedIn, detail, kakao, setTab });

  // ── 탭 전환/인증 네비게이션 ──
  const {
    handleExpertLogin,
    switchToAdmin, switchToExpert, switchToInfo,
    handleExpertView, handleConsultFromDetail,
    handleNavClick,
  } = useAppNavigation({
    tab, setTab, expert, admin, consult, detail,
    compIds, setShowCompOpen, showToast,
    budgetMin, budgetMax, isLoggedIn, onLoginRequired: () => { setLoginTrigger("map"); setShowLoginPrompt(true); },
  });

  // ── 카카오 OAuth 콜백 useEffect ──
  useKakaoCallbackEffect({ tab, kakao, expert, admin, detail, setTab, showToast });

  // ── containerMaxWidth ──
  const containerMaxWidth = (expert.expertLoggedIn && (tab === "expert" || tab === "expertConsults")) || (admin.adminLoggedIn && tab === "admin") ? 1200 : isDesktop ? 1200 : isPC ? 960 : 520;

  // ── 공유 콜백 3종 (scoredMapRef 내부 관리) ──
  const { handleShareDetail, handleShareCompare, handleShareFilters } = useShareCallbacks({
    scoredMap, profile, compIds, compItems, openShareSheet, getShareURL,
    filterRegion, budgetMin, budgetMax, areaMin, areaMax,
    unitsMin, unitsMax, moveInFilter, minScore, builderTier, benefitOnly,
  });

  // ── 데스크톱 키보드 단축키 ──
  useKeyboardShortcuts({ isDesktop, setProfile, canUndo, canRedo, undo, redo, detail });

  // ── 독립 useEffect: print CSS ──
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "print-styles";
    style.textContent = `@media print { nav[aria-label] { display: none !important; } [data-no-print] { display: none !important; } [data-sidebar] { display: none !important; } [data-print-content] { flex: none !important; width: 100% !important; overflow: visible !important; height: auto !important; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }`;
    document.head.appendChild(style);
    return () => { const el = document.getElementById("print-styles"); if (el) el.remove(); };
  }, []);

  // ── 독립 useEffect: tab="upcoming" ↔ URL "/upcoming" 동기화 ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onUpcomingPath = window.location.pathname.startsWith("/upcoming");
    if (tab === "upcoming" && !onUpcomingPath) {
      try { window.history.pushState(null, "", "/upcoming"); } catch { /* noop */ }
    } else if (tab !== "upcoming" && onUpcomingPath) {
      try { window.history.pushState(null, "", "/"); } catch { /* noop */ }
    }
  }, [tab]);

  // ── 독립 useEffect: URL 딥링크 복원 ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const detailId = params.get("detail");
    const compareStr = params.get("compare");
    const profileParam = params.get("profile");
    if (profileParam && PROFILES[profileParam]) setProfile(profileParam);
    if (detailId) detail.setDetailAptId(detailId);
    if (compareStr) {
      const ids = compareStr.split(",").filter(Boolean).slice(0, MAX_COMPARE);
      if (ids.length >= 2) { setCompIds(ids); setShowCompOpen(true); }
    }
    if (detailId || compareStr) {
      const cleanParams = new URLSearchParams(window.location.search);
      cleanParams.delete("detail");
      cleanParams.delete("compare");
      const remaining = cleanParams.toString();
      try { window.history.replaceState(null, "", remaining ? `?${remaining}` : window.location.pathname); } catch { /* noop: history.replaceState 미지원 환경 무시 */ }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 독립 useEffect: dedup 후 무효 ID 정리 ──
  useEffect(() => {
    if (dataLoading || dataError || !apartments.length) return;
    const validIds = new Set(apartments.map(a => a.id));
    setFavoriteIds(ids => {
      const next = ids.filter(id => validIds.has(id));
      if (next.length === ids.length) return ids;
      if (ids.length - next.length > 0) showToast(`데이터 변경으로 관심매물 ${ids.length - next.length}개가 정리되었습니다`);
      return next;
    });
    setCompIds(ids => {
      const next = ids.filter(id => validIds.has(id));
      return next.length === ids.length ? ids : next;
    });
  }, [apartments, dataLoading, dataError, setFavoriteIds, setCompIds, showToast]);

  // ── JSX ──
  return (
    <div style={{ background: isDesktop ? C.white : C.bg, minHeight: "100dvh", maxWidth: containerMaxWidth, margin: "0 auto", fontFamily: "'Pretendard Variable','Noto Sans KR',-apple-system,BlinkMacSystemFont,sans-serif", fontSize: isDesktop ? 14 : 13, color: C.text, paddingBottom: isDesktop ? 24 : 70, paddingTop: isDesktop ? 64 : 0, transition: "max-width .3s" }}>

      <HeaderSection profile={profile} onProfileChange={setProfile} apartmentCount={apartments.length}
        isDesktop={isDesktop} tab={tab} onNavClick={handleNavClick} showComp={showComp} compCount={compIds.length} expertLoggedIn={expert.expertLoggedIn} containerMaxWidth={containerMaxWidth} />

      {dataLoading && (
        <div style={{ textAlign: "center", padding: "6px", fontSize: 11, color: C.muted }}>
          데이터 로딩 중...
        </div>
      )}
      {dataError && (
        <div style={{ textAlign: "center", padding: "8px 16px", fontSize: 12, color: "#991B1B", background: "#FEF2F2", borderRadius: 8, margin: "8px 16px 0" }}>
          데이터 로딩 실패: {dataError}
          <button onClick={retryData} style={{ marginLeft: 8, padding: "4px 12px", fontSize: 11, fontWeight: 700, color: C.white, background: C.blue, border: "none", borderRadius: 4, cursor: "pointer" }}>다시 시도</button>
        </div>
      )}

      {(tab === "list" || tab === "map") && (
        <div style={{ padding: isDesktop ? "0 24px" : "0 16px" }}>
          <SearchFilterBar
            filterRegion={filterRegion} onRegionChange={handleRegionChange} regionOptions={regionOptions}
            filterGu={filterGu} onGuChange={handleGuChange} guOptions={guOptions}
            budgetMin={budgetMin} onBudgetMinChange={handleBudgetMinChange} budgetMax={budgetMax} onBudgetMaxChange={handleBudgetMaxChange} onBudgetReset={handleBudgetReset}
            sortKey={sortKey} onSortChange={setSortKey}
            isDesktop={isDesktop}
            showFavOnly={showFavOnly} onToggleFavOnly={toggleFavOnly} favCount={favoriteIds.length}
            areaMin={areaMin} onAreaMinChange={handleAreaMinChange} areaMax={areaMax} onAreaMaxChange={handleAreaMaxChange}
            unitsMin={unitsMin} onUnitsMinChange={handleUnitsMinChange} unitsMax={unitsMax} onUnitsMaxChange={handleUnitsMaxChange} onAreaUnitsReset={handleAreaUnitsReset}
            moveInFilter={moveInFilter} onMoveInChange={handleMoveInChange}
            minScore={minScore} onMinScoreChange={handleMinScoreChange}
            builderTier={builderTier} onBuilderTierChange={handleBuilderTierChange}
            benefitOnly={benefitOnly} onToggleBenefitOnly={toggleBenefitOnly}
            hideNoUnsold={hideNoUnsold} onToggleHideNoUnsold={toggleHideNoUnsold}
            activeFilterCount={activeFilterCount}
            filteredLength={filtered.length} scoredLength={scored.length}
            onShareFilters={handleShareFilters}
            onResetAll={handleResetAll}
            onApplyPreset={applyPreset}
            customPresets={customPresets} onSavePreset={saveCustomPreset} onDeletePreset={deleteCustomPreset}
            filterHistory={filterHistory} onApplyHistory={applyHistory} onClearHistory={clearHistory}
            onUndo={undo} onRedo={redo} canUndo={canUndo} canRedo={canRedo}
            filterOptionCounts={filterOptionCounts}
            showToast={showToast}
          />
        </div>
      )}

      {tab === "list" ? (
        <div style={{ padding: isDesktop ? "0 24px" : "0 16px" }}>
          {compIds.length >= 2 && (
            <button onClick={() => { const wasOpen = showComp; setShowCompOpen(!showCompOpen); if (wasOpen) window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{
              width: "100%", background: showComp ? C.indigo : "transparent", color: showComp ? C.white : C.indigo,
              border: `1.5px solid ${C.indigo}`, borderRadius: 8, padding: "12px", fontSize: 13, fontWeight: 700,
              cursor: "pointer", marginBottom: 10, transition: "all .2s"
            }}>{compIds.length}개 비교 {showComp ? "닫기" : "보기"}</button>
          )}
          {showComp && <Suspense fallback={<div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, animation: "skeleton-pulse 1.5s ease-in-out infinite" }}><div style={{ height: 16, width: "40%", background: C.slate100, borderRadius: 4, marginBottom: 16 }} /><div style={{ height: 120, background: C.slate100, borderRadius: 4 }} /></div>}><CompareSheet items={compItems} onShare={handleShareCompare} onClose={() => setShowCompOpen(false)} profile={profile} isDesktop={isDesktop} isLoggedIn={isLoggedIn} /></Suspense>}
          <AptListSection key={filterRegion}
            visible={visible} filteredLength={filtered.length} visibleCount={visibleCount} onLoadMore={() => { setVisibleCount(v => v + VISIBLE_PAGE_SIZE); trackEvent("load_more", { visible_count: visibleCount + VISIBLE_PAGE_SIZE }); }}
            onDetail={handleDetailGated} onFav={toggleFavorite} onComp={toggleComp} favoriteSet={favoriteSet} compIds={compIds}
            pw={pw} profile={profile} isPC={isPC} isDesktop={isDesktop} isPending={isPending || isFilterPending || isSortPending}
            budgetMin={budgetMin} budgetMax={budgetMax} filterRegion={filterRegion}
            moveInFilter={moveInFilter} builderTier={builderTier} minScore={minScore}
            onResetBudget={handleBudgetReset} onResetRegion={() => handleRegionChange("전체")}
            dataLoading={dataLoading} dataFreshnessText={dataFreshnessText}
            onExpertView={expert.expertLoggedIn ? handleExpertView : undefined}
            onResetAll={handleResetAll}
            isLoggedIn={isLoggedIn}
          />
        </div>
      ) : tab === "map" ? (
        <div style={{ padding: isDesktop ? "0 24px" : "0 16px" }}>
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", fontSize: 13, color: C.muted }}>지도 로딩 중...</div>}>
            <MapView filtered={filtered} onDetail={detail.handleOpenDetail} isPC={isPC} isDesktop={isDesktop} />
          </Suspense>
        </div>
      ) : tab === "info" ? (
        <InfoPage expertLoggedIn={expert.expertLoggedIn} onExpertLoginClick={() => setTab("expertLogin")} />
      ) : tab === "consult" ? (
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", fontSize: 13, color: C.muted }}>로딩 중...</div>}>
            <ConsultForm scored={scored} favoriteIds={favoriteIds} setFavoriteIds={setFavoriteIds} form={consult.consultForm} setForm={consult.setConsultForm}
              onSubmit={consult.handleConsultSubmit} submitted={consult.consultSubmitted} showToast={showToast} />
          </Suspense>
        </div>
      ) : tab === "expertLogin" ? (
        <ExpertLoginForm expert={expert} onLogin={handleExpertLogin} onBack={() => setTab("info")} onKakaoLogin={() => kakao.initKakaoLogin()} kakaoLoading={kakao.kakaoLoading} />
      ) : tab === "expert" ? (
        <Suspense fallback={<div style={{ padding: 40, textAlign: "center", fontSize: 13, color: C.muted }}>대시보드 로딩 중...</div>}>
          <ExpertDashboard scored={scored} profile={profile} setProfile={setProfile}
            expandedApt={expert.expertExpandedApt} setExpandedApt={expert.setExpertExpandedApt}
            onSwitchToAdmin={admin.adminLoggedIn ? switchToAdmin : undefined} />
        </Suspense>
      ) : tab === "admin" ? (
        admin.adminLoggedIn ? (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", fontSize: 13, color: C.muted }}>관리자 패널 로딩 중...</div>}>
            <AdminDashboard admin={admin} onLogout={switchToInfo} onSwitchToExpert={switchToExpert} profile={profile} setProfile={setProfile} customWeights={customWeights} saveCustomWeights={saveCustomWeights} scored={scored} showToast={showToast} />
          </Suspense>
        ) : null
      ) : tab === "upcoming" ? (
        <Suspense fallback={<div style={{ padding: 40, textAlign: "center", fontSize: 13, color: C.muted }}>분양예정 페이지 로딩 중...</div>}>
          <UpcomingPage
            onOpenDetail={detail.handleOpenDetail}
            onBackToMain={() => { setTab("list"); try { window.history.pushState(null, "", "/"); } catch { /* noop */ } }}
          />
        </Suspense>
      ) : tab === "kakaoCallback" ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "40dvh" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 8 }}>카카오 로그인 처리 중...</div>
            <div style={{ fontSize: 12, color: C.muted }}>잠시만 기다려주세요</div>
          </div>
        </div>
      ) : tab === "expertConsults" ? (
        <div style={{ padding: "0 16px" }}>
          <div style={{ background: C.indigoLight, borderRadius: 8, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.indigo }}>상담 요청 목록</span>
            <span style={{ fontSize: 11, color: C.indigo }}>{consult.submittedConsults.length}건</span>
          </div>

          {consult.submittedConsults.length === 0 ? (
            <div style={{ background: C.card, borderRadius: 12, padding: "40px 20px", border: `1px solid ${C.border}`, textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>아직 상담 요청이 없습니다</div>
              <div style={{ fontSize: 12, color: C.muted }}>소비자가 상담을 신청하면 여기에 표시됩니다</div>
            </div>
          ) : (
            consult.submittedConsults.map((c) => {
              const aptNames = c.interestedApts.map(id => { const found = apartments.find(a => a.id === id); return found ? found.name : id; });
              return (
                <div key={c.id} style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: 14, marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{c.name}</span>
                    <span style={{ fontSize: 10, color: C.muted }}>{new Date(c.submittedAt).toLocaleString("ko-KR")}</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.sub, lineHeight: 1.8 }}>
                    <div>연락처: {c.phone}</div>
                    <div>상담유형: {c.consultType}</div>
                    <div>관심단지: {aptNames.join(", ")}</div>
                    {(c.budgetMin || c.budgetMax) && <div>예산: {c.budgetMin || "?"} ~ {c.budgetMax || "?"}만원</div>}
                    {c.message && <div>메시지: {c.message}</div>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : null}

      {/* 상세 분석 모달 */}
      {detail.detailAptId && (() => {
        const item = scored.find(x => x.apt.id === detail.detailAptId);
        if (!item) return null;
        return <Suspense fallback={<div style={{ position: "fixed", top: 0, right: 0, bottom: 0, left: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ background: C.card, borderRadius: 16, padding: 32, width: isDesktop ? 760 : "90%", maxHeight: "80vh", animation: "skeleton-pulse 1.5s ease-in-out infinite" }}><div style={{ height: 20, width: "50%", background: C.slate100, borderRadius: 4, marginBottom: 16 }} /><div style={{ height: 14, width: "70%", background: C.slate100, borderRadius: 4, marginBottom: 12 }} /><div style={{ height: 200, background: C.slate100, borderRadius: 8 }} /></div></div>}><DetailModal item={item} onClose={detail.handleCloseDetail}
          isComp={compIds.includes(detail.detailAptId)} onComp={toggleComp}
          isFav={favoriteSet.has(detail.detailAptId)} onFav={toggleFavorite}
          onShare={handleShareDetail} isPC={isPC} isDesktop={isDesktop}
          onConsult={handleConsultFromDetail} /></Suspense>;
      })()}

      {/* 로그인 유도 모달 */}
      <LoginPromptModal open={showLoginPrompt} onClose={() => { setShowLoginPrompt(false); setLoginTrigger(null); }}
        onKakaoLogin={handleKakaoFromPrompt} onExpertLogin={handleExpertFromPrompt} kakaoLoading={kakao.kakaoLoading} trigger={loginTrigger} />

      {/* 토스트 */}
      <ShareSheet open={shareSheetOpen} onKakao={shareKakao} onSMS={shareSMS} onCopy={shareCopy} onClose={closeShareSheet} isMobile={isMobile} isPC={isPC} />

      {toast && (
        <div role="status" aria-live="polite" data-no-print style={{ position: "fixed", bottom: isDesktop ? "24px" : "calc(76px + env(safe-area-inset-bottom, 0px))", left: "50%", transform: "translateX(-50%)", background: C.text, color: C.white, padding: "12px 24px", borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 400, boxShadow: "0 4px 16px rgba(0,0,0,0.25)", whiteSpace: "nowrap" }}>{toast}</div>
      )}

      {/* 사업자 정보 */}
      <footer data-no-print style={{ textAlign: "center", padding: isDesktop ? "16px 12px 24px" : "16px 12px 72px", fontSize: 9, color: C.muted, lineHeight: 1.6, letterSpacing: -0.2 }}>
        이로움기획 | 대표 김상원 | 사업자등록번호 267-02-01775<br />
        대전광역시 유성구 구암동 606-11 201호
      </footer>

      {/* 하단 네비 */}
      <BottomNav tab={tab} expertLoggedIn={expert.expertLoggedIn} showComp={showComp} onNavClick={handleNavClick} containerMaxWidth={containerMaxWidth} isDesktop={isDesktop} />
    </div>
  );
}
