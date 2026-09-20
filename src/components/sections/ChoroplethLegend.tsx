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
      {/*
        점수 6단계를 2열 3행으로 접는다. 세로 1열이면 표본 안내 줄까지 7줄이 되어
        범례가 지도 바닥(bottom:12) 기준으로 길어지고, 지도 높이가
        calc(100dvh - N) 이라 **화면 밖으로 잘린다**(세션553 실측: 마지막 줄이
        y=1621 에서 잘림). 2열로 접으면 3행 + 안내 1줄 = 4줄이라 원래(6줄)보다 짧다.
      */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 10, rowGap: gap }}>
        {TIERS.map((t) => {
          const g = gr(t.score);
          return (
            <div key={t.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: boxSize,
                  height: boxSize,
                  background: g.c,
                  borderRadius: 2,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              <span style={{ whiteSpace: "nowrap" }}>{t.label}</span>
            </div>
          );
        })}
      </div>
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
            // 0.35 = 시도(0.3)·시군구(0.25) 중간값. 두 모드가 값이 달라 하나를 고를 수 없고,
            // 이 칸은 색 대조표가 아니라 "이 정도로 연하면 표본 부족"이라는 뜻만 전한다.
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
