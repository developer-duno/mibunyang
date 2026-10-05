import { memo, type CSSProperties } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";
import { REGION_STATS_ROWS } from "@/constants/regionStatsFields";
import { SUB_CONTEXT } from "@/constants/subContext";
import {
  CANCEL_RATIO_TIERS,
  CANCEL_RATIO_HIGH_LABEL,
  HOUSING_SUPPLY_LEVEL_TIERS,
  HOUSING_SUPPLY_HIGH_LABEL,
  LIQUIDITY_TIERS,
  LIQUIDITY_LABELS,
  POP_GROWTH_TIERS,
  POP_GROWTH_LOW_SCORE,
  liquidityBand,
  tierMaxLabel,
  tierMin,
} from "@/constants/scoringTiers";
import { HelpHint } from "@/components/HelpHint";
import { PositionGauge, positionPct } from "@/components/charts/PositionGauge";
import { MarketStatsCharts } from "./MarketStatsCharts";
import type { Apt } from "@/types/scoring";

/**
 * RegionStats — "이 지역 통계" 묶음 (세션 507 PR-2 · 세션591 P3·P4 접힘 해체)
 *
 * ## 왜 따로 묶나
 *
 * 인구·의료·거래량은 시세 탭 표에서 이 단지 값들과 같은 모양으로 늘어서 있었다. 손님에겐 이 단지
 * 값으로 읽힌다. 실제로는 같은 동네 모든 단지가 공유하는 통계다. 그래서 ① 테두리 하나로 묶고
 * ② 제목 줄이 "이 단지 값이 아니다"를 먼저 말하고 ③ 각 줄 앞에 어느 동네를 잰 값인지 접두로 박았다.
 *
 * ## 세션591 — 접힘 없이 한눈에
 *
 * 옛 접힘(▼)을 없애고 펼치지 않아도 보이게 했다:
 * - 지역 시장 추이 4종 → 작은 추이 선 칸 4개(`MarketStatsCharts` — 세션592 분양가격지수 뺌)
 * - 눈금 4개 → 계약해제율(옛 "분양 안전" 접힘에서 옮겨 옴 — 시·군·구 매매 거래로 잰 값이라 지역 통계가
 *   제자리다) · 주택보급률 · 인구 증감 · 6개월 거래. **경계는 전부 점수표 상수에서 읽는다**(손으로 적지 않는다).
 *   오른쪽 = 유리: 계약해제율은 낮을수록 · 거래는 많을수록 · 인구 증감은 0 이 가운데. 주택보급률은 방향이
 *   아니라 "적정이 가운데"라 왼쪽 끝 = 부족 · 오른쪽 끝 = 과잉이고 점 색도 한 가지(판정 색을 입히지 않는다).
 * - 나머지 4개(순이동 · 출산율 · 의사 수 · 병상 수) → 눈금 아래 작은 글자 한 줄(값 있는 것만)
 *
 * ## 채움 도넛을 안 그리는 이유
 *
 * 팝업의 도넛은 "**이 단지** 자료가 얼마나 모였나"를 뜻하는 기호다. 지역값에 같은 도넛을 그리면
 * 한 기호가 두 뜻을 갖게 돼, 이 묶음이 하려는 구분(단지값 ≠ 지역값)을 스스로 흐린다.
 */

const SECTION_HINT =
  "인구·순이동·주택보급률은 시·도 단위, 계약해제율·출산율·의사수·병상수·거래량은 시·군·구 단위로 잰 통계예요. 아래 작은 그래프는 시·도(자료가 있으면 시·군·구) 분양 시장 흐름이에요. 이 단지 하나를 잰 값이 아니라 같은 동네 단지가 모두 공유하는 숫자라, 단지끼리 비교할 때가 아니라 '이 동네가 어떤 동네인가'를 볼 때 쓰세요. 계약해제율은 최근 6개월 아파트 매매 계약이 해제된 비율이에요. 눈금은 오른쪽일수록 유리한 쪽이고, 주택보급률만 가운데가 적정이에요.";

type Scope = "sido" | "gu";

/** 눈금 한 줄의 계산 결과 */
export type GaugeView = {
  pct: number;
  color: string;
  valueText: string;
  verdict: string | null;
  leftLabel: string;
  rightLabel: string;
};

type GaugeSpec = { field: string; label: string; scope: Scope; view: (_v: number) => GaugeView };

const pctText = (v: number) => `${v}%`;

/**
 * 인구 증감 → 눈금 색. **점수 탭과 같은 판정**을 그대로 쓴다(세션591 보완 F3 — 옛 "음수면 빨강"은 점수 탭이
 * "보합"으로 보는 -0.3~0 까지 빨갛게 칠했다). 점수는 `POP_GROWTH_TIERS`(scoreFuture 와 같은 표), 판정 글자는
 * `SUB_CONTEXT.future.인구`(점수 탭 문구) — 경계 숫자를 여기 다시 적지 않는다.
 * 유입 활발 = 초록 · 보합 = 중립(같은 묶음 6개월 거래의 "보통"과 같은 파랑) · 유출 주의 = 빨강.
 */
export function popGrowthColor(v: number): string {
  const word = SUB_CONTEXT.future.인구.interpret?.(tierMin(v, POP_GROWTH_TIERS, POP_GROWTH_LOW_SCORE), `${v}%`) ?? "";
  return word.includes("활발") ? C.green : word.includes("유출") ? C.red : C.blue;
}

/**
 * 눈금 4개. 세 점(가운데·양 끝)은 전부 `scoringTiers.ts` 상수에서 읽는다.
 * ⚠️ 필드 이름은 `field: "…"` 로 적는다 — `tabExtraFields.test.ts` 가 이 글자로 "실제로 그린다"를 대조한다.
 */
export const REGION_GAUGES: readonly GaugeSpec[] = [
  {
    // 낮을수록 유리 — 가운데 = 둘째 경계(1.2, 판정 "적음"의 끝) · 오른쪽 끝 = 첫 경계 0.7 · 왼쪽 끝 = 마지막 경계 5
    field: "cancelRatio6m",
    label: "계약해제율",
    scope: "gu",
    view: (v) => {
      const center = CANCEL_RATIO_TIERS[1].max as number;
      const best = CANCEL_RATIO_TIERS[0].max as number;
      const worst = CANCEL_RATIO_TIERS[CANCEL_RATIO_TIERS.length - 1].max as number;
      const verdict = tierMaxLabel(v, CANCEL_RATIO_TIERS, CANCEL_RATIO_HIGH_LABEL);
      return {
        pct: positionPct(v, center, best, worst),
        // '보통' = 중립 파랑 — 같은 묶음 6개월 거래의 "보통"과 같은 색(위 popGrowthColor 주석, 세션594)
        color: verdict === "적음" ? C.green : verdict === "보통" ? C.blue : C.red,
        valueText: pctText(v),
        verdict,
        leftLabel: `많음 ${worst}%`,
        rightLabel: `적음 ${best}%`,
      };
    },
  },
  {
    // 방향 없음 — 가운데 = 적정 구간 한가운데 · 왼쪽 끝 = 부족 경계 · 오른쪽 끝 = 과잉 경계
    field: "housingSupplyLevel",
    label: "주택보급률",
    scope: "sido",
    view: (v) => {
      const lack = HOUSING_SUPPLY_LEVEL_TIERS[0].max as number; // 96
      const fair = HOUSING_SUPPLY_LEVEL_TIERS[1].max as number; // 101
      const over = HOUSING_SUPPLY_LEVEL_TIERS[HOUSING_SUPPLY_LEVEL_TIERS.length - 1].max as number; // 104
      const center = (lack + fair) / 2;
      return {
        pct: positionPct(v, center, over, lack),
        color: C.blue,
        valueText: pctText(v),
        verdict: tierMaxLabel(v, HOUSING_SUPPLY_LEVEL_TIERS, HOUSING_SUPPLY_HIGH_LABEL),
        leftLabel: `${HOUSING_SUPPLY_LEVEL_TIERS[0].label} ${lack}%`,
        rightLabel: `${HOUSING_SUPPLY_HIGH_LABEL} ${over}%`,
      };
    },
  },
  {
    // 높을수록 유리 — 가운데 0 · 오른쪽 끝 = 첫 칸(그 위로는 점수가 안 움직인다) · 왼쪽 끝 = 마지막 칸
    field: "popGrowth",
    label: "인구 증감",
    scope: "sido",
    view: (v) => {
      const center = 0; // 늘지도 줄지도 않음 — 경계가 아니라 0 자체(점수표에도 `min: 0` 칸이 있다)
      const best = POP_GROWTH_TIERS[0].min;
      const worst = POP_GROWTH_TIERS[POP_GROWTH_TIERS.length - 1].min;
      const sign = (n: number) => `${n > 0 ? "+" : ""}${n}%`;
      return {
        pct: positionPct(v, center, best, worst),
        color: popGrowthColor(v),
        valueText: sign(v),
        verdict: null,
        leftLabel: sign(worst),
        rightLabel: sign(best),
      };
    },
  },
  {
    // 많을수록 유리 — 가운데 = "보통" 경계 · 오른쪽 끝 = "활발" 경계 · 왼쪽 끝 = "한산" 경계
    field: "recentTrades6m",
    label: "6개월 거래",
    scope: "gu",
    view: (v) => {
      const center = LIQUIDITY_TIERS[1].min as number;
      const best = LIQUIDITY_TIERS[0].min as number;
      const worst = LIQUIDITY_TIERS[LIQUIDITY_TIERS.length - 1].min as number;
      const band = liquidityBand(v);
      const idx = LIQUIDITY_LABELS.indexOf(band);
      return {
        pct: positionPct(v, center, best, worst),
        color: [C.green, C.blue, C.amber, C.red][idx] ?? C.text,
        valueText: `${v.toLocaleString("ko-KR")}건`,
        verdict: band,
        leftLabel: `${LIQUIDITY_LABELS[LIQUIDITY_LABELS.length - 1]} ${worst.toLocaleString("ko-KR")}건`,
        rightLabel: `${LIQUIDITY_LABELS[0]} ${best.toLocaleString("ko-KR")}건`,
      };
    },
  },
];

const GAUGE_FIELDS = new Set(REGION_GAUGES.map((g) => g.field));

const RS_S: Record<string, CSSProperties> = {
  // DataSectionBlock 의 DSB_S.container 와 같은 박스 (같은 탭 형제와 시각 일관)
  container: {
    background: C.bg,
    borderRadius: 10,
    padding: "10px 12px",
    marginBottom: 10,
    border: `1px solid ${C.border}`,
  },
  // 블록 제목 — 입지 탭 '치안 · 환경'·같은 탭 '네이버 분양정보'와 같은 크기·색(세션591 보완 F7)
  title: {
    fontSize: F.base,
    fontWeight: 700,
    color: C.text,
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 8,
  },
  // 제목 옆 한 줄 — "이 단지 값이 아니다"를 먼저 말한다
  subtitle: { fontSize: F.xs, fontWeight: 400, color: C.muted, marginLeft: 6 },
  gauges: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8, marginTop: 10 },
  // 흰 바탕 — 게이지 눈금(slate100)이 회색 바탕(C.bg) 위에선 안 보인다(입지 탭 소음 게이지와 같은 처리)
  gauge: { background: C.card, borderRadius: 8, padding: "6px 10px" },
  gaugeTitle: { fontSize: F.sm, fontWeight: 700 },
  small: { marginTop: 8, fontSize: F.xs, color: C.muted, lineHeight: 1.6 },
};

type FieldMetaFmt = Record<string, { fmt?: (_v: unknown, _apt: unknown) => unknown } | undefined>;

export const RegionStats = memo(function RegionStats({ apt }: { apt: Apt }) {
  const region = (apt.region as string | null) ?? "";
  const gu = (apt.gu as string | null) ?? "";

  // Q-B 결정(사장님, 2026-08-09): 시·군·구 단위 값이 섞여 있어 "{region} 전체 통계"는 그 줄들에 거짓이 된다.
  // 구·시도를 병기하고, 구를 모르는 단지만 시도로 축약한다.
  const scopeText = gu ? `이 단지 값이 아니라 ${gu}·${region} 통계예요` : `이 단지 값이 아니라 ${region} 전체 통계예요`;

  // 시·군·구를 모르는 단지는 그 줄들도 시·도 이름으로 읽는다 (라벨이 빈 접두로 시작하지 않게)
  const prefixOf = (scope: Scope) => (scope === "sido" ? region : gu || region);

  const numOf = (field: string): number | null => {
    const raw = apt[field];
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const gauges = REGION_GAUGES.map((g) => ({ g, v: numOf(g.field) })).filter(
    (x): x is { g: GaugeSpec; v: number } => x.v != null
  );

  // 눈금으로 안 그리는 지역 통계(순이동·출산율·의사수·병상수) — 값 있는 것만, 단위는 FIELD_META fmt 그대로
  const smallParts = REGION_STATS_ROWS.filter((r) => !GAUGE_FIELDS.has(r.field) && apt[r.field] != null).map((r) => {
    const meta = (FIELD_META as FieldMetaFmt)[r.field];
    const val = apt[r.field];
    return { field: r.field, text: `${prefixOf(r.scope)} ${r.label} ${String(meta?.fmt ? meta.fmt(val, apt) : val)}` };
  });

  // 값이 전부 없고 지역도 모르면 묶음 자체를 안 그린다(지역 시장 추이도 지역이 있어야 불러온다)
  if (!region && gauges.length === 0 && smallParts.length === 0) return null;

  return (
    <div style={RS_S.container} data-testid="region-stats">
      <div style={RS_S.title}>
        이 지역 통계
        <span style={RS_S.subtitle}>{scopeText}</span>
        <HelpHint text={SECTION_HINT} label="이 지역 통계" />
      </div>
      <MarketStatsCharts region={apt.region} gu={apt.gu} />
      {gauges.length > 0 && (
        <div style={RS_S.gauges}>
          {gauges.map(({ g, v }) => {
            const view = g.view(v);
            return (
              <div key={g.field} style={RS_S.gauge} data-testid="region-gauge" data-field={g.field} data-value={v}>
                <div style={{ ...RS_S.gaugeTitle, color: view.color }}>
                  {prefixOf(g.scope)} {g.label} {view.valueText}
                  {view.verdict ? ` · ${view.verdict}` : ""}
                </div>
                {/* 값은 제목에 적고 가운데 글자는 비운다 — 가운데 눈금 바로 밑에 값이 찍히면 "가운데 눈금 = 이 값"
                    처럼 읽힌다(입지 탭 소음 게이지 보완 F4 와 같은 처리). */}
                <PositionGauge
                  pct={view.pct}
                  color={view.color}
                  leftLabel={view.leftLabel}
                  centerLabel=""
                  rightLabel={view.rightLabel}
                />
              </div>
            );
          })}
        </div>
      )}
      {smallParts.length > 0 && (
        <div style={RS_S.small} data-testid="region-small-line">
          {smallParts.map((p, i) => (
            <span key={p.field} data-field={p.field}>
              {i > 0 ? " · " : ""}
              {p.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});
