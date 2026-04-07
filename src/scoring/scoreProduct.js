import { BRAND_TIER, LAYOUT_SCORE } from "@/constants/brands";
import {
  tierMin, tierMax,
  UNIT_TIERS, UNIT_UNKNOWN_SCORE, UNIT_SMALL_SCORE,
  PARKING_TIERS, PARKING_LOW_SCORE, FAR_TIERS, FAR_HIGH_SCORE,
  ENERGY_SCORES, ENERGY_DEFAULT, GREEN_BLDG_SCORES,
  EXCL_RATIO_TIERS, EXCL_LOW_SCORE, FLOOR_TIERS, FLOOR_LOW_SCORE, PRODUCT_MAX,
  HOUSING_TYPE_CAP_DEFAULT, HOUSING_TYPE_CAP_NON_APT,
} from "@/constants/scoringTiers";

const IS_DEV = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;

export function scoreProduct(apt) {
  const brand = BRAND_TIER[apt.builder];
  if (!brand && IS_DEV) console.warn(`[scoring] Unknown builder: "${apt.builder}"`);
  const b = brand || { score: 5, tier: "기타" };
  // 주택유형별 브랜드 상한: 오피스텔/도시형 → 15, 아파트/null → 20
  const housingCap = apt.presaleHousingType != null &&
    (apt.presaleHousingType.includes("오피스텔") || apt.presaleHousingType.includes("도시형"))
    ? HOUSING_TYPE_CAP_NON_APT : HOUSING_TYPE_CAP_DEFAULT;
  const brandSc = Math.min(b.score, housingCap);
  let unitSc = apt.units <= 1 ? UNIT_UNKNOWN_SCORE : tierMin(apt.units, UNIT_TIERS, UNIT_SMALL_SCORE);
  if (apt.hasPool) unitSc = Math.min(unitSc + 3, 15);
  // presaleParking 폴백: parkingRatio 기본값(0.5)이고 presaleParking 있으면 대체
  const effectivePR = apt._noParking && apt.presaleParking != null
    ? apt.presaleParking / Math.max(apt.presaleGeneralSupply ?? apt.units, 1)
    : apt.parkingRatio;
  let parkSc = tierMin(effectivePR, PARKING_TIERS, PARKING_LOW_SCORE);
  let farSc = tierMax(apt.floorAreaRatio, FAR_TIERS, FAR_HIGH_SCORE);
  let energySc = (ENERGY_SCORES[apt.energyGrade] ?? ENERGY_DEFAULT) + (GREEN_BLDG_SCORES[apt.greenBldg] || 0);
  let exclSc = tierMin(apt.exclusiveRatio, EXCL_RATIO_TIERS, EXCL_LOW_SCORE);
  const layoutSc = LAYOUT_SCORE[apt.layout] || 3;
  const quakeSc = apt.quakeDesign ? 5 : 0;
  let structSc = tierMin(apt.maxFloor, FLOOR_TIERS, FLOOR_LOW_SCORE);
  const rawTotal = brandSc + unitSc + parkSc + farSc + energySc + exclSc + layoutSc + quakeSc + structSc;
  const maxPossible = Object.values(PRODUCT_MAX).reduce((a, b) => a + b, 0);
  const total = Math.round(Math.max(0, Math.min(rawTotal / maxPossible * 100, 100)));
  return {
    total,
    subs: [
      { name: "브랜드", score: brandSc, info: b.tier || "기타", detail: `${b.tier || "기타"} (1군 20점, 2군 15점, 3군 10점, 기타 5점)` },
      { name: "세대수", score: unitSc, info: apt.units <= 1 ? "정보 없음 (중립)" : `${(apt.units ?? 0).toLocaleString()}세대`, detail: apt.units <= 1 ? "미확인 (중립 8점)" : `${(apt.units ?? 0).toLocaleString()}세대 (대단지 1500↑, 중대형 700↑, 중형 400↑)` },
      { name: "주차", score: parkSc, info: apt._noParking ? "정보 없음" : `${apt.parkingRatio}대/세대`, detail: apt._noParking ? "미수집 (기준: 1.5↑우수, 1.3↑양호, 1.1↑보통)" : `${apt.parkingRatio}대/세대 (우수 1.5↑, 양호 1.3↑, 보통 1.1↑)` },
      { name: "용적률", score: farSc, info: apt._noFar ? "정보 없음" : `${apt.floorAreaRatio}%`, detail: apt._noFar ? "미수집 (기준: 200%↓쾌적, 250%↓보통)" : `${apt.floorAreaRatio}% (쾌적 200%↓, 보통 250%↓, 밀집 250%↑)` },
      { name: "에너지", score: energySc, info: apt.energyGrade != null ? `${apt.energyGrade}등급` : "정보 없음", detail: apt.energyGrade != null ? `${apt.energyGrade}등급 (1등급 7점, 2등급 5점, 기본 3점)` : "미수집 (기준: 1등급 최고 7점, 2등급 5점)" },
      { name: "전용률", score: exclSc, info: apt._noExcl ? "정보 없음" : `${apt.exclusiveRatio}%`, detail: apt._noExcl ? "미수집 (기준: 80%↑우수, 77%↑양호, 74%↑보통)" : `${apt.exclusiveRatio}% (우수 80%↑, 양호 77%↑, 보통 74%↑)` },
      { name: "평면", score: layoutSc, info: apt.layout || "정보 없음", detail: apt.layout ? `${apt.layout} (판상형>혼합형>타워형)` : "미수집 (판상형>혼합형>타워형)" },
      { name: "내진", score: quakeSc, info: apt.quakeDesign ? "적용" : "정보 없음", detail: apt.quakeDesign ? "적용 (5점)" : "미적용 또는 미수집 (0점)" },
      { name: "구조", score: structSc, info: apt._noFloor ? "정보 없음" : `최고 ${apt.maxFloor}층`, detail: apt._noFloor ? "미수집 (기준: 35층↑고층, 25층↑중고층, 15층↑중층)" : `최고 ${apt.maxFloor}층 (고층 35↑, 중고층 25↑, 중층 15↑)` },
    ],
  };
}
