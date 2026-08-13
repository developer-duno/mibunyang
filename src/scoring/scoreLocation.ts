import { NOXIOUS_PENALTY } from "@/constants/brands";
import { CITY_TIER, REGIONS } from "@/constants/regions";
import {
  tierMax,
  tierMaxLabel,
  SUBWAY_DIST_TIERS,
  FULL_BUS_ROUTES,
  IC_DIST_TIERS,
  IC_DIST_FALLBACK_LABEL,
  KTX_DIST_TIERS,
  KTX_DIST_FALLBACK_LABEL,
  INFRA_CONFIG,
  VIEW_SCORES,
  SUNLIGHT_SCORES,
  SUNLIGHT_DEFAULT,
  SUNLIGHT_NO_DATA,
  NOISE_TIERS,
  NOISE_UNKNOWN_SCORE,
  NOXIOUS_DIST_THRESHOLD,
  NOXIOUS_REDUCTION,
  NOXIOUS_PEN_CAP,
  DIRECTION_BONUS,
  SUNLIGHT_DIRECTION_MAX,
  AIR_QUALITY_TIERS,
  AIR_QUALITY_DEFAULT,
  ENV_MAX,
  infraSaturation,
  AIR_PM10_TIERS,
  AIR_PM10_DEFAULT,
  AIR_O3_TIERS,
  AIR_O3_DEFAULT,
  AIR_O3_BAD_SCORE,
  SCHOOL_WALK_BONUS,
  SCHOOL_WALK_FAR_ADJ,
} from "@/constants/scoringTiers";
import type { Apt, Res } from "@/types/scoring";

const IS_DEV =
  typeof import.meta !== "undefined" && !!(import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV;

/**
 * 입지·생활권 점수 (0~100). 5개 서브 가중치 합계 = 1.00 (불변식).
 *
 * 가중치(이 함수 내부 — src/scoring/CLAUDE.md L40):
 *   transport 0.30 · school 0.25 · infra 0.20 · env 0.10 · noxSafe 0.15
 *
 * 핵심 보정:
 *   - airSc 복합: PM2.5(0.40) + PM10(0.35) + O3(0.25). pm10/o3 둘 다 null이면 PM2.5 단독.
 *   - school 도보보정: naverSchoolWalkMin 기반 ≤5분 +10, ≤10분 +5, ≤20분 -5, >20분 -10.
 *   - 혐오시설 거리 완화: noxiousDist ≥ NOXIOUS_DIST_THRESHOLD(500m) 시 감점 × NOXIOUS_REDUCTION,
 *     하한 NOXIOUS_PEN_CAP.
 *   - 일조 방향 보너스: primaryDirection별 DIRECTION_BONUS 가산, 상한 SUNLIGHT_DIRECTION_MAX.
 *   - infra 서브가중치 10항목 합계 1.00 (INFRA_CONFIG, CLAUDE.md L41).
 *
 * null 처리: `apt.schoolScore ?? 50` 등 `??` 사용. `||` 금지(0이 50으로 대체되는 함정).
 * 클램핑: `Math.max(0, Math.min(total, 100))` 강제.
 *
 * @example
 * // 5개 서브 가중치 합 검증
 * 0.30 + 0.25 + 0.20 + 0.10 + 0.15 === 1.00  // true
 */
export function scoreLocation(apt: Apt): Res {
  const region = apt.region as string;
  const tier = (REGIONS as Record<string, { tier: string }>)[region]?.tier;
  if (!tier && IS_DEV) console.warn(`[scoring] Unknown region: "${region}"`);
  type CtType = { subwayW: number; busW: number; icW: number; ktxW: number };
  const ct = ((CITY_TIER as Record<string, CtType>)[tier] || (CITY_TIER as Record<string, CtType>).C) as CtType;

  const subwayDist = (apt.subwayDist ?? 9999) as number;
  const busRoutes = (apt.busRoutes ?? 0) as number;
  const icDist = (apt.icDist ?? 99) as number;
  const ktxDist = (apt.ktxDist ?? 99) as number;

  const rawSub: number = tierMax(subwayDist, SUBWAY_DIST_TIERS, 0);
  const rawBus = Math.min(busRoutes / FULL_BUS_ROUTES, 1) * 30;
  const rawIc: number = tierMax(icDist, IC_DIST_TIERS, 0);
  const rawKtx: number = tierMax(ktxDist, KTX_DIST_TIERS, 0);

  const subSc = rawSub * ct.subwayW;
  const busSc = rawBus * ct.busW;
  const icSc = rawIc * ct.icW;
  const ktxSc = rawKtx * ct.ktxW;
  const maxTransport = 25 * ct.subwayW + 30 * ct.busW + 20 * ct.icW + 20 * ct.ktxW + 5;
  const transport = Math.max(0, Math.min(((subSc + busSc + icSc + ktxSc + 5) / maxTransport) * 100, 100));

  // 학교 도보시간 보정: naverSchoolWalkMin 기반 ±10
  const walkMin = apt.naverSchoolWalkMin;
  const walkAdj: number = walkMin == null ? 0 : tierMax(walkMin, SCHOOL_WALK_BONUS, SCHOOL_WALK_FAR_ADJ);
  const schoolScore = (apt.schoolScore ?? 50) as number;
  const school = Math.max(0, Math.min(100, schoolScore + walkAdj));

  const infraItems = (INFRA_CONFIG as Array<{ key: string; max: number; weight: number }>).map((cfg) => ({
    v: ((apt as Record<string, unknown>)[cfg.key] as number | undefined) ?? 0,
    m: cfg.max,
    w: cfg.weight,
  }));
  // 체감 곡선 — 병원 0→5개의 차이는 크고 100→163개의 차이는 사실상 없다. 선형(v/max)은
  // 그 둘을 같은 폭으로 세어 흔한 동네를 과소평가한다(INFRA_CONFIG·infraSaturation 주석 참조).
  const infra = infraItems.reduce((s, i) => s + infraSaturation(i.v, i.m) * i.w * 100, 0);

  const view = apt.view as string | undefined;
  const sunlight = apt.sunlight as string | undefined;
  const viewSc: number = (VIEW_SCORES as Record<string, number>)[String(view)] || 0;
  let sunSc: number = apt._noSunlight
    ? SUNLIGHT_NO_DATA
    : ((SUNLIGHT_SCORES as Record<string, number>)[String(sunlight)] ?? SUNLIGHT_DEFAULT);
  // 방향 보정: 일조 점수에 방향 보너스 가산 (남향 최대 +8)
  const primaryDirection = apt.primaryDirection as string | undefined;
  const dirBonus: number = primaryDirection ? ((DIRECTION_BONUS as Record<string, number>)[primaryDirection] ?? 0) : 0;
  sunSc = Math.min(sunSc + dirBonus, SUNLIGHT_DIRECTION_MAX);
  // 세션508: 소음 미측정(null) 시 중립값(NOISE_UNKNOWN_SCORE). 옛 `?? 75`는 NOISE_TIERS 최대(70)
  //   보다 커서 fallback 0점으로 떨어져 "안 재본 곳이 실측 최악(70dB)보다 시끄럽다"로 채점됐다.
  const noise = apt.noise as number | null | undefined;
  const noiseSc: number = noise == null ? NOISE_UNKNOWN_SCORE : tierMax(noise, NOISE_TIERS, 0);
  // 대기질 복합: PM2.5(40%) + PM10(35%) + O3(25%) — pm10/o3 null이면 기존과 동일
  const airQuality = apt.airQuality as { pm25?: number; pm10?: number; o3?: number; grade?: string } | undefined;
  const pm25Sc: number =
    airQuality?.pm25 != null ? tierMax(airQuality.pm25, AIR_QUALITY_TIERS, 0) : AIR_QUALITY_DEFAULT;
  const pm10Sc: number | null = airQuality?.pm10 != null ? tierMax(airQuality.pm10, AIR_PM10_TIERS, 0) : null;
  const o3Sc: number | null = airQuality?.o3 != null ? tierMax(airQuality.o3, AIR_O3_TIERS, AIR_O3_BAD_SCORE) : null;
  const airSc =
    pm10Sc == null && o3Sc == null
      ? pm25Sc
      : pm25Sc * 0.4 + (pm10Sc ?? AIR_PM10_DEFAULT) * 0.35 + (o3Sc ?? AIR_O3_DEFAULT) * 0.25;
  // 0~100 정규화 — 네 요소를 그냥 더하면 최대 128 이 나와, 배점 10점(env*0.1) 자리를 최대
  // 12.8점까지 먹는다(실측 1,646곳 중 1,054곳(64.0%)이 100 초과). 자르지 않고 나누는 이유는
  // ENV_MAX 주석 참조 — 자르면 그 64% 가 전부 동점이 되어 변별력이 오히려 죽는다.
  const env = ((viewSc + sunSc + noiseSc + airSc) / ENV_MAX) * 100;
  const noxious = (apt.noxious as string[] | undefined) || [];
  let noxPen = noxious.reduce((s, n) => s + ((NOXIOUS_PENALTY as Record<string, number>)[n] || 0), 0);
  // 거리 기반 감점 완화: noxiousDist >= 500m이면 감점 반감
  const noxiousDist = apt.noxiousDist as number | undefined;
  if (noxiousDist != null && noxiousDist >= NOXIOUS_DIST_THRESHOLD) noxPen = noxPen * NOXIOUS_REDUCTION;
  noxPen = Math.max(noxPen, NOXIOUS_PEN_CAP);
  const noxSafe = Math.max(0, 100 + (noxPen / 15) * 100);
  const total = transport * 0.3 + school * 0.25 + infra * 0.2 + env * 0.1 + noxSafe * 0.15;
  const subwayLines = apt.subwayLines as string | undefined;
  const schoolGrade = apt.schoolGrade as string | undefined;
  return {
    total: Math.round(Math.min(Math.max(total, 0), 100)),
    subs: [
      {
        name: "교통",
        score: Math.round(transport),
        info: [
          subwayDist > 9000 ? "지하철 없음" : `지하철 ${subwayDist}m${subwayLines ? `(${subwayLines})` : ""}`,
          apt._noBus ? null : `버스 ${busRoutes}개`,
          icDist < 90 ? `IC ${icDist}km` : null,
          ktxDist < 90 ? `KTX ${ktxDist}km` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        detail: [
          subwayDist > 9000
            ? "지하철 없음"
            : `지하철 ${subwayDist}m${subwayLines ? `(${subwayLines})` : ""} ${subwayDist <= 300 ? "역세권" : subwayDist <= 500 ? "도보권" : subwayDist <= 700 ? "양호" : subwayDist <= 1000 ? "보통" : "원거리"}`,
          apt._noBus ? "버스 미수집" : `버스 ${busRoutes}개/${FULL_BUS_ROUTES}`,
          // 등급 문구는 점수표(IC_DIST_TIERS/KTX_DIST_TIERS)에서 뽑는다 — 여기에 경계를 따로
          // 박으면 점수표만 바뀌었을 때 문구가 안 따라와 "0점인데 보통"이 남는다(세션499).
          icDist < 90
            ? `IC ${icDist}km ${tierMaxLabel(icDist, IC_DIST_TIERS, IC_DIST_FALLBACK_LABEL)}`
            : `IC ${IC_DIST_FALLBACK_LABEL}`,
          ktxDist < 90 ? `KTX ${ktxDist}km ${tierMaxLabel(ktxDist, KTX_DIST_TIERS, KTX_DIST_FALLBACK_LABEL)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      },
      {
        name: "학군",
        score: Math.round(school),
        info: schoolGrade ? `${schoolGrade}${walkMin != null ? ` 도보${walkMin}분` : ""}` : schoolGrade,
        // ⚠️ 등급은 점수에서 **파생**된다(`schools-neis.mjs gradeFromScore`: 80↑ A · 60↑ B · 40↑ C).
        //    옛 문구 "A=100, B=80, C=60, D=40점" 이 주장하는 1:1 대응은 성립할 수 없다 —
        //    B등급 186곳은 실측 60~79(중앙 71)라 80 에 닿지 않는다(520곳에서 detail 이 거짓이었다).
        //    `schoolScore` 는 `?? 50` 폴백이 걸려 있어, 등급이 없으면 점수도 함께 감춘다.
        detail:
          `${schoolGrade ? `${schoolGrade} ${schoolScore}점` : "미수집"} (A 80↑ · B 60↑ · C 40↑)` +
          `${walkMin != null ? ` · 도보 ${walkMin}분 (5분↓+10, 10분↓+5, 20분↑-10)` : ""}`,
      },
      {
        name: "생활인프라",
        score: Math.round(infra),
        info: `병원${apt.hospital} 마트${apt.mart} 편의점${apt.conv} 공원${apt.park} 약국${apt.pharmacy} 보육${apt.childcare ?? 0}`,
        // 분모는 INFRA_CONFIG 에서 뽑는다 — 여기에 숫자를 박으면 기준만 바뀌었을 때 문구가
        // 안 따라와 "5개인데 5/150" 같은 거짓이 남는다(세션499 의 등급 문구 사고와 같은 자리).
        detail: [
          ["병원", "hospital", "1km"],
          ["마트", "mart", "1km"],
          ["편의점", "conv", "500m"],
          ["공원", "park", "1km"],
          ["약국", "pharmacy", "500m"],
          ["어린이집", "childcare", "1km"],
          ["응급의료", "emergency", "10km"],
        ]
          .map(([label, key, rad]) => {
            const cfg = INFRA_CONFIG.find((c) => c.key === key);
            const v = ((apt as Record<string, unknown>)[key] as number | undefined) ?? 0;
            return `${label}${v}/${cfg?.max ?? "?"}(${rad})`;
          })
          .join(" "),
      },
      {
        name: "자연환경",
        score: Math.round(env),
        info:
          apt._noView && apt._noNoise && apt._noSunlight
            ? "정보 없음"
            : `${view || "미확인"}조망${apt._noSunlight ? "" : ` 일조:${sunlight}`}${apt._noNoise ? "" : ` ${noise}dB`}${airQuality?.grade ? ` 대기:${airQuality.grade}` : ""}`,
        detail: `조망:${view || "미확인"}(블루40 그린30 천공20점) 일조:${sunlight || "미확인"}(우수30 양호22점) 소음:${apt._noNoise ? "미수집" : `${noise}dB`}(50↓우수 60↓양호) 대기질:${airQuality?.grade || "미수집"}(PM2.5${pm10Sc != null ? `/PM10` : ""}${o3Sc != null ? `/O3` : ""})`,
      },
      {
        name: "혐오시설",
        score: Math.round(noxSafe),
        info: noxious.length ? noxious.join(",") : "없음",
        detail: noxious.length ? `${noxious.join(",")} (500m↑ 감점 반감, 하한 -15점)` : "없음 (감점 0)",
      },
    ],
  };
}
