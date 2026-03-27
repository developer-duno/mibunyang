import { memo, useEffect } from "react";
import { C, SHORT_LABEL } from "@/theme";
import { getZone, calcLTV, ZONE_TYPE } from "@/constants/regulations";
import { ScoreBadge, Radar } from "./primitives";
import { CatPanel } from "./CatPanel";
import { fmtPrice, fmtCompletion } from "@/lib/format";
import { PriceTable } from "./detail/PriceTable";
import { SchoolInfo } from "./detail/SchoolInfo";
import { LoanAnalysis } from "./detail/LoanAnalysis";
import { DataSections } from "./detail/DataSections";
import { PriceChart } from "./detail/PriceChart";
import { UnsoldChart } from "./detail/UnsoldChart";

export const DetailModal = memo(function DetailModal({ item, onClose, isComp, onComp, isFav, onFav, onShare, isPC, onConsult }) {
  useEffect(() => {
    if (!item) return;
    document.body.style.overflow = "hidden";
    const handleEsc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleEsc);
    return () => { document.body.style.overflow = ""; document.removeEventListener("keydown", handleEsc); };
  }, [!!item, onClose]);

  if (!item) return null;
  const { apt, res } = item;
  const zone = getZone(apt.region, apt.gu);
  const zoneName = ZONE_TYPE[zone];
  const radarData = Object.entries(res.cats).map(([k, c]) => ({ l: SHORT_LABEL[c.label] || c.label, v: c.total }));

  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, left: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: isPC ? "center" : "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: C.card, borderRadius: isPC ? 20 : "20px 20px 0 0", width: "100%", maxWidth: isPC ? 640 : 520, maxHeight: isPC ? "92dvh" : "95dvh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: isPC ? "0 8px 40px rgba(0,0,0,0.2)" : "0 -8px 30px rgba(0,0,0,0.15)" }} onClick={e => e.stopPropagation()}>
        <div style={{ flexShrink: 0, padding: "12px 16px 0", borderBottom: `1px solid ${C.border}`, background: C.card }}>
          <div onClick={onClose} style={{ width: 40, height: 4, background: C.border, borderRadius: 2, margin: "0 auto 12px", cursor: "pointer" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{apt.name}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{[apt.region, apt.gu, apt.dong].filter(Boolean).join(" ")} · {apt.area}㎡ · {fmtPrice(apt.price)}</div>
              {apt.address && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{apt.address}{apt.district ? ` (${apt.district})` : ""}</div>}
              {apt.roadAddress && <div style={{ fontSize: 11, color: C.muted }}>{apt.roadAddress}</div>}
            </div>
            <button onClick={onClose} aria-label="닫기" style={{ background: C.slate100, border: "none", borderRadius: "50%", width: 44, height: 44, fontSize: 18, cursor: "pointer", color: C.muted, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: `0 16px calc(20px + env(safe-area-inset-bottom, 0px)) 16px` }}>

        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <ScoreBadge score={res.total} size={80} />
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "0 0 12px" }}>
          <div style={{ flexShrink: 0 }}><Radar data={radarData} size={150} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>핵심 지표</div>
            {[
              { l: "지역", v: [apt.region, apt.gu, apt.dong].filter(Boolean).join(" "), c: C.blue },
              { l: "분양가", v: fmtPrice(apt.price) },
              { l: "적정가 괴리", v: `${Number(res.cats.price.deviation) > 0 ? "+" : ""}${res.cats.price.deviation}%`, c: Number(res.cats.price.deviation) > 0 ? C.green : C.red },
              { l: "전세가율", v: apt.jeonseRate != null ? `${apt.jeonseRate}%` : "-" },
              { l: "미분양률", v: apt.unsoldRate != null ? `${apt.unsoldRate}%` : "—", c: apt.unsoldRate != null ? (apt.unsoldRate > 15 ? C.red : C.green) : C.muted },
              { l: "규제현황", v: zoneName, c: zone === "normal" ? C.green : C.red },
              { l: "LTV한도", v: fmtPrice(calcLTV(apt.price, zone)), c: C.blue },
              { l: "입주", v: fmtCompletion(apt.completion) },
            ].map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                <span style={{ fontSize: 12, color: C.muted }}>{r.l}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: r.c || C.text }}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>

        {apt.benefits && apt.benefits.length > 0 && (
          <div style={{ background: C.amberLight, borderRadius: 10, padding: "8px 10px", marginBottom: 10, border: `1px solid ${C.amberBorder}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.amber, marginBottom: 4 }}>혜택 상세</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {apt.benefits.map((b, i) => (
                <span key={i} style={{ fontSize: 11, color: C.amber, background: C.white, padding: "4px 10px", borderRadius: 4, border: `1px solid ${C.amberBorder}` }}>{b}</span>
              ))}
            </div>
          </div>
        )}


        <PriceTable apt={apt} />
        <PriceChart apartmentId={apt.id} />
        <UnsoldChart apartmentId={apt.id} />

        <SchoolInfo apt={apt} />

        <LoanAnalysis apt={apt} />

        <DataSections apt={apt} />
        {onConsult && (
          <button onClick={() => onConsult(apt.id)} style={{
            width: "100%", background: C.blue, color: C.white, border: "none", borderRadius: 8,
            padding: "12px 0", fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 44,
            marginBottom: 8, transition: "all .15s",
          }}>이 매물 상담하기</button>
        )}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button onClick={() => onFav(apt.id)} style={{
            flex: 1, background: isFav ? C.redLight : C.slate100, color: isFav ? C.red : C.muted,
            border: isFav ? `1.5px solid ${C.red}` : "1.5px solid transparent", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 44, transition: "all .15s"
          }}>{isFav ? "관심 등록됨" : "관심매물 추가"}</button>
          <button onClick={() => onComp(apt.id)} style={{
            flex: 1, background: isComp ? C.indigo : "transparent", color: isComp ? C.white : C.indigo,
            border: `1.5px solid ${C.indigo}`, borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 44, transition: "all .15s"
          }}>{isComp ? "비교 중" : "비교 추가"}</button>
          {onShare && <button onClick={() => onShare(apt.id)} aria-label="이 단지 공유하기" style={{
            flex: 1, background: C.slate100, color: C.slate600,
            border: "1.5px solid transparent", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 44, transition: "all .15s"
          }}>공유</button>}
        </div>

        {Object.entries(res.cats).map(([k, c]) => <CatPanel key={k} cat={c} k={k} />)}

        </div>
      </div>
    </div>
  );
});