import { useState, useMemo, useEffect, useCallback } from "react";
import { PROFILES } from "@/constants/profiles";
import { CITY_TIER } from "@/constants/regions";
import { calcAll } from "@/scoring/engine";
import { C, catCol, catBg, gr } from "@/theme";
import { Bar, ScoreBadge } from "@/components/primitives";
import { AptCard } from "@/components/AptCard";
import { CompareSheet } from "@/components/CompareSheet";
import { DetailModal } from "@/components/DetailModal";
import { ConsultForm } from "@/components/ConsultForm";
import { ExpertDashboard } from "@/components/expert/ExpertDashboard";
import { useToast } from "@/hooks/useToast";
import { useFilterSort } from "@/hooks/useFilterSort";
import { useComparison } from "@/hooks/useComparison";
import { useFavorites } from "@/hooks/useFavorites";
import { useDetailModal } from "@/hooks/useDetailModal";
import { useConsult } from "@/hooks/useConsult";
import { useExpertMode } from "@/hooks/useExpertMode";
import { useApartmentData } from "@/hooks/useApartmentData";

export default function App() {
  const [profile, setProfile] = useState("live");
  const [tab, setTab] = useState(() => sessionStorage.getItem("expertLoggedIn") === "true" ? "expert" : "list");

  // 7 custom hooks
  const { toast, showToast } = useToast();
  const { favoriteIds, setFavoriteIds, toggleFavorite } = useFavorites();
  const detail = useDetailModal(tab);
  const closeDetail = useCallback(() => detail.setDetailAptId(null), [detail.setDetailAptId]);
  const { filterRegion, filterGu, sortKey, setSortKey, handleRegionChange, handleGuChange } = useFilterSort({ onFilterChange: closeDetail });
  const { compIds, showComp, showCompOpen, setShowCompOpen, toggleComp } = useComparison(showToast);
  const consult = useConsult(showToast, favoriteIds);
  const expert = useExpertMode(showToast);
  const { apartments, loading: dataLoading } = useApartmentData();

  // 5 useMemo
  const guOptions = useMemo(() => {
    if (filterRegion === "전체") {
      const gus = new Set(apartments.map(a => a.gu));
      return ["전체", ...gus];
    }
    const regionGus = new Set(apartments.filter(a => a.region === filterRegion).map(a => a.gu));
    return ["전체", ...regionGus];
  }, [filterRegion, apartments]);

  const scored = useMemo(() => apartments.map(a => ({ apt: a, res: calcAll(a, profile) })), [apartments, profile]);
  const filtered = useMemo(() => {
    let list = scored;
    if (filterRegion !== "전체") list = list.filter(x => x.apt.region === filterRegion);
    if (filterGu !== "전체") list = list.filter(x => x.apt.gu === filterGu);
    const sorters = { total: (a, b) => b.res.total - a.res.total, price: (a, b) => a.apt.price - b.apt.price, priceScore: (a, b) => b.res.cats.price.total - a.res.cats.price.total, location: (a, b) => b.res.cats.location.total - a.res.cats.location.total, safe: (a, b) => b.res.cats.risk.total - a.res.cats.risk.total };
    return [...list].sort(sorters[sortKey] || sorters.total);
  }, [scored, filterRegion, filterGu, sortKey]);
  const compItems = useMemo(() => compIds.map(id => scored.find(x => x.apt.id === id)).filter(Boolean), [compIds, scored]);
  const pw = PROFILES[profile].w;

  const regionOptions = useMemo(() => {
    const rs = new Set(apartments.map(a => a.region));
    return ["전체", ...rs];
  }, [apartments]);

  const containerMaxWidth = expert.expertLoggedIn && (tab === "expert" || tab === "expertConsults") ? 1200 : 520;

  // handleExpertLogin wrapper (setTab is in App scope)
  const handleExpertLogin = () => {
    if (expert.handleExpertLogin()) {
      setTab("expert");
    }
  };

  const handleExpertLogout = () => {
    expert.handleExpertLogout(() => { setTab("list"); setShowCompOpen(false); });
  };

  const handleNavClick = useCallback((k) => {
    if (k === "logout") return handleExpertLogout();
    if (k === "list") { setTab("list"); setShowCompOpen(false); return; }
    if (k === "compare") {
      if (compIds.length < 2) { showToast("카드에서 2개 이상 선택해주세요"); setTab("list"); return; }
      setShowCompOpen(true); setTab("list"); return;
    }
    if (k === "consult" && consult.consultSubmitted) {
      consult.setConsultSubmitted(false);
      consult.setConsultForm({ name: "", phone: "", interestedApts: [], budgetMin: "", budgetMax: "", consultType: "방문상담", message: "" });
    }
    setTab(k);
  }, [compIds.length, showToast, handleExpertLogout, setShowCompOpen, consult]);

  // print CSS useEffect
  useEffect(() => {
    if (!expert.expertLoggedIn) return;
    const style = document.createElement("style");
    style.id = "expert-print-styles";
    style.textContent = `@media print { nav[aria-label] { display: none !important; } [data-no-print] { display: none !important; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }`;
    document.head.appendChild(style);
    return () => { const el = document.getElementById("expert-print-styles"); if (el) el.remove(); };
  }, [expert.expertLoggedIn]);

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

      {/* 가중치 */}
      <div style={{ padding: "10px 16px 0" }}>
        <div style={{ background: C.card, borderRadius: 12, padding: "10px 16px", border: `1px solid ${C.border}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{PROFILES[profile].name}</span>
            <span style={{ fontSize: 11, color: C.muted }}>· {PROFILES[profile].desc}</span>
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "center" }}>
            {Object.entries(pw).map(([k]) => {
              const nm = { location: "입지", product: "상품", price: "가격", risk: "안전", benefit: "혜택", future: "미래" };
              return <span key={k} style={{ fontSize: 11, fontWeight: 700, color: catCol[k], background: catBg[k], padding: "3px 8px", borderRadius: 4 }}>{nm[k]} {pw[k]}%</span>;
            })}
          </div>
        </div>
      </div>

      {tab === "list" ? (
        <div style={{ padding: "0 16px" }}>
          <div style={{ background: C.card, borderRadius: 12, padding: "12px 14px", border: `1px solid ${C.border}`, marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>

            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <select value={filterRegion} onChange={e => handleRegionChange(e.target.value)} aria-label="시/도 선택" style={{
                flex: 1, padding: "7px 28px 7px 12px", fontSize: 13, fontWeight: filterRegion !== "전체" ? 700 : 500,
                border: filterRegion !== "전체" ? `1.5px solid ${C.indigo}` : "none", borderRadius: 6, background: C.slate100,
                color: filterRegion !== "전체" ? C.indigo : C.slate600, cursor: "pointer", minHeight: 38,
                WebkitAppearance: "none", MozAppearance: "none", appearance: "none",
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%236B7280' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center"
              }}>
                {regionOptions.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select value={filterGu} onChange={e => handleGuChange(e.target.value)} aria-label="구/군 선택" disabled={filterRegion === "전체" || guOptions.length <= 1} style={{
                flex: 1, padding: "7px 28px 7px 12px", fontSize: 13, fontWeight: filterGu !== "전체" ? 700 : 500,
                border: filterGu !== "전체" ? `1.5px solid ${C.indigo}` : "none", borderRadius: 6,
                background: (filterRegion === "전체" || guOptions.length <= 1) ? "#E2E8F0" : C.slate100,
                color: (filterRegion === "전체" || guOptions.length <= 1) ? "#94A3B8" : filterGu !== "전체" ? C.indigo : C.slate600,
                cursor: (filterRegion === "전체" || guOptions.length <= 1) ? "default" : "pointer", minHeight: 38,
                WebkitAppearance: "none", MozAppearance: "none", appearance: "none",
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%236B7280' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center"
              }}>
                {guOptions.map(g2 => <option key={g2} value={g2}>{g2}</option>)}
              </select>
            </div>

            <div style={{ display: "flex", gap: 4 }}>
              {[{ k: "total", l: "종합", ac: C.indigo, bg: C.indigoLight, pas: "#F0EEFF" }, { k: "price", l: "저가순", ac: C.amber, bg: C.amberLight, pas: "#FFFBEB" }, { k: "priceScore", l: "가격매력", ac: C.green, bg: C.greenLight, pas: "#EDFCF2" }, { k: "location", l: "입지", ac: C.blue, bg: C.blueLight, pas: "#EEF3FF" }, { k: "safe", l: "안전", ac: C.red, bg: C.redLight, pas: "#FEF2F2" }].map(s => (
                <button key={s.k} onClick={() => setSortKey(s.k)} style={{
                  flex: 1, background: sortKey === s.k ? s.bg : s.pas, color: sortKey === s.k ? s.ac : C.slate600,
                  border: sortKey === s.k ? `1.5px solid ${s.ac}` : "1.5px solid transparent", borderRadius: 6, padding: "7px 8px", minHeight: 36,
                  fontSize: 12, fontWeight: sortKey === s.k ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap", transition: "all .15s", textAlign: "center"
                }}>{s.l}</button>
              ))}
            </div>
          </div>

          {compIds.length >= 2 && (
            <button onClick={() => { const wasOpen = showComp; setShowCompOpen(!showCompOpen); if (wasOpen) window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{
              width: "100%", background: showComp ? C.indigo : "transparent", color: showComp ? C.white : C.indigo,
              border: `1.5px solid ${C.indigo}`, borderRadius: 8, padding: "12px", fontSize: 13, fontWeight: 700,
              cursor: "pointer", marginBottom: 10, transition: "all .2s"
            }}>{compIds.length}개 비교 {showComp ? "닫기" : "보기"}</button>
          )}

          {showComp && <CompareSheet items={compItems} />}

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 6, padding: "0 2px" }}>
            {filtered.length}개 단지 · {PROFILES[profile].name} 모드{filterRegion !== "전체" ? ` · ${filterRegion}` : " · 전국"}
          </div>

          {filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: "48px 24px", color: C.muted }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>해당 지역에 미분양 단지가 없습니다</div>
              <div style={{ fontSize: 12 }}>다른 지역을 선택하거나 '전체'로 변경해주세요</div>
            </div>
          )}

          {filtered.map((item, idx) => (
            <AptCard key={item.apt.id} apt={item.apt} res={item.res} rank={idx + 1}
              onDetail={detail.handleOpenDetail}
              isComp={compIds.includes(item.apt.id)} onComp={toggleComp}
              isFav={favoriteIds.includes(item.apt.id)} onFav={toggleFavorite}
              profileWeights={pw} />
          ))}
        </div>
      ) : tab === "info" ? (
        <div style={{ padding: "0 16px" }}>
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
        <ConsultForm scored={scored} favoriteIds={favoriteIds} setFavoriteIds={setFavoriteIds} form={consult.consultForm} setForm={consult.setConsultForm}
          onSubmit={consult.handleConsultSubmit} submitted={consult.consultSubmitted} showToast={showToast} />
      ) : tab === "expertLogin" ? (
        <div style={{ padding: "0 16px" }}>
          <div style={{ background: C.card, borderRadius: 12, padding: "40px 20px", border: `1px solid ${C.border}`, textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 4 }}>전문가 전용 페이지</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>파트너 전문가 전용 대시보드입니다</div>
            <div style={{ fontSize: 11, color: C.muted, background: C.slate100, borderRadius: 6, padding: "8px 12px", marginBottom: 20 }}>
              * 데모 버전 — 비밀번호: expert2024
            </div>
            <form onSubmit={e => { e.preventDefault(); handleExpertLogin(); }}>
              <div style={{ marginBottom: 16 }}>
                <label htmlFor="expert-pw" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block" }}>비밀번호</label>
                <input id="expert-pw" type="password" autoComplete="current-password" value={expert.expertPw} onChange={e => expert.setExpertPw(e.target.value)}
                  placeholder="비밀번호 입력" style={{
                    width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                    background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42, textAlign: "center"
                  }} />
              </div>
              <button type="submit" style={{
                width: "100%", padding: "12px", fontSize: 14, fontWeight: 800, color: C.white, background: C.indigo,
                border: "none", borderRadius: 6, cursor: "pointer", minHeight: 44, marginBottom: 12
              }}>로그인</button>
            </form>
            <button onClick={() => setTab("info")} style={{
              background: "transparent", border: "none", color: C.muted, fontSize: 12, cursor: "pointer"
            }}>돌아가기</button>
          </div>
        </div>
      ) : tab === "expert" ? (
        <ExpertDashboard scored={scored} profile={profile} setProfile={setProfile}
          expandedApt={expert.expertExpandedApt} setExpandedApt={expert.setExpertExpandedApt} />
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
        return <DetailModal item={item} onClose={detail.handleCloseDetail}
          isComp={compIds.includes(detail.detailAptId)} onComp={toggleComp}
          isFav={favoriteIds.includes(detail.detailAptId)} onFav={toggleFavorite} />;
      })()}

      {/* 토스트 */}
      {toast && (
        <div role="status" aria-live="polite" style={{ position: "fixed", bottom: "calc(76px + env(safe-area-inset-bottom, 0px))", left: "50%", transform: "translateX(-50%)", background: C.text, color: C.white, padding: "12px 24px", borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 200, boxShadow: "0 4px 16px rgba(0,0,0,0.25)", whiteSpace: "nowrap" }}>{toast}</div>
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
