import { memo } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";

// 생활인프라 2열 그리드 (개수>0 우선 정렬)
// pairs: [[countField, distField|null], ...]
export const InfrastructureSection = memo(function InfrastructureSection({ pairs, apt }) {
  const sorted = [...pairs].sort(
    (a, b) => ((apt[b[0]] ?? 0) > 0 ? 1 : 0) - ((apt[a[0]] ?? 0) > 0 ? 1 : 0)
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
      {sorted.map(([countF, distF]) => {
        const meta = FIELD_META[countF];
        if (!meta) return null;
        const count = apt[countF] ?? 0;
        const dist = distF ? apt[distF] : null;
        const dimmed = count === 0;
        return (
          <div key={countF} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", opacity: dimmed ? 0.4 : 1 }}>
            <span style={{ fontSize: F.xs, color: C.muted }}>{meta.label}</span>
            <span style={{ fontSize: F.xs, fontWeight: 600, color: dimmed ? C.muted : C.text }}>
              {count}{meta.unit ?? ""}{dist != null ? ` (${dist}m)` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
});
