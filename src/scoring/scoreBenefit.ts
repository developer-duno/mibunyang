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
  /**
   * 원본이 `null`(안 재봄)이면 "미수집", 확인된 0/false 일 때만 "없음".
   *
   * ⚠️ 세션512 실측 — 이 5종(할인·무이자·옵션·발코니·캐시백)의 원본 필드는 **1,646곳 전부 null** 이다.
   * 그런데 옛 문구는 전부 "…없음"이라 단정해, 한 번도 재보지 않은 것을 "확인해 보니 없다"로 말했다.
   * `src/scoring/CLAUDE.md` §"unknown(null) 처리 원칙"의 문구판이다.
   */
  const unk = (raw: unknown, none: string): string => (raw == null ? "미수집" : none);
  /**
   * 합계 금액이 **실제로 무엇으로 이뤄졌는지**. 화면 라벨은 이 값을 쓴다.
   *
   * ⚠️ 세션512 실측 — 금액이 있는 548곳 **전부** 내용물이 `관리비 절감` 단독인데 화면은
   * "총 혜택"이라 불렀다. 나머지 5종이 전 단지 미수집이라 그런 것인데, 손님은 "혜택을 다 따져본
   * 결과"로 읽는다. 라벨을 손으로 적으면 나중에 다른 혜택이 채워질 때 또 어긋나므로 **파생**한다.
   */
  const parts = [
    discVal > 0 ? "분양가 할인" : null,
    loanVal > 0 ? "중도금 무이자" : null,
    optVal > 0 ? "옵션 무상" : null,
    balVal > 0 ? "발코니 확장" : null,
    cashVal > 0 ? "캐시백" : null,
    maintSave > 0 ? "관리비 절감" : null,
  ].filter(Boolean) as string[];
  const wonSource = parts.length === 1 ? parts[0] : parts.length > 1 ? "혜택 합계" : "";
  return {
    total: sc,
    totalWon,
    wonSource,
    rate: Math.min(rate, 9999).toFixed(1),
    noData,
    subs: [
      {
        name: "분양가 할인",
        score: itemScore(discVal),
        info: discVal > 0 ? `${discVal.toLocaleString()}만` : "-",
        detail:
          discVal > 0
            ? `${discVal.toLocaleString()}만원 (분양가의 ${discountPct}% 할인)`
            : unk(apt._noDiscount ? null : discountPct, "할인 없음"),
      },
      {
        name: "중도금 무이자",
        score: itemScore(loanVal),
        info: loanVal > 0 ? `~${loanVal.toLocaleString()}만` : "-",
        detail:
          loanVal > 0
            ? `~${loanVal.toLocaleString()}만원 (무이자율 ${loanFreePct}% × 금리 4.5% × 1.5년)`
            : unk(apt.loanFree, "무이자 없음"),
      },
      {
        name: "옵션 무상",
        score: itemScore(optVal),
        info: optVal > 0 ? `${optVal.toLocaleString()}만` : "-",
        detail:
          optVal > 0 ? `${optVal.toLocaleString()}만원 (주방/바닥재/조명 등)` : unk(apt.optionFree, "옵션 무상 없음"),
      },
      {
        name: "발코니 확장",
        score: itemScore(balVal),
        info: balVal > 0 ? `${balVal.toLocaleString()}만` : "-",
        detail:
          balVal > 0
            ? `${balVal.toLocaleString()}만원 (발코니 개방/확장 비용)`
            : unk(apt.balconyFree, "발코니 무상 없음"),
      },
      {
        name: "캐시백",
        score: itemScore(cashVal),
        info: cashVal > 0 ? `${cashVal}만` : "-",
        detail:
          cashVal > 0 ? `${cashVal}만원 (계약 시 현금 지급)` : unk(apt._noCashback ? null : cashback, "캐시백 없음"),
      },
      {
        name: "관리비 절감",
        score: itemScore(maintSave),
        info: maintSave > 0 ? `연 ~${maintSave.toLocaleString()}만` : "-",
        detail:
          maintSave > 0
            ? `연 ~${maintSave.toLocaleString()}만원 (지역 중앙값 관리비 대비 월 차액 × 12개월)`
            : unk(apt._noMaint ? null : avgMaint, "관리비 비교 불가"),
      },
    ],
  };
}
