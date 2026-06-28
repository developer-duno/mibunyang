import { INTEREST_RATE, LOAN_TERM_MULT, BENEFIT_FULL_RATE } from "@/constants/scoringTiers";
import type { Apt, Res } from "@/types/scoring";

/**
 * 혜택·할인 점수 (0~100). 6개 혜택 만원 단위 합산 → 분양가 대비 비율 → BENEFIT_FULL_RATE 기준.
 *
 * 합산 항목 6개:
 *   discVal(분양가 할인) + loanVal(중도금 무이자) + optVal(옵션 무상) +
 *   balVal(발코니 확장) + cashVal(캐시백) + maintSave(관리비 절감)
 *
 * 핵심 공식:
 *   - loanVal = `loanFree ? round(price × (loanFreePct/100) × INTEREST_RATE × LOAN_TERM_MULT) : 0`.
 *   - maintSave: `_regionAvgMaint > 0 && avgMaintenanceCost > 0` 동시 충족 시
 *     `max(0, round((regionAvgMaint - avgMaintenanceCost) × 12))` (음수 클램프).
 *   - rate = `price > 0 ? (totalWon / price) × 100 : 0` (price=0 가드).
 *   - sc = `Math.max(0, Math.min(round(rate / BENEFIT_FULL_RATE × 100), 100))`.
 *   - itemScore: `totalWon > 0 ? round(sc × v / totalWon) : 0` (0으로 나누기 방지).
 *   - noData: 6개 모두 0이면 true (UI 분기용).
 *
 * @example
 * // 분양가 5억(50000만), 할인 25% → 12500만 → rate 25 → sc 100 (BENEFIT_FULL_RATE 기준 충족 시)
 * scoreBenefit({ price: 50000, discountPct: 25, loanFree: false, optionFree: false,
 *                balconyFree: false, cashback: 0 }).total  // 100
 */
export function scoreBenefit(apt: Apt): Res {
  const price = (apt.price ?? 0) as number;
  const loanFreePct = (apt.loanFreePct ?? 0) as number;
  const discountPct = (apt.discountPct ?? 0) as number;
  const optionValue = (apt.optionValue ?? 0) as number;
  const balconyValue = (apt.balconyValue ?? 0) as number;
  const cashback = (apt.cashback ?? 0) as number;
  const regionAvgMaint = (apt._regionAvgMaint ?? 0) as number;
  const avgMaint = (apt.avgMaintenanceCost ?? 0) as number;

  const loanVal = apt.loanFree ? Math.round(price * (loanFreePct / 100) * INTEREST_RATE * LOAN_TERM_MULT) : 0;
  const discVal = Math.round((price * discountPct) / 100);
  const optVal = apt.optionFree ? optionValue : 0;
  const balVal = apt.balconyFree ? balconyValue : 0;
  const cashVal = cashback;
  // 관리비 절감액: 지역 평균보다 낮으면 연간 절감액을 혜택에 합산 (만원/세대/월 단위)
  const maintSave = regionAvgMaint > 0 && avgMaint > 0 ? Math.max(0, Math.round((regionAvgMaint - avgMaint) * 12)) : 0;
  const totalWon = discVal + loanVal + optVal + balVal + cashVal + maintSave;
  const rate = price > 0 ? (totalWon / price) * 100 : 0;
  const sc = Math.max(0, Math.min(Math.round((rate / BENEFIT_FULL_RATE) * 100), 100));
  const itemScore = (v: number): number => (totalWon > 0 ? Math.round((sc * v) / totalWon) : 0);
  const noData = discVal === 0 && loanVal === 0 && optVal === 0 && balVal === 0 && cashVal === 0 && maintSave === 0;
  return {
    total: sc,
    totalWon,
    rate: Math.min(rate, 9999).toFixed(1),
    noData,
    subs: [
      {
        name: "분양가 할인",
        score: itemScore(discVal),
        info: discVal > 0 ? `${discVal.toLocaleString()}만` : "-",
        detail: discVal > 0 ? `${discVal.toLocaleString()}만원 (분양가의 ${discountPct}% 할인)` : "할인 없음",
      },
      {
        name: "중도금 무이자",
        score: itemScore(loanVal),
        info: loanVal > 0 ? `~${loanVal.toLocaleString()}만` : "-",
        detail:
          loanVal > 0
            ? `~${loanVal.toLocaleString()}만원 (무이자율 ${loanFreePct}% × 금리 4.5% × 1.5년)`
            : "무이자 없음",
      },
      {
        name: "옵션 무상",
        score: itemScore(optVal),
        info: optVal > 0 ? `${optVal.toLocaleString()}만` : "-",
        detail: optVal > 0 ? `${optVal.toLocaleString()}만원 (주방/바닥재/조명 등)` : "옵션 무상 없음",
      },
      {
        name: "발코니 확장",
        score: itemScore(balVal),
        info: balVal > 0 ? `${balVal.toLocaleString()}만` : "-",
        detail: balVal > 0 ? `${balVal.toLocaleString()}만원 (발코니 개방/확장 비용)` : "발코니 무상 없음",
      },
      {
        name: "캐시백",
        score: itemScore(cashVal),
        info: cashVal > 0 ? `${cashVal}만` : "-",
        detail: cashVal > 0 ? `${cashVal}만원 (계약 시 현금 지급)` : "캐시백 없음",
      },
      {
        name: "관리비 절감",
        score: itemScore(maintSave),
        info: maintSave > 0 ? `연 ~${maintSave.toLocaleString()}만` : "-",
        detail:
          maintSave > 0
            ? `연 ~${maintSave.toLocaleString()}만원 (지역 평균 대비 절감액 × 면적 × 12개월)`
            : "관리비 비교 불가",
      },
    ],
  };
}
