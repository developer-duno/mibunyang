import { memo, useState } from "react";
import { C, F, catCol, gr } from "@/theme";
import { Bar } from "./primitives";
import { SUB_CONTEXT, PRODUCT_MAX } from "@/constants/subContext";
import type { Res } from "@/types/scoring";

type SubScoreItem = { name: string; score: number; info?: string };

type CatPanelProps = {
  cat: Res;
  k: string;
  emphasized?: boolean;
};

function getDots(score: number, catKey: string, subName: string): number {
  if (catKey === "benefit") return -1;
  return Math.round(normalizeScore(score, catKey, subName) / 20);
}

function renderDots(n: number) {
  if (n < 0) return null;
  const filled = Math.max(0, Math.min(n, 5));
  return (
    <span style={{ fontSize: F.xs, letterSpacing: 1, color: C.muted }} aria-label={`${filled}/5점`}>
      {"●".repeat(filled)}{"○".repeat(5 - filled)}
    </span>
  );
}

function normalizeScore(score: number, catKey: string, subName: string): number {
  if (catKey === "product") return Math.round(score / ((PRODUCT_MAX as Record<string, number>)[subName] || 10) * 100);
  return score;
}

function scoreColor(score: number, catKey: string, subName: string): string {
  if (catKey === "benefit") return C.amber;
  const n = normalizeScore(score, catKey, subName);
  return n >= 70 ? C.green : n >= 40 ? C.amber : C.red;
}

function getHighlights(subs: SubScoreItem[], catKey: string): SubScoreItem[] {
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

export const CatPanel = memo(function CatPanel({ cat, k, emphasized }: CatPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const col = (catCol as Record<string, string>)[k];
  const grade = gr(cat.total);
  const ctx = (SUB_CONTEXT as unknown as Record<string, Record<string, { interpret?: ((_sc: number) => string) | null; benchmark?: string | null }>>)[k] || {};
  const highlights = getHighlights(cat.subs as SubScoreItem[], k);

  return (
    <div style={{ marginBottom: 12, background: C.bg, borderRadius: 10, padding: "10px 12px", border: emphasized ? `2px solid ${col}` : `1px solid ${C.border}` }}>
      <div
        onClick={() => setExpanded(v => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(v => !v); } }}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: F.md, fontWeight: 700, color: C.text }}>{cat.label}</span>
          <span style={{ fontSize: F.sm, fontWeight: 700, color: grade.c, background: grade.bg, padding: "2px 8px", borderRadius: 4 }}>{grade.l}</span>
          {emphasized && <span style={{ fontSize: F.xs, fontWeight: 700, color: col, background: C.bg, border: `1px solid ${col}`, padding: "2px 6px", borderRadius: 4 }}>★ 중점</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: F.lg, fontWeight: 800, color: col }}>{cat.total}</span>
          <span style={{ fontSize: F.sm, color: C.muted, transition: "transform .2s", transform: expanded ? "rotate(180deg)" : "rotate(0)", display: "inline-block" }}>▼</span>
        </div>
      </div>

      <Bar value={cat.total} color={col} h={5} />

      {highlights.length > 0 && <div style={{ marginTop: 6 }}>
        {highlights.map((s) => {
          const sc = ctx[s.name];
          const interp = sc?.interpret?.(s.score);
          return (
            <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 0" }}>
              <span style={{ fontSize: F.xs, color: C.muted, flexShrink: 0 }}>·</span>
              <span style={{ fontSize: F.base, fontWeight: 600, color: C.text }}>{s.name}:</span>
              <span style={{ fontSize: F.base, fontWeight: 700, color: col }}>{s.info}</span>
              {interp && <span style={{ fontSize: F.sm, color: scoreColor(s.score, k, s.name) }}>→ {interp}</span>}
            </div>
          );
        })}
      </div>}

      {expanded && (
        <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
          {(cat.subs as SubScoreItem[]).map((s: SubScoreItem, i: number) => {
            const sc = ctx[s.name];
            const dots = getDots(s.score, k, s.name);
            const interp = sc?.interpret?.(s.score);
            const sc2 = scoreColor(s.score, k, s.name);
            return (
              <div key={s.name} style={{ padding: "6px 0", borderBottom: i < cat.subs.length - 1 ? `1px solid ${C.border}` : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: F.base, fontWeight: 600, color: C.text }}>{s.name}</span>
                  <span style={{ fontSize: F.base, fontWeight: 700, color: col }}>{s.info}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {renderDots(dots)}
                    {interp && <span style={{ fontSize: F.sm, color: sc2 }}>{interp}</span>}
                  </div>
                  {sc?.benchmark && <span style={{ fontSize: F.xs, color: C.muted }}>기준: {sc.benchmark}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
