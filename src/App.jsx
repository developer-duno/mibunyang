import { useState, useMemo, useEffect, useCallback, useRef, useTransition, lazy, Suspense } from "react";
import { PROFILES } from "@/constants/profiles";
import { CITY_TIER } from "@/constants/regions";
import { calcCats, computeRegionalMedians } from "@/scoring/engine";
import { C, catCol, catBg } from "@/theme";
import { AptCard } from "@/components/AptCard";

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
import { useUserLocation } from "@/hooks/useUserLocation";
import { useResponsive } from "@/hooks/useResponsive";
import { matchSearch } from "@/lib/chosung";
import { ShareSheet } from "@/components/ShareSheet";

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
  const { filterRegion, filterGu, sortKey, setSortKey, handleRegionChange, handleGuChange, budgetMin, handleBudgetMinChange, budgetMax, handleBudgetMaxChange, handleBudgetReset, searchText, handleSearchChange, applyDetectedRegion } = useFilterSort({ onFilterChange: closeDetail });
  const userLocation = useUserLocation();
  const { compIds, setCompIds, showComp, showCompOpen, setShowCompOpen, toggleComp } = useComparison(showToast);
  const consult = useConsult(showToast, favoriteIds);
  const expert = useExpertMode(showToast);
  const admin = useAdminMode(showToast);
  const { apartments, loading: dataLoading, error: dataError, retry: retryData } = useApartmentData();
  const { openShareSheet, closeShareSheet, shareKakao, shareSMS, shareCopy, shareSheetOpen, shareData, isMobile } = useShare(showToast);

  // 5 useMemo
  const guOptions = useMemo(() => {
    if (filterRegion === "전체") {
      const gus = new Set(apartments.map(a => a.gu));
      return ["전체", ...gus];
    }
    const regionGus = new Set(apartments.filter(a => a.region === filterRegion).map(a => a.gu));
    return ["전체", ...regionGus];
  }, [filterRegion, apartments]);

  const catsCache = useMemo(() => {
    const regionMedians = computeRegionalMedians(apartments);
    const ctx = { regionMedians };
    return apartments.map(a => ({ apt: a, cats: calcCats(a, ctx) }));
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
    if (filterRegion !== "전체") list = list.filter(x => x.apt.region === filterRegion);
    if (filterGu !== "전체") list = list.filter(x => x.apt.gu === filterGu);
    const bMin = budgetMin !== "" ? Number(budgetMin) : null;
    const bMax = budgetMax !== "" ? Number(budgetMax) : null;
    const effectiveMin = (bMin != null && bMax != null && bMin > bMax) ? bMax : bMin;
    const effectiveMax = (bMin != null && bMax != null && bMin > bMax) ? bMin : bMax;
    if (effectiveMin != null) list = list.filter(x => x.apt.price >= effectiveMin * 10000);
    if (effectiveMax != null) list = list.filter(x => x.apt.price <= effectiveMax * 10000);
    if (searchText) list = list.filter(x => matchSearch(x.apt.name, searchText) || matchSearch(x.apt.builder ?? "", searchText) || matchSearch(x.apt.gu ?? "", searchText) || matchSearch(x.apt.region ?? "", searchText));
    const sorters = { total: (a, b) => b.res.total - a.res.total, price: (a, b) => a.apt.price - b.apt.price, priceScore: (a, b) => b.res.cats.price.total - a.res.cats.price.total, location: (a, b) => b.res.cats.location.total - a.res.cats.location.total, safe: (a, b) => b.res.cats.risk.total - a.res.cats.risk.total };
    return [...list].sort(sorters[sortKey] || sorters.total);
  }, [scored, filterRegion, filterGu, sortKey, budgetMin, budgetMax, searchText]);
  useEffect(() => { setVisibleCount(30); }, [profile, filterRegion, filterGu, searchText]);
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const compItems = useMemo(() => compIds.map(id => scored.find(x => x.apt.id === id)).filter(Boolean), [compIds, scored]);
  const pw = useMemo(() => customWeights[profile] ?? PROFILES[profile].w, [profile, customWeights]);

  const regionOptions = useMemo(() => {
    const rs = new Set(apartments.map(a => a.region));
    return ["전체", ...rs];
  }, [apartments]);

  // 위치 감지 → 자동 지역 필터 적용
  const locationAppliedRef = useRef(false);
  useEffect(() => {
    if (locationAppliedRef.current || userLocation.loading || !userLocation.region) return;
    if (regionOptions.length <= 1) return; // 아파트 데이터 미로드
    locationAppliedRef.current = true;
    applyDetectedRegion(userLocation.region, regionOptions);
  }, [userLocation.loading, userLocation.region, regionOptions, applyDetectedRegion]);

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

  const handleShareDetail = useCallback((aptId) => {
    const item = scored.find(x => x.apt.id === aptId);
    if (!item) return;
    openShareSheet({
      title: `${item.apt.name} - 미분양 분석`,
      text: `${item.apt.name} ${item.res.total}점 · ${((item.apt.price ?? 0) / 10000).toFixed(1)}억`,
      url: `${window.location.origin}/?detail=${aptId}&profile=${profile}`
    });
  }, [scored, profile, openShareSheet]);

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

      {/* 헤더 */}
      <div style={{ background: "linear-gradient(135deg,#2563EB 0%,#1E40AF 100%)", padding: "16px 16px 16px", borderRadius: "0 0 24px 24px", color: C.white, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.04)" }} />
        <div style={{ position: "absolute", bottom: -20, left: 20, width: 60, height: 60, borderRadius: "50%", background: "rgba(255,255,255,0.03)" }} />
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: -.5 }}>전국 미분양 비교 엔진</h1>
              <p style={{ margin: "2px 0 0", fontSize: 12, opacity: .75, fontWeight: 500 }}>전국 {apartments.length}개 단지 · 6개 항목 · 34+ 지표</p>
            </div>
            <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 600 }}>v3.0</div>
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", overflowX: "auto", paddingBottom: 2, WebkitOverflowScrolling: "touch" }}>
            {Object.entries(PROFILES).map(([k, p]) => (
              <button key={k} onClick={() => setProfile(k)} aria-pressed={profile === k} style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                background: profile === k ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.12)",
                color: profile === k ? C.blue : "rgba(255,255,255,0.9)",
                border: `1.5px solid ${profile === k ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.2)"}`,
                borderRadius: 8, padding: "8px 0", minHeight: 44, cursor: "pointer", transition: "all .2s",
                boxShadow: profile === k ? "0 2px 8px rgba(37,99,235,0.15)" : "none"
              }}>
                <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: -0.3 }}>{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

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
          {/* 검색 + 필터 통합 컴팩트 바 */}
          <div data-no-print style={{ background: C.card, borderRadius: 10, padding: "8px 10px", border: `1px solid ${C.border}`, margin: "8px 0 6px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            {/* 1행: 검색 입력 */}
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
              <div style={{ position: "relative", flex: 1 }}>
                <input type="text" value={searchText} onChange={e => handleSearchChange(e.target.value)} placeholder="단지명, 건설사, 지역 검색" aria-label="단지 검색" style={{
                  width: "100%", padding: "6px 30px 6px 10px", fontSize: 12,
                  border: searchText ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`,
                  borderRadius: 6, background: C.slate100, color: C.text,
                  outline: "none", height: 32, boxSizing: "border-box"
                }} />
                {searchText && (
                  <button onClick={() => handleSearchChange("")} aria-label="검색어 지우기" style={{
                    position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 14, padding: 2
                  }}>✕</button>
                )}
              </div>
            </div>
            {/* 2행: 지역 + 예산 + 초기화 */}
            <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 6 }}>
              <select value={filterRegion} onChange={e => handleRegionChange(e.target.value)} aria-label="시/도" style={{
                flex: "0 0 auto", width: 80, padding: "4px 20px 4px 8px", fontSize: 11, fontWeight: filterRegion !== "전체" ? 700 : 500,
                border: filterRegion !== "전체" ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`, borderRadius: 5, background: C.slate100,
                color: filterRegion !== "전체" ? C.indigo : C.slate600, cursor: "pointer", height: 30,
                WebkitAppearance: "none", MozAppearance: "none", appearance: "none",
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%236B7280' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center"
              }}>
                {regionOptions.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select value={filterRegion === "전체" ? "" : filterGu} onChange={e => handleGuChange(e.target.value)} aria-label="구/군" disabled={filterRegion === "전체" || guOptions.length <= 1} style={{
                flex: "0 0 auto", width: 80, padding: "4px 20px 4px 8px", fontSize: 11, fontWeight: filterGu !== "전체" ? 700 : 500,
                border: filterGu !== "전체" ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`, borderRadius: 5,
                background: (filterRegion === "전체" || guOptions.length <= 1) ? "#E2E8F0" : C.slate100,
                color: (filterRegion === "전체" || guOptions.length <= 1) ? "#94A3B8" : filterGu !== "전체" ? C.indigo : C.slate600,
                cursor: (filterRegion === "전체" || guOptions.length <= 1) ? "default" : "pointer", height: 30,
                WebkitAppearance: "none", MozAppearance: "none", appearance: "none",
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%236B7280' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center"
              }}>
                {filterRegion === "전체" && <option value="">지역 먼저 선택</option>}
                {guOptions.map(g2 => <option key={g2} value={g2}>{g2}</option>)}
              </select>
              <input type="number" inputMode="decimal" min="0" step="0.1" value={budgetMin} onChange={e => handleBudgetMinChange(e.target.value)} placeholder="최소(억)" aria-label="최소 예산(억)"
                style={{ flex: 1, minWidth: 0, padding: "4px 6px", fontSize: 11, border: budgetMin ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`, borderRadius: 5, outline: "none", height: 30, boxSizing: "border-box", background: C.slate100 }} />
              <span style={{ fontSize: 10, color: C.muted, flexShrink: 0 }}>~</span>
              <input type="number" inputMode="decimal" min="0" step="0.1" value={budgetMax} onChange={e => handleBudgetMaxChange(e.target.value)} placeholder="최대(억)" aria-label="최대 예산(억)"
                style={{ flex: 1, minWidth: 0, padding: "4px 6px", fontSize: 11, border: budgetMax ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`, borderRadius: 5, outline: "none", height: 30, boxSizing: "border-box", background: C.slate100 }} />
              <span style={{ fontSize: 10, color: C.muted, flexShrink: 0 }}>억</span>
              {(budgetMin || budgetMax) ? (
                <button onClick={handleBudgetReset} aria-label="예산 초기화" style={{
                  background: C.slate100, border: `1px solid ${C.border}`, borderRadius: 5, padding: "0 6px", fontSize: 11, color: C.muted,
                  cursor: "pointer", height: 30, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                }}>✕</button>
              ) : null}
            </div>
            {/* 3행: 정렬 + 가중치 뱃지 */}
            <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
              {isPC ? [{ k: "total", l: "종합", ac: C.indigo, bg: C.indigoLight, pas: "#F0EEFF" }, { k: "price", l: "저가순", ac: C.amber, bg: C.amberLight, pas: "#FFFBEB" }, { k: "priceScore", l: "가격매력", ac: C.green, bg: C.greenLight, pas: "#EDFCF2" }, { k: "location", l: "입지", ac: C.blue, bg: C.blueLight, pas: "#EEF3FF" }, { k: "safe", l: "안전", ac: C.red, bg: C.redLight, pas: "#FEF2F2" }].map(s => (
                <button key={s.k} onClick={() => setSortKey(s.k)} style={{
                  flex: 1, background: sortKey === s.k ? s.bg : s.pas, color: sortKey === s.k ? s.ac : C.slate600,
                  border: sortKey === s.k ? `1.5px solid ${s.ac}` : "1.5px solid transparent", borderRadius: 5, padding: "4px 0", height: 28,
                  fontSize: 11, fontWeight: sortKey === s.k ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap", transition: "all .15s", textAlign: "center"
                }}>{s.l}</button>
              )) : (
                <select value={sortKey} onChange={e => setSortKey(e.target.value)} aria-label="정렬 기준" style={{
                  flex: "0 0 auto", padding: "4px 24px 4px 8px", fontSize: 11, fontWeight: 700, height: 28,
                  border: `1.5px solid ${C.indigo}`, borderRadius: 5, background: C.indigoLight, color: C.indigo,
                  cursor: "pointer", WebkitAppearance: "none", MozAppearance: "none", appearance: "none",
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%234F46E5' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center"
                }}>
                  {[{ k: "total", l: "종합순" }, { k: "price", l: "저가순" }, { k: "priceScore", l: "가격매력순" }, { k: "location", l: "입지순" }, { k: "safe", l: "안전순" }].map(s => (
                    <option key={s.k} value={s.k}>{s.l}</option>
                  ))}
                </select>
              )}
              <div style={{ width: 1, height: 20, background: C.border, flexShrink: 0, margin: "0 2px" }} />
              {Object.entries(pw).map(([k]) => {
                const nm = { location: "입지", product: "상품", price: "가격", risk: "안전", benefit: "혜택", future: "미래" };
                return <span key={k} style={{ fontSize: 9, fontWeight: 700, color: catCol[k], background: catBg[k], padding: "2px 4px", borderRadius: 3, whiteSpace: "nowrap" }}>{nm[k]}{pw[k]}</span>;
              })}
            </div>
          </div>

          {compIds.length >= 2 && (
            <button onClick={() => { const wasOpen = showComp; setShowCompOpen(!showCompOpen); if (wasOpen) window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{
              width: "100%", background: showComp ? C.indigo : "transparent", color: showComp ? C.white : C.indigo,
              border: `1.5px solid ${C.indigo}`, borderRadius: 8, padding: "12px", fontSize: 13, fontWeight: 700,
              cursor: "pointer", marginBottom: 10, transition: "all .2s"
            }}>{compIds.length}개 비교 {showComp ? "닫기" : "보기"}</button>
          )}

          {showComp && <Suspense fallback={null}><CompareSheet items={compItems} onShare={handleShareCompare} /></Suspense>}

          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, padding: "0 2px", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            <span>{filtered.length}개 단지 · {PROFILES[profile].name}{filterRegion !== "전체" ? ` · ${filterRegion}` : ""}{searchText ? ` · "${searchText}"` : ""}{(budgetMin || budgetMax) ? ` · ${budgetMin || "0"}~${budgetMax || "∞"}억` : ""}</span>
            {budgetMin && budgetMax && Number(budgetMin) > Number(budgetMax) && (
              <span style={{ color: C.red, fontWeight: 700 }}>(최소&gt;최대)</span>
            )}
            {userLocation.region && !userLocation.loading && (
              <span style={{ fontSize: 10, color: C.blue, background: C.blueLight, padding: "1px 6px", borderRadius: 10, fontWeight: 600, whiteSpace: "nowrap" }}>
                {userLocation.method === "gps" ? "\uD83D\uDCCD" : "\uD83C\uDF10"} {userLocation.region}{userLocation.gu ? ` ${userLocation.gu}` : ""}
              </span>
            )}
          </div>

          {filtered.length === 0 && !dataLoading && (
            <div style={{ textAlign: "center", padding: "48px 24px", color: C.muted }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>{searchText ? "\uD83D\uDD0D" : (budgetMin || budgetMax) ? "\uD83D\uDCB0" : "\uD83D\uDDFA\uFE0F"}</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: C.text }}>{searchText ? `"${searchText}" 검색 결과가 없습니다` : (budgetMin || budgetMax) ? "예산 범위에 맞는 단지가 없습니다" : "해당 지역에 미분양 단지가 없습니다"}</div>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>{searchText ? "단지명, 건설사, 지역명으로 검색해보세요" : (budgetMin || budgetMax) ? "예산을 조정하거나 초기화해주세요" : "다른 지역을 선택하거나 '전체'로 변경해주세요"}</div>
            </div>
          )}

          <div style={{ ...(isPC ? { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0 12px" } : {}), ...(isPending ? { opacity: 0.6, pointerEvents: "none", transition: "opacity 0.15s" } : {}) }}>
            {visible.map((item, idx) => (
              <AptCard key={item.apt.id} apt={item.apt} res={item.res} rank={idx + 1}
                onDetail={detail.handleOpenDetail}
                isComp={compIds.includes(item.apt.id)} onComp={toggleComp}
                isFav={favoriteIds.includes(item.apt.id)} onFav={toggleFavorite}
                profileWeights={pw} />
            ))}
          </div>
          {visibleCount < filtered.length && (
            <div style={{ textAlign: "center", padding: "16px 0 24px" }}>
              <button onClick={() => setVisibleCount(v => v + 30)} style={{ padding: "10px 32px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                더 보기 ({filtered.length - visibleCount}개 남음)
              </button>
            </div>
          )}
        </div>
      ) : tab === "info" ? (
        <div style={{ padding: "0 16px", maxWidth: 640, margin: "0 auto" }}>
          <div style={{ background: C.card, borderRadius: 12, padding: 14, border: `1px solid ${C.border}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 10 }}>스코어링 엔진 구조</div>
            {[
              { title: "가격 매력도", desc: "적정가괴리도(신축프리미엄·면적·브랜드 보정) + 전세가율 + PIR(소득대비) + PSR(분양가/시세) + 데이터신뢰도" },
              { title: "입지·생활권", desc: "교통접근성(도시등급별 보정: 특별시↔군 지하철·버스·IC·KTX 가중치 자동 조정) + 학군 + 생활인프라(8개 카테고리) + 환경 + 혐오시설" },
              { title: "상품성", desc: "브랜드티어(4단계) + 세대수 + 주차비 + 용적률 + 에너지등급 + 전용률 + 평면구조 + 내진설계 + 구조(층수)" },
              { title: "혜택·할인", desc: "원화환산(분양가할인 + 중도금무이자 + 옵션무상 + 발코니확장 + 캐시백) ÷ 분양가" },
              { title: "안전도", desc: "미분양률 + 거래량 + 대출/잔금(DSR) + 시공사재무(DART) + 규제 + 공급파이프라인 + 시장환경" },
              { title: "미래가치", desc: "교통개발(GTX·KTX·광역철도) + 도시개발 + 인구/산업유입" },
            ].map((item, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{item.title}</div>
                <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.6, marginTop: 2 }}>{item.desc}</div>
              </div>
            ))}

            <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.blue, marginBottom: 6 }}>도시등급별 교통 보정 (NEW)</div>
              <div style={{ fontSize: 11, color: C.sub, lineHeight: 1.6 }}>
                {Object.entries(CITY_TIER).map(([k, v]) =>
                  `${v.label}(${k}): 지하철×${v.subwayW} 버스×${v.busW} IC×${v.icW} KTX×${v.ktxW}`
                ).join(" | ")}
              </div>
            </div>

            <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>학술 기반</div>
              <div style={{ fontSize: 11, color: C.sub, lineHeight: 1.6 }}>
                AHP 계층분석법(황규성·장형진 2016) · 헤도닉 가격모형 · 한국부동산원 공시가격 조사체계 · 국토연구원 GTX 영향 분석(2024) · 하자심사분쟁조정위 데이터
              </div>
            </div>

            {!expert.expertLoggedIn && (
              <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 16, marginTop: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>파트너 전문가 전용</div>
                <button onClick={() => setTab("expertLogin")} style={{
                  width: "100%", background: C.indigoLight, border: `1.5px solid ${C.indigo}`, color: C.indigo, fontSize: 13, fontWeight: 700,
                  cursor: "pointer", padding: "12px", borderRadius: 6, minHeight: 44
                }}>전문가 로그인</button>
              </div>
            )}
          </div>
        </div>
      ) : tab === "consult" ? (
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", fontSize: 13, color: C.muted }}>로딩 중...</div>}>
            <ConsultForm scored={scored} favoriteIds={favoriteIds} setFavoriteIds={setFavoriteIds} form={consult.consultForm} setForm={consult.setConsultForm}
              onSubmit={consult.handleConsultSubmit} submitted={consult.consultSubmitted} showToast={showToast} />
          </Suspense>
        </div>
      ) : tab === "expertLogin" ? (
        <div style={{ padding: "0 16px", maxWidth: 640, margin: "0 auto" }}>
          <div style={{ background: C.card, borderRadius: 12, padding: "40px 20px", border: `1px solid ${C.border}`, textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 4 }}>
              {expert.authMode === "login" ? "전문가 로그인" : "전문가 회원가입"}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>
              {expert.authMode === "login" ? "파트너 전문가 전용 대시보드입니다" : "전문가 계정을 생성합니다"}
            </div>

            {expert.authStatus === "pending" && (
              <div style={{ fontSize: 12, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, padding: "10px 12px", marginBottom: 16, textAlign: "left", lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>승인 대기중</div>
                관리자 승인 후 이용 가능합니다. 잠시만 기다려주세요.
              </div>
            )}
            {expert.authStatus === "rejected" && (
              <div style={{ fontSize: 12, color: C.red, background: C.redLight, border: "1px solid #FECACA", borderRadius: 6, padding: "10px 12px", marginBottom: 16, textAlign: "left", lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>승인 거부</div>
                가입 신청이 거부되었습니다. 관리자에게 문의해주세요.
              </div>
            )}
            {expert.authError && !expert.authStatus && (
              <div style={{ fontSize: 12, color: C.red, background: C.redLight, borderRadius: 6, padding: "8px 12px", marginBottom: 16 }}>
                {expert.authError}
              </div>
            )}

            <form onSubmit={e => {
              e.preventDefault();
              if (expert.authMode === "login") handleExpertLogin();
              else expert.handleExpertSignup();
            }}>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="expert-email" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>이메일</label>
                <input id="expert-email" type="email" autoComplete="email" value={expert.authForm.email}
                  onChange={e => expert.setAuthForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="이메일 입력" style={{
                    width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                    background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                  }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="expert-pw" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>비밀번호{expert.authMode === "signup" ? " (8자 이상)" : ""}</label>
                <input id="expert-pw" type="password" autoComplete={expert.authMode === "login" ? "current-password" : "new-password"}
                  value={expert.authForm.password}
                  onChange={e => expert.setAuthForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="비밀번호 입력" style={{
                    width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                    background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                  }} />
              </div>

              {expert.authMode === "signup" && (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <label htmlFor="expert-name" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>이름</label>
                    <input id="expert-name" type="text" autoComplete="name" value={expert.authForm.name}
                      onChange={e => expert.setAuthForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="이름 입력" style={{
                        width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                        background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                      }} />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label htmlFor="expert-affil" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>소속 (선택)</label>
                    <input id="expert-affil" type="text" autoComplete="organization" value={expert.authForm.affiliation}
                      onChange={e => expert.setAuthForm(f => ({ ...f, affiliation: e.target.value }))}
                      placeholder="부동산 사무소명 등" style={{
                        width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                        background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                      }} />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label htmlFor="expert-phone" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>연락처</label>
                    <input id="expert-phone" type="tel" autoComplete="tel" value={expert.authForm.phone}
                      onChange={e => expert.setAuthForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="010-1234-5678" style={{
                        width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                        background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                      }} />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label htmlFor="expert-specialty" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>전문 분야</label>
                    <select id="expert-specialty" value={expert.authForm.specialty}
                      onChange={e => expert.setAuthForm(f => ({ ...f, specialty: e.target.value }))}
                      style={{
                        width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                        background: C.white, color: expert.authForm.specialty ? C.text : C.muted, boxSizing: "border-box", minHeight: 42,
                        WebkitAppearance: "none", MozAppearance: "none", appearance: "none",
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%236B7280' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,
                        backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center"
                      }}>
                      <option value="">전문 분야 선택</option>
                      {["부동산 중개", "분양 컨설팅", "감정평가", "건축/설계", "기타"].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label htmlFor="expert-license" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>자격증/면허 (선택)</label>
                    <input id="expert-license" type="text" value={expert.authForm.license}
                      onChange={e => expert.setAuthForm(f => ({ ...f, license: e.target.value }))}
                      placeholder="예: 공인중개사, 감정평가사" style={{
                        width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                        background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                      }} />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label htmlFor="expert-exp" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>경력 (년)</label>
                    <input id="expert-exp" type="number" min="0" max="50" value={expert.authForm.experience}
                      onChange={e => expert.setAuthForm(f => ({ ...f, experience: e.target.value }))}
                      placeholder="경력 연수" style={{
                        width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                        background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                      }} />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label htmlFor="expert-bio" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>자기소개 / 가입 사유 (10자 이상)</label>
                    <textarea id="expert-bio" rows={4} maxLength={500} value={expert.authForm.bio}
                      onChange={e => expert.setAuthForm(f => ({ ...f, bio: e.target.value }))}
                      placeholder="전문가 페이지 이용 사유를 입력해주세요" style={{
                        width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                        background: C.white, color: C.text, boxSizing: "border-box", resize: "vertical", lineHeight: 1.6, fontFamily: "inherit"
                      }} />
                    <div style={{ fontSize: 10, color: C.muted, textAlign: "right", marginTop: 2 }}>{(expert.authForm.bio || "").length}/500</div>
                  </div>
                </>
              )}

              <button type="submit" disabled={expert.authLoading} style={{
                width: "100%", padding: "12px", fontSize: 14, fontWeight: 800, color: C.white,
                background: expert.authLoading ? C.muted : C.indigo,
                border: "none", borderRadius: 6, cursor: expert.authLoading ? "default" : "pointer",
                minHeight: 44, marginBottom: 12, transition: "background .15s"
              }}>{expert.authLoading ? "처리 중..." : expert.authMode === "login" ? "로그인" : "회원가입"}</button>
            </form>

            <button onClick={() => { expert.setAuthMode(expert.authMode === "login" ? "signup" : "login"); expert.setAuthForm({ email: "", password: "", name: "", affiliation: "", phone: "", specialty: "", license: "", experience: "", bio: "" }); }} style={{
              background: "transparent", border: "none", color: C.indigo, fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 8
            }}>{expert.authMode === "login" ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}</button>

            <div>
              <button onClick={() => setTab("info")} style={{
                background: "transparent", border: "none", color: C.muted, fontSize: 12, cursor: "pointer"
              }}>돌아가기</button>
            </div>
          </div>
        </div>
      ) : tab === "expert" ? (
        <Suspense fallback={<div style={{ padding: 40, textAlign: "center", fontSize: 13, color: C.muted }}>대시보드 로딩 중...</div>}>
          <ExpertDashboard scored={scored} profile={profile} setProfile={setProfile}
            expandedApt={expert.expertExpandedApt} setExpandedApt={expert.setExpertExpandedApt}
            onSwitchToAdmin={admin.adminLoggedIn ? switchToAdmin : undefined} />
        </Suspense>
      ) : tab === "admin" ? (
        admin.adminLoggedIn ? (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", fontSize: 13, color: C.muted }}>관리자 패널 로딩 중...</div>}>
            <AdminDashboard admin={admin} onLogout={switchToInfo} onSwitchToExpert={switchToExpert} profile={profile} setProfile={setProfile} customWeights={customWeights} saveCustomWeights={saveCustomWeights} />
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
                    <div>연락처: {c.phone}{c.contactMethod ? ` (${c.contactMethod})` : ""}</div>
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
      <nav aria-label="메인 내비게이션" data-no-print style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: containerMaxWidth, background: expert.expertLoggedIn ? C.indigoLight : C.white, borderTop: `1px solid ${expert.expertLoggedIn ? C.indigo + "30" : C.border}`, padding: "8px 8px calc(8px + env(safe-area-inset-bottom, 0px)) 8px", display: "flex", justifyContent: "space-around", zIndex: 100, boxShadow: "0 -2px 10px rgba(0,0,0,0.05)", transition: "max-width .3s" }}>
        {(expert.expertLoggedIn
          ? [{ l: "대시보드", k: "expert" }, { l: "상담목록", k: "expertConsults" }, { l: "소비자뷰", k: "list" }, { l: "로그아웃", k: "logout" }]
          : [{ l: "목록", k: "list" }, { l: "비교", k: "compare" }, { l: "상담", k: "consult" }, { l: "정보", k: "info" }]
        ).map(n => {
          const isActive = n.k === "compare" ? (showComp && tab === "list") : (tab === n.k && !(n.k === "list" && showComp));
          const activeColor = expert.expertLoggedIn ? C.indigo : C.blue;
          return (
            <button key={n.k} aria-current={(!["compare", "logout"].includes(n.k) && tab === n.k) ? "page" : undefined} onClick={() => handleNavClick(n.k)} style={{
              background: isActive ? (expert.expertLoggedIn ? C.indigo + "14" : C.blueLight) : "transparent",
              border: "none", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              color: isActive ? activeColor : C.muted, padding: "10px 14px", minHeight: 48, transition: "all .2s"
            }}>
              <span style={{ fontSize: 13, fontWeight: isActive ? 800 : 600, letterSpacing: -0.2 }}>{n.l}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
