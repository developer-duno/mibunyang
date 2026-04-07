import { NOXIOUS_PENALTY } from "@/constants/brands";
import { CITY_TIER, REGIONS } from "@/constants/regions";
import {
  tierMax,
  SUBWAY_DIST_TIERS, FULL_BUS_ROUTES, IC_DIST_TIERS, KTX_DIST_TIERS,
  INFRA_CONFIG, VIEW_SCORES, SUNLIGHT_SCORES, SUNLIGHT_DEFAULT, SUNLIGHT_NO_DATA,
  NOISE_TIERS, NOXIOUS_DIST_THRESHOLD, NOXIOUS_REDUCTION, NOXIOUS_PEN_CAP,
  DIRECTION_BONUS, SUNLIGHT_DIRECTION_MAX,
  AIR_QUALITY_TIERS, AIR_QUALITY_DEFAULT,
  AIR_PM10_TIERS, AIR_PM10_DEFAULT, AIR_O3_TIERS, AIR_O3_DEFAULT, AIR_O3_BAD_SCORE,
  SCHOOL_WALK_BONUS, SCHOOL_WALK_FAR_ADJ,
} from "@/constants/scoringTiers";

const IS_DEV = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;

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
  const transport = Math.max(0, Math.min((subSc + busSc + icSc + ktxSc + 5) / maxTransport * 100, 100));

  // 학교 도보시간 보정: naverSchoolWalkMin 기반 ±10
  const walkMin = apt.naverSchoolWalkMin;
  const walkAdj = walkMin == null ? 0
    : tierMax(walkMin, SCHOOL_WALK_BONUS, SCHOOL_WALK_FAR_ADJ);
  const school = Math.max(0, Math.min(100, (apt.schoolScore ?? 50) + walkAdj));

  const infraItems = INFRA_CONFIG.map(cfg => ({ v: apt[cfg.key] ?? 0, m: cfg.max, w: cfg.weight }));
  const infra = infraItems.reduce((s, i) => s + Math.min(i.v / i.m, 1) * i.w * 100, 0);

  let viewSc = VIEW_SCORES[apt.view] || 0;
  let sunSc = apt._noSunlight ? SUNLIGHT_NO_DATA : (SUNLIGHT_SCORES[apt.sunlight] ?? SUNLIGHT_DEFAULT);
  // 방향 보정: 일조 점수에 방향 보너스 가산 (남향 최대 +8)
  const dirBonus = apt.primaryDirection ? (DIRECTION_BONUS[apt.primaryDirection] ?? 0) : 0;
  sunSc = Math.min(sunSc + dirBonus, SUNLIGHT_DIRECTION_MAX);
  let noiseSc = tierMax(apt.noise, NOISE_TIERS, 0);
  // 대기질 복합: PM2.5(40%) + PM10(35%) + O3(25%) — pm10/o3 null이면 기존과 동일
  const pm25Sc = apt.airQuality?.pm25 != null ? tierMax(apt.airQuality.pm25, AIR_QUALITY_TIERS, 0) : AIR_QUALITY_DEFAULT;
  const pm10Sc = apt.airQuality?.pm10 != null ? tierMax(apt.airQuality.pm10, AIR_PM10_TIERS, 0) : null;
  const o3Sc = apt.airQuality?.o3 != null ? tierMax(apt.airQuality.o3, AIR_O3_TIERS, AIR_O3_BAD_SCORE) : null;
  const airSc = (pm10Sc == null && o3Sc == null)
    ? pm25Sc
    : pm25Sc * 0.40 + (pm10Sc ?? AIR_PM10_DEFAULT) * 0.35 + (o3Sc ?? AIR_O3_DEFAULT) * 0.25;
  const env = viewSc + sunSc + noiseSc + airSc;
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
      { name: "학군", score: Math.round(school), info: apt.schoolGrade ? `${apt.schoolGrade}${walkMin != null ? ` 도보${walkMin}분` : ""}` : apt.schoolGrade, detail: `${apt.schoolGrade || "미수집"} (A=100, B=80, C=60, D=40점)${walkMin != null ? ` · 도보 ${walkMin}분 (5분↓+10, 10분↓+5, 20분↑-10)` : ""}` },
      { name: "생활인프라", score: Math.round(infra), info: `병원${apt.hospital} 마트${apt.mart} 편의점${apt.conv} 공원${apt.park} 약국${apt.pharmacy} 보육${apt.childcare ?? 0}`, detail: `병원${apt.hospital}/5(1km) 마트${apt.mart}/3(1km) 편의점${apt.conv}/10(500m) 공원${apt.park}/4(1km) 약국${apt.pharmacy}/4(500m) 어린이집${apt.childcare ?? 0}/5(1km) 응급의료${apt.emergency ?? 0}/3(10km)` },
      { name: "자연환경", score: Math.round(env), info: apt._noView && apt._noNoise && apt._noSunlight ? "정보 없음" : `${apt.view || "미확인"}조망${apt._noSunlight ? "" : ` 일조:${apt.sunlight}`}${apt._noNoise ? "" : ` ${apt.noise}dB`}${apt.airQuality?.grade ? ` 대기:${apt.airQuality.grade}` : ""}`, detail: `조망:${apt.view || "미확인"}(블루40 그린30 천공20점) 일조:${apt.sunlight || "미확인"}(우수30 양호22점) 소음:${apt._noNoise ? "미수집" : `${apt.noise}dB`}(50↓우수 60↓양호) 대기질:${apt.airQuality?.grade || "미수집"}(PM2.5${pm10Sc != null ? `/PM10` : ""}${o3Sc != null ? `/O3` : ""})` },
      { name: "혐오시설", score: Math.round(noxSafe), info: (apt.noxious || []).length ? (apt.noxious || []).join(",") : "없음", detail: (apt.noxious || []).length ? `${(apt.noxious || []).join(",")} (500m↑ 감점 반감, 하한 -15점)` : "없음 (감점 0)" },
    ],
  };
}
