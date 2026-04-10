import { memo } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";

export const ExpertFieldTable = memo(function ExpertFieldTable({ apt, fields, title, color, exclude }) {
  return (
    <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: F.base, fontWeight: 800, color: color || C.indigo, marginBottom: 10, borderBottom: `2px solid ${color || C.indigo}`, paddingBottom: 6 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        {fields.map(fk => {
          const meta = FIELD_META[fk];
          if (!meta || meta.hidden) return null;
          if (exclude?.includes(fk)) return null;
          const raw = apt[fk] ?? null;
          const val = meta.fmt ? meta.fmt(raw, apt) : (raw ?? "미수집");
          const isDef = meta.isDefault && meta.isDefault(raw);
          const isMissing = raw == null && (val === "—" || val === "미수집");
          return (
            <div key={fk} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", borderBottom: `1px solid ${C.border}`, fontSize: F.sm }}>
              <span style={{ color: C.muted, flexShrink: 0 }}>{meta.label}</span>
              <span title={isDef ? "이 값은 기본값/추정값입니다" : undefined} style={{ fontWeight: 600, color: isMissing ? C.muted : isDef ? C.amber : C.text, textAlign: "right", marginLeft: 8, fontStyle: isMissing ? "italic" : "normal" }}>{String(val)}{isDef ? " ⚠" : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
