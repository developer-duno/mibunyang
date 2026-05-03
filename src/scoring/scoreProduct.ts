import { BRAND_TIER, LAYOUT_SCORE } from "@/constants/brands";
import {
  tierMin, tierMax,
  UNIT_TIERS, UNIT_UNKNOWN_SCORE, UNIT_SMALL_SCORE,
  PARKING_TIERS, PARKING_LOW_SCORE, FAR_TIERS, FAR_HIGH_SCORE,
  ENERGY_SCORES, ENERGY_DEFAULT, GREEN_BLDG_SCORES,
  EXCL_RATIO_TIERS, EXCL_LOW_SCORE, FLOOR_TIERS, FLOOR_LOW_SCORE, PRODUCT_MAX,
  HOUSING_TYPE_CAP_DEFAULT, HOUSING_TYPE_CAP_NON_APT,
} from "@/constants/scoringTiers";
import type { Apt, Res } from "@/types/scoring";

const IS_DEV = typeof import.meta !== "undefined" && !!(import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV;

/**
 * 상품성 점수 (0~100). 9개 항목 합산 후 PRODUCT_MAX 합으로 정규화.
 *
 * PRODUCT_MAX 합계 = 100 (CLAUDE.md L44, 9개 max 합):
 *   brand · units · parking · far · energy · excl · layout · quake · struct
 * 정규화: `Math.max(0, Math.min(rawTotal / maxPossible × 100, 100))`.
 *
 * 핵심 보정:
 *   - 주택유형별 브랜드 상한: presaleHousingType이 "오피스텔"/"도시형" 포함 시
 *     HOUSING_TYPE_CAP_NON_APT(15), 그 외 HOUSING_TYPE_CAP_DEFAULT(20).
 *   - presaleParking 폴백: `_noParking && presaleParking != null`이면
 *     `presaleParking / max(presaleGeneralSupply ?? units, 1)`로 effectivePR 산출.
 *   - hasPool 보너스: unitSc + 3, 상한 15.
 *   - units ≤ 1: UNIT_UNKNOWN_SCORE(중립 8점) — 0/1 동시 처리.
 *
 * null 처리: `apt.units ?? 0`, `apt.childcare ?? 0` 등 `??` 사용.
 *
 * @example
 * // PRODUCT_MAX 9항목 합 = 100
 * Object.values(PRODUCT_MAX).reduce((a, b) => a + b, 0) === 100  // true
 */
export function scoreProduct(apt: Apt): Res {
  const builder = (apt.builder ?? "기타") as string;
  const brand = (BRAND_TIER as Record<string, { score: number; tier: string }>)[builder];
  if (!brand && IS_DEV) console.warn(`[scoring] Unknown builder: "${builder}"`);
  const b = brand || { score: 5, tier: "기타" };
  // 주택유형별 브랜드 상한: 오피스텔/도시형 → 15, 아파트/null → 20
  const housingType = apt.presaleHousingType as string | undefined;
  const housingCap = housingType != null &&
    (housingType.includes("오피스텔") || housingType.includes("도시형"))
    ? HOUSING_TYPE_CAP_NON_APT : HOUSING_TYPE_CAP_DEFAULT;
  const brandSc = Math.min(b.score, housingCap);
  const units = (apt.units ?? 0) as number;
  let unitSc: number = units <= 1 ? UNIT_UNKNOWN_SCORE : tierMin(units, UNIT_TIERS, UNIT_SMALL_SCORE);
  if (apt.hasPool) unitSc = Math.min(unitSc + 3, 15);
  // presaleParking 폴백: parkingRatio 기본값(0.5)이고 presaleParking 있으면 대체
  const parkingRatio = (apt.parkingRatio ?? 0.5) as number;
  const effectivePR = apt._noParking && apt.presaleParking != null
    ? apt.presaleParking / Math.max((apt.presaleGeneralSupply ?? units) as number, 1)
    : parkingRatio;
  const parkSc: number = tierMin(effectivePR, PARKING_TIERS, PARKING_LOW_SCORE);
  const floorAreaRatio = (apt.floorAreaRatio ?? 300) as number;
  const farSc: number = tierMax(floorAreaRatio, FAR_TIERS, FAR_HIGH_SCORE);
  const energyGrade = apt.energyGrade as string | number | undefined;
  const greenBldg = apt.greenBldg as string | undefined;
  const energySc: number = ((ENERGY_SCORES as Record<string, number>)[String(energyGrade)] ?? ENERGY_DEFAULT) +
    ((GREEN_BLDG_SCORES as Record<string, number>)[String(greenBldg)] || 0);
  const exclusiveRatio = (apt.exclusiveRatio ?? 60) as number;
  const exclSc: number = tierMin(exclusiveRatio, EXCL_RATIO_TIERS, EXCL_LOW_SCORE);
  const layout = apt.layout as string | undefined;
  const layoutSc = (LAYOUT_SCORE as Record<string, number>)[String(layout)] || 3;
  const quakeSc = apt.quakeDesign ? 5 : 0;
  const maxFloor = (apt.maxFloor ?? 10) as number;
  const structSc: number = tierMin(maxFloor, FLOOR_TIERS, FLOOR_LOW_SCORE);
  const rawTotal = brandSc + unitSc + parkSc + farSc + energySc + exclSc + layoutSc + quakeSc + structSc;
  const maxPossible = (Object.values(PRODUCT_MAX) as number[]).reduce((a, b) => a + b, 0);
  const total = Math.round(Math.max(0, Math.min(rawTotal / maxPossible * 100, 100)));
  return {
    total,
    subs: [
      { name: "브랜드", score: brandSc, info: b.tier || "기타", detail: `${b.tier || "기타"} (1군 20점, 2군 15점, 3군 10점, 기타 5점)` },
      { name: "세대수", score: unitSc, info: units <= 1 ? "정보 없음 (중립)" : `${units.toLocaleString()}세대`, detail: units <= 1 ? "미확인 (중립 8점)" : `${units.toLocaleString()}세대 (대단지 1500↑, 중대형 700↑, 중형 400↑)` },
      { name: "주차", score: parkSc, info: apt._noParking ? "정보 없음" : `${parkingRatio}대/세대`, detail: apt._noParking ? "미수집 (기준: 1.5↑우수, 1.3↑양호, 1.1↑보통)" : `${parkingRatio}대/세대 (우수 1.5↑, 양호 1.3↑, 보통 1.1↑)` },
      { name: "용적률", score: farSc, info: apt._noFar ? "정보 없음" : `${floorAreaRatio}%`, detail: apt._noFar ? "미수집 (기준: 200%↓쾌적, 250%↓보통)" : `${floorAreaRatio}% (쾌적 200%↓, 보통 250%↓, 밀집 250%↑)` },
      { name: "에너지", score: energySc, info: energyGrade != null ? `${energyGrade}등급` : "정보 없음", detail: energyGrade != null ? `${energyGrade}등급 (1등급 7점, 2등급 5점, 기본 3점)` : "미수집 (기준: 1등급 최고 7점, 2등급 5점)" },
      { name: "전용률", score: exclSc, info: apt._noExcl ? "정보 없음" : `${exclusiveRatio}%`, detail: apt._noExcl ? "미수집 (기준: 80%↑우수, 77%↑양호, 74%↑보통)" : `${exclusiveRatio}% (우수 80%↑, 양호 77%↑, 보통 74%↑)` },
      { name: "평면", score: layoutSc, info: layout || "정보 없음", detail: layout ? `${layout} (판상형>혼합형>타워형)` : "미수집 (판상형>혼합형>타워형)" },
      { name: "내진", score: quakeSc, info: apt.quakeDesign ? "적용" : "정보 없음", detail: apt.quakeDesign ? "적용 (5점)" : "미적용 또는 미수집 (0점)" },
      { name: "구조", score: structSc, info: apt._noFloor ? "정보 없음" : `최고 ${maxFloor}층`, detail: apt._noFloor ? "미수집 (기준: 35층↑고층, 25층↑중고층, 15층↑중층)" : `최고 ${maxFloor}층 (고층 35↑, 중고층 25↑, 중층 15↑)` },
    ],
  };
}
