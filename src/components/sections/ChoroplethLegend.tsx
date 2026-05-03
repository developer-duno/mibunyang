import { memo } from "react";
import { C, F, gr } from "@/theme";

// 색칠 지도 범례 — 점수 6단계(S/A/B+/B/C/D) 색 박스 + 라벨
// gr() 색 매핑 재사용. 우하단 absolute 오버레이.

const TIERS = [
  { score: 95, label: "S 90+" },
  { score: 85, label: "A 80~89" },
  { score: 75, label: "B+ 70~79" },
  { score: 65, label: "B 60~69" },
  { score: 55, label: "C 50~59" },
  { score: 45, label: "D <50" },
];

type ChoroplethLegendProps = { isPC?: boolean; isDesktop?: boolean };
export const ChoroplethLegend = memo(function ChoroplethLegend({ isPC, isDesktop }: ChoroplethLegendProps) {
  const fontSize = isDesktop ? F.xs : F.micro;
  const padding = isDesktop ? "8px 10px" : "6px 8px";
  const boxSize = isPC ? 12 : 10;
  const gap = isPC ? 6 : 4;

  return (
    <div
      role="img"
      aria-label="시도 평균 점수 색 범례"
      style={{
        position: "absolute",
        bottom: 12,
        right: 12,
        background: "rgba(255,255,255,0.94)",
        borderRadius: 8,
        padding,
        fontSize,
        fontWeight: 600,
        color: C.text,
        boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
        border: `1px solid ${C.border}`,
        display: "flex",
        flexDirection: "column" as const,
        gap,
        zIndex: 10,
      }}
    >
      {TIERS.map(t => {
        const g = gr(t.score);
        return (
          <div key={t.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: boxSize, height: boxSize, background: g.c, borderRadius: 2, display: "inline-block" }} />
            <span>{t.label}</span>
          </div>
        );
      })}
    </div>
  );
});
