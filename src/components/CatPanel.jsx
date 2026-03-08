import { memo, useState } from "react";
import { C, catCol, gr } from "@/theme";
import { Bar } from "./primitives";
import { SUB_CONTEXT, PRODUCT_MAX } from "@/constants/subContext";

function getDots(score, catKey, subName) {
  if (catKey === "benefit") return -1;
  return Math.round(normalizeScore(score, catKey, subName) / 20);
}

function renderDots(n) {
  if (n < 0) return null;
  const filled = Math.max(0, Math.min(n, 5));
  return (
    <span style={{ fontSize: 10, letterSpacing: 1, color: C.muted }} aria-label={`${filled}/5점`}>
      {"●".repeat(filled)}{"○".repeat(5 - filled)}
    </span>
  );
}

function normalizeScore(score, catKey, subName) {
  if (catKey === "product") return Math.round(score / (PRODUCT_MAX[subName] || 10) * 100);
  return score;
}

function scoreColor(score, catKey, subName) {
  if (catKey === "benefit") return C.amber;
  const n = normalizeScore(score, catKey, subName);
  return n >= 70 ? C.green : n >= 40 ? C.amber : C.red;
}

function getHighlights(subs, catKey) {
  if (catKey === "benefit") {
    return subs.filter(s => s.info !== "-").slice(0, 3);
  }
  return [...subs]
    .sort((a, b) => {
      const na = normalizeScore(a.score, catKey, a.name);
      const nb = normalizeScore(b.score, catKey, b.name);
      return Math.abs(nb - 50) - Math.abs(na - 50);
    })
    .slice(0, 3);
}

export const CatPanel = memo(function CatPanel({ cat, k }) {
  const [expanded, setExpanded] = useState(false);
  const col = catCol[k];
  const grade = gr(cat.total);
  const ctx = SUB_CONTEXT[k] || {};
  const highlights = getHighlights(cat.subs, k);

  return (
    <div style={{ marginBottom: 12, background: C.bg, borderRadius: 10, padding: "10px 12px", border: `1px solid ${C.border}` }}>
      <div
        onClick={() => setExpanded(v => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(v => !v); } }}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{cat.label}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: grade.c, background: grade.bg, padding: "2px 8px", borderRadius: 4 }}>{grade.l}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: col }}>{cat.total}</span>
          <span style={{ fontSize: 12, color: C.muted, transition: "transform .2s", transform: expanded ? "rotate(180deg)" : "rotate(0)", display: "inline-block" }}>▼</span>
        </div>
      </div>

      <Bar value={cat.total} color={col} h={5} />

      {highlights.length > 0 && <div style={{ marginTop: 6 }}>
        {highlights.map((s, i) => {
          const sc = ctx[s.name];
          const interp = sc?.interpret?.(s.score);
          return (
            <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 0" }}>
              <span style={{ fontSize: 11, color: C.muted, flexShrink: 0 }}>·</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{s.name}:</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: col }}>{s.info}</span>
              {interp && <span style={{ fontSize: 11, color: scoreColor(s.score, k, s.name) }}>→ {interp}</span>}
            </div>
          );
        })}
      </div>}

      {expanded && (
        <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
          {cat.subs.map((s, i) => {
            const sc = ctx[s.name];
            const dots = getDots(s.score, k, s.name);
            const interp = sc?.interpret?.(s.score);
            const sc2 = scoreColor(s.score, k, s.name);
            return (
              <div key={i} style={{ padding: "6px 0", borderBottom: i < cat.subs.length - 1 ? `1px solid ${C.border}` : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{s.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: col }}>{s.info}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {renderDots(dots)}
                    {interp && <span style={{ fontSize: 11, color: sc2 }}>{interp}</span>}
                  </div>
                  {sc?.benchmark && <span style={{ fontSize: 10, color: C.muted }}>기준: {sc.benchmark}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
