import { memo } from "react";
import { C, F } from "@/theme";
import { Bar } from "../primitives";
import { FIELD_META } from "@/constants/fieldMeta";
import type { InfrastructureSectionProps } from "@/types/detail";

// 거리 막대 대상 distField — 반경 1km 안에 분포(라이브 실측 max ~990m, 채움률 96~99%).
// martDist(채움률 41%)·emergencyDist(p50 1431m·1km 밖)는 제외해 텍스트만 유지.
const BARRED_DIST = new Set(["hospitalDist", "convDist", "parkDist", "childcareDist"]);

// 거리(m) → 막대 비율(0~100). 가까울수록 길게 (0m=100, 1000m=0). Bar 가 0~100 클램핑.
const distToBarValue = (dist: number) => (1000 - dist) / 10;

// 생활인프라 2열 그리드 (개수>0 우선 정렬)
// pairs: [[countField, distField|null], ...]
export const InfrastructureSection = memo(function InfrastructureSection({ pairs, apt }: InfrastructureSectionProps) {
  const sorted = [...pairs].sort(
    (a, b) => (Number(apt[b[0]] ?? 0) > 0 ? 1 : 0) - (Number(apt[a[0]] ?? 0) > 0 ? 1 : 0)
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", alignItems: "start" }}>
      {sorted.map(([countF, distF]) => {
        const meta = (FIELD_META as Record<string, { label: string; unit?: string }>)[countF];
        if (!meta) return null;
        const count = Number(apt[countF] ?? 0);
        const dist = distF ? apt[distF] : null;
        const dimmed = count === 0;
        const distNum = dist != null ? Number(dist) : null;
        const showBar = distF != null && BARRED_DIST.has(distF) && distNum != null && Number.isFinite(distNum);
        return (
          <div key={countF} style={{ padding: "3px 0", opacity: dimmed ? 0.4 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: F.xs, color: C.muted }}>{meta.label}</span>
              <span style={{ fontSize: F.xs, fontWeight: 600, color: dimmed ? C.muted : C.text }}>
                {count}{meta.unit ?? ""}{dist != null ? ` (${String(dist)}m)` : ""}
              </span>
            </div>
            {showBar && (
              <div style={{ marginTop: 3 }}>
                <Bar value={distToBarValue(distNum)} h={4} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
