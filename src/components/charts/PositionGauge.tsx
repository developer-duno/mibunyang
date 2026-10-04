import { memo } from "react";
import { C, F } from "@/theme";

/**
 * 위치 게이지 — "기준 대비 어디쯤인가"를 한 줄 눈금 위 점으로 그린다.
 *
 * 세션589 에 `DetailModal` 시세 탭의 "적정가 대비 위치"에 박혀 있던 그림을 그대로 떼어냈다
 * (모양·글자 변화 0). 같은 눈금을 PSR 줄이 다시 쓴다(`detail/PricePositionBox`).
 *
 * ## 읽는 법
 *
 * 가운데 선 = 기준(적정가 · 구 실거래가와 같음). **오른쪽일수록 유리**하다.
 * 양 끝은 "점수가 더는 안 움직이는 지점"이라, 끝을 넘는 값은 끝점에 찍고 가운데 글자가 실제 값을 말한다.
 *
 * ⚠️ 경계(양 끝·색이 갈리는 지점)를 이 부품이나 호출부에 손으로 적지 않는다 —
 *    `constants/scoringTiers.ts` 상수에서 읽어 넘긴다(점수와 그림은 한 쌍).
 */

/**
 * 값 → 눈금 위 위치(0~100%). 가운데 = 50, `rightEnd` = 100, `leftEnd` = 0. 끝을 넘으면 끝에 고정.
 * 두 쪽의 폭이 달라도 된다(가운데에서 각 끝까지 따로 비례).
 * `rightEnd` 가 가운데보다 작아도 된다(PSR 처럼 낮을수록 유리한 값).
 */
export function positionPct(value: number, center: number, rightEnd: number, leftEnd: number): number {
  const towardRight = rightEnd >= center ? value >= center : value <= center;
  const span = Math.abs((towardRight ? rightEnd : leftEnd) - center);
  if (!(span > 0)) return 50;
  const ratio = (Math.min(Math.abs(value - center), span) / span) * 50;
  return towardRight ? 50 + ratio : 50 - ratio;
}

export const PositionGauge = memo(function PositionGauge({
  pct,
  color,
  leftLabel,
  centerLabel,
  rightLabel,
}: {
  /** 점의 위치(0~100) — `positionPct` 로 만든다 */
  pct: number;
  /** 점과 가운데 글자의 색 */
  color: string;
  /** 왼쪽 끝 글자(불리한 쪽 한계) */
  leftLabel: string;
  /** 가운데 글자 — 실제 값 */
  centerLabel: string;
  /** 오른쪽 끝 글자(유리한 쪽 한계) */
  rightLabel: string;
}) {
  return (
    <>
      <div
        style={{
          position: "relative",
          height: 12,
          background: C.slate100,
          borderRadius: 6,
          margin: "4px 0 6px",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            width: 2,
            height: "100%",
            background: C.muted,
            transform: "translateX(-1px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${pct}%`,
            top: "50%",
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: color,
            border: `2px solid ${C.card}`,
            transform: "translate(-50%,-50%)",
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: F.xs, color: C.muted }}>
        <span>{leftLabel}</span>
        <span style={{ fontWeight: 700, color }}>{centerLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </>
  );
});
