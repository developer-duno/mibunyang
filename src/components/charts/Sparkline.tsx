import { memo } from "react";

/**
 * 작은 추이 선 — 축·눈금 없이 "오르나 내리나"만 보여 준다(세션591 분양 탭 지역 통계 P4).
 *
 * 큰 `LineChart`(300폭 + 축 글자)는 묶음 안 작은 칸에 넣기엔 크고, 그 부품은 분양가·미분양 추이가
 * 같이 쓰므로 모양을 바꾸지 않는다. 값 글자(최신 값·기준 시점)는 이 부품 밖, 칸 제목 줄이 말한다.
 *
 * 마지막 점 = 최신 값이라 점 하나를 찍어 "여기가 지금"을 표시한다.
 */
export const SPARK_W = 100;
export const SPARK_H = 28;
const PAD = 3;

/** 값 배열 → 0~SPARK_W × 0~SPARK_H 좌표. 값이 전부 같으면 가운데 수평선 */
export function sparkPoints(values: readonly number[]): { x: number; y: number }[] {
  const n = values.length;
  if (n === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return values.map((v, i) => ({
    x: n === 1 ? SPARK_W / 2 : PAD + (i / (n - 1)) * (SPARK_W - 2 * PAD),
    // 위가 큰 값 — SVG 는 y 가 아래로 커지므로 뒤집는다
    y: span > 0 ? PAD + (1 - (v - min) / span) * (SPARK_H - 2 * PAD) : SPARK_H / 2,
  }));
}

export const Sparkline = memo(function Sparkline({
  values,
  color,
  ariaLabel,
}: {
  values: readonly number[];
  color: string;
  ariaLabel: string;
}) {
  const pts = sparkPoints(values);
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  return (
    <svg
      width="100%"
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      style={{ display: "block" }}
    >
      <polyline
        points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* 마지막 점 — 원(circle)은 preserveAspectRatio="none" 에서 타원으로 늘어난다. 길이 0 선 + 둥근
          끝 + non-scaling-stroke 는 칸 폭과 상관없이 동그랗게 그려진다. */}
      <line
        data-spark-last=""
        x1={last.x}
        y1={last.y}
        x2={last.x}
        y2={last.y}
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
});
