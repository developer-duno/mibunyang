import { memo } from "react";
import { C, catCol, gr } from "@/theme";

export const CompareSheet = memo(function CompareSheet({ items, onShare }) {
  if (items.length < 2) return null;
  const cats = Object.keys(items[0].res.cats);
  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.blueBorder}`, borderRadius: 16, padding: 14, marginBottom: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.blue }}>비교 분석</div>
        {onShare && <button onClick={onShare} aria-label="비교 결과 공유하기" style={{
          background: C.slate100, color: C.slate600, border: "1.5px solid transparent", borderRadius: 6,
          padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", minHeight: 36, transition: "all .15s"
        }}>공유</button>}
      </div>
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 320 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${C.border}` }}>
              <th style={{ textAlign: "left", padding: "8px 6px", color: C.muted, fontWeight: 600, fontSize: 12 }}>항목</th>
              {items.map((it, i) => <th key={i} style={{ textAlign: "center", padding: "8px 6px", color: C.text, fontWeight: 700, fontSize: 12 }}>{it.apt.name.split(" ").pop()}<br/><span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>{it.apt.region}</span></th>)}
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "10px 6px", fontWeight: 700, color: C.text }}>종합</td>
              {items.map((it, i) => { const g2 = gr(it.res.total); const isMax = it.res.total === Math.max(...items.map(x => x.res.total)); return (
                <td key={i} style={{ textAlign: "center", padding: "10px 6px" }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: g2.c }}>{it.res.total}</span>
                  {isMax && <span style={{ fontSize: 11, fontWeight: 700, color: C.blue, display: "block", background: C.blueLight, borderRadius: 4, padding: "1px 6px", marginTop: 2 }}>최고</span>}
                </td>
              ); })}
            </tr>
            {cats.map((k, idx) => { const scores = items.map(it => it.res.cats[k].total); const mx = Math.max(...scores); return (
              <tr key={k} style={{ borderBottom: `1px solid ${C.border}`, background: idx % 2 === 1 ? "#FAFBFD" : "transparent" }}>
                <td style={{ padding: "8px 6px", color: C.sub, fontSize: 11 }}>{items[0].res.cats[k].label.split("·")[0]}</td>
                {scores.map((s, i) => <td key={i} style={{ textAlign: "center", padding: "8px 6px" }}><span style={{ fontWeight: 700, color: s === mx ? catCol[k] : C.muted }}>{s}</span></td>)}
              </tr>
            ); })}
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "8px 6px", color: C.sub, fontSize: 11 }}>분양가</td>
              {items.map((it, i) => <td key={i} style={{ textAlign: "center", padding: "8px 6px", fontWeight: 600, color: C.text }}>{(it.apt.price / 10000).toFixed(1)}억</td>)}
            </tr>
            <tr>
              <td style={{ padding: "8px 6px", color: C.sub, fontSize: 11 }}>총혜택</td>
              {items.map((it, i) => <td key={i} style={{ textAlign: "center", padding: "8px 6px", fontWeight: 600, color: C.amber }}>{it.res.cats.benefit.totalWon?.toLocaleString() || 0}만</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
});
