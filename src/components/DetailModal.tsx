import { memo, useEffect, useMemo, useRef, useState, lazy, Suspense, type CSSProperties } from "react";
import { C, F } from "@/theme";
import { getZone, calcLTV, ZONE_TYPE } from "@/constants/regulations";
import { PROFILES, getTopCats } from "@/constants/profiles";
import { ScoreBadge } from "./primitives";
import { CatPanel } from "./CatPanel";
import { fmtPrice, fmtCompletion, fmtUnsoldRate } from "@/lib/format";
import { PriceTable } from "./detail/PriceTable";
import { SchoolInfo } from "./detail/SchoolInfo";
import { NearbyChildcareSection } from "./detail/NearbyChildcareSection";
import { LoanAnalysis } from "./detail/LoanAnalysis";
import { DataSectionBlock, NearbyFacilitiesBlock, PriceByFloorBlock, AnnouncementLink } from "./detail/DataSectionBlock";
import { CategoryMiniCard } from "./detail/CategoryMiniCard";
import { ProfileWeightBar } from "./detail/ProfileWeightBar";
import { AdminDataAudit } from "./detail/AdminDataAudit";
import { OVERVIEW_SECTIONS, LOCATION_SECTIONS, PRICE_SECTIONS, PRESALE_SECTIONS } from "@/lib/dataSections";
import { PresaleInfo } from "./detail/PresaleInfo";
import { PriceChart } from "./detail/PriceChart";
import { UnsoldChart } from "./detail/UnsoldChart";
import { MarketStatsCharts } from "./detail/MarketStatsCharts";
import { HelpHint } from "./HelpHint";
import { StickyJumpNav, type JumpSection } from "./detail/StickyJumpNav";
import { IconClose } from "./icons";
import { fetchApartmentPrices, type PriceArrays } from "@/services/staticDataApi";
import { trackEvent } from "@/lib/analytics";
import type { DetailModalProps } from "@/types/components/DetailModal.types";

// 관리자 인사이트 레이어 (세션 405 전문가 대시보드 이식) — adminLoggedIn 일 때만 로드 (소비자 번들 영향 0)
const AdminScoreBreakdown = lazy(() => import("./detail/AdminScoreBreakdown").then(m => ({ default: m.AdminScoreBreakdown })));
const AdminUnitSupply = lazy(() => import("./detail/AdminUnitSupply").then(m => ({ default: m.AdminUnitSupply })));

// 탭바 6섹션 정의 — id 는 영문 슬러그 (한글 id CSS.escape 함정 회피).
// 13블록을 6탭으로 묶되 데이터 삭제·축소 0 (각 블록은 정확히 1탭 소속, 세션 407 D1: 점프 앵커 → 콘텐츠 교체 탭).
const JUMP_SECTIONS: JumpSection[] = [
  { id: "sec-overview", label: "종합" },
  { id: "sec-price", label: "시세" },
  { id: "sec-location", label: "입지" },
  { id: "sec-presale", label: "분양" },
  { id: "sec-finance", label: "금융" },
  { id: "sec-score", label: "점수" },
];

const UNSOLD_WARN_THRESHOLD = 15;

// 탭 전환 페이드 (세션 410 D3) — 활성 패널 진입 시 opacity 0→1 .18s. display:none→표시 전환 시
// animation-name 신규 적용으로 keyframe 1회 재생(W3C CSS Animations). prefers-reduced-motion 존중.
// <style> 은 게이트 밖 항상 렌더 위치에 1회 주입(Skeleton primitives.tsx 패턴 답습).
const FADE_KEYFRAMES = `@keyframes detailTabFade { from { opacity: 0 } to { opacity: 1 } }
@media (prefers-reduced-motion: reduce) { [data-tab-panel] { animation: none !important } }`;

const DM_S = {
  dragBar: { width: 40, height: 4, background: C.border, borderRadius: 2, margin: "0 auto 12px", cursor: "pointer" },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  closeBtn: { background: C.slate100, border: "none", borderRadius: "50%", width: 44, height: 44, cursor: "pointer", color: C.muted, display: "flex", alignItems: "center", justifyContent: "center" },
  scoreBadgeWrap: { textAlign: "center" as const, marginBottom: 16 },
  metricsHead: { fontSize: F.md, fontWeight: 700, color: C.text, marginBottom: 6 },
  metricsRow: { display: "flex", justifyContent: "space-between", padding: "4px 0" },
  metricsLabel: { fontSize: F.base, color: C.muted },
  benefitsBox: { background: C.amberLight, borderRadius: 10, padding: "8px 10px", marginBottom: 10, border: `1px solid ${C.amberBorder}` },
  benefitsHead: { fontSize: F.base, fontWeight: 700, color: C.amber, marginBottom: 4 },
  benefitsChipRow: { display: "flex", flexWrap: "wrap" as const, gap: 4 },
  benefitsChip: { fontSize: F.sm, color: C.amber, background: C.white, padding: "4px 10px", borderRadius: 4, border: `1px solid ${C.amberBorder}` },
  republishBadge: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: F.sm, color: C.amber, background: C.amberLight, border: `1px solid ${C.amberBorder}`, borderRadius: 6, padding: "3px 8px", marginBottom: 8 },
  sourceFooter: { fontSize: F.micro, color: C.muted, marginTop: 10, lineHeight: 1.5 },
  actionRow: { display: "flex", gap: 8 },
};

export const DetailModal = memo(function DetailModal({ item, onClose, isComp, onComp, isFav, onFav, onShare, isPC, isDesktop, onConsult, profile, adminLoggedIn = false }: DetailModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const prevFocusRef = useRef<Element | null>(null);
  // 가격배열 lazy fetch (apartments-prices.json) 상태 — DetailModal 첫 열림 시 1회 9.7MB fetch + 모듈 Map 캐시
  const [prices, setPrices] = useState<PriceArrays | null>(null);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [pricesError, setPricesError] = useState<string | null>(null);
  useEffect(() => {
    if (!item) return;
    prevFocusRef.current = document.activeElement;
    document.body.style.overflow = "hidden";
    // 모달 열림 시 닫기 버튼으로 포커스 이동 (모바일 가상키보드 방지)
    requestAnimationFrame(() => closeRef.current?.focus());
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      // 포커스 트랩: Tab 키가 모달 내부에서만 순환
      if (e.key === "Tab") {
        const modal = closeRef.current?.closest('[role="dialog"]');
        if (!modal) return;
        const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); (last as HTMLElement).focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); (first as HTMLElement).focus(); }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKey);
      // 모달 닫힘 시 이전 포커스 복원
      (prevFocusRef.current as HTMLElement | null)?.focus?.();
    };
    // boolean sentinel: 모달 열림/닫힘(false↔true)에만 effect 재실행. item 객체 reference 변경 시
    // 포커스가 닫기 버튼으로 튀거나 body overflow 가 깜박이는 것 방지. exhaustive-deps 의도적 위반.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!item, onClose]);

  // 가격배열 lazy fetch — item 변경 시마다 (캐시 hit 으로 안전)
  useEffect(() => {
    if (!item) { setPrices(null); setPricesError(null); setPricesLoading(false); return; }
    const aptId = item.apt.id as string;
    // Supabase 분기 가드 — apartments_flat VIEW 가 단지별로 priceByArea 를 다른 형태로 응답:
    //   - null: trade_stats LEFT JOIN miss (가격 데이터 미수집 단지)
    //   - 배열 (빈 배열 포함): trade_stats 응답 완료 (거래 0건 = 빈 배열)
    //   - undefined: 정적 분기 (USE_SUPABASE=false) apartments-list.json 에 priceByArea 미수록
    // null/배열 모두 "이미 응답 받은 상태" → fetch skip. undefined 만 fetch 발동 (정적 lazy).
    const priceByArea = (item.apt as { priceByArea?: unknown }).priceByArea;
    if (priceByArea === null || Array.isArray(priceByArea)) {
      setPrices(null); setPricesError(null); return;
    }
    if (priceByArea !== undefined) {
      // 미래 타입 변경 대비 — 알 수 없는 형태도 fetch skip
      setPrices(null); setPricesError(null); return;
    }
    let cancelled = false;
    setPricesLoading(true);
    setPricesError(null);
    fetchApartmentPrices(aptId)
      .then(p => { if (!cancelled) { setPrices(p); setPricesLoading(false); } })
      .catch(err => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (import.meta.env.DEV) {
          console.warn("[DetailModal] prices fetch 실패", msg);
        }
        setPricesError(msg);
        setPricesLoading(false);
      });
    return () => { cancelled = true; };
  }, [item]);
  // 가격배열 병합 — useMemo + item?.apt.id deps 로 item ref 변경마다 무효화 차단.
  // hook 순서 보장 위해 conditional return 이전에 호출. item 미정의 시 빈 객체 반환.
  const mergedApt = useMemo(
    () => (item && prices ? { ...item.apt, ...prices } : item?.apt),
    [item?.apt.id, item?.apt, prices],
  );

  // 탭 상태 (세션 407 D1) — activeTab = 현재 콘텐츠 교체 탭, visited = 방문 탭 누적(keepMounted).
  // 한 번 마운트된 패널은 display:none 으로 유지: 떠난 탭의 fetch 훅 인스턴스 캐시(useRef 캐시인
  // useLoanRates/useRentLoanRates 포함)·trackEvent dedup·펼침 상태가 모달 열림 세션 동안 보존된다.
  // 리셋 effect 없음 — App 이 detailAptId 조건부 렌더라 닫힘 = 언마운트 = state 자연 소멸.
  // 불변식: activeTab ∈ visited (초기 시딩 + handleTabChange 가 둘을 동시 갱신).
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<string>(JUMP_SECTIONS[0].id);
  const [visited, setVisited] = useState<Set<string>>(() => new Set([JUMP_SECTIONS[0].id]));

  // 탭 목록 — 관리자 로그인 시에만 "관리자" 탭(sec-admin) 7번째 추가 (세션 409 D2b).
  // 소비자(adminLoggedIn=false)는 JUMP_SECTIONS 6개 그대로 = 칩·패널 노출 0. 초기 탭은 항상
  // JUMP_SECTIONS[0](sec-overview) 불변이라 activeTab/visited 초기값(위)과 단일 출처 유지.
  const sections = useMemo<JumpSection[]>(
    () => (adminLoggedIn ? [...JUMP_SECTIONS, { id: "sec-admin", label: "관리자" }] : JUMP_SECTIONS),
    [adminLoggedIn],
  );

  // 관리자가 sec-admin 탭을 보던 중 로그아웃 → sections 6개로 축소되며 activeTab 이 사라진 탭을 가리켜
  // 모든 패널 display:none = 빈 본문. activeTab 이 더 이상 존재하지 않으면 종합 탭으로 복원(세션 410 D3 적대검증).
  useEffect(() => {
    if (!sections.some(s => s.id === activeTab)) setActiveTab(JUMP_SECTIONS[0].id);
  }, [sections, activeTab]);

  // 미니카드 → 점수 탭 자동 펼침: 카테고리별 단조 증가 seq. 점프 시 그 카테고리 CatPanel 의 key 만
  // 바뀌어 1개만 리마운트(=defaultExpanded 재평가=펼침), 형제 5개 key 불변 = 손으로 펼친 상태 보존.
  // 같은 카테고리 재클릭도 seq+1 로 재펼침. 모달 닫힘 = 언마운트 = 자연 소멸 (세션 409 D2b 적대검증 R2).
  const [jumpSeqs, setJumpSeqs] = useState<Record<string, number>>({});
  const handleCategoryJump = (k: string) => {
    setJumpSeqs(m => ({ ...m, [k]: (m[k] ?? 0) + 1 }));
    handleTabChange("sec-score");
  };

  // 칩 클릭 = 탭 전환. setActiveTab/visited 는 무조건 실행(가드 밖) — scrollTo 미구현 환경
  // (jsdom·구형 브라우저)에서도 탭 전환은 일어나야 비활성 패널 콘텐츠에 도달 가능.
  // scrollTo 는 탭 전환 시 이전 탭의 스크롤 잔류 방지용 top:0 리셋(instant)만.
  const handleTabChange = (id: string) => {
    // analytics — 탭이 실제 바뀔 때만 발화(같은 탭 재선택 제외). activeTab 은 인라인 함수 클로저라
    // 클릭 시점의 최신 활성탭 캡처. 미니카드 점프(handleCategoryJump→sec-score)·칩 클릭·화살표 전환
    // 모두 이 핸들러 경유 = 단일 발화 지점. tab_switch(useAppNavigation) 선례 답습.
    if (id !== activeTab) trackEvent("detail_tab_view", { tab: id, previous_tab: activeTab });
    setActiveTab(id);
    setVisited(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    const root = bodyRef.current;
    if (root && typeof root.scrollTo === "function") root.scrollTo({ top: 0 });
  };

  // 패널 마운트/표시 규칙 — 관리자는 전부 즉시 마운트(인쇄 "전체 펼침" 보존), 소비자는 첫 방문 시
  // 마운트 후 keepMounted. 표시는 activeTab 만 (나머지 display:none — print CSS 가 인쇄 시 펼침).
  const isPanelMounted = (id: string) => adminLoggedIn || visited.has(id);
  // 활성 패널만 페이드 애니메이션 부여 — display:none→표시 전환 시 keyframe 1회 재생(세션 410 D3).
  // 같은 탭 유지 중 리렌더는 animation 문자열 동일 → 재생 skip(깜빡임 0). 인쇄는 print CSS 가 무효화.
  const panelStyle = (id: string): CSSProperties =>
    activeTab === id
      ? { margin: 0, padding: 0, animation: "detailTabFade .18s ease-out" }
      : { margin: 0, padding: 0, display: "none" };

  if (!item) return null;
  const { apt, res } = item;
  const zone = getZone(apt.region as string, apt.gu as string);
  const zoneName = (ZONE_TYPE as Record<string, string>)[zone];

  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, left: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: isPC ? "center" : "flex-end", justifyContent: "center" }} onClick={onClose} role="dialog" aria-modal="true" aria-label={`${apt.name} 상세 분석`}>
      <div style={{ background: C.card, borderRadius: isPC ? 20 : "20px 20px 0 0", width: "100%", maxWidth: isDesktop ? 760 : isPC ? 640 : 520, maxHeight: isPC ? "92dvh" : "95dvh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: isPC ? "0 8px 40px rgba(0,0,0,0.2)" : "0 -8px 30px rgba(0,0,0,0.15)" }} onClick={e => e.stopPropagation()}>
        <div style={{ flexShrink: 0, padding: isDesktop ? "16px 24px 0" : "12px 16px 0", borderBottom: `1px solid ${C.border}`, background: C.card }}>
          {!isDesktop && <div onClick={onClose} style={DM_S.dragBar} />}
          <div style={DM_S.headerRow}>
            <div>
              <div style={{ fontSize: isDesktop ? F.xl : F.lg, fontWeight: 800, color: C.text }}>{apt.name}</div>
              <div style={{ fontSize: isDesktop ? F.base : F.sm, color: C.muted }}>{[apt.region, apt.gu, apt.dong].filter(Boolean).join(" ")} · {apt.area}㎡ · {fmtPrice(apt.price)}</div>
              {apt.address ? <div style={{ fontSize: F.sm, color: C.muted, marginTop: 2 }}>{String(apt.address)}{apt.district ? ` (${String(apt.district)})` : ""}</div> : null}
              {apt.roadAddress ? <div style={{ fontSize: F.sm, color: C.muted }}>{String(apt.roadAddress)}</div> : null}
            </div>
            <button ref={closeRef} onClick={onClose} aria-label="닫기" style={DM_S.closeBtn}><IconClose size={18} /></button>
          </div>
        </div>
        {/* data-print-content: 관리자 인쇄 시 App print CSS 가 스크롤 해제·전체 펼침 (세션 405) */}
        {/* 하단 패딩은 CTA sticky 바가 자체 패딩으로 담당 (바닥 밀착을 위해 스크롤러 하단 패딩 0) */}
        <div ref={bodyRef} data-testid="detail-scroll-body" data-print-content style={{ flex: 1, minHeight: 0, overflowY: "auto", position: "relative", padding: isDesktop ? "0 24px" : "0 16px" }}>

        <StickyJumpNav sections={sections} activeId={activeTab} totalScore={res.total} onJump={handleTabChange} isMounted={isPanelMounted} isDesktop={isDesktop} noPrint />
        {/* 탭 전환 페이드 keyframes — 게이트 밖 항상 렌더 위치 1회 주입 (세션 410 D3) */}
        <style>{FADE_KEYFRAMES}</style>

        {/* §1 종합 탭 — ScoreBadge + 핵심지표 + 카테고리 미니카드 6 + 혜택칩 + 재공고배지 (세션 409 D2b: 레이더 제거) */}
        {isPanelMounted("sec-overview") && (
        <section id="sec-overview" role="tabpanel" aria-labelledby="tab-sec-overview" data-tab-panel style={panelStyle("sec-overview")}>
        <div style={DM_S.scoreBadgeWrap}>
          <ScoreBadge score={res.total} size={80} />
        </div>

        {/* 핵심 지표 — 세션 409 D2b: 6각형 레이더 제거(카테고리 점수는 아래 미니카드와 이중 노출 → 루즈
            해소, 사장님 지시). 미니카드가 카테고리 시각화+진입 역할을 모두 흡수. 핵심지표는 전폭. */}
        <div style={{ marginBottom: 12 }}>
          <div>
            <div style={DM_S.metricsHead}>핵심 지표</div>
            {[
              { l: "지역", v: [apt.region, apt.gu, apt.dong].filter(Boolean).join(" "), c: C.blue },
              { l: "분양가", v: fmtPrice(apt.price) },
              { l: "적정가 괴리", v: res.cats.price.deviation != null ? `${Number(res.cats.price.deviation) > 0 ? "+" : ""}${res.cats.price.deviation}%` : "—", c: res.cats.price.deviation != null ? (Number(res.cats.price.deviation) > 0 ? C.green : C.red) : C.muted, hint: "주변 시세로 계산한 '적정가'와 실제 분양가를 비교한 거예요. +(플러스)면 적정가보다 싸게(좋은 신호), −(마이너스)면 비싸게 나온 거예요. 예: +5%면 적정가보다 5% 저렴해요." },
              { l: "전세가율", v: apt.jeonseRate != null ? `${apt.jeonseRate}%` : "-" },
              { l: "미분양률", v: fmtUnsoldRate(apt.unsoldRate as number | null), c: apt.unsoldRate != null ? (apt.unsoldRate > UNSOLD_WARN_THRESHOLD ? C.red : C.green) : C.muted },
              { l: "규제현황", v: zoneName, c: zone === "normal" ? C.green : C.red },
              { l: "LTV한도", v: fmtPrice(calcLTV(apt.price, zone)), c: C.blue },
              { l: "입주", v: fmtCompletion(apt.completion) },
            ].map((r, i) => (
              <div key={i} style={DM_S.metricsRow}>
                <span style={{ ...DM_S.metricsLabel, display: "flex", alignItems: "center" }}>{r.l}{(r as { hint?: string }).hint && <HelpHint text={(r as { hint?: string }).hint as string} label={r.l} />}</span>
                <span style={{ fontSize: F.base, fontWeight: 600, color: r.c || C.text }}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>

        {Array.isArray(apt.benefits) && apt.benefits.length > 0 && (
          <div style={DM_S.benefitsBox}>
            <div style={DM_S.benefitsHead}>혜택 상세</div>
            <div style={DM_S.benefitsChipRow}>
              {(apt.benefits as string[]).map((b: string, i: number) => (
                <span key={i} style={DM_S.benefitsChip}>{b}</span>
              ))}
            </div>
          </div>
        )}


        {Array.isArray(apt.siblingIds) && (apt.siblingIds as string[]).length > 1 && (
          <div style={DM_S.republishBadge}>
            재공고 {(apt.siblingIds as string[]).length}회 · 시계열 통합 조회
          </div>
        )}

        {/* 카테고리 요약 미니카드 6개 (세션 409 D2b) — 점수+등급+결론, 탭하면 점수 탭 해당 카테고리 자동 펼침.
            레이더(위)는 한눈 균형 비교(시각), 미니카드는 결론+진입(행동)으로 역할 분리. */}
        {(() => {
          const overviewTopCats = profile ? (getTopCats(PROFILES[profile].w) as string[]) : [];
          return (
            <div style={{ display: "grid", gridTemplateColumns: isPC ? "repeat(3, 1fr)" : "repeat(2, 1fr)", gap: 8, margin: "12px 0" }}>
              {Object.entries(res.cats).map(([k, c]) => (
                <CategoryMiniCard key={k} k={k} cat={c} emphasized={overviewTopCats.includes(k)} onJump={() => handleCategoryJump(k)} />
              ))}
            </div>
          );
        })()}

        {/* 프로필 가중치 막대 — "왜 이 점수인지" 새 정보축 (세션 434 점수 근거 투명화 A+B).
            손님이 보는 상세 모달은 로그인 전제(useDetailModal 단일 진입) → 블라인드 무관. profile 있을 때만. */}
        {profile && <ProfileWeightBar weights={PROFILES[profile].w} cats={res.cats} />}

        {/* 단지 기본정보 (핵심지표 중복 4필드 제외 — 세션 408 D2a) */}
        {OVERVIEW_SECTIONS.map(s => <DataSectionBlock key={s.title} section={s} apt={mergedApt ?? apt} />)}

        {/* 출처 footer — 전 탭 공통 데이터 출처 (종합 탭 1회 고정, 세션 408 D2a) */}
        <div style={DM_S.sourceFooter}>
          출처: 청약홈(국토교통부) · 카카오 로컬 API · KOSIS(통계청) · 국토부 실거래가 · NEIS(교육부)
        </div>
        </section>
        )}

        {/* §2 시세 탭 — PriceTable + PriceChart + UnsoldChart */}
        {isPanelMounted("sec-price") && (
        <section id="sec-price" role="tabpanel" aria-labelledby="tab-sec-price" data-tab-panel style={panelStyle("sec-price")}>
        {/* 주변 시세 대비 위치 게이지 (세션 430) — deviation 양수=저렴(scorePrice.ts 진실원천), -30~+30% 클램프, 0 중앙 */}
        {res.cats.price?.deviation != null && (() => {
          const dev = Number(res.cats.price.deviation);
          if (!Number.isFinite(dev)) return null;
          const clamped = Math.max(-30, Math.min(30, dev));
          const pct = 50 + (clamped / 30) * 50;
          const isGood = dev > 0;
          return (
            <div style={{ background: C.bg, borderRadius: 10, padding: "12px 14px", marginBottom: 10, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 8 }}>주변 시세 대비 위치</div>
              <div style={{ position: "relative", height: 12, background: C.slate100, borderRadius: 6, margin: "4px 0 6px" }}>
                <div style={{ position: "absolute", left: "50%", top: 0, width: 2, height: "100%", background: C.muted, transform: "translateX(-1px)" }} />
                <div style={{ position: "absolute", left: `${pct}%`, top: "50%", width: 14, height: 14, borderRadius: "50%", background: isGood ? C.green : C.red, border: `2px solid ${C.card}`, transform: "translate(-50%,-50%)" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: F.xs, color: C.muted }}>
                <span>30% 비쌈</span>
                <span style={{ fontWeight: 700, color: isGood ? C.green : C.red }}>{isGood ? `+${Math.round(dev)}% 저렴` : dev < 0 ? `${Math.abs(Math.round(dev))}% 비쌈` : "주변과 비슷"}</span>
                <span>30% 저렴</span>
              </div>
            </div>
          );
        })()}
        <PriceTable apt={mergedApt ?? apt} isLoading={pricesLoading} error={pricesError} />
        <PriceChart apartmentId={apt.id as string} siblingIds={apt.siblingIds as string[] | undefined} />
        <UnsoldChart apartmentId={apt.id as string} siblingIds={apt.siblingIds as string[] | undefined} />

        {/* 시장지표·네이버교차·층별가 (세션 408 D2a) */}
        {PRICE_SECTIONS.map(s => <DataSectionBlock key={s.title} section={s} apt={mergedApt ?? apt} />)}
        <PriceByFloorBlock apt={mergedApt ?? apt} />
        </section>
        )}

        {/* §3 입지 탭 — SchoolInfo + NearbyChildcare */}
        {isPanelMounted("sec-location") && (
        <section id="sec-location" role="tabpanel" aria-labelledby="tab-sec-location" data-tab-panel style={panelStyle("sec-location")}>
        <SchoolInfo apt={apt} />

        <NearbyChildcareSection apt={apt} />

        {/* 생활인프라·교통·치안환경 (세션 408 D2a — 입지 탭 빈약 해소) */}
        {LOCATION_SECTIONS.map(s => <DataSectionBlock key={s.title} section={s} apt={mergedApt ?? apt} />)}
        <NearbyFacilitiesBlock apt={mergedApt ?? apt} />
        </section>
        )}

        {/* §4 분양 탭 — PresaleInfo + MarketStatsCharts(KOSIS 지역 거시통계) */}
        {isPanelMounted("sec-presale") && (
        <section id="sec-presale" role="tabpanel" aria-labelledby="tab-sec-presale" data-tab-panel style={panelStyle("sec-presale")}>
        <PresaleInfo apt={apt} />

        {/* 청약경쟁·네이버분양정보 + 국토부 모집공고 원문 (세션 408 D2a) */}
        {PRESALE_SECTIONS.map(s => <DataSectionBlock key={s.title} section={s} apt={mergedApt ?? apt} />)}
        <AnnouncementLink apt={mergedApt ?? apt} />

        {/* 관리자 인사이트(동/호수·평형 공급)는 세션 409 D2b 로 관리자 탭(sec-admin)으로 이동 */}

        <MarketStatsCharts region={apt.region} gu={apt.gu} />
        </section>
        )}

        {/* §5 금융 탭 — LoanAnalysis (이 단지 대출 시뮬레이션) */}
        {isPanelMounted("sec-finance") && (
        <section id="sec-finance" role="tabpanel" aria-labelledby="tab-sec-finance" data-tab-panel style={panelStyle("sec-finance")}>
        <LoanAnalysis apt={mergedApt ?? apt} isLoading={pricesLoading} error={pricesError} />
        </section>
        )}

        {/* §6 점수 탭 — CatPanel×6 순수 점수만 (세션 409 D2b: 관리자 인사이트는 sec-admin 탭으로 이동).
            jumpSeqs[k] key = 종합 탭 미니카드 클릭 시 해당 카테고리 1개만 리마운트(defaultExpanded 펼침). */}
        {isPanelMounted("sec-score") && (
        <section id="sec-score" role="tabpanel" aria-labelledby="tab-sec-score" data-tab-panel style={panelStyle("sec-score")}>
        {(() => {
          const topCats = profile ? (getTopCats(PROFILES[profile].w) as string[]) : [];
          return Object.entries(res.cats).map(([k, c]) => {
            const seq = jumpSeqs[k] ?? 0;
            return <CatPanel key={`${k}#${seq}`} cat={c} k={k} emphasized={topCats.includes(k)} defaultExpanded={seq > 0} />;
          });
        })()}
        </section>
        )}

        {/* §7 관리자 탭 — 점수 산출 과정 + 동/호수·평형 공급 + 141필드 검수 (세션 409 D2b: 점수·분양 탭에서
            분리, adminLoggedIn 시에만 칩·패널 노출). data-tab-panel = App print CSS 가 인쇄 시 펼침.
            isPanelMounted(adminLoggedIn)=즉시 마운트 → 현행 "전체 펼쳐 인쇄" 동선 보존. */}
        {adminLoggedIn && isPanelMounted("sec-admin") && (
        <section id="sec-admin" role="tabpanel" aria-labelledby="tab-sec-admin" data-tab-panel style={panelStyle("sec-admin")}>
        <Suspense fallback={<div style={{ padding: 16, fontSize: F.sm, color: C.muted }}>점수 산출 과정 로딩 중...</div>}>
          <AdminScoreBreakdown apt={apt} res={res} profile={profile} />
        </Suspense>
        <Suspense fallback={<div style={{ padding: 12, fontSize: F.sm, color: C.muted }}>평형별 공급 로딩 중...</div>}>
          <AdminUnitSupply apt={apt} />
        </Suspense>
        <AdminDataAudit apt={mergedApt ?? apt} profile={profile} />
        </section>
        )}

        {/* CTA 공통 영역 — 탭 무관 항상 노출 + sticky bottom (사장님 결정 2026-06-13 ×2).
            sticky 기본 동작 = 콘텐츠가 화면보다 길면 하단에 반투명으로 겹쳐 떠 있고, 짧으면 콘텐츠 끝
            제자리 — 길이 측정 분기 없이 두 경우 자동. 좌우 negative margin = 스크롤러 패딩 전폭 덮기
            (StickyJumpNav 패턴). 포커스 트랩 불변식: 이 블록이 모달 내 마지막 포커서블 + 항상 가시 —
            트랩(위 handleKey)이 display:none 패널 내부 요소를 경계로 잡아 탈출하는 것을 DOM 순서로 차단. */}
        <div data-testid="detail-cta-bar" style={{
          position: "sticky",
          bottom: 0,
          zIndex: 10,
          margin: `12px ${isDesktop ? -24 : -16}px 0`,
          padding: `10px ${isDesktop ? 24 : 16}px calc(12px + env(safe-area-inset-bottom, 0px))`,
          background: `${C.card}EB`,
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          borderTop: `1px solid ${C.border}`,
        }}>
        {onConsult && (
          <button onClick={() => onConsult(apt.id as string)} style={{
            width: "100%", background: C.blue, color: C.white, border: "none", borderRadius: 8,
            padding: "12px 0", fontSize: F.base, fontWeight: 700, cursor: "pointer", minHeight: 44,
            marginBottom: 8, transition: "all .15s",
          }}>이 매물 상담하기</button>
        )}
        <div style={DM_S.actionRow}>
          <button onClick={() => onFav(apt.id as string)} style={{
            flex: 1, background: isFav ? C.redLight : C.slate100, color: isFav ? C.red : C.muted,
            border: isFav ? `1.5px solid ${C.red}` : "1.5px solid transparent", borderRadius: 8, padding: isDesktop ? "12px 0" : "10px 0", fontSize: isDesktop ? F.md : F.base, fontWeight: 700, cursor: "pointer", minHeight: 44, transition: "all .15s"
          }}>{isFav ? "관심 등록됨" : "관심매물 추가"}</button>
          <button onClick={() => onComp(apt.id as string)} style={{
            flex: 1, background: isComp ? C.indigo : "transparent", color: isComp ? C.white : C.indigo,
            border: `1.5px solid ${C.indigo}`, borderRadius: 8, padding: isDesktop ? "12px 0" : "10px 0", fontSize: isDesktop ? F.md : F.base, fontWeight: 700, cursor: "pointer", minHeight: 44, transition: "all .15s"
          }}>{isComp ? "비교 중" : "비교 추가"}</button>
          {onShare && <button onClick={() => onShare(apt.id as string)} aria-label="이 단지 공유하기" style={{
            flex: 1, background: C.slate100, color: C.slate600,
            border: "1.5px solid transparent", borderRadius: 8, padding: isDesktop ? "12px 0" : "10px 0", fontSize: isDesktop ? F.md : F.base, fontWeight: 700, cursor: "pointer", minHeight: 44, transition: "all .15s"
          }}>공유</button>}
        </div>
        </div>

        </div>
      </div>
    </div>
  );
});