import { BRAND_TIER, AGE_PREMIUM } from "@/constants/brands";
import {
  tierMin,
  DEV_SCORE_TIERS, DEV_SCORE_NEGATIVE_MULT, DEV_SCORE_BASE,
  LAND_COST_TIERS, LAND_COST_LOW, LAND_COST_NULL,
  PRICE_NO_DATA_DEFAULTS,
  PIR_SCORE_TIERS,
  PRICE_INDEX_HOT, PRICE_INDEX_WARM, PRICE_INDEX_HOT_BONUS, PRICE_INDEX_WARM_BONUS,
  PRICE_FALLBACK_RELIABILITY_PENALTY,
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

// 세션111: price=0 구조적 사유별 UX 분기 확장.
// 점수 로직(devSc=30 중립)은 불변, 문구만 정교화.
// 판정 순서: 임대 → 정비사업 → 후분양 → 오피스텔 → 분양계획 → 택지지구 블록 → 공공분양 → 기본.
// presaleStage "분양계획"은 모집공고 전 예정 단지 신호 — naver-presale 수집기가
// price=0으로 저장하는 정상 동작. 이름 패턴보다 구체적이라 택지블록 앞에 위치.
function classifyNoPrice(apt) {
  const name = apt.name || "";
  const presale = apt.presaleType || "";
  const stage = apt.presaleStage || "";
  if (presale.includes("임대")) return "임대형 공급 — 분양가 산출 대상 아님";
  if (/(재건축|재개발|촉진구역|\d+구역)/.test(name)) return "정비사업 — 조합원 물량, 분양가 미정";
  if (/(써밋|후분양)/.test(name)) return "후분양 단지 — 분양가 미정";
  if (/\(오\)$/.test(name)) return "오피스텔 — 분양가 별도 공고";
  if (stage === "분양계획") return "분양 예정 단지 — 모집공고 전";
  if (/(\d+BL|\d+블럭|\d+블록|\bA\d+\b|\bB\d+\b|\d+단지|지구|신도시)/.test(name)) return "택지지구 블록 — 분양가 공고 전";
  if (presale.includes("공공")) return "공공분양 — 분양가 공고 대기";
  return "분양가 데이터 없음 (중립 점수)";
}

export function scorePrice(apt) {
  const brand = BRAND_TIER[apt.builder];
  if (!brand && IS_DEV) console.warn(`[scoring] Unknown builder: "${apt.builder}"`);
  const b = brand || { adj: 1.0 };
  const ageCoeff = getAgeCoeff(apt.completion);
  const areaAdj = getAreaAdj(apt.area);
  let fairPrice = (apt.nearbyMedian ?? 0) * ageCoeff * areaAdj * b.adj;
  // 세션114: nearbyMedian 부재로 시도 평균 폴백(avgPriceSqm/presalePp) 사용 여부.
  // 섬·군 지역에서 시도 평균이 실시세의 2~3배로 왜곡 → 신뢰도 차감 + detail 경고.
  let fairPriceFromSidoAvg = false;
  // fairPrice=0 폴백: avgPriceSqm(천원/㎡) 또는 presalePp(만원/평) → 만원 총가
  if (fairPrice <= 0 && apt.avgPriceSqm != null && apt.area > 0) {
    fairPrice = Math.round(apt.avgPriceSqm * apt.area / 10) * ageCoeff * areaAdj * b.adj;
    if (fairPrice > 0) fairPriceFromSidoAvg = true;
  }
  if (fairPrice <= 0 && apt.presalePp != null && apt.presalePp > 0 && apt.area > 0) {
    fairPrice = apt.presalePp * (apt.area / 3.3058) * ageCoeff * areaAdj * b.adj;
    if (fairPrice > 0) fairPriceFromSidoAvg = true;
  }
  // 택지비 비율 서브스코어 (공통)
  const landSc = apt.landCostRatio != null
    ? tierMin(apt.landCostRatio, LAND_COST_TIERS, LAND_COST_LOW) : LAND_COST_NULL;
  // priceIndex 보정: 과열 시장에서 신뢰도 가산
  const idxBonus = apt.priceIndex != null && apt.priceIndex > PRICE_INDEX_HOT ? PRICE_INDEX_HOT_BONUS
    : apt.priceIndex != null && apt.priceIndex > PRICE_INDEX_WARM ? PRICE_INDEX_WARM_BONUS : 0;
  // 방안 A: 시도 평균 폴백 사용 시 dataReliability 차감(세션114)
  const relBase = fairPriceFromSidoAvg
    ? Math.max(0, apt.dataReliability - PRICE_FALLBACK_RELIABILITY_PENALTY)
    : apt.dataReliability;
  const relSc = Math.min(relBase + idxBonus, 100);
  if (fairPrice <= 0 || !apt.price || apt.price <= 0) {
    const devSc = PRICE_NO_DATA_DEFAULTS.dev;
    const jrSc = PRICE_NO_DATA_DEFAULTS.jr; const pirSc = PRICE_NO_DATA_DEFAULTS.pir; const psrSc = PRICE_NO_DATA_DEFAULTS.psr;
    const total = devSc * 0.30 + jrSc * 0.20 + pirSc * 0.15 + psrSc * 0.25 + relSc * 0.07 + landSc * 0.03;
    const noPriceDetail = (!apt.price || apt.price <= 0) ? classifyNoPrice(apt) : "주변 시세 없음 — 적정가 산출 불가";
    return {
      total: Math.round(Math.max(0, Math.min(total, 100))), fairPrice: 0, deviation: "0.0",
      subs: [
        { name: "적정가 괴리도", score: devSc, info: "데이터 부재", detail: noPriceDetail },
        { name: "전세가율", score: Math.round(jrSc), info: apt.jeonseRate == null ? "데이터 부재" : `${apt.jeonseRate}%`, detail: apt.jeonseRate == null ? "전세가율 데이터 없음 (중립 50점)" : `${apt.jeonseRate}% (적정 70~80%, 위험 40%↓)` },
        { name: "PIR", score: Math.round(pirSc), info: apt.pir == null ? "데이터 부재" : `${apt.pir}배`, detail: apt.pir == null ? "PIR 데이터 없음 (중립 50점)" : `${apt.pir}배 (우수 10↓, 양호 20↓, 보통 30↓, 부담 30↑)` },
        { name: "PSR", score: Math.round(psrSc), info: apt.psr == null ? "데이터 부재" : `${(apt.psr * 100).toFixed(0)}%`, detail: apt.psr == null ? "PSR 데이터 없음 (중립 50점)" : `${(apt.psr * 100).toFixed(0)}% (저평가 85%↓, 적정 100%↓)` },
        { name: "데이터 신뢰도", score: relSc, info: `${apt.dataReliability}%${idxBonus ? `(+${idxBonus})` : ""}`, detail: `${apt.dataReliability}%${idxBonus ? ` +지수보정${idxBonus}` : ""} (80%↑신뢰, 30%↓추정)` },
        { name: "택지비비율", score: landSc, info: apt.landCostRatio != null ? `${apt.landCostRatio}%` : "정보 없음", detail: apt.landCostRatio != null ? `${apt.landCostRatio}% (60%↑안정, 40%↑양호, 20%↓위험)` : "택지비 데이터 없음 (중립 50점)" },
      ],
    };
  }
  const dev = ((fairPrice - apt.price) / fairPrice) * 100;
  let devSc = dev >= DEV_SCORE_TIERS[0].min ? DEV_SCORE_TIERS[0].score : dev >= DEV_SCORE_TIERS[1].min ? DEV_SCORE_TIERS[1].base + (dev - DEV_SCORE_TIERS[1].min) / DEV_SCORE_TIERS[1].span * DEV_SCORE_TIERS[1].range : dev >= DEV_SCORE_TIERS[2].min ? DEV_SCORE_TIERS[2].base + (dev - DEV_SCORE_TIERS[2].min) / DEV_SCORE_TIERS[2].span * DEV_SCORE_TIERS[2].range : dev >= DEV_SCORE_TIERS[3].min ? DEV_SCORE_TIERS[3].base + dev / DEV_SCORE_TIERS[3].span * DEV_SCORE_TIERS[3].range : Math.max(0, DEV_SCORE_BASE + dev * DEV_SCORE_NEGATIVE_MULT);
  devSc = Math.max(0, Math.min(devSc, 100));

  const jr = apt.jeonseRate;
  let jrSc;
  if (jr == null) jrSc = PRICE_NO_DATA_DEFAULTS.jr;
  else if (jr >= 70 && jr <= 80) jrSc = 80 + (1 - Math.abs(jr - 75) / 5) * 20;
  else if (jr > 80) jrSc = Math.max(0, 80 - (jr - 80) * 5);
  else if (jr >= 60) jrSc = 60 + (jr - 60) / 10 * 20;
  else jrSc = Math.max(0, jr / 60 * 60);

  const pir = apt.pir;
  // 세션108: KOSIS 1인당 개인소득 기준 PIR 분포(p25=14.7, p50=19.25, p75=25.27)에 맞춘
  // 재설계 구간. 기존 ≤3/≤5/≤7 구간(가구소득 가정)은 개인소득 PIR에 부적절.
  const { EXCELLENT_MAX, GOOD_MAX, MODERATE_MAX, BURDEN_PENALTY } = PIR_SCORE_TIERS;
  const pirSc = pir == null ? PRICE_NO_DATA_DEFAULTS.pir
    : pir <= EXCELLENT_MAX ? 100
    : pir <= GOOD_MAX ? 80 + (GOOD_MAX - pir) / (GOOD_MAX - EXCELLENT_MAX) * 20
    : pir <= MODERATE_MAX ? 60 + (MODERATE_MAX - pir) / (MODERATE_MAX - GOOD_MAX) * 20
    : Math.max(0, 60 - (pir - MODERATE_MAX) * BURDEN_PENALTY);
  const psr = apt.psr;
  const psrSc = psr == null ? PRICE_NO_DATA_DEFAULTS.psr
    : Math.min(psr < 0.85 ? 85 + (0.85 - psr) / 0.15 * 15 : psr <= 1.0 ? 50 + (1.0 - psr) / 0.15 * 35 : Math.max(0, 50 - (psr - 1.0) / 0.2 * 50), 100);
  const total = devSc * 0.30 + jrSc * 0.20 + pirSc * 0.15 + psrSc * 0.25 + relSc * 0.07 + landSc * 0.03;
  // 방안 B: 시도 평균 폴백 사용 시 detail 접미 경고(세션114)
  const sidoNotice = fairPriceFromSidoAvg ? " — 광역 시도 평균 기준(실시세 왜곡 가능)" : "";
  const relNotice = fairPriceFromSidoAvg ? ` -폴백차감${PRICE_FALLBACK_RELIABILITY_PENALTY}` : "";
  return {
    total: Math.round(Math.max(0, Math.min(total, 100))), fairPrice: Math.round(fairPrice), deviation: dev.toFixed(1),
    subs: [
      { name: "적정가 괴리도", score: Math.round(devSc), info: `${dev > 0 ? "+" : ""}${dev.toFixed(1)}%`, detail: `${dev > 0 ? "+" : ""}${dev.toFixed(1)}% (±5% 적정, ±10~20% 주의, 20%↑ 과대)${sidoNotice}` },
      { name: "전세가율", score: Math.round(jrSc), info: jr == null ? "데이터 부재" : `${jr}%`, detail: jr == null ? "전세가율 데이터 없음 (중립 50점)" : `${jr}% (적정 70~80%, 위험 40%↓, 과열 90%↑)` },
      { name: "PIR", score: Math.round(pirSc), info: pir == null ? "데이터 부재" : `${pir}배`, detail: pir == null ? "PIR 데이터 없음 (중립 50점)" : `${pir}배 (우수 10↓, 양호 20↓, 보통 30↓, 부담 30↑)` },
      { name: "PSR", score: Math.round(psrSc), info: psr == null ? "데이터 부재" : `${(psr * 100).toFixed(0)}%`, detail: psr == null ? "PSR 데이터 없음 (중립 50점)" : `${(psr * 100).toFixed(0)}% (저평가 85%↓, 적정 100%↓, 고평가 100%↑)` },
      { name: "데이터 신뢰도", score: relSc, info: `${apt.dataReliability}%${idxBonus ? `(+${idxBonus})` : ""}${relNotice}`, detail: `${apt.dataReliability}%${idxBonus ? ` +지수보정${idxBonus}` : ""}${relNotice} (80%↑신뢰, 50%↑보통, 30%↓추정)` },
      { name: "택지비비율", score: landSc, info: apt.landCostRatio != null ? `${apt.landCostRatio}%` : "정보 없음", detail: apt.landCostRatio != null ? `${apt.landCostRatio}% (60%↑안정, 40%↑양호, 20%↓위험)` : "택지비 데이터 없음 (중립 50점)" },
    ],
  };
}
