import { memo } from "react";
import { C, catCol, catBg, gr } from "@/theme";
import { Bar } from "./primitives";

export const CatPanel = memo(function CatPanel({ cat, k }) {
  const col = catCol[k], bg = catBg[k];
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{cat.label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: col }}>{cat.total}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: col, background: bg, padding: "2px 8px", borderRadius: 4 }}>{gr(cat.total).l}</span>
        </div>
      </div>
      <Bar value={cat.total} color={col} h={5} />
      <div style={{ marginTop: 4 }}>
        {cat.subs.map((s, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
            <span style={{ fontSize: 12, color: C.muted }}>{s.name}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: C.muted }}>{s.info}</span>
              {s.score > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: s.score >= 70 ? C.green : s.score >= 40 ? C.amber : C.red, minWidth: 18, textAlign: "right" }}>{s.score}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
