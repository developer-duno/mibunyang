import { BRAND_TIER, AGE_PREMIUM } from "@/constants/brands";
import {
  tierMin,
  DEV_SCORE_TIERS, DEV_SCORE_NEGATIVE_MULT, DEV_SCORE_BASE,
  LAND_COST_TIERS, LAND_COST_LOW, LAND_COST_NULL,
  PRICE_NO_DATA_DEFAULTS,
  PRICE_INDEX_HOT, PRICE_INDEX_WARM, PRICE_INDEX_HOT_BONUS, PRICE_INDEX_WARM_BONUS,
} from "@/constants/scoringTiers";

const IS_DEV = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;

export function getAgeCoeff(completion) {
  if (!completion) return 1.05;
  const parts = completion.toString().split("-");
  const comp = parts.length >= 2 ? new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2] || 1)) : new Date(completion);
  if (isNaN(comp.getTime())) return 1.05;
  if (comp.getTime() > Date.now()) return 1.0;
  const yrs = Math.max(0, (Date.now() - comp.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  const found = AGE_PREMIUM.find(a => yrs >= a.min && yrs < a.max);
  return found ? found.coeff : 1.05;
}

export function getAreaAdj(area) {
  if (!area || area <= 0) return 1.0;  // 면적 미등록 = 중립
  if (area < 60) return 1.08;
  if (area < 85) return 1.0;
  if (area < 115) return 0.97;
  return 0.94;
}

export function scorePrice(apt) {
  const brand = BRAND_TIER[apt.builder];
  if (!brand && IS_DEV) console.warn(`[scoring] Unknown builder: "${apt.builder}"`);
  const b = brand || { adj: 1.0 };
  const ageCoeff = getAgeCoeff(apt.completion);
  const areaAdj = getAreaAdj(apt.area);
  let fairPrice = apt.nearbyMedian * ageCoeff * areaAdj * b.adj;
  // fairPrice=0 폴백: avgPriceSqm 또는 presalePp로 대체 시도
  if (fairPrice <= 0 && apt.avgPriceSqm != null && apt.area > 0) {
    fairPrice = Math.round(apt.avgPriceSqm * apt.area / 10000 * 3.3) * ageCoeff * b.adj;
  }
  if (fairPrice <= 0 && apt.presalePp != null && apt.presalePp > 0) {
    fairPrice = apt.presalePp * ageCoeff * b.adj;
  }
  // 택지비 비율 서브스코어 (공통)
  const landSc = apt.landCostRatio != null
    ? tierMin(apt.landCostRatio, LAND_COST_TIERS, LAND_COST_LOW) : LAND_COST_NULL;
  // priceIndex 보정: 과열 시장에서 신뢰도 가산
  const idxBonus = apt.priceIndex != null && apt.priceIndex > PRICE_INDEX_HOT ? PRICE_INDEX_HOT_BONUS
    : apt.priceIndex != null && apt.priceIndex > PRICE_INDEX_WARM ? PRICE_INDEX_WARM_BONUS : 0;
  const relSc = Math.min(apt.dataReliability + idxBonus, 100);
  if (fairPrice <= 0) {
    const devSc = PRICE_NO_DATA_DEFAULTS.dev;
    const jrSc = PRICE_NO_DATA_DEFAULTS.jr; const pirSc = PRICE_NO_DATA_DEFAULTS.pir; const psrSc = PRICE_NO_DATA_DEFAULTS.psr;
    const total = devSc * 0.30 + jrSc * 0.20 + pirSc * 0.15 + psrSc * 0.25 + relSc * 0.07 + landSc * 0.03;
    return {
      total: Math.round(Math.max(0, Math.min(total, 100))), fairPrice: 0, deviation: "0.0",
      subs: [
        { name: "적정가 괴리도", score: devSc, info: "데이터 부재", detail: "주변 시세 없음 — 적정가 산출 불가" },
        { name: "전세가율", score: Math.round(jrSc), info: `${apt.jeonseRate}%`, detail: `${apt.jeonseRate}% (적정 70~80%, 위험 40%↓)` },
        { name: "PIR", score: Math.round(pirSc), info: `${apt.pir}배`, detail: `${apt.pir}배 (우수 3↓, 양호 5↓, 보통 7↓)` },
        { name: "PSR", score: Math.round(psrSc), info: `${(apt.psr * 100).toFixed(0)}%`, detail: `${(apt.psr * 100).toFixed(0)}% (저평가 85%↓, 적정 100%↓)` },
        { name: "데이터 신뢰도", score: relSc, info: `${apt.dataReliability}%${idxBonus ? `(+${idxBonus})` : ""}`, detail: `${apt.dataReliability}%${idxBonus ? ` +지수보정${idxBonus}` : ""} (80%↑신뢰, 30%↓추정)` },
        { name: "택지비비율", score: landSc, info: apt.landCostRatio != null ? `${apt.landCostRatio}%` : "정보 없음", detail: apt.landCostRatio != null ? `${apt.landCostRatio}% (60%↑안정, 40%↑양호, 20%↓위험)` : "택지비 데이터 없음 (중립 50점)" },
      ],
    };
  }
  const dev = ((fairPrice - apt.price) / fairPrice) * 100;
  let devSc = dev >= DEV_SCORE_TIERS[0].min ? DEV_SCORE_TIERS[0].score : dev >= DEV_SCORE_TIERS[1].min ? DEV_SCORE_TIERS[1].base + (dev - DEV_SCORE_TIERS[1].min) / DEV_SCORE_TIERS[1].span * DEV_SCORE_TIERS[1].range : dev >= DEV_SCORE_TIERS[2].min ? DEV_SCORE_TIERS[2].base + (dev - DEV_SCORE_TIERS[2].min) / DEV_SCORE_TIERS[2].span * DEV_SCORE_TIERS[2].range : dev >= DEV_SCORE_TIERS[3].min ? DEV_SCORE_TIERS[3].base + dev / DEV_SCORE_TIERS[3].span * DEV_SCORE_TIERS[3].range : Math.max(0, DEV_SCORE_BASE + dev * DEV_SCORE_NEGATIVE_MULT);
  devSc = Math.max(0, Math.min(devSc, 100));

  let jrSc; const jr = apt.jeonseRate;
  if (jr >= 70 && jr <= 80) jrSc = 80 + (1 - Math.abs(jr - 75) / 5) * 20;
  else if (jr > 80) jrSc = Math.max(0, 80 - (jr - 80) * 5);
  else if (jr >= 60) jrSc = 60 + (jr - 60) / 10 * 20;
  else jrSc = Math.max(0, jr / 60 * 60);

  let pirSc = apt.pir <= 3 ? 100 : apt.pir <= 5 ? 80 + (5 - apt.pir) / 2 * 20 : apt.pir <= 7 ? 60 + (7 - apt.pir) / 2 * 20 : Math.max(0, 60 - (apt.pir - 7) * 10);
  let psrSc = Math.min(apt.psr < 0.85 ? 85 + (0.85 - apt.psr) / 0.15 * 15 : apt.psr <= 1.0 ? 50 + (1.0 - apt.psr) / 0.15 * 35 : Math.max(0, 50 - (apt.psr - 1.0) / 0.2 * 50), 100);
  const total = devSc * 0.30 + jrSc * 0.20 + pirSc * 0.15 + psrSc * 0.25 + relSc * 0.07 + landSc * 0.03;
  return {
    total: Math.round(Math.max(0, Math.min(total, 100))), fairPrice: Math.round(fairPrice), deviation: dev.toFixed(1),
    subs: [
      { name: "적정가 괴리도", score: Math.round(devSc), info: `${dev > 0 ? "+" : ""}${dev.toFixed(1)}%`, detail: `${dev > 0 ? "+" : ""}${dev.toFixed(1)}% (±5% 적정, ±10~20% 주의, 20%↑ 과대)` },
      { name: "전세가율", score: Math.round(jrSc), info: `${jr}%`, detail: `${jr}% (적정 70~80%, 위험 40%↓, 과열 90%↑)` },
      { name: "PIR", score: Math.round(pirSc), info: `${apt.pir}배`, detail: `${apt.pir}배 (우수 3↓, 양호 5↓, 보통 7↓, 부담 7↑)` },
      { name: "PSR", score: Math.round(psrSc), info: `${(apt.psr * 100).toFixed(0)}%`, detail: `${(apt.psr * 100).toFixed(0)}% (저평가 85%↓, 적정 100%↓, 고평가 100%↑)` },
      { name: "데이터 신뢰도", score: relSc, info: `${apt.dataReliability}%${idxBonus ? `(+${idxBonus})` : ""}`, detail: `${apt.dataReliability}%${idxBonus ? ` +지수보정${idxBonus}` : ""} (80%↑신뢰, 50%↑보통, 30%↓추정)` },
      { name: "택지비비율", score: landSc, info: apt.landCostRatio != null ? `${apt.landCostRatio}%` : "정보 없음", detail: apt.landCostRatio != null ? `${apt.landCostRatio}% (60%↑안정, 40%↑양호, 20%↓위험)` : "택지비 데이터 없음 (중립 50점)" },
    ],
  };
}
