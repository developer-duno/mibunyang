// App.jsx — useDataPipeline + useAppNavigation 추출로 520줄 → ~250줄
import { useState, useMemo, useEffect, useCallback, useRef, useTransition, lazy, Suspense } from "react";
import { PROFILES } from "@/constants/profiles";
import { fmtPrice } from "@/lib/format";
import { C } from "@/theme";

const CompareSheet = lazy(() => import("@/components/CompareSheet").then(m => ({ default: m.CompareSheet })));
const DetailModal = lazy(() => import("@/components/DetailModal").then(m => ({ default: m.DetailModal })));
const ConsultForm = lazy(() => import("@/components/ConsultForm").then(m => ({ default: m.ConsultForm })));
const ExpertDashboard = lazy(() => import("@/components/expert/ExpertDashboard").then(m => ({ default: m.ExpertDashboard })));
const AdminDashboard = lazy(() => import("@/components/admin/AdminDashboard").then(m => ({ default: m.AdminDashboard })));
const MapView = lazy(() => import("@/components/sections/MapView").then(m => ({ default: m.MapView })));
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

import { ShareSheet } from "@/components/ShareSheet";
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
  const setProfile = useCallback((k) => { startTransition(() => setProfileRaw(k)); try { localStorage.setItem("mibunyang_profile", k); } catch {} trackEvent("profile_change", { profile: k }); }, [startTransition]);
  const [customWeights, setCustomWeights] = useState(() => {
    try { const v = localStorage.getItem("mibunyang_customWeights"); return v ? JSON.parse(v) : {}; } catch { return {}; }
  });
  const saveCustomWeights = useCallback((cw) => {
    setCustomWeights(cw);
    try { localStorage.setItem("mibunyang_customWeights", JSON.stringify(cw)); } catch {}
  }, []);
  const [hideNoUnsold, setHideNoUnsold] = useState(true);
  const toggleHideNoUnsold = useCallback(() => setHideNoUnsold(v => !v), []);
  const [tab, setTab] = useState(() => {
    if (!sessionStorage.getItem("expertToken")) return "list";
    return sessionStorage.getItem("userRole") === "admin" ? "admin" : "expert";
  });

  // ── 커스텀 훅 13개 ──
  const { isPC, isDesktop } = useResponsive();
  const { toast, showToast } = useToast();
  const { favoriteIds, favoriteSet, setFavoriteIds, toggleFavorite } = useFavorites(showToast);
  const detail = useDetailModal(tab);
  const closeDetail = useCallback(() => detail.setDetailAptId(null), [detail.setDetailAptId]);
  const { filterRegion, filterGu, sortKey, setSortKey, handleRegionChange, handleGuChange, budgetMin, handleBudgetMinChange, budgetMax, handleBudgetMaxChange, handleBudgetReset, showFavOnly, toggleFavOnly, areaMin, handleAreaMinChange, areaMax, handleAreaMaxChange, unitsMin, handleUnitsMinChange, unitsMax, handleUnitsMaxChange, handleAreaUnitsReset, moveInFilter, handleMoveInChange, filterCollapsed, toggleFilterCollapsed, minScore, handleMinScoreChange, builderTier, handleBuilderTierChange, benefitOnly, toggleBenefitOnly, getShareURL, handleResetAll, applyPreset, customPresets, saveCustomPreset, deleteCustomPreset, filterHistory, applyHistory, clearHistory, undo, redo, canUndo, canRedo, isSortPending } = useFilterSort({ onFilterChange: closeDetail });
  const { compIds, setCompIds, showComp, showCompOpen, setShowCompOpen, toggleComp } = useComparison(showToast);
  const consult = useConsult(showToast, favoriteIds);
  const expert = useExpertMode(showToast);
  const admin = useAdminMode(showToast);
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

  // ── 탭 전환/인증 네비게이션 ──
  const {
    handleExpertLogin, handleExpertLogout,
    switchToAdmin, switchToExpert, switchToInfo,
    handleExpertView, handleConsultFromDetail,
    handleNavClick,
  } = useAppNavigation({
    tab, setTab, expert, admin, consult, detail,
    compIds, setShowCompOpen, showToast,
    budgetMin, budgetMax,
  });

  // ── containerMaxWidth ──
  const containerMaxWidth = (expert.expertLoggedIn && (tab === "expert" || tab === "expertConsults")) || (admin.adminLoggedIn && tab === "admin") ? 1200 : isDesktop ? 1200 : isPC ? 960 : 520;

  // ── 공유 콜백 (네비게이션과 별개) ──
  const scoredMapRef = useRef(scoredMap);
  useEffect(() => { scoredMapRef.current = scoredMap; }, [scoredMap]);

  const handleShareDetail = useCallback((aptId) => {
    const item = scoredMapRef.current.get(aptId);
    if (!item) return;
    const base = getShareURL();
    const sep = base.includes("?") ? "&" : "?";
    openShareSheet({
      title: `${item.apt.name} - 미분양 분석`,
      text: `${item.apt.name} ${item.res.total}점 · ${fmtPrice(item.apt.price)}`,
      url: `${base}${sep}detail=${aptId}&profile=${profile}`
    });
  }, [profile, openShareSheet, getShareURL]);

  const handleShareCompare = useCallback(() => {
    if (compIds.length < 2) return;
    const base = getShareURL();
    const sep = base.includes("?") ? "&" : "?";
    openShareSheet({
      title: `미분양 ${compIds.length}개 단지 비교`,
      text: compItems.map(x => x.apt.name).join(" vs "),
      url: `${base}${sep}compare=${compIds.join(",")}&profile=${profile}`
    });
  }, [compIds, compItems, profile, openShareSheet, getShareURL]);

  const handleShareFilters = useCallback(() => {
    const activeFilters = [
      filterRegion !== "전체" && filterRegion,
      budgetMin && `${budgetMin}~${budgetMax || "∞"}억`,
      (areaMin || areaMax) && `면적 ${areaMin || "0"}~${areaMax || "∞"}㎡`,
      (unitsMin || unitsMax) && `세대 ${unitsMin || "0"}~${unitsMax || "∞"}`,
      moveInFilter !== "전체" && moveInFilter,
      minScore && `${minScore}점+`,
      builderTier !== "전체" && builderTier,
      benefitOnly && "혜택",
    ].filter(Boolean).join(" · ");
    openShareSheet({
      title: "미분양 필터 공유",
      text: activeFilters || "전체 조건",
      url: getShareURL()
    });
  }, [filterRegion, budgetMin, budgetMax, areaMin, areaMax, unitsMin, unitsMax, moveInFilter, minScore, builderTier, benefitOnly, openShareSheet, getShareURL]);

  // ── 독립 useEffect: print CSS ──
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "print-styles";
    style.textContent = `@media print { nav[aria-label] { display: none !important; } [data-no-print] { display: none !important; } [data-sidebar] { display: none !important; } [data-print-content] { flex: none !important; width: 100% !important; overflow: visible !important; height: auto !important; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }`;
    document.head.appendChild(style);
    return () => { const el = document.getElementById("print-styles"); if (el) el.remove(); };
  }, []);

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
      try { window.history.replaceState(null, "", remaining ? `?${remaining}` : window.location.pathname); } catch {}
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
            isPC={isPC} isDesktop={isDesktop}
            showFavOnly={showFavOnly} onToggleFavOnly={toggleFavOnly} favCount={favoriteIds.length}
            areaMin={areaMin} onAreaMinChange={handleAreaMinChange} areaMax={areaMax} onAreaMaxChange={handleAreaMaxChange}
            unitsMin={unitsMin} onUnitsMinChange={handleUnitsMinChange} unitsMax={unitsMax} onUnitsMaxChange={handleUnitsMaxChange} onAreaUnitsReset={handleAreaUnitsReset}
            moveInFilter={moveInFilter} onMoveInChange={handleMoveInChange}
            minScore={minScore} onMinScoreChange={handleMinScoreChange}
            builderTier={builderTier} onBuilderTierChange={handleBuilderTierChange}
            benefitOnly={benefitOnly} onToggleBenefitOnly={toggleBenefitOnly}
            hideNoUnsold={hideNoUnsold} onToggleHideNoUnsold={toggleHideNoUnsold}
            filterCollapsed={filterCollapsed} onToggleCollapsed={toggleFilterCollapsed}
            activeFilterCount={activeFilterCount}
            filteredLength={filtered.length} scoredLength={scored.length}
            onShareFilters={handleShareFilters}
            onResetAll={handleResetAll}
            onApplyPreset={applyPreset}
            customPresets={customPresets} onSavePreset={saveCustomPreset} onDeletePreset={deleteCustomPreset}
            filterHistory={filterHistory} onApplyHistory={applyHistory} onClearHistory={clearHistory}
            onUndo={undo} onRedo={redo} canUndo={canUndo} canRedo={canRedo}
            filterOptionCounts={filterOptionCounts}
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
          {showComp && <Suspense fallback={null}><CompareSheet items={compItems} onShare={handleShareCompare} onClose={() => setShowCompOpen(false)} profile={profile} isDesktop={isDesktop} /></Suspense>}
          <AptListSection key={filterRegion}
            visible={visible} filteredLength={filtered.length} visibleCount={visibleCount} onLoadMore={() => { setVisibleCount(v => v + VISIBLE_PAGE_SIZE); trackEvent("load_more", { visible_count: visibleCount + VISIBLE_PAGE_SIZE }); }}
            onDetail={detail.handleOpenDetail} onFav={toggleFavorite} onComp={toggleComp} favoriteIds={favoriteIds} favoriteSet={favoriteSet} compIds={compIds}
            pw={pw} profile={profile} isPC={isPC} isDesktop={isDesktop} isPending={isPending || isFilterPending || isSortPending}
            budgetMin={budgetMin} budgetMax={budgetMax} filterRegion={filterRegion}
            dataLoading={dataLoading} dataFreshnessText={dataFreshnessText}

            onExpertView={expert.expertLoggedIn ? handleExpertView : undefined}
            onResetAll={handleResetAll}
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
        <ExpertLoginForm expert={expert} onLogin={handleExpertLogin} onBack={() => setTab("info")} />
      ) : tab === "expert" ? (
        <Suspense fallback={<div style={{ padding: 40, textAlign: "center", fontSize: 13, color: C.muted }}>대시보드 로딩 중...</div>}>
          <ExpertDashboard scored={scored} profile={profile} setProfile={setProfile}
            expandedApt={expert.expertExpandedApt} setExpandedApt={expert.setExpertExpandedApt}
            onSwitchToAdmin={admin.adminLoggedIn ? switchToAdmin : undefined} />
        </Suspense>
      ) : tab === "admin" ? (
        admin.adminLoggedIn ? (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", fontSize: 13, color: C.muted }}>관리자 패널 로딩 중...</div>}>
            <AdminDashboard admin={admin} onLogout={switchToInfo} onSwitchToExpert={switchToExpert} profile={profile} setProfile={setProfile} customWeights={customWeights} saveCustomWeights={saveCustomWeights} scored={scored} />
          </Suspense>
        ) : null
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
            consult.submittedConsults.map((c, i) => {
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
        return <Suspense fallback={null}><DetailModal item={item} onClose={detail.handleCloseDetail}
          isComp={compIds.includes(detail.detailAptId)} onComp={toggleComp}
          isFav={favoriteSet.has(detail.detailAptId)} onFav={toggleFavorite}
          onShare={handleShareDetail} isPC={isPC} isDesktop={isDesktop}
          onConsult={handleConsultFromDetail} /></Suspense>;
      })()}

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
