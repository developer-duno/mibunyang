import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { ChartFrame } from "./ChartFrame";

/**
 * 분양 진행 단계 + 분양가 범위 + 경쟁률 — "이 단지가 지금 어디쯤 와 있나".
 *
 * ## 실측 (1,581단지, 2026-08-03)
 *
 * | 자료 | 채움 |
 * |---|---|
 * | `presaleStage` | 51.4% (813) — 나머지 768은 **단지 통째로** 분양정보 없음 |
 * | 분양가 범위(min<max) | 38.1% |
 * | 경쟁률 > 0 | 47.9% · 중앙 **10.62** · 최대 **437,995** |
 *
 * 결측이 랜덤이 아니라 단지 단위라, `presaleStage` 가 없으면 **그림 자체를 안 그린다**.
 * 필드마다 "자료없음"을 뿌리면 화면만 지저분해지고 알려주는 건 없다.
 *
 * ## 경쟁률을 로그로 그리는 이유
 *
 * 최대가 437,995 대 1이다. 선형 막대로 그리면 그 한 단지가 막대를 다 먹고
 * **나머지 756개가 전부 폭 0**이 된다. 10대 1과 100대 1의 차이가 안 보인다.
 * 그래서 자릿수(1 → 10 → 100 → 1,000 → …)로 눈금을 잡는다.
 */

/** 진행 순서 — 왼쪽에서 오른쪽으로 */
export const STAGES = ["분양계획", "청약중", "분양중", "미분양"] as const;
export type Stage = (typeof STAGES)[number];

const STAGE_HINT: Record<Stage, string> = {
  분양계획: "아직 청약 전이에요",
  청약중: "지금 청약을 받고 있어요",
  분양중: "청약이 끝나고 남은 물량을 팔고 있어요",
  미분양: "다 팔리지 않고 남은 집이 있어요",
};

/** 경쟁률을 자릿수 눈금 위 0~1 위치로 (1 미만은 0) */
export function logPos(rate: number, maxDecades = 6): number {
  if (!Number.isFinite(rate) || rate <= 1) return 0;
  return Math.min(1, Math.log10(rate) / maxDecades);
}

/** 1,234.5 → "1,235" · 0.5 → "0.5" */
export function fmtRate(v: number): string {
  return v >= 10 ? Math.round(v).toLocaleString("ko-KR") : String(Math.round(v * 100) / 100);
}

export const PresaleTimeline = memo(function PresaleTimeline({
  stage,
  minPrice,
  maxPrice,
  aptPrice,
  competitionRate,
}: {
  stage?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  aptPrice?: number | null;
  competitionRate?: number | null;
}) {
  const idx = STAGES.indexOf(stage as Stage);
  const hasRange = minPrice != null && maxPrice != null && maxPrice > minPrice;
  const rate = competitionRate != null && competitionRate > 0 ? competitionRate : null;

  const aria = useMemo(() => {
    if (idx < 0) return "분양 정보가 없습니다.";
    const parts = [`분양 진행 단계 ${STAGES.length}칸 중 ${idx + 1}번째, ${STAGES[idx]}.`];
    if (hasRange)
      parts.push(
        `분양가 ${(minPrice as number).toLocaleString("ko-KR")}만원부터 ${(maxPrice as number).toLocaleString("ko-KR")}만원.`
      );
    if (rate) parts.push(`청약 경쟁률 ${fmtRate(rate)} 대 1.`);
    return parts.join(" ");
  }, [idx, hasRange, minPrice, maxPrice, rate]);

  return (
    <ChartFrame
      title="분양 진행 상황"
      hint={
        "왼쪽부터 분양계획 → 청약중 → 분양중 → 미분양 순서예요. 색이 찬 칸이 지금 단계고, " +
        "그 아래는 분양가 범위(가장 싼 평형~가장 비싼 평형)와 청약 경쟁률이에요. " +
        "경쟁률 눈금은 1·10·100처럼 자릿수로 늘어나요 — 수만 대 1인 단지가 있어서 " +
        "보통 눈금으로는 나머지가 전부 안 보이거든요."
      }
      ariaLabel={aria}
      empty={idx < 0}
      emptyReason="이 단지는 분양 정보를 아직 모으지 못했어요 (전체의 절반 정도가 그래요)"
      height={hasRange || rate ? 132 : 64}
    >
      {idx >= 0 && (
        <div>
          {/* 4단계 스텝 */}
          <div style={{ display: "flex", gap: 4 }}>
            {STAGES.map((s, i) => {
              const done = i <= idx;
              const now = i === idx;
              return (
                <div key={s} style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 3,
                      background: done ? (now ? C.blue : C.blueBorder) : C.border,
                    }}
                  />
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: F.micro,
                      fontWeight: now ? 800 : 500,
                      color: now ? C.blue : C.muted,
                      textAlign: "center",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 6, fontSize: F.xs, color: C.sub }}>{STAGE_HINT[STAGES[idx]]}</div>

          {/* 분양가 범위 */}
          {hasRange && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: F.micro, color: C.muted }}>
                <span>{(minPrice as number).toLocaleString("ko-KR")}만</span>
                <span>분양가 범위</span>
                <span>{(maxPrice as number).toLocaleString("ko-KR")}만</span>
              </div>
              <div
                style={{ position: "relative", height: 10, marginTop: 4, background: "#ECEEF4", borderRadius: 5 }}
                aria-hidden
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: 0,
                    right: 0,
                    borderRadius: 5,
                    background: C.blueBorder,
                  }}
                />
                {aptPrice != null && aptPrice >= (minPrice as number) && aptPrice <= (maxPrice as number) && (
                  <div
                    style={{
                      position: "absolute",
                      top: -3,
                      bottom: -3,
                      width: 2,
                      background: C.amber,
                      left: `${(((aptPrice as number) - (minPrice as number)) / ((maxPrice as number) - (minPrice as number))) * 100}%`,
                    }}
                  />
                )}
              </div>
              {aptPrice != null && aptPrice >= (minPrice as number) && aptPrice <= (maxPrice as number) && (
                <div style={{ fontSize: F.micro, color: C.amber, marginTop: 3 }}>
                  ▲ 이 평형 분양가 {aptPrice.toLocaleString("ko-KR")}만
                </div>
              )}
            </div>
          )}

          {/* 경쟁률 — 자릿수(로그) 눈금 */}
          {rate && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 4 }}>
                청약 경쟁률 <b style={{ color: C.indigo, fontSize: F.sm }}>{fmtRate(rate)} : 1</b>
              </div>
              <div style={{ position: "relative", height: 10, background: "#ECEEF4", borderRadius: 5 }} aria-hidden>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(2, logPos(rate) * 100)}%`,
                    background: C.indigo,
                    borderRadius: 5,
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: F.micro, color: C.muted }}>
                {["1", "10", "100", "1천", "1만", "10만", "100만"].map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </ChartFrame>
  );
});
