import { memo, useEffect, useMemo, useRef, useState } from "react";
import { C, F, SHORT_LABEL } from "@/theme";
import { getZone, calcLTV, ZONE_TYPE } from "@/constants/regulations";
import { ScoreBadge, Radar } from "./primitives";
import { CatPanel } from "./CatPanel";
import { fmtPrice, fmtCompletion } from "@/lib/format";
import { PriceTable } from "./detail/PriceTable";
import { SchoolInfo } from "./detail/SchoolInfo";
import { NearbyChildcareSection } from "./detail/NearbyChildcareSection";
import { LoanAnalysis } from "./detail/LoanAnalysis";
import { DataSections } from "./detail/DataSections";
import { PresaleInfo } from "./detail/PresaleInfo";
import { PriceChart } from "./detail/PriceChart";
import { UnsoldChart } from "./detail/UnsoldChart";
import { MarketStatsCharts } from "./detail/MarketStatsCharts";
import { StickyJumpNav, JUMP_NAV_HEIGHT, type JumpSection } from "./detail/StickyJumpNav";
import { IconClose } from "./icons";
import { fetchApartmentPrices, type PriceArrays } from "@/services/staticDataApi";
import type { DetailModalProps } from "@/types/components/DetailModal.types";

// 목차바 6섹션 정의 — id 는 영문 슬러그 (한글 id CSS.escape 함정 회피, getElementById 안전).
// 13블록을 6섹션으로 묶되 데이터 삭제·축소 0 (각 블록은 정확히 1섹션 소속).
const JUMP_SECTIONS: JumpSection[] = [
  { id: "sec-overview", label: "종합" },
  { id: "sec-price", label: "시세" },
  { id: "sec-location", label: "입지" },
  { id: "sec-presale", label: "분양" },
  { id: "sec-finance", label: "금융" },
  { id: "sec-score", label: "점수" },
];

const UNSOLD_WARN_THRESHOLD = 15;

const DM_S = {
  dragBar: { width: 40, height: 4, background: C.border, borderRadius: 2, margin: "0 auto 12px", cursor: "pointer" },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  closeBtn: { background: C.slate100, border: "none", borderRadius: "50%", width: 44, height: 44, cursor: "pointer", color: C.muted, display: "flex", alignItems: "center", justifyContent: "center" },
  scoreBadgeWrap: { textAlign: "center" as const, marginBottom: 16 },
  radarRow: { display: "flex", gap: 8, alignItems: "center", padding: "0 0 12px" },
  metricsHead: { fontSize: F.md, fontWeight: 700, color: C.text, marginBottom: 6 },
  metricsRow: { display: "flex", justifyContent: "space-between", padding: "4px 0" },
  metricsLabel: { fontSize: F.base, color: C.muted },
  benefitsBox: { background: C.amberLight, borderRadius: 10, padding: "8px 10px", marginBottom: 10, border: `1px solid ${C.amberBorder}` },
  benefitsHead: { fontSize: F.base, fontWeight: 700, color: C.amber, marginBottom: 4 },
  benefitsChipRow: { display: "flex", flexWrap: "wrap" as const, gap: 4 },
  benefitsChip: { fontSize: F.sm, color: C.amber, background: C.white, padding: "4px 10px", borderRadius: 4, border: `1px solid ${C.amberBorder}` },
  republishBadge: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: F.sm, color: C.amber, background: C.amberLight, border: `1px solid ${C.amberBorder}`, borderRadius: 6, padding: "3px 8px", marginBottom: 8 },
  actionRow: { display: "flex", gap: 8, marginBottom: 16 },
};

export const DetailModal = memo(function DetailModal({ item, onClose, isComp, onComp, isFav, onFav, onShare, isPC, isDesktop, onConsult }: DetailModalProps) {
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

  // 목차바(StickyJumpNav) — 스크롤 컨테이너(bodyRef) 안 6 섹션을 IntersectionObserver 로 추적.
  // 포커스 트랩 effect(위)와 별개 effect 로 분리: 그쪽은 [!!item] sentinel 로 item 변경 무시(포커스
  // 튐 방지)지만, observer 는 다른 단지 클릭 시 child 섹션 노드가 재생성되므로 [item?.apt.id] 로 재관찰.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [activeSection, setActiveSection] = useState<string>(JUMP_SECTIONS[0].id);
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || !item) return;
    const els = JUMP_SECTIONS
      .map((s) => root.querySelector<HTMLElement>(`#${s.id}`))
      .filter((el): el is HTMLElement => el != null);
    if (els.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        // 화면 상단(칩바 아래)에 가장 가까운 가시 섹션을 active 로.
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = visible[0].target.id;
        if (id) setActiveSection(id);
      },
      // root = 모달 내부 스크롤러. 칩바 높이만큼 상단 마진 보정(root:null 금지 — body 가 아니라 div 스크롤).
      { root, rootMargin: `-${JUMP_NAV_HEIGHT}px 0px -55% 0px`, threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [item?.apt.id, item]);

  // 칩 클릭 → 해당 섹션으로 점프. scrollIntoView 는 모달 내부 스크롤러(bodyRef)에서 불안정해
  // (sticky 칩바·중첩 구조), 컨테이너를 직접 scrollTo 한다. 보정은 칩바 높이만큼 빼서 단일 적용.
  // el.offsetTop 은 offsetParent 기준이므로 bodyRef 가 position:relative(아래 렌더 style) 여야 정확.
  const handleJump = (id: string) => {
    const root = bodyRef.current;
    const el = root?.querySelector<HTMLElement>(`#${id}`);
    if (root && el && typeof root.scrollTo === "function") {
      root.scrollTo({ top: Math.max(0, el.offsetTop - JUMP_NAV_HEIGHT), behavior: "smooth" });
      setActiveSection(id);
    }
  };

  if (!item) return null;
  const { apt, res } = item;
  const zone = getZone(apt.region as string, apt.gu as string);
  const zoneName = (ZONE_TYPE as Record<string, string>)[zone];
  const radarData = (Object.values(res.cats) as Array<{ label: string; total: number }>).map((c) => ({ l: (SHORT_LABEL as Record<string, string>)[c.label] || c.label, v: c.total }));

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
        <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", position: "relative", padding: isDesktop ? "0 24px 24px 24px" : `0 16px calc(20px + env(safe-area-inset-bottom, 0px)) 16px` }}>

        <StickyJumpNav sections={JUMP_SECTIONS} activeId={activeSection} totalScore={res.total} onJump={handleJump} isDesktop={isDesktop} />

        {/* §1 종합 — ScoreBadge + Radar/핵심지표 + 혜택칩 + 재공고배지 */}
        <section id="sec-overview" style={{ margin: 0, padding: 0, scrollMarginTop: JUMP_NAV_HEIGHT }}>
        <div style={DM_S.scoreBadgeWrap}>
          <ScoreBadge score={res.total} size={80} />
        </div>

        <div style={DM_S.radarRow}>
          <div style={{ flexShrink: 0 }}><Radar data={radarData} size={isDesktop ? 180 : 150} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={DM_S.metricsHead}>핵심 지표</div>
            {[
              { l: "지역", v: [apt.region, apt.gu, apt.dong].filter(Boolean).join(" "), c: C.blue },
              { l: "분양가", v: fmtPrice(apt.price) },
              { l: "적정가 괴리", v: res.cats.price.deviation != null ? `${Number(res.cats.price.deviation) > 0 ? "+" : ""}${res.cats.price.deviation}%` : "—", c: res.cats.price.deviation != null ? (Number(res.cats.price.deviation) > 0 ? C.green : C.red) : C.muted },
              { l: "전세가율", v: apt.jeonseRate != null ? `${apt.jeonseRate}%` : "-" },
              { l: "미분양률", v: apt.unsoldRate != null ? `${apt.unsoldRate}%` : "—", c: apt.unsoldRate != null ? (apt.unsoldRate > UNSOLD_WARN_THRESHOLD ? C.red : C.green) : C.muted },
              { l: "규제현황", v: zoneName, c: zone === "normal" ? C.green : C.red },
              { l: "LTV한도", v: fmtPrice(calcLTV(apt.price, zone)), c: C.blue },
              { l: "입주", v: fmtCompletion(apt.completion) },
            ].map((r, i) => (
              <div key={i} style={DM_S.metricsRow}>
                <span style={DM_S.metricsLabel}>{r.l}</span>
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
        </section>

        {/* §2 시세 — PriceTable + PriceChart + UnsoldChart */}
        <section id="sec-price" style={{ margin: 0, padding: 0, scrollMarginTop: JUMP_NAV_HEIGHT }}>
        <PriceTable apt={mergedApt ?? apt} isLoading={pricesLoading} error={pricesError} />
        <PriceChart apartmentId={apt.id as string} siblingIds={apt.siblingIds as string[] | undefined} />
        <UnsoldChart apartmentId={apt.id as string} siblingIds={apt.siblingIds as string[] | undefined} />
        </section>

        {/* §3 입지 — SchoolInfo + NearbyChildcare */}
        <section id="sec-location" style={{ margin: 0, padding: 0, scrollMarginTop: JUMP_NAV_HEIGHT }}>
        <SchoolInfo apt={apt} />

        <NearbyChildcareSection apt={apt} />
        </section>

        {/* §4 분양 — PresaleInfo + MarketStatsCharts(KOSIS 지역 거시통계) */}
        <section id="sec-presale" style={{ margin: 0, padding: 0, scrollMarginTop: JUMP_NAV_HEIGHT }}>
        <PresaleInfo apt={apt} />

        <MarketStatsCharts region={apt.region} gu={apt.gu} />
        </section>

        {/* §5 금융 — LoanAnalysis (이 단지 대출 시뮬레이션) */}
        <section id="sec-finance" style={{ margin: 0, padding: 0, scrollMarginTop: JUMP_NAV_HEIGHT }}>
        <LoanAnalysis apt={mergedApt ?? apt} isLoading={pricesLoading} error={pricesError} />
        </section>

        {/* §6 점수 — DataSections(공공데이터) + 액션버튼 + CatPanel×6 */}
        <section id="sec-score" style={{ margin: 0, padding: 0, scrollMarginTop: JUMP_NAV_HEIGHT }}>
        <DataSections apt={mergedApt ?? apt} />
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

        {Object.entries(res.cats).map(([k, c]) => <CatPanel key={k} cat={c} k={k} />)}
        </section>

        </div>
      </div>
    </div>
  );
});