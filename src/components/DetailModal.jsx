import { memo, useEffect, useRef } from "react";
import { C, F, SHORT_LABEL } from "@/theme";
import { getZone, calcLTV, ZONE_TYPE } from "@/constants/regulations";
import { ScoreBadge, Radar } from "./primitives";
import { CatPanel } from "./CatPanel";
import { fmtPrice, fmtCompletion } from "@/lib/format";
import { PriceTable } from "./detail/PriceTable";
import { SchoolInfo } from "./detail/SchoolInfo";
import { LoanAnalysis } from "./detail/LoanAnalysis";
import { DataSections } from "./detail/DataSections";

const UNSOLD_WARN_THRESHOLD = 15;
import { PresaleInfo } from "./detail/PresaleInfo";
import { PriceChart } from "./detail/PriceChart";
import { UnsoldChart } from "./detail/UnsoldChart";
import { MarketStatsCharts } from "./detail/MarketStatsCharts";
import { IconClose } from "./icons";

const DM_S = {
  dragBar: { width: 40, height: 4, background: C.border, borderRadius: 2, margin: "0 auto 12px", cursor: "pointer" },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  closeBtn: { background: C.slate100, border: "none", borderRadius: "50%", width: 44, height: 44, cursor: "pointer", color: C.muted, display: "flex", alignItems: "center", justifyContent: "center" },
  scoreBadgeWrap: { textAlign: "center", marginBottom: 16 },
  radarRow: { display: "flex", gap: 8, alignItems: "center", padding: "0 0 12px" },
  metricsHead: { fontSize: F.md, fontWeight: 700, color: C.text, marginBottom: 6 },
  metricsRow: { display: "flex", justifyContent: "space-between", padding: "4px 0" },
  metricsLabel: { fontSize: F.base, color: C.muted },
  benefitsBox: { background: C.amberLight, borderRadius: 10, padding: "8px 10px", marginBottom: 10, border: `1px solid ${C.amberBorder}` },
  benefitsHead: { fontSize: F.base, fontWeight: 700, color: C.amber, marginBottom: 4 },
  benefitsChipRow: { display: "flex", flexWrap: "wrap", gap: 4 },
  benefitsChip: { fontSize: F.sm, color: C.amber, background: C.white, padding: "4px 10px", borderRadius: 4, border: `1px solid ${C.amberBorder}` },
  republishBadge: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: F.sm, color: C.amber, background: C.amberLight, border: `1px solid ${C.amberBorder}`, borderRadius: 6, padding: "3px 8px", marginBottom: 8 },
  actionRow: { display: "flex", gap: 8, marginBottom: 16 },
};

export const DetailModal = memo(function DetailModal({ item, onClose, isComp, onComp, isFav, onFav, onShare, isPC, isDesktop, onConsult }) {
  const closeRef = useRef(null);
  const prevFocusRef = useRef(null);
  useEffect(() => {
    if (!item) return;
    prevFocusRef.current = document.activeElement;
    document.body.style.overflow = "hidden";
    // 모달 열림 시 닫기 버튼으로 포커스 이동 (모바일 가상키보드 방지)
    requestAnimationFrame(() => closeRef.current?.focus());
    const handleKey = (e) => {
      if (e.key === "Escape") { onClose(); return; }
      // 포커스 트랩: Tab 키가 모달 내부에서만 순환
      if (e.key === "Tab") {
        const modal = closeRef.current?.closest('[role="dialog"]');
        if (!modal) return;
        const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKey);
      // 모달 닫힘 시 이전 포커스 복원
      prevFocusRef.current?.focus?.();
    };
  }, [!!item, onClose]);

  if (!item) return null;
  const { apt, res } = item;
  const zone = getZone(apt.region, apt.gu);
  const zoneName = ZONE_TYPE[zone];
  const radarData = Object.entries(res.cats).map(([k, c]) => ({ l: SHORT_LABEL[c.label] || c.label, v: c.total }));

  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, left: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: isPC ? "center" : "flex-end", justifyContent: "center" }} onClick={onClose} role="dialog" aria-modal="true" aria-label={`${apt.name} 상세 분석`}>
      <div style={{ background: C.card, borderRadius: isPC ? 20 : "20px 20px 0 0", width: "100%", maxWidth: isDesktop ? 760 : isPC ? 640 : 520, maxHeight: isPC ? "92dvh" : "95dvh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: isPC ? "0 8px 40px rgba(0,0,0,0.2)" : "0 -8px 30px rgba(0,0,0,0.15)" }} onClick={e => e.stopPropagation()}>
        <div style={{ flexShrink: 0, padding: isDesktop ? "16px 24px 0" : "12px 16px 0", borderBottom: `1px solid ${C.border}`, background: C.card }}>
          {!isDesktop && <div onClick={onClose} style={DM_S.dragBar} />}
          <div style={DM_S.headerRow}>
            <div>
              <div style={{ fontSize: isDesktop ? F.xl : F.lg, fontWeight: 800, color: C.text }}>{apt.name}</div>
              <div style={{ fontSize: isDesktop ? F.base : F.sm, color: C.muted }}>{[apt.region, apt.gu, apt.dong].filter(Boolean).join(" ")} · {apt.area}㎡ · {fmtPrice(apt.price)}</div>
              {apt.address && <div style={{ fontSize: F.sm, color: C.muted, marginTop: 2 }}>{apt.address}{apt.district ? ` (${apt.district})` : ""}</div>}
              {apt.roadAddress && <div style={{ fontSize: F.sm, color: C.muted }}>{apt.roadAddress}</div>}
            </div>
            <button ref={closeRef} onClick={onClose} aria-label="닫기" style={DM_S.closeBtn}><IconClose size={18} /></button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: isDesktop ? "0 24px 24px 24px" : `0 16px calc(20px + env(safe-area-inset-bottom, 0px)) 16px` }}>

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

        {apt.benefits && apt.benefits.length > 0 && (
          <div style={DM_S.benefitsBox}>
            <div style={DM_S.benefitsHead}>혜택 상세</div>
            <div style={DM_S.benefitsChipRow}>
              {apt.benefits.map((b, i) => (
                <span key={i} style={DM_S.benefitsChip}>{b}</span>
              ))}
            </div>
          </div>
        )}


        {apt.siblingIds?.length > 1 && (
          <div style={DM_S.republishBadge}>
            재공고 {apt.siblingIds.length}회 · 시계열 통합 조회
          </div>
        )}

        <PriceTable apt={apt} />
        <PriceChart apartmentId={apt.id} siblingIds={apt.siblingIds} />
        <UnsoldChart apartmentId={apt.id} siblingIds={apt.siblingIds} />

        <SchoolInfo apt={apt} />

        <PresaleInfo apt={apt} />

        <LoanAnalysis apt={apt} />

        <MarketStatsCharts region={apt.region} gu={apt.gu} />

        <DataSections apt={apt} />
        {onConsult && (
          <button onClick={() => onConsult(apt.id)} style={{
            width: "100%", background: C.blue, color: C.white, border: "none", borderRadius: 8,
            padding: "12px 0", fontSize: F.base, fontWeight: 700, cursor: "pointer", minHeight: 44,
            marginBottom: 8, transition: "all .15s",
          }}>이 매물 상담하기</button>
        )}
        <div style={DM_S.actionRow}>
          <button onClick={() => onFav(apt.id)} style={{
            flex: 1, background: isFav ? C.redLight : C.slate100, color: isFav ? C.red : C.muted,
            border: isFav ? `1.5px solid ${C.red}` : "1.5px solid transparent", borderRadius: 8, padding: isDesktop ? "12px 0" : "10px 0", fontSize: isDesktop ? F.md : F.base, fontWeight: 700, cursor: "pointer", minHeight: 44, transition: "all .15s"
          }}>{isFav ? "관심 등록됨" : "관심매물 추가"}</button>
          <button onClick={() => onComp(apt.id)} style={{
            flex: 1, background: isComp ? C.indigo : "transparent", color: isComp ? C.white : C.indigo,
            border: `1.5px solid ${C.indigo}`, borderRadius: 8, padding: isDesktop ? "12px 0" : "10px 0", fontSize: isDesktop ? F.md : F.base, fontWeight: 700, cursor: "pointer", minHeight: 44, transition: "all .15s"
          }}>{isComp ? "비교 중" : "비교 추가"}</button>
          {onShare && <button onClick={() => onShare(apt.id)} aria-label="이 단지 공유하기" style={{
            flex: 1, background: C.slate100, color: C.slate600,
            border: "1.5px solid transparent", borderRadius: 8, padding: isDesktop ? "12px 0" : "10px 0", fontSize: isDesktop ? F.md : F.base, fontWeight: 700, cursor: "pointer", minHeight: 44, transition: "all .15s"
          }}>공유</button>}
        </div>

        {Object.entries(res.cats).map(([k, c]) => <CatPanel key={k} cat={c} k={k} />)}

        </div>
      </div>
    </div>
  );
});