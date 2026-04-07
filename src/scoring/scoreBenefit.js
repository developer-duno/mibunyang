import { INTEREST_RATE, LOAN_TERM_MULT, BENEFIT_FULL_RATE } from "@/constants/scoringTiers";

export function scoreBenefit(apt) {
  const loanVal = apt.loanFree ? Math.round(apt.price * (apt.loanFreePct / 100) * INTEREST_RATE * LOAN_TERM_MULT) : 0;
  const discVal = Math.round(apt.price * apt.discountPct / 100);
  const optVal = apt.optionFree ? apt.optionValue : 0;
  const balVal = apt.balconyFree ? apt.balconyValue : 0;
  const cashVal = apt.cashback;
  // 관리비 절감액: 지역 평균보다 낮으면 연간 절감액을 혜택에 합산 (만원/세대/월 단위)
  const maintSave = apt._regionAvgMaint > 0 && apt.avgMaintenanceCost > 0
    ? Math.max(0, Math.round((apt._regionAvgMaint - apt.avgMaintenanceCost) * 12))
    : 0;
  const totalWon = discVal + loanVal + optVal + balVal + cashVal + maintSave;
  const rate = apt.price > 0 ? (totalWon / apt.price) * 100 : 0;
  const sc = Math.max(0, Math.min(Math.round(rate / BENEFIT_FULL_RATE * 100), 100));
  const itemScore = (v) => totalWon > 0 ? Math.round(sc * v / totalWon) : 0;
  const noData = discVal === 0 && loanVal === 0 && optVal === 0 && balVal === 0 && cashVal === 0 && maintSave === 0;
  return {
    total: sc, totalWon, rate: Math.min(rate, 9999).toFixed(1), noData,
    subs: [
      { name: "분양가 할인", score: itemScore(discVal), info: discVal > 0 ? `${discVal.toLocaleString()}만` : "-", detail: discVal > 0 ? `${discVal.toLocaleString()}만원 (분양가의 ${apt.discountPct}% 할인)` : "할인 없음" },
      { name: "중도금 무이자", score: itemScore(loanVal), info: loanVal > 0 ? `~${loanVal.toLocaleString()}만` : "-", detail: loanVal > 0 ? `~${loanVal.toLocaleString()}만원 (무이자율 ${apt.loanFreePct}% × 금리 4.5% × 1.5년)` : "무이자 없음" },
      { name: "옵션 무상", score: itemScore(optVal), info: optVal > 0 ? `${optVal.toLocaleString()}만` : "-", detail: optVal > 0 ? `${optVal.toLocaleString()}만원 (주방/바닥재/조명 등)` : "옵션 무상 없음" },
      { name: "발코니 확장", score: itemScore(balVal), info: balVal > 0 ? `${balVal.toLocaleString()}만` : "-", detail: balVal > 0 ? `${balVal.toLocaleString()}만원 (발코니 개방/확장 비용)` : "발코니 무상 없음" },
      { name: "캐시백", score: itemScore(cashVal), info: cashVal > 0 ? `${cashVal}만` : "-", detail: cashVal > 0 ? `${cashVal}만원 (계약 시 현금 지급)` : "캐시백 없음" },
      { name: "관리비 절감", score: itemScore(maintSave), info: maintSave > 0 ? `연 ~${maintSave.toLocaleString()}만` : "-", detail: maintSave > 0 ? `연 ~${maintSave.toLocaleString()}만원 (지역 평균 대비 절감액 × 면적 × 12개월)` : "관리비 비교 불가" },
    ],
  };
}
