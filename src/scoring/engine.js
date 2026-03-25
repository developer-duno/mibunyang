import { BRAND_TIER, AGE_PREMIUM, LAYOUT_SCORE, NOXIOUS_PENALTY } from "@/constants/brands";
const IS_DEV = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;
import { CITY_TIER, REGIONS } from "@/constants/regions";
import { PROFILES } from "@/constants/profiles";
import { getZone } from "@/constants/regulations";
import {
  tierMax, tierMin,
  SUBWAY_DIST_TIERS, FULL_BUS_ROUTES, IC_DIST_TIERS, KTX_DIST_TIERS,
  INFRA_CONFIG, VIEW_SCORES, SUNLIGHT_SCORES, SUNLIGHT_DEFAULT, SUNLIGHT_NO_DATA,
  NOISE_TIERS, NOXIOUS_DIST_THRESHOLD, NOXIOUS_REDUCTION, NOXIOUS_PEN_CAP,
  UNIT_TIERS, UNIT_UNKNOWN_SCORE, UNIT_SMALL_SCORE,
  PARKING_TIERS, PARKING_LOW_SCORE, FAR_TIERS, FAR_HIGH_SCORE,
  ENERGY_SCORES, ENERGY_DEFAULT, GREEN_BLDG_SCORES,
  EXCL_RATIO_TIERS, EXCL_LOW_SCORE, FLOOR_TIERS, FLOOR_LOW_SCORE, PRODUCT_MAX,
  UNSOLD_RATE_TIERS, UNSOLD_HIGH_SCORE, UNSOLD_UNKNOWN_SCORE,
  LIQUIDITY_TIERS, LIQUIDITY_LOW_SCORE,
  CREDIT_GRADE_SCORES, CREDIT_DEFAULT,
  SUPPLY_RATIO_TIERS, SUPPLY_HIGH_SCORE,
  CANCEL_RATIO_TIERS, CANCEL_RATIO_HIGH_SCORE, CANCEL_RATIO_NULL_SCORE,
  POP_RISK_TIERS, POP_RISK_HIGH, POP_RISK_NULL,
  POP_FUTURE_TIERS, POP_FUTURE_LOW, POP_FUTURE_NULL,
  INTEREST_RATE, LOAN_TERM_MULT, BENEFIT_FULL_RATE,
  AREA_ADJ_TIERS, AREA_ADJ_LARGE,
  FUTURE_WEIGHT_MAP,
  PRICE_NO_DATA_DEFAULTS, DEV_SCORE_TIERS, DEV_SCORE_NEGATIVE_MULT, DEV_SCORE_BASE,
  DIRECTION_BONUS, SUNLIGHT_DIRECTION_MAX, WON_TO_MANWON,
} from "@/constants/scoringTiers";

// --- scoreFuture 키워드 배열 (Clean-3) ---
const TRANSIT_ACTIVE = ["기존", "운행중", "개통"];
const TRANSIT_PLANNED = ["계획", "착공", "공사중", "추진", "확정", "예정", "인가"];
const TRANSIT_HIGH = ["GTX", "KTX역", "SRT", "지하철연장", "신설역", "광역급행", "BRT", "트램", "경전철", "도시철도"];
const CITY_HIGH = ["테크노", "주거타운", "신도시", "신도심", "복합도시", "재건축", "혁신",
                   "스마트시티", "자족도시", "행정중심", "경제자유구역", "국가산단"];
const CITY_MID = ["재생", "리모델링", "관광", "산업단지", "공항", "특구", "메디컬",
                  "역세권개발", "도시정비", "택지개발", "물류단지", "연구단지"];
const matchAny = (str, keywords) => keywords.some(k => str.includes(k));

// --- null 안전 레이어 (Bug-2 + API-2) ---
function sanitize(apt, rm) {
  const str = (v, fallback = "") => (v ?? fallback).toString().trim().normalize("NFC");
  const num = (v, fallback) => { const n = Number(v); return (v == null || Number.isNaN(n)) ? fallback : n; };
  return {
    ...apt,
    // 위험 필드 → 지역 중위값 우선, 없으면 비관적 기본값
    pir: num(apt.pir, rm?.pir ?? 10), psr: num(apt.psr, rm?.psr ?? 1.5),
    unsoldRate: num(apt.unsoldRate, rm?.unsoldRate ?? 50), recentTrades6m: num(apt.recentTrades6m, 0), cancelRatio6m: num(apt.cancelRatio6m, null),
    competitionRate: num(apt.competitionRate, null),
    builderDebtRatio: num(apt.builderDebtRatio, 250), supplyRatio: num(apt.supplyRatio, rm?.supplyRatio ?? 150),
    popGrowth: apt.popGrowth != null ? num(apt.popGrowth, null) : null,
    netMigration: apt.netMigration != null ? num(apt.netMigration, null) : null,
    dataReliability: num(apt.dataReliability, 30),
    // 가격/시장 필드
    jeonseRate: num(apt.jeonseRate, 40), nearbyMedian: num(apt.nearbyMedian, 0),
    price: num(apt.price, 0), area: num(apt.area, 84),
    // 교통 필드
    subwayDist: num(apt.subwayDist, 9999), busRoutes: num(apt.busRoutes, 0),
    icDist: num(apt.icDist, 99), ktxDist: num(apt.ktxDist, 99),
    // 인프라 필드
    noise: num(apt.noise, 75),
    hospital: num(apt.hospital, 0), mart: num(apt.mart, 0), conv: num(apt.conv, 0),
    park: num(apt.park, 0), cafe: num(apt.cafe, 0), culture: num(apt.culture, 0),
    bank: num(apt.bank, 0), pharmacy: num(apt.pharmacy, 0),
    // 혜택 필드 → 0
    discountPct: num(apt.discountPct, 0), loanFreePct: num(apt.loanFreePct, 0),
    optionValue: num(apt.optionValue, 0), balconyValue: num(apt.balconyValue, 0),
    cashback: num(apt.cashback, 0),
    // 상품성 필드
    units: num(apt.units, 0), parkingRatio: num(apt.parkingRatio, 0.5),
    floorAreaRatio: num(apt.floorAreaRatio, 300), exclusiveRatio: num(apt.exclusiveRatio, 60),
    maxFloor: num(apt.maxFloor, 10),
    devDist: num(apt.devDist, 99),
    // 한글 문자열 NFC 정규화 (API-2)
    region: str(apt.region), gu: str(apt.gu),
    builder: str(apt.builder, "기타"),
    transitDev: str(apt.transitDev), cityDev: str(apt.cityDev), industryDev: str(apt.industryDev),
    view: str(apt.view), sunlight: str(apt.sunlight),
    schoolGrade: str(apt.schoolGrade),
    // 관리비/방향 (Phase 4 수집 데이터)
    avgMaintenanceCost: num(apt.avgMaintenanceCost, 0),
    primaryDirection: str(apt.primaryDirection, ""),
    _regionAvgMaint: num(rm?.maint, 0),
    // 원본 null 여부 플래그 (표시용)
    _noView: apt.view == null || apt.view === "",
    _noNoise: apt.noise == null,
    _noBus: apt.busRoutes == null,
    _noParking: apt.parkingRatio == null,
    _noFar: apt.floorAreaRatio == null,
    _noExcl: apt.exclusiveRatio == null,
    _noFloor: apt.maxFloor == null,
    _noSunlight: apt.sunlight == null || apt.sunlight === "",
  };
}

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
  const fairPrice = apt.nearbyMedian * ageCoeff * areaAdj * b.adj;
  if (fairPrice <= 0) {
    const devSc = PRICE_NO_DATA_DEFAULTS.dev;
    const jrSc = PRICE_NO_DATA_DEFAULTS.jr; const pirSc = PRICE_NO_DATA_DEFAULTS.pir; const psrSc = PRICE_NO_DATA_DEFAULTS.psr;
    const total = devSc * 0.30 + jrSc * 0.20 + pirSc * 0.15 + psrSc * 0.25 + Math.min(apt.dataReliability, 100) * 0.10;
    return {
      total: Math.round(Math.min(total, 100)), fairPrice: 0, deviation: "0.0",
      subs: [
        { name: "적정가 괴리도", score: devSc, info: "데이터 부재", detail: "주변 시세 없음 — 적정가 산출 불가" },
        { name: "전세가율", score: Math.round(jrSc), info: `${apt.jeonseRate}%`, detail: `${apt.jeonseRate}% (적정 70~80%, 위험 40%↓)` },
        { name: "PIR", score: Math.round(pirSc), info: `${apt.pir}배`, detail: `${apt.pir}배 (우수 3↓, 양호 5↓, 보통 7↓)` },
        { name: "PSR", score: Math.round(psrSc), info: `${(apt.psr * 100).toFixed(0)}%`, detail: `${(apt.psr * 100).toFixed(0)}% (저평가 85%↓, 적정 100%↓)` },
        { name: "데이터 신뢰도", score: Math.min(apt.dataReliability, 100), info: `${apt.dataReliability}%`, detail: `${apt.dataReliability}% (80%↑신뢰, 30%↓추정)` },
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
  const total = devSc * 0.30 + jrSc * 0.20 + pirSc * 0.15 + psrSc * 0.25 + Math.min(apt.dataReliability, 100) * 0.10;
  return {
    total: Math.round(Math.min(total, 100)), fairPrice: Math.round(fairPrice), deviation: dev.toFixed(1),
    subs: [
      { name: "적정가 괴리도", score: Math.round(devSc), info: `${dev > 0 ? "+" : ""}${dev.toFixed(1)}%`, detail: `${dev > 0 ? "+" : ""}${dev.toFixed(1)}% (±5% 적정, ±10~20% 주의, 20%↑ 과대)` },
      { name: "전세가율", score: Math.round(jrSc), info: `${jr}%`, detail: `${jr}% (적정 70~80%, 위험 40%↓, 과열 90%↑)` },
      { name: "PIR", score: Math.round(pirSc), info: `${apt.pir}배`, detail: `${apt.pir}배 (우수 3↓, 양호 5↓, 보통 7↓, 부담 7↑)` },
      { name: "PSR", score: Math.round(psrSc), info: `${(apt.psr * 100).toFixed(0)}%`, detail: `${(apt.psr * 100).toFixed(0)}% (저평가 85%↓, 적정 100%↓, 고평가 100%↑)` },
      { name: "데이터 신뢰도", score: Math.min(apt.dataReliability, 100), info: `${apt.dataReliability}%`, detail: `${apt.dataReliability}% (80%↑신뢰, 50%↑보통, 30%↓추정)` },
    ],
  };
}

export function scoreLocation(apt) {
  const tier = REGIONS[apt.region]?.tier;
  if (!tier && IS_DEV) console.warn(`[scoring] Unknown region: "${apt.region}"`);
  const ct = CITY_TIER[tier] || CITY_TIER.C;

  let rawSub = tierMax(apt.subwayDist, SUBWAY_DIST_TIERS, 0);
  let rawBus = Math.min(apt.busRoutes / FULL_BUS_ROUTES, 1) * 30;
  let rawIc = tierMax(apt.icDist, IC_DIST_TIERS, 0);
  let rawKtx = tierMax(apt.ktxDist, KTX_DIST_TIERS, 0);

  const subSc = rawSub * ct.subwayW;
  const busSc = rawBus * ct.busW;
  const icSc = rawIc * ct.icW;
  const ktxSc = rawKtx * ct.ktxW;
  const maxTransport = 25 * ct.subwayW + 30 * ct.busW + 20 * ct.icW + 20 * ct.ktxW + 5;
  const transport = Math.min((subSc + busSc + icSc + ktxSc + 5) / maxTransport * 100, 100);

  const school = apt.schoolScore ?? 50;

  const infraItems = INFRA_CONFIG.map(cfg => ({ v: apt[cfg.key], m: cfg.max, w: cfg.weight }));
  const infra = infraItems.reduce((s, i) => s + Math.min(i.v / i.m, 1) * i.w * 100, 0);

  let viewSc = VIEW_SCORES[apt.view] || 0;
  let sunSc = apt._noSunlight ? SUNLIGHT_NO_DATA : (SUNLIGHT_SCORES[apt.sunlight] ?? SUNLIGHT_DEFAULT);
  // 방향 보정: 일조 점수에 방향 보너스 가산 (남향 최대 +8)
  const dirBonus = apt.primaryDirection ? (DIRECTION_BONUS[apt.primaryDirection] ?? 0) : 0;
  sunSc = Math.min(sunSc + dirBonus, SUNLIGHT_DIRECTION_MAX);
  let noiseSc = tierMax(apt.noise, NOISE_TIERS, 0);
  const env = viewSc + sunSc + noiseSc;
  let noxPen = (apt.noxious || []).reduce((s, n) => s + (NOXIOUS_PENALTY[n] || 0), 0);
  // 거리 기반 감점 완화: noxiousDist >= 500m이면 감점 반감
  if (apt.noxiousDist != null && apt.noxiousDist >= NOXIOUS_DIST_THRESHOLD) noxPen = noxPen * NOXIOUS_REDUCTION;
  noxPen = Math.max(noxPen, NOXIOUS_PEN_CAP);
  const noxSafe = Math.max(0, 100 + noxPen / 15 * 100);
  const total = transport * 0.30 + school * 0.25 + infra * 0.20 + env * 0.10 + noxSafe * 0.15;
  return {
    total: Math.round(Math.min(Math.max(total, 0), 100)),
    subs: [
      { name: "교통", score: Math.round(transport), info: [
        apt.subwayDist > 9000 ? "지하철 없음" : `지하철 ${apt.subwayDist}m${apt.subwayLines ? `(${apt.subwayLines})` : ""}`,
        apt._noBus ? null : `버스 ${apt.busRoutes}개`,
        apt.icDist < 90 ? `IC ${apt.icDist}km` : null,
        apt.ktxDist < 90 ? `KTX ${apt.ktxDist}km` : null,
      ].filter(Boolean).join(" · "), detail: [
        apt.subwayDist > 9000 ? "지하철 없음" : `지하철 ${apt.subwayDist}m${apt.subwayLines ? `(${apt.subwayLines})` : ""} ${apt.subwayDist <= 300 ? "역세권" : apt.subwayDist <= 500 ? "도보권" : apt.subwayDist <= 700 ? "양호" : apt.subwayDist <= 1000 ? "보통" : "원거리"}`,
        apt._noBus ? "버스 미수집" : `버스 ${apt.busRoutes}개/15`,
        apt.icDist < 90 ? `IC ${apt.icDist}km ${apt.icDist <= 2 ? "우수" : apt.icDist <= 5 ? "양호" : "보통"}` : "IC 원거리",
        apt.ktxDist < 90 ? `KTX ${apt.ktxDist}km ${apt.ktxDist <= 5 ? "우수" : apt.ktxDist <= 10 ? "양호" : "보통"}` : null,
      ].filter(Boolean).join(" · ") },
      { name: "학군", score: Math.round(school), info: apt.schoolGrade, detail: `${apt.schoolGrade || "미수집"} (A=100, B=80, C=60, D=40점)` },
      { name: "생활인프라", score: Math.round(infra), info: `병원${apt.hospital} 마트${apt.mart} 편의점${apt.conv} 공원${apt.park} 약국${apt.pharmacy}`, detail: `병원${apt.hospital}/5(1km) 마트${apt.mart}/3(1km) 편의점${apt.conv}/10(500m) 공원${apt.park}/4(1km) 약국${apt.pharmacy}/4(500m)` },
      { name: "자연환경", score: Math.round(env), info: apt._noView && apt._noNoise && apt._noSunlight ? "정보 없음" : `${apt.view || "미확인"}조망${apt._noSunlight ? "" : ` 일조:${apt.sunlight}`}${apt._noNoise ? "" : ` ${apt.noise}dB`}`, detail: `조망:${apt.view || "미확인"}(블루40 그린30 천공20점) 일조:${apt.sunlight || "미확인"}(우수30 양호22점) 소음:${apt._noNoise ? "미수집" : `${apt.noise}dB`}(50↓우수 60↓양호)` },
      { name: "혐오시설", score: Math.round(noxSafe), info: (apt.noxious || []).length ? (apt.noxious || []).join(",") : "없음", detail: (apt.noxious || []).length ? `${(apt.noxious || []).join(",")} (500m↑ 감점 반감, 하한 -15점)` : "없음 (감점 0)" },
    ],
  };
}

export function scoreProduct(apt) {
  const brand = BRAND_TIER[apt.builder];
  if (!brand && IS_DEV) console.warn(`[scoring] Unknown builder: "${apt.builder}"`);
  const b = brand || { score: 5, tier: "기타" };
  const brandSc = b.score;
  let unitSc = apt.units <= 1 ? UNIT_UNKNOWN_SCORE : tierMin(apt.units, UNIT_TIERS, UNIT_SMALL_SCORE);
  if (apt.hasPool) unitSc = Math.min(unitSc + 3, 15);
  let parkSc = tierMin(apt.parkingRatio, PARKING_TIERS, PARKING_LOW_SCORE);
  let farSc = tierMax(apt.floorAreaRatio, FAR_TIERS, FAR_HIGH_SCORE);
  let energySc = (ENERGY_SCORES[apt.energyGrade] ?? ENERGY_DEFAULT) + (GREEN_BLDG_SCORES[apt.greenBldg] || 0);
  let exclSc = tierMin(apt.exclusiveRatio, EXCL_RATIO_TIERS, EXCL_LOW_SCORE);
  const layoutSc = LAYOUT_SCORE[apt.layout] || 3;
  const quakeSc = apt.quakeDesign ? 5 : 0;
  let structSc = tierMin(apt.maxFloor, FLOOR_TIERS, FLOOR_LOW_SCORE);
  const rawTotal = brandSc + unitSc + parkSc + farSc + energySc + exclSc + layoutSc + quakeSc + structSc;
  const maxPossible = Object.values(PRODUCT_MAX).reduce((a, b) => a + b, 0);
  const total = Math.round(Math.min(rawTotal / maxPossible * 100, 100));
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

export function scoreBenefit(apt) {
  const loanVal = apt.loanFree ? Math.round(apt.price * (apt.loanFreePct / 100) * INTEREST_RATE * LOAN_TERM_MULT) : 0;
  const discVal = Math.round(apt.price * apt.discountPct / 100);
  const optVal = apt.optionFree ? apt.optionValue : 0;
  const balVal = apt.balconyFree ? apt.balconyValue : 0;
  const cashVal = apt.cashback;
  // 관리비 절감액: 지역 평균보다 낮으면 연간 절감액을 혜택에 합산 (만원 단위)
  const maintSave = apt._regionAvgMaint > 0 && apt.avgMaintenanceCost > 0
    ? Math.max(0, Math.round((apt._regionAvgMaint - apt.avgMaintenanceCost) * apt.area * 12 / WON_TO_MANWON))
    : 0;
  const totalWon = discVal + loanVal + optVal + balVal + cashVal + maintSave;
  const rate = apt.price > 0 ? (totalWon / apt.price) * 100 : 0;
  const sc = Math.min(Math.round(rate / BENEFIT_FULL_RATE * 100), 100);
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

export function scoreRisk(apt) {
  let unsoldSc = apt.units <= 1 ? UNSOLD_UNKNOWN_SCORE : tierMax(apt.unsoldRate, UNSOLD_RATE_TIERS, UNSOLD_HIGH_SCORE);
  let liqSc = tierMin(apt.recentTrades6m, LIQUIDITY_TIERS, LIQUIDITY_LOW_SCORE);
  let loanSc = (apt.dsr40pass ? 15 : 50) + (apt.loanFree ? 0 : 15);
  let finSc = (apt.hugGuarantee ? 0 : 40) + (CREDIT_GRADE_SCORES[apt.builderCreditGrade] ?? CREDIT_DEFAULT) + (apt.builderDebtRatio > 200 ? 20 : apt.builderDebtRatio > 150 ? 10 : 0);
  finSc = Math.min(finSc, 100);
  const zone = getZone(apt.region, apt.gu);
  let regSc = zone !== "normal" ? 60 : 10;
  let supSc = tierMax(apt.supplyRatio, SUPPLY_RATIO_TIERS, SUPPLY_HIGH_SCORE);
  let mktSc = apt.popGrowth == null ? 35
    : apt.popGrowth >= 0.5 ? 10
    : apt.popGrowth >= 0 ? 20
    : apt.popGrowth >= -0.3 ? 30
    : apt.popGrowth >= -0.8 ? 45
    : 60;
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
  const risk = unsoldSc * 0.15 + liqSc * 0.15 + loanSc * 0.15 + finSc * 0.18 + regSc * 0.05 + supSc * 0.10 + mktSc * 0.07 + cancelSc * 0.05 + compSc * 0.10;
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
    ],
  };
}

export function scoreFuture(apt) {
  // 교통개발 (기본 40%)
  let trSc = (!apt.transitDev || apt.transitDev === "없음") ? 0
    : matchAny(apt.transitDev, TRANSIT_ACTIVE) ? (apt.devDist <= 1 ? 100 : apt.devDist <= 2 ? 70 : 40)
    : matchAny(apt.transitDev, TRANSIT_PLANNED) ? (apt.devDist <= 1 ? 60 : apt.devDist <= 3 ? 40 : 20) : 10;
  if (trSc > 0 && matchAny(apt.transitDev, TRANSIT_HIGH)) trSc = Math.min(Math.round(trSc * 1.2), 100);

  // 도시개발 (기본 30%)
  let citySc = (!apt.cityDev || apt.cityDev === "") ? 0
    : matchAny(apt.cityDev, CITY_HIGH) ? 80
    : matchAny(apt.cityDev, CITY_MID) ? 50 : 30;

  // 인구 (기본 30%) — 한국 현실 기반 7단계
  let popSc = apt.popGrowth == null ? 35
    : apt.popGrowth >= 1.0 ? 95
    : apt.popGrowth >= 0.5 ? 80
    : apt.popGrowth >= 0 ? 65
    : apt.popGrowth >= -0.3 ? 50
    : apt.popGrowth >= -0.8 ? 35
    : apt.popGrowth >= -2.0 ? 20
    : 10;
  if (apt.netMigration != null && apt.netMigration > 0) popSc = Math.min(popSc + 10, 100);
  if (apt.netMigration != null && apt.netMigration <= -5000) popSc = Math.max(popSc - 5, 0);

  // 산업개발 (4번째 축)
  const indDev = apt.industryDev;
  const hasInd = indDev && (Array.isArray(indDev) ? indDev.length > 0 : String(indDev).trim().length > 0);
  let indSc = 0;
  if (hasInd) {
    const indStr = Array.isArray(indDev) ? indDev.join(" ") : String(indDev);
    indSc = matchAny(indStr, CITY_HIGH) ? 80 : matchAny(indStr, CITY_MID) ? 55 : 35;
  }

  // 동적 가중치: 데이터 부재 시 인구에 가중치 집중 (합계 항상 1.00)
  const hasTr = trSc > 0;
  const hasCity = citySc > 0;
  const fw = FUTURE_WEIGHT_MAP[`${+hasTr},${+hasCity},${+hasInd}`];

  const total = trSc * fw.tr + citySc * fw.city + popSc * fw.pop + indSc * fw.ind;
  const pg = apt.popGrowth;
  return {
    total: Math.round(Math.min(total, 100)),
    subs: [
      { name: "교통개발", score: Math.round(trSc), info: apt.transitDev || "없음", detail: apt.transitDev ? `${apt.transitDev} (GTX/KTX역 ×1.2배, 1km내 100점, 2km 70점)` : "교통개발 없음 (0점)" },
      { name: "도시개발", score: Math.round(citySc), info: apt.cityDev || "없음", detail: apt.cityDev ? `${apt.cityDev} (신도시/테크노 80점, 재생/특구 50점, 기타 30점)` : "도시개발 없음 (0점)" },
      { name: "인구", score: Math.round(popSc), info: pg != null ? `${pg > 0 ? "+" : ""}${pg}%` : "정보 없음", detail: pg != null ? `${pg > 0 ? "+" : ""}${pg}% (성장 +1%↑=95점, 안정 0%↑=65점, 감소 -2%↓=10점)` : "데이터 없음 (기본 35점)" },
      { name: "산업개발", score: Math.round(indSc), info: hasInd ? (Array.isArray(indDev) ? indDev.join(", ") : String(indDev)) : "없음", detail: hasInd ? `${Array.isArray(indDev) ? indDev.join(", ") : String(indDev)} (국가산단 80점, 산업단지 55점, 기타 35점)` : "산업개발 없음 (0점)" },
    ],
  };
}

// --- 지역 중위값 계산 (Phase 3-1) ---
export function computeRegionalMedians(apartments) {
  const groups = {};
  for (const apt of apartments) {
    const r = apt.region || "기타";
    if (!groups[r]) groups[r] = { pir: [], psr: [], unsoldRate: [], supplyRatio: [], maint: [] };
    if (apt.pir != null && Number.isFinite(Number(apt.pir))) groups[r].pir.push(Number(apt.pir));
    if (apt.psr != null && Number.isFinite(Number(apt.psr))) groups[r].psr.push(Number(apt.psr));
    if (apt.unsoldRate != null && Number.isFinite(Number(apt.unsoldRate))) groups[r].unsoldRate.push(Number(apt.unsoldRate));
    if (apt.supplyRatio != null && Number.isFinite(Number(apt.supplyRatio))) groups[r].supplyRatio.push(Number(apt.supplyRatio));
    if (apt.avgMaintenanceCost != null && apt.avgMaintenanceCost > 0) groups[r].maint.push(Number(apt.avgMaintenanceCost));
  }
  const median = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const result = {};
  for (const [r, g] of Object.entries(groups)) {
    result[r] = { pir: median(g.pir), psr: median(g.psr), unsoldRate: median(g.unsoldRate), supplyRatio: median(g.supplyRatio), maint: median(g.maint) };
  }
  return result;
}

export function calcCats(apt, ctx) {
  const rm = ctx?.regionMedians?.[apt.region];
  const a = sanitize(apt, rm);
  const safe = (fn) => { try { return fn(); } catch (e) { console.error("[scoring] safe() caught:", e?.message ?? e); return { total: 0, subs: [], totalWon: 0, rate: 0, deviation: 0, fairPrice: 0, riskRaw: 0 }; } };
  return {
    price: { ...safe(() => scorePrice(a)), label: "가격 매력도", key: "price" },
    location: { ...safe(() => scoreLocation(a)), label: "입지·생활권", key: "location" },
    product: { ...safe(() => scoreProduct(a)), label: "상품성", key: "product" },
    benefit: { ...safe(() => scoreBenefit(a)), label: "혜택·할인", key: "benefit" },
    risk: { ...safe(() => scoreRisk(a)), label: "안전도", key: "risk" },
    future: { ...safe(() => scoreFuture(a)), label: "미래가치", key: "future" },
  };
}

export function calcAll(apt, profile, ctx) {
  const w = PROFILES[profile]?.w || PROFILES.live.w;
  const cats = calcCats(apt, ctx);
  const total = Object.keys(cats).reduce((s, k) => {
    const ct = cats[k].total;
    return s + (Number.isFinite(ct) ? ct * w[k] / 100 : 0);
  }, 0);
  return { total: Math.round(Math.min(total, 100)), cats, weights: w };
}
