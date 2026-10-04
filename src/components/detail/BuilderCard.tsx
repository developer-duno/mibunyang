import { memo, type CSSProperties } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";
import { BUILDER_DEBT_TIERS } from "@/constants/scoringTiers";
import { PositionGauge, positionPct } from "@/components/charts/PositionGauge";
import type { Apt } from "@/types/scoring";

/**
 * BuilderCard — 분양 탭 "시공사" 블록 (세션508 PR-3c C2 · 세션591 P2 접힘 해체).
 *
 * 그리는 것 2가지: 시공사 이름 칩(`builder`) · 부채비율 눈금(`builderDebtRatio`).
 * **`hugGuarantee` 는 뺐다**(사장님 확정 — 수집률 0%, 세션 507 Q6 유지).
 *
 * ## 세션591 — 접힘 → 칩 + 부채비율 눈금
 *
 * 옛 "시공사 정보" 접힘(3칸 표)을 펼치지 않아도 보이게 바꿨다. **그릴 것(이름 칩 또는 부채비율 눈금)이
 * 하나도 없으면 블록 자체를 안 그린다**(제목만 남는 빈 블록 금지).
 *
 * ## builderCreditGrade — 분양 탭에서 뺐다 (세션591 사장님 결정)
 *
 * 이 칸의 값은 신용평가사 등급이 아니라 `dart-builders.mjs` `estimateCreditGrade(부채비율)` 로 **부채비율에서
 * 계산한 값**이다(정적 사본 등급 보유 400곳 전부 계산값과 일치). 바로 아래 부채비율 눈금이 같은 내용을 말하므로
 * "신용등급" 칩은 뺐다. 세션592 에 점수 탭(`scoreRisk.ts` "시공사 재무")·카드 칩도 등급 글자 대신 부채비율 숫자로
 * 바꿨다(점수는 그대로 — 사장님 결정 "이름만 정직하게").
 *
 * ## builder — fmt 재사용 (등급 어휘를 새로 짓지 않는다)
 *
 * `FIELD_META.builder.fmt` 가 이미 "롯데건설 (1군)" · "OO신탁 (브랜드 해당없음)" · "OO건설 (기타)" 를
 * 가른다(`BRAND_TIER` + 해당없음 판정). 칩 글자로 그대로 쓴다.
 *
 * ## builderDebtRatio — 눈금 (기준선은 `BUILDER_DEBT_TIERS` 에서)
 *
 * 폴백(`_fallbackBuilderDebt`)이거나 null 이면 눈금을 안 그린다(`scoreRisk.ts` 의 "미수집" 판정 이관 —
 * 지역 평균 대체값을 이 시공사 값처럼 그리지 않는다, #368).
 * 눈금: 가운데 = 첫 경계(150) · 왼쪽 끝 = 둘째 경계(200 — 그 위로는 점수가 더 안 움직인다) · 오른쪽 끝 =
 * 가운데에서 같은 폭만큼 반대쪽(100). **오른쪽이 유리**(부채가 적다). 끝을 넘는 값(551% 등)은 끝점에 찍힌다.
 * 실제 값은 제목("부채비율 168.2%")에, 가운데 글자는 "기준 150%" — 가운데 눈금 바로 밑에 실제 값을 찍으면
 * "150 자리에 168"로 읽힌다(세션591 보완 F2 · 입지 탭 소음 게이지 F4 와 같은 처리).
 */

/** 부채비율 눈금의 세 점 — 손으로 적지 않고 점수표 경계에서 읽는다 */
export const DEBT_GAUGE = (() => {
  const center = BUILDER_DEBT_TIERS[0].max; // 150 — 기준
  const worst = BUILDER_DEBT_TIERS[1].max; // 200 — 그 위로는 점수가 안 움직인다
  return { center, worst, best: center - (worst - center) };
})();

/** 부채비율 → 색. 경계는 `BUILDER_DEBT_TIERS` (≤150 초록 · ≤200 주황 · 그 위 빨강) */
export function debtColor(d: number): string {
  return d <= BUILDER_DEBT_TIERS[0].max ? C.green : d <= BUILDER_DEBT_TIERS[1].max ? C.amber : C.red;
}

const BC_S: Record<string, CSSProperties> = {
  container: {
    background: C.bg,
    borderRadius: 10,
    padding: "10px 12px",
    marginBottom: 10,
    border: `1px solid ${C.border}`,
  },
  // 블록 제목 — 입지 탭 '치안 · 환경'·같은 탭 '네이버 분양정보'와 같은 크기·색(세션591 보완 F7)
  title: { fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 8 },
  chips: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    fontSize: F.sm,
    color: C.text,
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 99,
    padding: "3px 10px",
    lineHeight: 1.4,
  },
  // 흰 바탕 — 게이지 눈금(slate100)이 회색 바탕(C.bg) 위에선 안 보인다(입지 탭 소음 게이지와 같은 처리)
  gauge: { marginTop: 10, background: C.card, borderRadius: 8, padding: "6px 10px" },
  gaugeTitle: { fontSize: F.sm, fontWeight: 700 },
};

export const BuilderCard = memo(function BuilderCard({ apt }: { apt: Apt }) {
  const builderText = apt.builder != null ? FIELD_META.builder.fmt(apt.builder, apt) : null;

  // scoreRisk.ts 와 같은 "미수집" 판정 — null 이거나 폴백이면 눈금을 안 그린다.
  const builderDebtRatio = apt.builderDebtRatio as number | null | undefined;
  const debt =
    builderDebtRatio != null && !apt._fallbackBuilderDebt && Number.isFinite(Number(builderDebtRatio))
      ? Number(builderDebtRatio)
      : null;

  // 실제로 그릴 것이 있는가로 판정한다(신용등급만 있는 단지는 이제 그릴 것이 없다).
  if (!builderText && debt == null) return null;

  return (
    <div style={BC_S.container} data-testid="builder-block">
      <div style={BC_S.title}>시공사</div>
      {builderText && (
        <div style={BC_S.chips}>
          <span style={BC_S.chip} data-chip="builder">
            {builderText}
          </span>
        </div>
      )}
      {debt != null && (
        <div style={BC_S.gauge} data-testid="debt-gauge" data-debt={debt}>
          <div style={{ ...BC_S.gaugeTitle, color: debtColor(debt) }}>
            부채비율 {FIELD_META.builderDebtRatio.fmt(debt, apt)}
          </div>
          <PositionGauge
            pct={positionPct(debt, DEBT_GAUGE.center, DEBT_GAUGE.best, DEBT_GAUGE.worst)}
            color={debtColor(debt)}
            leftLabel={`높음 ${DEBT_GAUGE.worst}%`}
            centerLabel={`기준 ${DEBT_GAUGE.center}%`}
            rightLabel={`낮음 ${DEBT_GAUGE.best}%`}
          />
        </div>
      )}
    </div>
  );
});
