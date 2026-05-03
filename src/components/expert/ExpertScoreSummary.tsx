import { memo } from "react";
import { C, F, catCol, gr } from "@/theme";
import { PROFILES } from "@/constants/profiles";
import type { ExpertScoreSummaryProps } from "@/types/expert";

export const ExpertScoreSummary = memo(function ExpertScoreSummary({ res, profile }: ExpertScoreSummaryProps) {
  const w = PROFILES[profile]?.w || PROFILES.live.w;
  const g = gr(res.total);
  const catKeys = Object.keys(res.cats);
  return (
    <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: F.base, fontWeight: 800, color: C.text, marginBottom: 10, borderBottom: `2px solid ${C.text}`, paddingBottom: 6 }}>최종 가중 합계 — {PROFILES[profile]?.name || profile}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: F.sm }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${C.border}` }}>
            <th style={{ textAlign: "left", padding: "8px 4px", color: C.muted }}>카테고리</th>
            <th style={{ textAlign: "center", padding: "8px 4px", color: C.muted }}>점수</th>
            <th style={{ textAlign: "center", padding: "8px 4px", color: C.muted }}>가중치</th>
            <th style={{ textAlign: "right", padding: "8px 4px", color: C.muted }}>기여분</th>
          </tr>
        </thead>
        <tbody>
          {catKeys.map(k => {
            const cat = res.cats[k as keyof typeof res.cats];
            const weight = w[k as keyof typeof w] || 0;
            return (
              <tr key={k} style={{ borderBottom: `1px solid ${C.bg}` }}>
                <td style={{ padding: "6px 4px", fontWeight: 600, color: (catCol as Record<string, string>)[k] }}>{cat.label}</td>
                <td style={{ textAlign: "center", padding: "6px 4px", fontWeight: 700 }}>{cat.total}</td>
                <td style={{ textAlign: "center", padding: "6px 4px", color: C.muted }}>{weight}%</td>
                <td style={{ textAlign: "right", padding: "6px 4px", fontWeight: 700, color: C.text }}>{(cat.total * weight / 100).toFixed(1)}</td>
              </tr>
            );
          })}
          <tr style={{ borderTop: `2px solid ${C.text}` }}>
            <td style={{ padding: "8px 4px", fontWeight: 800, color: C.text }}>합계</td>
            <td />
            <td style={{ textAlign: "center", padding: "8px 4px", fontWeight: 700 }}>100%</td>
            <td style={{ textAlign: "right", padding: "8px 4px", fontWeight: 800, fontSize: F.base, color: g.c }}>{res.total}점 ({g.l})</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
});
