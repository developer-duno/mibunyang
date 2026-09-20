import { memo } from "react";
import { C, F, gr } from "@/theme";
import { MIN_MAP_SAMPLE } from "@/hooks/useRegionAverages";

// 색칠 지도 범례 — 점수 6단계(S/A/B+/B/C/D) 색 박스 + 라벨 + 표본 가드 안내
// gr() 색 매핑 재사용. 우하단 absolute 오버레이.
// 시도·시군구 두 모드가 같은 범례를 쓴다(줌으로 오갈 뿐 색 잣대는 하나).

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
      aria-label={`지역 평균 점수 색 범례 — 연한 칸은 단지 ${MIN_MAP_SAMPLE}곳 미만이라 평균을 믿기 어려운 곳입니다`}
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
      {TIERS.map((t) => {
        const g = gr(t.score);
        return (
          <div key={t.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{ width: boxSize, height: boxSize, background: g.c, borderRadius: 2, display: "inline-block" }}
            />
            <span>{t.label}</span>
          </div>
        );
      })}
      {/*
        표본 가드 안내 — 색이 흐린 칸이 "점수가 낮다"로 읽히면 안 된다.
        흐린 이유는 점수가 아니라 표본 부족이므로 범례가 그 뜻을 말해 준다.
        문턱 숫자는 useRegionAverages 의 상수에서 가져온다(손으로 적으면 갈린다).
      */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          borderTop: `1px solid ${C.border}`,
          paddingTop: gap,
          marginTop: 1,
          fontWeight: 500,
        }}
      >
        <span
          style={{
            width: boxSize,
            height: boxSize,
            background: gr(75).c,
            opacity: 0.35,
            borderRadius: 2,
            display: "inline-block",
          }}
        />
        <span>연한 칸 = 단지 {MIN_MAP_SAMPLE}곳 미만</span>
      </div>
    </div>
  );
});
