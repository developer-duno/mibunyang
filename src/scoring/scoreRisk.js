import { getZone } from "@/constants/regulations";
import {
  tierMax, tierMin,
  UNSOLD_RATE_TIERS, UNSOLD_HIGH_SCORE, UNSOLD_UNKNOWN_SCORE,
  LIQUIDITY_TIERS, LIQUIDITY_LOW_SCORE,
  CREDIT_GRADE_SCORES, CREDIT_DEFAULT,
  SUPPLY_RATIO_TIERS, SUPPLY_HIGH_SCORE,
  CANCEL_RATIO_TIERS, CANCEL_RATIO_HIGH_SCORE, CANCEL_RATIO_NULL_SCORE,
  CRIME_SAFETY_SCORES, CRIME_SAFETY_NULL_SCORE,
  POLICE_DIST_TIERS, POLICE_DIST_HIGH_SCORE, POLICE_DIST_NULL_SCORE,
  INIT_SALE_TIERS, INIT_SALE_HIGH_RISK, INIT_SALE_NULL,
  LISTING_FLOOD_THRESHOLD, LISTING_WARN_THRESHOLD, LISTING_FLOOD_PENALTY, LISTING_WARN_PENALTY,
  PUBLIC_PRESALE_BONUS, NEW_SUPPLY_HIGH, NEW_SUPPLY_LOW, NEW_SUPPLY_HIGH_ADJ, NEW_SUPPLY_LOW_ADJ,
} from "@/constants/scoringTiers";

export function scoreRisk(apt) {
  let unsoldSc = apt.units <= 1 ? UNSOLD_UNKNOWN_SCORE : tierMax(apt.unsoldRate, UNSOLD_RATE_TIERS, UNSOLD_HIGH_SCORE);
  let liqSc = tierMin(apt.recentTrades6m, LIQUIDITY_TIERS, LIQUIDITY_LOW_SCORE);
  // 매물 과잉 페널티: naverSellCount 기반
  const listingPen = apt.naverSellCount != null && apt.naverSellCount > LISTING_FLOOD_THRESHOLD ? LISTING_FLOOD_PENALTY
    : apt.naverSellCount != null && apt.naverSellCount > LISTING_WARN_THRESHOLD ? LISTING_WARN_PENALTY : 0;
  liqSc = Math.min(liqSc + listingPen, 100);
  let loanSc = (apt.dsr40pass ? 15 : 50) + (apt.loanFree ? 0 : 15);
  let finSc = (apt.hugGuarantee ? 0 : 40) + (CREDIT_GRADE_SCORES[apt.builderCreditGrade] ?? CREDIT_DEFAULT) + (apt.builderDebtRatio > 200 ? 20 : apt.builderDebtRatio > 150 ? 10 : 0);
  // 공공분양 재무안전 보너스
  if (apt.presaleType != null && apt.presaleType.includes("공공")) finSc += PUBLIC_PRESALE_BONUS;
  finSc = Math.max(0, Math.min(finSc, 100));
  // 규제지역: DB isRegulated 우선, null이면 getZone() 폴백
  const zone = apt.isRegulated != null
    ? (apt.isRegulated ? "regulated" : "normal")
    : getZone(apt.region, apt.gu);
  let regSc = zone !== "normal" ? 60 : 10;
  let supSc = tierMax(apt.supplyRatio, SUPPLY_RATIO_TIERS, SUPPLY_HIGH_SCORE);
  // 신규공급 보정
  if (apt.newSupply != null && apt.newSupply > NEW_SUPPLY_HIGH) supSc = Math.min(supSc + NEW_SUPPLY_HIGH_ADJ, 100);
  else if (apt.newSupply != null && apt.newSupply < NEW_SUPPLY_LOW) supSc = Math.max(supSc + NEW_SUPPLY_LOW_ADJ, 0);
  // 초기분양률 서브스코어 (신규)
  let initSc = apt.initialSaleRate == null ? INIT_SALE_NULL
    : tierMin(apt.initialSaleRate, INIT_SALE_TIERS, INIT_SALE_HIGH_RISK);
  let mktSc = apt.popGrowth == null ? 35
    : apt.popGrowth >= 1.0 ? 5
    : apt.popGrowth >= 0.5 ? 20
    : apt.popGrowth >= 0 ? 35
    : apt.popGrowth >= -0.3 ? 50
    : apt.popGrowth >= -0.8 ? 65
    : apt.popGrowth >= -2.0 ? 80
    : 90;
  let cancelSc = apt.cancelRatio6m == null ? CANCEL_RATIO_NULL_SCORE
    : tierMax(apt.cancelRatio6m, CANCEL_RATIO_TIERS, CANCEL_RATIO_HIGH_SCORE);
  // 경쟁률: 미달(음수) → 위험, 높을수록 안전. 완충 구간 포함 (rate=0 절벽 방지)
  let compSc = apt.competitionRate == null ? 40
    : apt.competitionRate >= 10 ? 5
    : apt.competitionRate >= 3 ? 15
    : apt.competitionRate >= 1 ? 30
    : apt.competitionRate >= 0.5 ? 45
    : apt.competitionRate >= 0 ? 55
    : apt.competitionRate >= -0.5 ? 70
    : 85;
  // 치안 안전: 행안부 범죄 등급(70%) + 경찰관서 근접성(30%)
  const gradeRisk = apt.crimeSafetyGrade == null ? CRIME_SAFETY_NULL_SCORE
    : (CRIME_SAFETY_SCORES[apt.crimeSafetyGrade] ?? CRIME_SAFETY_NULL_SCORE);
  const policeRisk = apt.policeDist == null ? POLICE_DIST_NULL_SCORE
    : tierMax(apt.policeDist, POLICE_DIST_TIERS, POLICE_DIST_HIGH_SCORE);
  let crimeSc = gradeRisk * 0.7 + policeRisk * 0.3;
  const risk = unsoldSc * 0.14 + liqSc * 0.14 + loanSc * 0.15 + finSc * 0.17 + regSc * 0.05 + supSc * 0.10 + mktSc * 0.04 + cancelSc * 0.04 + compSc * 0.09 + crimeSc * 0.05 + initSc * 0.03;
  const safety = Math.round(Math.max(0, Math.min(100, 100 - risk)));
  return {
    total: safety, riskRaw: Math.round(risk),
    subs: [
      { name: "미분양률", score: 100 - unsoldSc, info: apt.units <= 1 ? "세대수 미확인 (중립)" : `${apt.unsoldRate}%`, detail: apt.units <= 1 ? "세대수 미확인 (중립 40점)" : `${apt.unsoldRate}% (안전 5%↓, 주의 15~30%, 위험 50%↑)` },
      { name: "경쟁률", score: 100 - compSc, info: apt.competitionRate != null ? (apt.competitionRate < 0 ? `미달 ${(Math.abs(apt.competitionRate) * 100).toFixed(0)}%` : `${apt.competitionRate.toFixed(1)}:1`) : "정보 없음", detail: apt.competitionRate != null ? (apt.competitionRate < 0 ? `미달 ${(Math.abs(apt.competitionRate) * 100).toFixed(0)}% (신청부족)` : `${apt.competitionRate.toFixed(1)}:1 (인기 10↑, 적정 3↑, 약 1↑, 미달 0↓)`) : "경쟁률 데이터 없음 (중립 40점)" },
      { name: "거래량", score: 100 - liqSc, info: `6개월 ${apt.recentTrades6m}건`, detail: `6개월 ${apt.recentTrades6m}건 (활발 30↑, 보통 15↑, 부진 5↓)` },
      { name: "대출/잔금", score: 100 - loanSc, info: apt.dsr40pass ? "DSR통과" : "주의", detail: apt.dsr40pass ? "DSR 40% 통과 (자금조달 양호)" : "DSR 미통과 (대출 곤란 주의)" },
      { name: "시공사 재무", score: 100 - Math.round(finSc), info: apt.builderCreditGrade || "정보 없음", detail: `${apt.builderCreditGrade || "미확인"} (AA↑안전, A보통, BBB↓주의, 부채율 ${apt.builderDebtRatio}%)` },
      { name: "규제", score: 100 - regSc, info: zone !== "normal" ? "규제지역" : "비규제", detail: zone !== "normal" ? "규제지역 (매매·대출 제약)" : "비규제 (거래 자유)" },
      { name: "공급량", score: 100 - supSc, info: `${apt.supplyRatio}%`, detail: `${apt.supplyRatio}% (부족 50%↓, 적정 100%↓, 과잉 130%↑)` },
      { name: "시장환경", score: 100 - mktSc, info: apt.popGrowth != null ? `인구 ${apt.popGrowth > 0 ? "+" : ""}${apt.popGrowth}%` : "정보 없음", detail: apt.popGrowth != null ? `인구 ${apt.popGrowth > 0 ? "+" : ""}${apt.popGrowth}% (성장 +1%↑, 안정 0%↑, 감소 -0.8%↓)` : "인구 데이터 없음 (중립 35점)" },
      { name: "계약해제율", score: 100 - cancelSc, info: apt.cancelRatio6m != null ? `${apt.cancelRatio6m}%` : "정보 없음", detail: apt.cancelRatio6m != null ? `${apt.cancelRatio6m}% (안전 3%↓, 주의 8~15%, 위험 25%↑)` : "계약해제율 데이터 없음 (중립 35점)" },
      { name: "치안 안전", score: Math.round(100 - crimeSc), info: [apt.crimeSafetyGrade != null ? `${apt.crimeSafetyGrade}등급` : null, apt.policeDist != null ? `경찰 ${apt.policeDist}m` : null].filter(Boolean).join(" · ") || "정보 없음", detail: [apt.crimeSafetyGrade != null ? `범죄등급 ${apt.crimeSafetyGrade}등급 (1=최안전~5=최위험)` : "범죄등급 미수집", apt.policeDist != null ? `경찰관서 ${apt.policeDist}m (${(apt.police ?? 0)}개/3km)` : "경찰관서 미수집"].join(" · ") },
      { name: "초기분양률", score: 100 - initSc, info: apt.initialSaleRate != null ? `${apt.initialSaleRate}%` : "정보 없음", detail: apt.initialSaleRate != null ? `${apt.initialSaleRate}% (90%↑안전, 70%↑양호, 50%↑보통, 30%↓위험)` : "초기분양률 데이터 없음 (중립 40점)" },
    ],
  };
}
