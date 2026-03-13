import { memo } from "react";
import { C } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";

export const ExpertFieldTable = memo(function ExpertFieldTable({ apt, fields, title, color, exclude }) {
  return (
    <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: color || C.indigo, marginBottom: 10, borderBottom: `2px solid ${color || C.indigo}`, paddingBottom: 6 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0" }}>
        {fields.map(fk => {
          const meta = FIELD_META[fk];
          if (!meta || meta.hidden) return null;
          if (exclude?.includes(fk)) return null;
          const raw = apt[fk] ?? null;
          const val = meta.fmt ? meta.fmt(raw, apt) : (raw ?? "—");
          const isDef = meta.isDefault && meta.isDefault(raw);
          const isMissing = raw == null && val === "—";
          return (
            <div key={fk} style={{ display: "flex", justifyContent: "space-between", padding: "6px 8px", borderBottom: `1px solid ${C.bg}`, fontSize: 12 }}>
              <span style={{ color: C.muted, flexShrink: 0 }}>{meta.label}</span>
              <span style={{ fontWeight: 600, color: isMissing ? C.muted : isDef ? C.amber : C.text, textAlign: "right", marginLeft: 8, fontStyle: isMissing ? "italic" : "normal" }}>{String(val)}{isDef ? " ⚠" : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
