import { getZone } from "@/constants/regulations";
import {
  tierMax,
  tierMin,
  UNSOLD_RATE_TIERS,
  UNSOLD_HIGH_SCORE,
  UNSOLD_UNKNOWN_SCORE,
  LIQUIDITY_TIERS,
  LIQUIDITY_LOW_SCORE,
  CREDIT_GRADE_SCORES,
  CREDIT_DEFAULT,
  HOUSING_SUPPLY_LEVEL_TIERS,
  HOUSING_SUPPLY_HIGH_SCORE,
  HOUSING_SUPPLY_UNKNOWN_SCORE,
  PERMIT_RATIO_HIGH,
  PERMIT_RATIO_LOW,
  PERMIT_RATIO_HIGH_ADJ,
  PERMIT_RATIO_LOW_ADJ,
  CANCEL_RATIO_TIERS,
  CANCEL_RATIO_HIGH_SCORE,
  CANCEL_RATIO_NULL_SCORE,
  CRIME_SAFETY_SCORES,
  CRIME_SAFETY_NULL_SCORE,
  POLICE_DIST_TIERS,
  POLICE_DIST_HIGH_SCORE,
  POLICE_DIST_NULL_SCORE,
  INIT_SALE_TIERS,
  INIT_SALE_HIGH_RISK,
  INIT_SALE_NULL,
  LISTING_FLOOD_THRESHOLD,
  LISTING_WARN_THRESHOLD,
  LISTING_FLOOD_PENALTY,
  LISTING_WARN_PENALTY,
  PUBLIC_PRESALE_BONUS,
  HOUSING_SUPPLY_HIGH_LABEL,
  tierMaxLabel,
} from "@/constants/scoringTiers";
import { fmtCompetitionRate } from "@/lib/format";
import type { Apt, Res } from "@/types/scoring";

/**
 * 안전도 점수 (0~100). 11개 서브 위험점수를 가중 합산 → `safety = 100 - risk` 반환.
 *
 * 11서브 가중치 합계 = 1.00 (CLAUDE.md L42, 실측 검산 PASS):
 *   unsold 0.14 · liq 0.14 · loan 0.15 · fin 0.17 · reg 0.05 · sup 0.10 ·
 *   mkt 0.04 · cancel 0.04 · comp 0.09 · crime 0.05 · init 0.03 = 1.0000
 *
 * 점수 방향성: 내부 sub*는 위험점수(높을수록 위험), 반환 subs[].score는 `100 - subSc`(안전점수, 높을수록 안전).
 * 클램핑: `Math.round(Math.max(0, Math.min(100, 100 - risk)))`.
 *
 * 핵심 보정:
 *   - listingPen: naverSellCount > LISTING_FLOOD_THRESHOLD → LISTING_FLOOD_PENALTY,
 *     > LISTING_WARN_THRESHOLD → LISTING_WARN_PENALTY. liqSc 가산 후 상한 100.
 *   - finSc 공공분양 보너스: presaleType "공공" 포함 시 + PUBLIC_PRESALE_BONUS (0~100 클램프).
 *   - isRegulated 폴백: DB값 우선, null이면 `getZone(region, gu)` 폴백.
 *   - 인허가율 보정(세션501, 옛 newSupply 보정 대체): >= PERMIT_RATIO_HIGH → supSc + 5 (상한 100),
 *     <= PERMIT_RATIO_LOW → supSc - 3 (하한 0). 주 지표는 주택보급률.
 *   - crimeSc 복합: gradeRisk(행안부 범죄등급) × 0.7 + policeRisk(경찰관서 거리) × 0.3.
 *   - 서브점수 구간 표는 src/scoring/CLAUDE.md L131~L191 참조.
 *
 * null 처리: `apt.cancelRatio6m == null ? CANCEL_RATIO_NULL_SCORE : ...` 등 명시적 분기.
 *
 * @example
 * // 11서브 가중치 합 검증
 * 0.14+0.14+0.15+0.17+0.05+0.10+0.04+0.04+0.09+0.05+0.03 === 1.00  // true
 */
export function scoreRisk(apt: Apt): Res {
  const units = (apt.units ?? 0) as number;
  // unsoldRate null = 미분양률 데이터 미확인 (청약홈 회차 폭발값이 100% 초과로 무력화된 경우 포함, 세션 445).
  //   sanitize(engine.ts)가 null 을 보존 → 여기서 units<=1 과 동일하게 중립(UNSOLD_UNKNOWN_SCORE) 처리.
  const unsoldRate = apt.unsoldRate as number | null;
  const recentTrades6m = (apt.recentTrades6m ?? 0) as number;
  // 세션 501: 공급량 주 지표 = 주택보급률(재고), 보정 = 인허가율(미래 공급).
  // 옛 코드는 `apt.supplyRatio ?? 150`(인허가율)을 주 지표로 썼는데 등급 경계가 보급률용이라
  // 어긋나 있었다 — 상세는 scoringTiers.ts HOUSING_SUPPLY_LEVEL_TIERS 주석.
  const housingSupplyLevel = apt.housingSupplyLevel as number | null | undefined;
  const permitRatio = apt.supplyRatio as number | null | undefined;
  const builderDebtRatio = (apt.builderDebtRatio ?? 250) as number;
  const builderCreditGrade = apt.builderCreditGrade as string | undefined;

  const unsoldUnknown = units <= 1 || unsoldRate == null;
  const unsoldSc: number = unsoldUnknown
    ? UNSOLD_UNKNOWN_SCORE
    : tierMax(unsoldRate, UNSOLD_RATE_TIERS, UNSOLD_HIGH_SCORE);
  let liqSc: number = tierMin(recentTrades6m, LIQUIDITY_TIERS, LIQUIDITY_LOW_SCORE);
  // 매물 과잉 페널티: naverSellCount 기반
  const listingPen =
    apt.naverSellCount != null && apt.naverSellCount > LISTING_FLOOD_THRESHOLD
      ? LISTING_FLOOD_PENALTY
      : apt.naverSellCount != null && apt.naverSellCount > LISTING_WARN_THRESHOLD
        ? LISTING_WARN_PENALTY
        : 0;
  liqSc = Math.min(liqSc + listingPen, 100);
  const loanSc = (apt.dsr40pass ? 15 : 50) + (apt.loanFree ? 0 : 15);
  let finSc: number =
    (apt.hugGuarantee ? 0 : 40) +
    ((CREDIT_GRADE_SCORES as Record<string, number>)[String(builderCreditGrade)] ?? CREDIT_DEFAULT) +
    (builderDebtRatio > 200 ? 20 : builderDebtRatio > 150 ? 10 : 0);
  // 공공분양 재무안전 보너스
  if (apt.presaleType != null && (apt.presaleType as string).includes("공공")) finSc += PUBLIC_PRESALE_BONUS;
  finSc = Math.max(0, Math.min(finSc, 100));
  // 규제지역: DB isRegulated 우선, null이면 getZone() 폴백
  const zone =
    apt.isRegulated != null
      ? apt.isRegulated
        ? "regulated"
        : "normal"
      : getZone(apt.region as string, apt.gu as string);
  const regSc = zone !== "normal" ? 60 : 10;
  let supSc: number =
    housingSupplyLevel == null
      ? HOUSING_SUPPLY_UNKNOWN_SCORE
      : tierMax(housingSupplyLevel, HOUSING_SUPPLY_LEVEL_TIERS, HOUSING_SUPPLY_HIGH_SCORE);
  // 미래 공급 압력 보정 (인허가율). 옛 newSupply(절대 세대수) 보정을 대체 — 그쪽은 HIGH=5000 에
  // 아무도 도달 못 했고(최대 경기 3,107) 절대값이라 큰 시도가 구조적으로 불리했다.
  if (permitRatio != null && permitRatio >= PERMIT_RATIO_HIGH) supSc = Math.min(supSc + PERMIT_RATIO_HIGH_ADJ, 100);
  else if (permitRatio != null && permitRatio <= PERMIT_RATIO_LOW) supSc = Math.max(supSc + PERMIT_RATIO_LOW_ADJ, 0);
  // 초기분양률 서브스코어 (신규)
  const initSc: number =
    apt.initialSaleRate == null ? INIT_SALE_NULL : tierMin(apt.initialSaleRate, INIT_SALE_TIERS, INIT_SALE_HIGH_RISK);
  const mktSc =
    apt.popGrowth == null
      ? 35
      : apt.popGrowth >= 1.0
        ? 5
        : apt.popGrowth >= 0.5
          ? 20
          : apt.popGrowth >= 0
            ? 35
            : apt.popGrowth >= -0.3
              ? 50
              : apt.popGrowth >= -0.8
                ? 65
                : apt.popGrowth >= -2.0
                  ? 80
                  : 90;
  const cancelSc: number =
    apt.cancelRatio6m == null
      ? CANCEL_RATIO_NULL_SCORE
      : tierMax(apt.cancelRatio6m, CANCEL_RATIO_TIERS, CANCEL_RATIO_HIGH_SCORE);
  // 경쟁률: 미달(음수) → 위험, 높을수록 안전. 완충 구간 포함 (rate=0 절벽 방지)
  const compSc =
    apt.competitionRate == null
      ? 40
      : apt.competitionRate >= 10
        ? 5
        : apt.competitionRate >= 3
          ? 15
          : apt.competitionRate >= 1
            ? 30
            : apt.competitionRate >= 0.5
              ? 45
              : apt.competitionRate >= 0
                ? 55
                : apt.competitionRate >= -0.5
                  ? 70
                  : 85;
  // 치안 안전: 행안부 범죄 등급(70%) + 경찰관서 근접성(30%)
  const gradeRisk: number =
    apt.crimeSafetyGrade == null
      ? CRIME_SAFETY_NULL_SCORE
      : ((CRIME_SAFETY_SCORES as Record<string, number>)[String(apt.crimeSafetyGrade)] ?? CRIME_SAFETY_NULL_SCORE);
  const policeDist = apt.policeDist as number | null | undefined;
  const policeRisk: number =
    policeDist == null ? POLICE_DIST_NULL_SCORE : tierMax(policeDist, POLICE_DIST_TIERS, POLICE_DIST_HIGH_SCORE);
  const crimeSc = gradeRisk * 0.7 + policeRisk * 0.3;
  const risk =
    unsoldSc * 0.14 +
    liqSc * 0.14 +
    loanSc * 0.15 +
    finSc * 0.17 +
    regSc * 0.05 +
    supSc * 0.1 +
    mktSc * 0.04 +
    cancelSc * 0.04 +
    compSc * 0.09 +
    crimeSc * 0.05 +
    initSc * 0.03;
  const safety = Math.round(Math.max(0, Math.min(100, 100 - risk)));
  return {
    total: safety,
    riskRaw: Math.round(risk),
    subs: [
      {
        name: "미분양률",
        score: 100 - unsoldSc,
        info: unsoldUnknown ? "세대수 미확인 (중립)" : `${unsoldRate}%`,
        detail: unsoldUnknown ? "세대수 미확인 (중립 40점)" : `${unsoldRate}% (안전 5%↓, 주의 15~30%, 위험 50%↑)`,
      },
      {
        name: "경쟁률",
        score: 100 - compSc,
        info: apt.competitionRate != null ? fmtCompetitionRate(apt.competitionRate) : "정보 없음",
        detail:
          apt.competitionRate != null
            ? apt.competitionRate < 0
              ? `${fmtCompetitionRate(apt.competitionRate)} (신청부족)`
              : `${fmtCompetitionRate(apt.competitionRate)} (인기 10↑, 적정 3↑, 약 1↑, 미달 0↓)`
            : "경쟁률 데이터 없음 (중립 40점)",
      },
      {
        name: "거래량",
        score: 100 - liqSc,
        info: `6개월 ${recentTrades6m}건`,
        detail: `6개월 ${recentTrades6m}건 (활발 30↑, 보통 15↑, 부진 5↓)`,
      },
      {
        name: "대출/잔금",
        score: 100 - loanSc,
        info: apt.dsr40pass ? "DSR통과" : "주의",
        detail: apt.dsr40pass ? "DSR 40% 통과 (자금조달 양호)" : "DSR 미통과 (대출 곤란 주의)",
      },
      {
        name: "시공사 재무",
        score: 100 - Math.round(finSc),
        info: builderCreditGrade || "정보 없음",
        detail: `${builderCreditGrade || "미확인"} (AA↑안전, A보통, BBB↓주의, 부채율 ${apt._fallbackBuilderDebt ? "미수집" : `${builderDebtRatio}%`})`,
      },
      {
        name: "규제",
        score: 100 - regSc,
        info: zone !== "normal" ? "규제지역" : "비규제",
        detail: zone !== "normal" ? "규제지역 (매매·대출 제약)" : "비규제 (거래 자유)",
      },
      {
        name: "공급량",
        score: 100 - supSc,
        info:
          housingSupplyLevel == null
            ? "정보 없음"
            : `보급률 ${housingSupplyLevel}% ${tierMaxLabel(housingSupplyLevel, HOUSING_SUPPLY_LEVEL_TIERS, HOUSING_SUPPLY_HIGH_LABEL)}`,
        detail:
          housingSupplyLevel == null
            ? "주택보급률 데이터 없음 (보수적 기본값 적용)"
            : `주택보급률 ${housingSupplyLevel}% — ${tierMaxLabel(housingSupplyLevel, HOUSING_SUPPLY_LEVEL_TIERS, HOUSING_SUPPLY_HIGH_LABEL)}` +
              ` (부족 96%↓, 적정 101%↓, 여유 104%↓, 과잉 104%↑)` +
              (permitRatio != null ? ` · 인허가율 ${permitRatio}%` : ""),
      },
      {
        name: "시장환경",
        score: 100 - mktSc,
        info: apt.popGrowth != null ? `인구 ${apt.popGrowth > 0 ? "+" : ""}${apt.popGrowth}%` : "정보 없음",
        detail:
          apt.popGrowth != null
            ? `인구 ${apt.popGrowth > 0 ? "+" : ""}${apt.popGrowth}% (성장 +1%↑, 안정 0%↑, 감소 -0.8%↓)`
            : "인구 데이터 없음 (중립 35점)",
      },
      {
        name: "계약해제율",
        score: 100 - cancelSc,
        info: apt.cancelRatio6m != null ? `${apt.cancelRatio6m}%` : "정보 없음",
        detail:
          apt.cancelRatio6m != null
            ? `${apt.cancelRatio6m}% (안전 3%↓, 주의 8~15%, 위험 25%↑)`
            : "계약해제율 데이터 없음 (중립 35점)",
      },
      {
        name: "치안 안전",
        score: Math.round(100 - crimeSc),
        info:
          [
            apt.crimeSafetyGrade != null ? `${apt.crimeSafetyGrade}등급` : null,
            policeDist != null ? `경찰 ${policeDist}m` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "정보 없음",
        detail: [
          apt.crimeSafetyGrade != null ? `범죄등급 ${apt.crimeSafetyGrade}등급 (1=최안전~5=최위험)` : "범죄등급 미수집",
          policeDist != null ? `경찰관서 ${policeDist}m (${apt.police ?? 0}개/3km)` : "경찰관서 미수집",
        ].join(" · "),
      },
      {
        name: "초기분양률",
        score: 100 - initSc,
        info: apt.initialSaleRate != null ? `${apt.initialSaleRate}%` : "정보 없음",
        detail:
          apt.initialSaleRate != null
            ? `${apt.initialSaleRate}% (90%↑안전, 70%↑양호, 50%↑보통, 30%↓위험)`
            : "초기분양률 데이터 없음 (중립 40점)",
      },
    ],
  };
}
