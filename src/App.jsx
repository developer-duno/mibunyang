// App.jsx SRP 분리 완료 — InfoPage, BottomNav, HeaderSection, ExpertLoginForm, SearchFilterBar, AptListSection
import { useState, useMemo, useEffect, useCallback, useRef, useTransition, lazy, Suspense } from "react";
import { PROFILES } from "@/constants/profiles";
import { REGIONS } from "@/constants/regions";
import { NOW_YM } from "@/components/AptCard";
import { calcCats, computeRegionalMedians } from "@/scoring/engine";
import { fmtPrice } from "@/lib/format";
import { C, catCol, catBg } from "@/theme";

const CompareSheet = lazy(() => import("@/components/CompareSheet").then(m => ({ default: m.CompareSheet })));
const DetailModal = lazy(() => import("@/components/DetailModal").then(m => ({ default: m.DetailModal })));
const ConsultForm = lazy(() => import("@/components/ConsultForm").then(m => ({ default: m.ConsultForm })));
const ExpertDashboard = lazy(() => import("@/components/expert/ExpertDashboard").then(m => ({ default: m.ExpertDashboard })));
const AdminDashboard = lazy(() => import("@/components/admin/AdminDashboard").then(m => ({ default: m.AdminDashboard })));
import { useToast } from "@/hooks/useToast";
import { useFilterSort } from "@/hooks/useFilterSort";
import { useComparison } from "@/hooks/useComparison";
import { useFavorites } from "@/hooks/useFavorites";
import { useDetailModal } from "@/hooks/useDetailModal";
import { useConsult } from "@/hooks/useConsult";
import { useExpertMode } from "@/hooks/useExpertMode";
import { useAdminMode } from "@/hooks/useAdminMode";
import { useApartmentData } from "@/hooks/useApartmentData";
import { useShare } from "@/hooks/useShare";

import { useResponsive } from "@/hooks/useResponsive";
import { matchSearch } from "@/lib/chosung";
import { ShareSheet } from "@/components/ShareSheet";
import { InfoPage } from "@/components/sections/InfoPage";
import { BottomNav } from "@/components/sections/BottomNav";
import { HeaderSection } from "@/components/sections/HeaderSection";
import { ExpertLoginForm } from "@/components/sections/ExpertLoginForm";
import { SearchFilterBar } from "@/components/sections/SearchFilterBar";
import { AptListSection } from "@/components/sections/AptListSection";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

export default function App() {
  const [profile, setProfileRaw] = useState(() => {
    try { const v = localStorage.getItem("mibunyang_profile"); return v && PROFILES[v] ? v : "live"; } catch { return "live"; }
  });
  const [isPending, startTransition] = useTransition();
  const setProfile = useCallback((k) => { startTransition(() => setProfileRaw(k)); try { localStorage.setItem("mibunyang_profile", k); } catch {} }, [startTransition]);
  const [customWeights, setCustomWeights] = useState(() => {
    try { const v = localStorage.getItem("mibunyang_customWeights"); return v ? JSON.parse(v) : {}; } catch { return {}; }
  });
  const saveCustomWeights = useCallback((cw) => {
    setCustomWeights(cw);
    try { localStorage.setItem("mibunyang_customWeights", JSON.stringify(cw)); } catch {}
  }, []);
  const [visibleCount, setVisibleCount] = useState(30);
  const [tab, setTab] = useState(() => {
    if (!sessionStorage.getItem("expertToken")) return "list";
    return sessionStorage.getItem("userRole") === "admin" ? "admin" : "expert";
  });

  const { isPC } = useResponsive();

  // 8 custom hooks
  const { toast, showToast } = useToast();
  const { favoriteIds, setFavoriteIds, toggleFavorite } = useFavorites();
  const detail = useDetailModal(tab);
  const closeDetail = useCallback(() => detail.setDetailAptId(null), [detail.setDetailAptId]);
  const { filterRegion, filterGu, sortKey, setSortKey, handleRegionChange, handleGuChange, budgetMin, handleBudgetMinChange, budgetMax, handleBudgetMaxChange, handleBudgetReset, searchText, handleSearchChange, showFavOnly, toggleFavOnly, areaMin, handleAreaMinChange, areaMax, handleAreaMaxChange, unitsMin, handleUnitsMinChange, unitsMax, handleUnitsMaxChange, handleAreaUnitsReset, moveInFilter, handleMoveInChange, filterCollapsed, toggleFilterCollapsed } = useFilterSort({ onFilterChange: closeDetail });
  const debouncedSearchText = useDebouncedValue(searchText, 300);

  const { compIds, setCompIds, showComp, showCompOpen, setShowCompOpen, toggleComp } = useComparison(showToast);
  const consult = useConsult(showToast, favoriteIds);
  const expert = useExpertMode(showToast);
  const admin = useAdminMode(showToast);
  const { apartments, loading: dataLoading, error: dataError, retry: retryData, dataUpdatedAt } = useApartmentData();
  const { openShareSheet, closeShareSheet, shareKakao, shareSMS, shareCopy, shareSheetOpen, isMobile } = useShare(showToast);

  // 5 useMemo
  const guOptions = useMemo(() => {
    if (filterRegion === "전체") {
      const gus = new Set(apartments.map(a => a.gu).filter(Boolean));
      return ["전체", ...[...gus].sort()];
    }
    const regionGus = new Set(apartments.filter(a => a.region === filterRegion).map(a => a.gu).filter(Boolean));
    return ["전체", ...[...regionGus].sort()];
  }, [filterRegion, apartments]);

  const catsCache = useMemo(() => {
    const needsFallback = apartments.some(a => !a.catsCache?.price);
    const ctx = needsFallback ? { regionMedians: computeRegionalMedians(apartments) } : null;

    if (import.meta.env.DEV && needsFallback) {
      const missing = apartments.filter(a => !a.catsCache?.price).length;
      console.warn(`[catsCache] ${missing}/${apartments.length} 폴백 (catsCache 누락)`);
      if (missing === apartments.length && apartments.length > 0) {
        console.error("[catsCache] 전체 폴백! API가 catsCache를 반환하지 않음 — 필드명 확인 필요");
      }
    }

    return apartments.map(a => ({
      apt: a,
      cats: (a.catsCache && a.catsCache.price) ? a.catsCache : calcCats(a, ctx),
    }));
  }, [apartments]);
  const scored = useMemo(() => {
    const raw = customWeights[profile];
    const w = (raw && typeof raw === "object" && Object.keys(PROFILES[profile].w).every(k => typeof raw[k] === "number")) ? raw : PROFILES[profile].w;
    return catsCache.map(({ apt, cats }) => {
      const total = Math.round(Math.min(Object.keys(cats).reduce((s, k) => s + cats[k].total * (w[k] ?? 0) / 100, 0), 100));
      return { apt, res: { total, cats, weights: w } };
    });
  }, [catsCache, profile, customWeights]);
  const filtered = useMemo(() => {
    let list = scored;
    if (showFavOnly) list = list.filter(x => favoriteIds.includes(x.apt.id));
    if (filterRegion !== "전체") {
      list = list.filter(x => x.apt.region === filterRegion);
    }
    if (filterGu !== "전체") list = list.filter(x => x.apt.gu === filterGu);
    const bMin = budgetMin !== "" ? Number(budgetMin) : null;
    const bMax = budgetMax !== "" ? Number(budgetMax) : null;
    const effectiveMin = (bMin != null && bMax != null && bMin > bMax) ? bMax : bMin;
    const effectiveMax = (bMin != null && bMax != null && bMin > bMax) ? bMin : bMax;
    if (effectiveMin != null) list = list.filter(x => x.apt.price >= effectiveMin * 10000);
    if (effectiveMax != null) list = list.filter(x => x.apt.price <= effectiveMax * 10000);
    if (areaMin) list = list.filter(x => (x.apt.area ?? 0) >= Number(areaMin));
    if (areaMax) list = list.filter(x => (x.apt.area ?? Infinity) <= Number(areaMax));
    if (unitsMin) list = list.filter(x => (x.apt.units ?? 0) >= Number(unitsMin));
    if (unitsMax) list = list.filter(x => (x.apt.units ?? Infinity) <= Number(unitsMax));
    if (moveInFilter !== "전체") {
      if (moveInFilter === "입주예정") list = list.filter(x => x.apt.completion && x.apt.completion >= NOW_YM);
      else if (moveInFilter === "미입주") list = list.filter(x => x.apt.completion && x.apt.completion < NOW_YM && (x.apt.unsoldRate ?? 0) > 0);
      else if (moveInFilter === "입주완료") list = list.filter(x => x.apt.completion && x.apt.completion < NOW_YM && (x.apt.unsoldRate ?? 0) === 0);
    }
    if (debouncedSearchText) list = list.filter(x => matchSearch(x.apt.name, debouncedSearchText) || matchSearch(x.apt.builder ?? "", debouncedSearchText) || matchSearch(x.apt.gu ?? "", debouncedSearchText) || matchSearch(x.apt.region ?? "", debouncedSearchText));
    const sorters = { total: (a, b) => b.res.total - a.res.total, price: (a, b) => a.apt.price - b.apt.price, priceScore: (a, b) => b.res.cats.price.total - a.res.cats.price.total, location: (a, b) => b.res.cats.location.total - a.res.cats.location.total, safe: (a, b) => b.res.cats.risk.total - a.res.cats.risk.total, benefit: (a, b) => (b.res.cats.benefit?.totalWon ?? 0) - (a.res.cats.benefit?.totalWon ?? 0), newest: (a, b) => (b.apt.updatedAt ?? "").localeCompare(a.apt.updatedAt ?? "") };
    return [...list].sort(sorters[sortKey] || sorters.total);
  }, [scored, filterRegion, filterGu, sortKey, budgetMin, budgetMax, debouncedSearchText, showFavOnly, favoriteIds, areaMin, areaMax, unitsMin, unitsMax, moveInFilter]);
  useEffect(() => { setVisibleCount(30); }, [profile, filterRegion, filterGu, debouncedSearchText, sortKey, budgetMin, budgetMax, showFavOnly, areaMin, areaMax, unitsMin, unitsMax, moveInFilter]);
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const scoredMap = useMemo(() => new Map(scored.map(x => [x.apt.id, x])), [scored]);
  const compItems = useMemo(() => compIds.map(id => scoredMap.get(id)).filter(Boolean), [compIds, scoredMap]);
  const pw = useMemo(() => customWeights[profile] ?? PROFILES[profile].w, [profile, customWeights]);
  const activeFilterCount = useMemo(() =>
    [showFavOnly, filterRegion !== "전체", budgetMin, budgetMax, areaMin, areaMax, unitsMin, unitsMax, moveInFilter !== "전체"].filter(Boolean).length,
    [showFavOnly, filterRegion, budgetMin, budgetMax, areaMin, areaMax, unitsMin, unitsMax, moveInFilter]
  );

  const regionOptions = useMemo(() => {
    const rs = new Set(apartments.map(a => a.region).filter(Boolean));
    const order = Object.keys(REGIONS);
    return ["전체", ...order.filter(r => rs.has(r)), ...[...rs].filter(r => !order.includes(r)).sort()];
  }, [apartments]);

  // 데이터 최신성 텍스트 (ISO 날짜 표시)
  const dataFreshnessText = dataUpdatedAt ? dataUpdatedAt.slice(0, 10) + " 업데이트" : null;


  const containerMaxWidth = (expert.expertLoggedIn && (tab === "expert" || tab === "expertConsults")) || (admin.adminLoggedIn && tab === "admin") ? 1200 : isPC ? 960 : 520;

  // handleExpertLogin wrapper (setTab is in App scope)
  const handleExpertLogin = useCallback(async () => {
    const result = await expert.handleExpertLogin();
    if (result?.ok) {
      if (result.role === "admin") {
        sessionStorage.setItem("userRole", "admin");
        admin.setAdminLoggedIn(true);
        setTab("admin");
      } else {
        sessionStorage.setItem("userRole", "expert");
        setTab("expert");
      }
    }
  }, [expert.handleExpertLogin, admin.setAdminLoggedIn]);

  const handleExpertLogout = useCallback(() => {
    expert.handleExpertLogout(() => { setTab("list"); setShowCompOpen(false); });
  }, [expert.handleExpertLogout, setShowCompOpen]);

  const switchToAdmin = useCallback(() => setTab("admin"), []);
  const switchToExpert = useCallback(() => setTab("expert"), []);
  const switchToInfo = useCallback(() => setTab("info"), []);
  const handleExpertView = useCallback((aptId) => {
    expert.setExpertExpandedApt(aptId);
    setTab("expert");
  }, [expert.setExpertExpandedApt]);

  const consultRef = useRef(consult);
  consultRef.current = consult;
  const budgetRef = useRef({ budgetMin, budgetMax });
  budgetRef.current = { budgetMin, budgetMax };

  const handleNavClick = useCallback((k) => {
    if (k === "logout") return handleExpertLogout();
    if (k === "list") { setTab("list"); setShowCompOpen(false); return; }
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
  }, [compIds.length, showToast, handleExpertLogout, setShowCompOpen]);

  // verify 실패 시 admin 상태 동기화 (양방향)
  useEffect(() => {
    if (!expert.expertLoggedIn && admin.adminLoggedIn) {
      admin.setAdminLoggedIn(false);
      if (tab === "admin" || tab === "expert") setTab("list");
    }
  }, [expert.expertLoggedIn, admin.adminLoggedIn, admin.setAdminLoggedIn, tab]);

  // print CSS useEffect (모든 모드에서 적용)
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "print-styles";
    style.textContent = `@media print { nav[aria-label] { display: none !important; } [data-no-print] { display: none !important; } [data-sidebar] { display: none !important; } [data-print-content] { flex: none !important; width: 100% !important; overflow: visible !important; height: auto !important; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }`;
    document.head.appendChild(style);
    return () => { const el = document.getElementById("print-styles"); if (el) el.remove(); };
  }, []);

  // URL 딥링크 복원 (공유 URL로 접근 시)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const detailId = params.get("detail");
    const compareStr = params.get("compare");
    const profileParam = params.get("profile");
    if (profileParam && PROFILES[profileParam]) setProfile(profileParam);
    if (detailId) detail.setDetailAptId(detailId);
    if (compareStr) {
      const ids = compareStr.split(",").filter(Boolean).slice(0, 4);
      if (ids.length >= 2) { setCompIds(ids); setShowCompOpen(true); }
    }
    if (detailId || compareStr) window.history.replaceState(null, "", window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 전문가 로그인 시 상담 목록 서버 조회
  useEffect(() => {
    if (expert.expertLoggedIn && tab === "expertConsults") {
      const token = sessionStorage.getItem("expertToken");
      if (token) consult.fetchConsults(token);
    }
  }, [expert.expertLoggedIn, tab, consult.fetchConsults]);

  const scoredMapRef = useRef(scoredMap);
  useEffect(() => { scoredMapRef.current = scoredMap; }, [scoredMap]);
  const handleShareDetail = useCallback((aptId) => {
    const item = scoredMapRef.current.get(aptId);
    if (!item) return;
    openShareSheet({
      title: `${item.apt.name} - 미분양 분석`,
      text: `${item.apt.name} ${item.res.total}점 · ${fmtPrice(item.apt.price)}`,
      url: `${window.location.origin}/?detail=${aptId}&profile=${profile}`
    });
  }, [profile, openShareSheet]);

  const handleShareCompare = useCallback(() => {
    if (compIds.length < 2) return;
    openShareSheet({
      title: `미분양 ${compIds.length}개 단지 비교`,
      text: compItems.map(x => x.apt.name).join(" vs "),
      url: `${window.location.origin}/?compare=${compIds.join(",")}&profile=${profile}`
    });
  }, [compIds, compItems, profile, openShareSheet]);

  return (
    <div style={{ background: C.bg, minHeight: "100dvh", maxWidth: containerMaxWidth, margin: "0 auto", fontFamily: "'Pretendard Variable','Noto Sans KR',-apple-system,BlinkMacSystemFont,sans-serif", color: C.text, paddingBottom: 70, transition: "max-width .3s" }}>

      <HeaderSection profile={profile} onProfileChange={setProfile} apartmentCount={apartments.length} />

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

      {tab === "list" ? (
        <div style={{ padding: "0 16px" }}>
          <SearchFilterBar
            searchText={searchText} onSearchChange={handleSearchChange}
            filterRegion={filterRegion} onRegionChange={handleRegionChange} regionOptions={regionOptions}
            filterGu={filterGu} onGuChange={handleGuChange} guOptions={guOptions}
            budgetMin={budgetMin} onBudgetMinChange={handleBudgetMinChange} budgetMax={budgetMax} onBudgetMaxChange={handleBudgetMaxChange} onBudgetReset={handleBudgetReset}
            sortKey={sortKey} onSortChange={setSortKey}
            pw={pw} catCol={catCol} catBg={catBg}
            isPC={isPC}
            showFavOnly={showFavOnly} onToggleFavOnly={toggleFavOnly} favCount={favoriteIds.length}
            areaMin={areaMin} onAreaMinChange={handleAreaMinChange} areaMax={areaMax} onAreaMaxChange={handleAreaMaxChange}
            unitsMin={unitsMin} onUnitsMinChange={handleUnitsMinChange} unitsMax={unitsMax} onUnitsMaxChange={handleUnitsMaxChange} onAreaUnitsReset={handleAreaUnitsReset}
            moveInFilter={moveInFilter} onMoveInChange={handleMoveInChange}
            filterCollapsed={filterCollapsed} onToggleCollapsed={toggleFilterCollapsed}
            activeFilterCount={activeFilterCount}
            filteredLength={filtered.length} scoredLength={scored.length}
          />

          {compIds.length >= 2 && (
            <button onClick={() => { const wasOpen = showComp; setShowCompOpen(!showCompOpen); if (wasOpen) window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{
              width: "100%", background: showComp ? C.indigo : "transparent", color: showComp ? C.white : C.indigo,
              border: `1.5px solid ${C.indigo}`, borderRadius: 8, padding: "12px", fontSize: 13, fontWeight: 700,
              cursor: "pointer", marginBottom: 10, transition: "all .2s"
            }}>{compIds.length}개 비교 {showComp ? "닫기" : "보기"}</button>
          )}
          {showComp && <Suspense fallback={null}><CompareSheet items={compItems} onShare={handleShareCompare} onClose={() => setShowCompOpen(false)} /></Suspense>}
          <AptListSection key={filterRegion}
            visible={visible} filteredLength={filtered.length} visibleCount={visibleCount} onLoadMore={() => setVisibleCount(v => v + 30)}
            onDetail={detail.handleOpenDetail} onFav={toggleFavorite} onComp={toggleComp} favoriteIds={favoriteIds} compIds={compIds}
            pw={pw} profile={profile} isPC={isPC} isPending={isPending}
            searchText={searchText} budgetMin={budgetMin} budgetMax={budgetMax} filterRegion={filterRegion}
            dataLoading={dataLoading} dataFreshnessText={dataFreshnessText}

            onExpertView={expert.expertLoggedIn ? handleExpertView : undefined}
          />
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
          isFav={favoriteIds.includes(detail.detailAptId)} onFav={toggleFavorite}
          onShare={handleShareDetail} isPC={isPC} /></Suspense>;
      })()}

      {/* 토스트 */}
      <ShareSheet open={shareSheetOpen} onKakao={shareKakao} onSMS={shareSMS} onCopy={shareCopy} onClose={closeShareSheet} isMobile={isMobile} isPC={isPC} />

      {toast && (
        <div role="status" aria-live="polite" data-no-print style={{ position: "fixed", bottom: "calc(76px + env(safe-area-inset-bottom, 0px))", left: "50%", transform: "translateX(-50%)", background: C.text, color: C.white, padding: "12px 24px", borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 400, boxShadow: "0 4px 16px rgba(0,0,0,0.25)", whiteSpace: "nowrap" }}>{toast}</div>
      )}

      {/* 하단 네비 */}
      <BottomNav tab={tab} expertLoggedIn={expert.expertLoggedIn} showComp={showComp} onNavClick={handleNavClick} containerMaxWidth={containerMaxWidth} />
    </div>
  );
}
