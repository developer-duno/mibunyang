import { memo, useEffect } from "react";
import { C, catCol, catBg, gr, SHORT_LABEL } from "@/theme";
import { ScoreBadge, Radar } from "./primitives";
import { CatPanel } from "./CatPanel";

export const DetailModal = memo(function DetailModal({ item, onClose, isComp, onComp, isFav, onFav, onShare }) {
  if (!item) return null;
  const { apt, res } = item;
  const g = gr(res.total);
  const radarData = Object.entries(res.cats).map(([k, c]) => ({ l: SHORT_LABEL[c.label] || c.label, v: c.total }));

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, left: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: C.card, borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 520, maxHeight: "90dvh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 -8px 30px rgba(0,0,0,0.15)" }} onClick={e => e.stopPropagation()}>
        <div style={{ flexShrink: 0, padding: "12px 16px 0", borderBottom: `1px solid ${C.border}`, background: C.card }}>
          <div onClick={onClose} style={{ width: 40, height: 4, background: C.border, borderRadius: 2, margin: "0 auto 12px", cursor: "pointer" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{apt.name}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{apt.region} {apt.gu} · {apt.area}㎡ · {(apt.price / 10000).toFixed(1)}억</div>
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
              { l: "지역", v: `${apt.region} ${apt.gu}`, c: C.blue },
              { l: "분양가", v: `${apt.price.toLocaleString()}만` },
              { l: "적정가 괴리", v: `${Number(res.cats.price.deviation) > 0 ? "+" : ""}${res.cats.price.deviation}%`, c: Number(res.cats.price.deviation) > 0 ? C.green : C.red },
              { l: "전세가율", v: `${apt.jeonseRate}%` },
              { l: "미분양률", v: `${apt.unsoldRate}%`, c: apt.unsoldRate > 15 ? C.red : C.green },
              { l: "입주", v: apt.completion },
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

        <div style={{ background: C.bg, borderRadius: 10, padding: "8px 10px", marginTop: 6 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>가중치 산출 내역</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {Object.entries(res.cats).map(([k, c]) => (
              <span key={k} style={{ fontSize: 11, color: catCol[k], background: catBg[k], padding: "3px 8px", borderRadius: 4, fontWeight: 600 }}>
                {SHORT_LABEL[c.label] || c.label} {c.total}×{res.weights[k]}%={Math.round(c.total * res.weights[k] / 100)}
              </span>
            ))}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
});
