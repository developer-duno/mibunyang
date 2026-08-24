import { BRAND_TIER, AGE_PREMIUM, PRESALE_PREMIUM_COEFF, resolveBuilder } from "@/constants/brands";
import {
  tierMin,
  DEV_SCORE_TIERS,
  DEV_SCORE_NEGATIVE_MULT,
  DEV_SCORE_BASE,
  LAND_COST_TIERS,
  LAND_COST_LOW,
  LAND_COST_NULL,
  PRICE_NO_DATA_DEFAULTS,
  PIR_SCORE_TIERS,
  PRICE_INDEX_HOT,
  PRICE_INDEX_WARM,
  PRICE_INDEX_HOT_BONUS,
  PRICE_INDEX_WARM_BONUS,
  PRICE_FALLBACK_RELIABILITY_PENALTY,
  AREA_BUCKET_TOLERANCE_M2,
} from "@/constants/scoringTiers";
import type { Apt, Res } from "@/types/scoring";

const IS_DEV =
  typeof import.meta !== "undefined" && !!(import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV;

/** 한국 시간(UTC+9, 서머타임 없음) 고정 오프셋 — 준공 판정을 러너 시간대에 맡기지 않는다. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 지금이 몇 년 몇 월인지를 **한국 시간 기준** "월 일련번호"(연×12 + 월−1)로 돌려준다.
 *
 * ⚠️ 러너 로컬 시간을 쓰면 안 된다 — `daily-deploy.yml` 의 `cron: '0 18 * * *'` 는 UTC 러너에서
 * KST 03:00 에 도는데 그 순간 UTC 는 아직 **전월**이다. 그러면 매월 1일마다 `compute-scores` 가
 * 굽는 판정이 한국 사용자 브라우저(`classify.ts` 의 `NOW_YM`)와 한 달씩 어긋난다
 * (2026-09-01 03:00 KST 실측: 로컬 UTC 기준 24319=2026-08 vs KST 고정 24320=2026-09).
 * 저장소 워크플로에 TZ 핀이 하나도 없어(`grep -rn "TZ:" .github/workflows/` → 0건) 여기서 고정한다.
 */
function currentMonthIndexKst(nowMs: number = Date.now()): number {
  const kst = new Date(nowMs + KST_OFFSET_MS);
  return kst.getUTCFullYear() * 12 + kst.getUTCMonth();
}

/**
 * completion 을 **월 일련번호**(연×12 + 월−1)로 파싱. 미기재·형식 불명이면 null.
 * `getAgeCoeff`/`isPresale` 공유.
 *
 * ⚠️ 운영 DB 의 실제 형식은 **대시 없는 "YYYYMM"** 이다(청약홈 `MVN_PREARNGE_YM` 계열 ·
 * `collect-applyhome-seed.mjs` / `naver-presale.mjs`). 2026-08-24 실측 `apartments_flat` 2,227행:
 * YYYYMM 1,802 · 빈값 374 · 비정형 51("미정" 41 · "2030 미" 계열 9 · "[1회]20" 1).
 * 대시 형식은 **운영 DB 에 0건**이고 테스트 픽스처에만 있다.
 *
 * 옛 코드는 대시가 없으면 `new Date("202605")` 로 넘겼는데 V8 은 이 6자리를 **확장 연도**로 읽어
 * 서기 202605년을 만든다. 그래서 1999년 준공 단지까지 "미래"가 되어 `isPresale` 이 YYYYMM 전량
 * true 였고, `AGE_PREMIUM` 표는 도입 이래 **한 번도 쓰이지 않았다**(실측: 1,802행 중 958곳이
 * 이미 준공됐는데 전부 미준공 판정 · 세션529).
 *
 * **일(日)은 일부러 버린다.** 원천에 일 정보가 없어 "1일"로 채우면 없는 사실을 지어내는 것이고,
 * 화면(`classify.ts:32` · `cardChips.ts`)도 이미 월 단위 문자열 비교로 판정한다 — 같은 단지를
 * 카드는 "입주예정", 엔진은 "준공완료"라 부르던 어긋남을 이 단위 통일이 없앤다.
 *
 * ⚠️ **범위 한정**: 이 통일은 **형식이 정상인 값에만** 성립한다. 비정형 42곳("미정"·"2030 미"·
 * "[1회]20")은 화면이 문자열 비교라 유니코드 순서상 전부 "입주예정"으로 분류되는 반면 여기선
 * 거부(1.05·presale=false)다 — 한 값에 규칙이 셋이다(정렬은 또 `/^\d{6}$/` 로 맨 뒤). 뿌리는
 * 수집기 절단이고 세션530 PR #441 이 다룬다. 또 `classify.ts` 의 `NOW_YM` 은 **브라우저 로컬 시간**
 * 이라, 여기 KST 고정과 해외 로케일 브라우저에서는 월초에 갈릴 수 있다.
 *
 * 형식에 안 맞으면 **거부(null)** 한다 — `new Date(s)` 폴백을 두면 "20266"(네이버 "2026.6" 이
 * slice 된 값) 같은 5자리가 서기 20266년으로 조용히 통과한다.
 */
function parseCompletionMonth(completion: string | null | undefined): number | null {
  if (completion == null) return null;
  const s = completion.toString().trim();
  if (!s) return null;
  //                      "202605"                    "2025-06-01" / "2025-6"
  const m = /^(\d{4})(\d{2})$/.exec(s) ?? /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (!m) return null;
  const month = Number(m[2]);
  // 월 범위를 여기서 막지 않으면 "202613" 이 Date 생성자에서 조용히 2027-01 로 넘어간다.
  if (month < 1 || month > 12) return null;
  return Number(m[1]) * 12 + (month - 1);
}

/**
 * 미준공(분양 예정) 여부. **준공월이 이번 달 이후면 미준공**이다(`>=`) — 화면의 입주 상태
 * (`classify.ts:32` `completion >= NOW_YM` → "입주예정")와 같은 경계를 쓴다. 이 경계가 어긋나면
 * 같은 단지를 카드는 "입주예정", 관리자 분해표는 "연식계수"라 부른다(2026-08 기준 22곳).
 *
 * 화면이 "연식계수"와 "신축 프리미엄"을 다른 이름으로 보여줘야 할 때(예: `AdminScoreBreakdown`)
 * 이 함수로 갈라야 한다 — `getAgeCoeff` 반환값을 역산해 판정하면 `AGE_PREMIUM` 표에 우연히 같은
 * 수치가 들어갈 때 조용히 틀린다.
 */
export function isPresale(completion: string | null | undefined): boolean {
  const idx = parseCompletionMonth(completion);
  return idx != null && idx >= currentMonthIndexKst();
}

/**
 * 준공시점 기반 연식 보정계수 — `fairPrice` 에 곱해진다.
 * 미준공(예정) → `PRESALE_PREMIUM_COEFF`. 준공 후 → `AGE_PREMIUM` 구간값.
 * 미입력·형식 불명 → 1.05 (약간 보수적 중립).
 *
 * 두 표의 값과 실측 근거는 `src/constants/brands.ts` 주석이 진실의 원천이다 — **여기에 수치를
 * 복사하지 말 것**(옛 주석이 구간값을 복사해 뒀다가 표와 함께 낡았다).
 */
export function getAgeCoeff(completion: string | null | undefined): number {
  const idx = parseCompletionMonth(completion);
  if (idx == null) return 1.05;
  const nowIdx = currentMonthIndexKst();
  if (idx >= nowIdx) return PRESALE_PREMIUM_COEFF;
  const yrs = (nowIdx - idx) / 12;
  type AgePremiumEntry = { min: number; max: number; coeff: number };
  const found = (AGE_PREMIUM as AgePremiumEntry[]).find((a) => yrs >= a.min && yrs < a.max);
  return found ? found.coeff : 1.05;
}

/**
 * 평형별 가격 보정계수. 소형 프리미엄·대형 디스카운트 반영.
 * 면적 미등록(0 또는 null) → 1.0 중립 (평균 평형 가정).
 * 구간: 60㎡ 미만 1.08 (소형), 60~85 1.0 (국민평형), 85~115 0.97, 115+ 0.94.
 */
export function getAreaAdj(area: number | null | undefined): number {
  if (!area || area <= 0) return 1.0; // 면적 미등록 = 중립
  if (area < 60) return 1.08;
  if (area < 85) return 1.0;
  if (area < 115) return 0.97;
  return 0.94;
}

/**
 * `priceByArea`(5㎡ 버킷별 실거래) 에서 이 단지 면적에 가장 가까운 버킷의 평균가를 찾는다.
 * 옛 fairPrice(`nearbyMedian × getAreaAdj`)는 구 전체 거래 총액 중위값에 ±3~8% 계수만 곱해
 * 대형 평형을 자동으로 "비싸다"고 채점하던 구조적 편향이 있었다(corr(면적,괴리도) = −0.704,
 * src/constants/scoringTiers.ts AREA_BUCKET_TOLERANCE_M2 주석 참조) — 이 함수가 그 1순위 대체.
 *
 * 최근접 버킷과의 이격이 `AREA_BUCKET_TOLERANCE_M2` 이내면 그 버킷의 평균가를 그대로 쓰고,
 * 넘으면(예: 버킷이 성기게 채워진 지역) 그 버킷의 ㎡당가로 환산해 반환한다.
 *
 * @returns 매칭된 가격(만원, 총액). 배열이 비었거나 area 가 유효하지 않으면 null.
 */
export function matchAreaPrice(
  priceByArea: Array<{ area: number; min: number; avg: number; max: number; count: number }> | null | undefined,
  area: number | null | undefined
): number | null {
  if (!Array.isArray(priceByArea) || priceByArea.length === 0) return null;
  if (area == null || !(area > 0)) return null;
  let best: { area: number; avg: number } | null = null;
  let bestDist = Infinity;
  for (const b of priceByArea) {
    if (!(b?.area > 0) || !(b?.avg > 0)) continue;
    const dist = Math.abs(b.area - area);
    if (dist < bestDist) {
      bestDist = dist;
      best = b;
    }
  }
  if (!best) return null;
  if (bestDist > AREA_BUCKET_TOLERANCE_M2) {
    return (best.avg / best.area) * area;
  }
  return best.avg;
}

// 세션111: price=0 구조적 사유별 UX 분기 확장.
// 점수 로직(devSc=30 중립)은 불변, 문구만 정교화.
// 판정 순서: 임대 → 정비사업 → 후분양 → 오피스텔 → 분양계획 → 택지지구 블록 → 공공분양 → 기본.
// presaleStage "분양계획"은 모집공고 전 예정 단지 신호 — naver-presale 수집기가
// price=0으로 저장하는 정상 동작. 이름 패턴보다 구체적이라 택지블록 앞에 위치.
function classifyNoPrice(apt: Apt): string {
  const name = (apt.name as string) || "";
  const presale = (apt.presaleType as string) || "";
  const stage = (apt.presaleStage as string) || "";
  if (presale.includes("임대")) return "임대형 공급 — 분양가 산출 대상 아님";
  if (/(재건축|재개발|촉진구역|\d+구역)/.test(name)) return "정비사업 — 조합원 물량, 분양가 미정";
  if (/(써밋|후분양)/.test(name)) return "후분양 단지 — 분양가 미정";
  if (/\(오\)$/.test(name)) return "오피스텔 — 분양가 별도 공고";
  if (stage === "분양계획") return "분양 예정 단지 — 모집공고 전";
  if (/(\d+BL|\d+블럭|\d+블록|\bA\d+\b|\bB\d+\b|\d+단지|지구|신도시)/.test(name))
    return "택지지구 블록 — 분양가 공고 전";
  if (presale.includes("공공")) return "공공분양 — 분양가 공고 대기";
  return "분양가 데이터 없음 (중립 점수)";
}

/**
 * 가격 매력도 점수 (가중치 합 1.00, total 0~100 클램핑).
 * 서브스코어: 괴리도 0.30 / 전세가율 0.20 / PIR 0.15 / PSR 0.25 / 신뢰도 0.07 / 택지비 0.03.
 * fairPrice 폴백 (src/scoring/CLAUDE.md "fairPrice 폴백 + 신뢰도 차감"):
 *   1순위: trade_stats.price_by_area 평형별 실거래 버킷 매칭 (matchAreaPrice) → areaAdj 미적용
 *   2순위: trade_stats.nearby_median × areaAdj
 *   3순위: regions.avg_price_sqm × 면적 → fairPriceFromSidoAvg=true
 *   4순위: presale_pp × 면적/3.3058 → fairPriceFromSidoAvg=true
 * 2~4순위 폴백 사용 시: dataReliability -= PRICE_FALLBACK_RELIABILITY_PENALTY (기본 15).
 *   1순위(버킷 매칭)는 신뢰도 차감 없음 — 시도 평균보다 정밀한 그 평형대 실거래이기 때문.
 * PIR 구간: ≤10→100, ≤20→80~100 선형, ≤30→60~80 선형, >30→60-(pir-30)×2 (0 하한, 세션108).
 * priceIndex 보정: 130+ → +5, 110+ → +3 (과열 시장 신뢰도 가산).
 */
export function scorePrice(apt: Apt): Res {
  // ⚠️ 이 자리는 **선재 결함**이다 — #400(세션513)이 만든 게 아니라, #400 이 브랜드 정규화를
  //   세 자리 중 두 자리(`scoreProduct`·카드 칩)에만 넣어 **불일치가 드러난** 것이다.
  //   `scorePrice` 는 처음부터 `apt.builder` 를 BRAND_TIER 에 직조회해 왔다.
  //   결과: 같은 단지가 상품성축에서는 1군Super(20점)인데 가격축 적정가 계수 `adj` 는
  //   미등재 1.0 으로 남는 **이중 잣대**가 68곳에 생겼다(운영 catsCache 대조 실측).
  //   정규화는 한 군데서만 하는 게 아니라 `builder` 를 읽는 **모든 자리**에서 해야 한다.
  const builder = resolveBuilder(apt.builder as string | null | undefined);
  const brand = (BRAND_TIER as Record<string, { adj?: number }>)[builder];
  if (!brand && IS_DEV) console.warn(`[scoring] Unknown builder: "${builder}"`);
  const b = brand || { adj: 1.0 };
  const bAdj = b.adj ?? 1.0;
  const ageCoeff = getAgeCoeff(apt.completion);
  const area = (apt.area ?? 84) as number;
  const areaAdj = getAreaAdj(area);
  let fairPrice = 0;
  // 세션114: nearbyMedian 부재로 시도 평균 폴백(avgPriceSqm/presalePp) 사용 여부.
  // 섬·군 지역에서 시도 평균이 실시세의 2~3배로 왜곡 → 신뢰도 차감 + detail 경고.
  let fairPriceFromSidoAvg = false;
  // 면적 편향 수정: 1순위 = 평형별 실거래 버킷 매칭(priceByArea). 이미 그 평형대 실거래이므로
  // areaAdj(±3~8%)를 다시 곱하지 않는다 — 곱하면 corr(면적,괴리도) −0.147 대신 −0.237로 악화(실측).
  // `_noArea`(면적 미상, sanitize 가 84 로 누르기 전 플래그)면 매칭 대상에서 제외 — 안 잰 것을
  // "84㎡ 단지"로 오매칭하지 않기 위함.
  let fairPriceFromAreaBucket = false;
  if (!apt._noArea) {
    const bucketAvg = matchAreaPrice(apt.priceByArea, area);
    if (bucketAvg != null && bucketAvg > 0) {
      fairPrice = bucketAvg * ageCoeff * bAdj;
      fairPriceFromAreaBucket = true;
    }
  }
  // 2순위 이하: 현행 3단 폴백 그대로 (nearbyMedian → avgPriceSqm → presalePp)
  if (!fairPriceFromAreaBucket) {
    fairPrice = (apt.nearbyMedian ?? 0) * ageCoeff * areaAdj * bAdj;
  }
  // fairPrice=0 폴백: avgPriceSqm(천원/㎡) 또는 presalePp(만원/평) → 만원 총가
  if (fairPrice <= 0 && apt.avgPriceSqm != null && area > 0) {
    fairPrice = Math.round((apt.avgPriceSqm * area) / 10) * ageCoeff * areaAdj * bAdj;
    if (fairPrice > 0) fairPriceFromSidoAvg = true;
  }
  if (fairPrice <= 0 && apt.presalePp != null && apt.presalePp > 0 && area > 0) {
    fairPrice = apt.presalePp * (area / 3.3058) * ageCoeff * areaAdj * bAdj;
    if (fairPrice > 0) fairPriceFromSidoAvg = true;
  }
  // 택지비 비율 서브스코어 (공통)
  const landSc: number =
    apt.landCostRatio != null ? tierMin(apt.landCostRatio, LAND_COST_TIERS, LAND_COST_LOW) : LAND_COST_NULL;
  // priceIndex 보정: 과열 시장에서 신뢰도 가산
  const idxBonus =
    apt.priceIndex != null && apt.priceIndex > PRICE_INDEX_HOT
      ? PRICE_INDEX_HOT_BONUS
      : apt.priceIndex != null && apt.priceIndex > PRICE_INDEX_WARM
        ? PRICE_INDEX_WARM_BONUS
        : 0;
  // 방안 A: 시도 평균 폴백 사용 시 dataReliability 차감(세션114)
  const dataReliability = (apt.dataReliability ?? 30) as number;
  const relBase = fairPriceFromSidoAvg
    ? Math.max(0, dataReliability - PRICE_FALLBACK_RELIABILITY_PENALTY)
    : dataReliability;
  const relSc = Math.min(relBase + idxBonus, 100);
  const price = (apt.price ?? 0) as number;
  if (fairPrice <= 0 || !price || price <= 0) {
    const devSc = PRICE_NO_DATA_DEFAULTS.dev;
    const jrSc = PRICE_NO_DATA_DEFAULTS.jr;
    const pirSc = PRICE_NO_DATA_DEFAULTS.pir;
    const psrSc = PRICE_NO_DATA_DEFAULTS.psr;
    const total = devSc * 0.3 + jrSc * 0.2 + pirSc * 0.15 + psrSc * 0.25 + relSc * 0.07 + landSc * 0.03;
    const noPriceDetail = !price || price <= 0 ? classifyNoPrice(apt) : "주변 시세 없음 — 적정가 산출 불가";
    return {
      total: Math.round(Math.max(0, Math.min(total, 100))),
      fairPrice: 0,
      deviation: "0.0",
      subs: [
        { name: "적정가 괴리도", score: devSc, info: "데이터 부재", detail: noPriceDetail },
        {
          name: "전세가율",
          score: Math.round(jrSc),
          info: apt.jeonseRate == null ? "데이터 부재" : `${apt.jeonseRate}%`,
          detail:
            apt.jeonseRate == null ? "전세가율 데이터 없음 (중립 50점)" : `${apt.jeonseRate}% (적정 70~80%, 위험 40%↓)`,
        },
        {
          name: "PIR",
          score: Math.round(pirSc),
          info: apt.pir == null ? "데이터 부재" : `${apt.pir}배`,
          detail:
            apt.pir == null ? "PIR 데이터 없음 (중립 50점)" : `${apt.pir}배 (우수 10↓, 양호 20↓, 보통 30↓, 부담 30↑)`,
        },
        {
          name: "PSR",
          score: Math.round(psrSc),
          info: apt.psr == null ? "데이터 부재" : `${(apt.psr * 100).toFixed(0)}%`,
          detail:
            apt.psr == null
              ? "PSR 데이터 없음 (중립 50점)"
              : `${(apt.psr * 100).toFixed(0)}% (저평가 85%↓, 적정 100%↓)`,
        },
        {
          name: "데이터 신뢰도",
          score: relSc,
          info: `${dataReliability}%${idxBonus ? `(+${idxBonus})` : ""}`,
          detail: `${dataReliability}%${idxBonus ? ` +지수보정${idxBonus}` : ""} (80%↑신뢰, 30%↓추정)`,
        },
        {
          name: "택지비비율",
          score: landSc,
          info: apt.landCostRatio != null ? `${apt.landCostRatio}%` : "정보 없음",
          detail:
            apt.landCostRatio != null
              ? `${apt.landCostRatio}% (60%↑안정, 40%↑양호, 20%↓위험)`
              : "택지비 데이터 없음 (중립 50점)",
        },
      ],
    };
  }
  const dev = ((fairPrice - price) / fairPrice) * 100;
  type DevTier = { min: number; score?: number; base?: number; span?: number; range?: number };
  const tiers = DEV_SCORE_TIERS as DevTier[];
  let devSc =
    dev >= tiers[0].min
      ? (tiers[0].score as number)
      : dev >= tiers[1].min
        ? (tiers[1].base as number) + ((dev - tiers[1].min) / (tiers[1].span as number)) * (tiers[1].range as number)
        : dev >= tiers[2].min
          ? (tiers[2].base as number) + ((dev - tiers[2].min) / (tiers[2].span as number)) * (tiers[2].range as number)
          : dev >= tiers[3].min
            ? (tiers[3].base as number) + (dev / (tiers[3].span as number)) * (tiers[3].range as number)
            : Math.max(0, DEV_SCORE_BASE + dev * DEV_SCORE_NEGATIVE_MULT);
  devSc = Math.max(0, Math.min(devSc, 100));

  const jr = apt.jeonseRate;
  let jrSc: number;
  if (jr == null) jrSc = PRICE_NO_DATA_DEFAULTS.jr;
  else if (jr >= 70 && jr <= 80) jrSc = 80 + (1 - Math.abs(jr - 75) / 5) * 20;
  else if (jr > 80) jrSc = Math.max(0, 80 - (jr - 80) * 5);
  else if (jr >= 60) jrSc = 60 + ((jr - 60) / 10) * 20;
  else jrSc = Math.max(0, (jr / 60) * 60);

  const pir = apt.pir;
  // 세션108: KOSIS 1인당 개인소득 기준 PIR 분포(p25=14.7, p50=19.25, p75=25.27)에 맞춘
  // 재설계 구간. 기존 ≤3/≤5/≤7 구간(가구소득 가정)은 개인소득 PIR에 부적절.
  const { EXCELLENT_MAX, GOOD_MAX, MODERATE_MAX, BURDEN_PENALTY } = PIR_SCORE_TIERS;
  const pirSc =
    pir == null
      ? PRICE_NO_DATA_DEFAULTS.pir
      : pir <= EXCELLENT_MAX
        ? 100
        : pir <= GOOD_MAX
          ? 80 + ((GOOD_MAX - pir) / (GOOD_MAX - EXCELLENT_MAX)) * 20
          : pir <= MODERATE_MAX
            ? 60 + ((MODERATE_MAX - pir) / (MODERATE_MAX - GOOD_MAX)) * 20
            : Math.max(0, 60 - (pir - MODERATE_MAX) * BURDEN_PENALTY);
  const psr = apt.psr;
  const psrSc =
    psr == null
      ? PRICE_NO_DATA_DEFAULTS.psr
      : Math.min(
          psr < 0.85
            ? 85 + ((0.85 - psr) / 0.15) * 15
            : psr <= 1.0
              ? 50 + ((1.0 - psr) / 0.15) * 35
              : Math.max(0, 50 - ((psr - 1.0) / 0.2) * 50),
          100
        );
  const total = devSc * 0.3 + jrSc * 0.2 + pirSc * 0.15 + psrSc * 0.25 + relSc * 0.07 + landSc * 0.03;
  // 방안 B: 시도 평균 폴백 사용 시 detail 접미 경고(세션114)
  // 두 플래그는 서로 배타적(버킷 매칭 성공 시 sidoAvg 폴백 경로 자체를 안 탐) — 접미는 둘 다
  // 넣어도 실제로는 하나만 붙는다.
  const sidoNotice = fairPriceFromSidoAvg ? " — 광역 시도 평균 기준(실시세 왜곡 가능)" : "";
  const areaBucketNotice = fairPriceFromAreaBucket ? " — 평수대별 실거래 기준" : "";
  const relNotice = fairPriceFromSidoAvg ? ` -폴백차감${PRICE_FALLBACK_RELIABILITY_PENALTY}` : "";
  return {
    total: Math.round(Math.max(0, Math.min(total, 100))),
    fairPrice: Math.round(fairPrice),
    deviation: dev.toFixed(1),
    // 어느 경로로 fairPrice 를 구했는지 **밖으로 알린다**. 화면이 "산출 과정"을 설명하려면
    // 이 사실이 필요한데, 없으면 `AdminScoreBreakdown` 처럼 **화면이 제 나름대로 다시 계산**해
    // 같은 모달 안에서 서로 다른 괴리율 두 개가 뜬다(세션527 적대검증이 실제로 잡은 결함).
    // detail 문자열을 정규식으로 훑어 판정하면 문구를 고칠 때 조용히 깨지므로 플래그로 준다.
    fairPriceFromAreaBucket,
    fairPriceFromSidoAvg,
    subs: [
      {
        name: "적정가 괴리도",
        score: Math.round(devSc),
        info: `${dev > 0 ? "+" : ""}${dev.toFixed(1)}%`,
        detail: `${dev > 0 ? "+" : ""}${dev.toFixed(1)}% (±5% 적정, ±10~20% 주의, 20%↑ 과대)${sidoNotice}${areaBucketNotice}`,
      },
      {
        name: "전세가율",
        score: Math.round(jrSc),
        info: jr == null ? "데이터 부재" : `${jr}%`,
        detail: jr == null ? "전세가율 데이터 없음 (중립 50점)" : `${jr}% (적정 70~80%, 위험 40%↓, 과열 90%↑)`,
      },
      {
        name: "PIR",
        score: Math.round(pirSc),
        info: pir == null ? "데이터 부재" : `${pir}배`,
        detail: pir == null ? "PIR 데이터 없음 (중립 50점)" : `${pir}배 (우수 10↓, 양호 20↓, 보통 30↓, 부담 30↑)`,
      },
      {
        name: "PSR",
        score: Math.round(psrSc),
        info: psr == null ? "데이터 부재" : `${(psr * 100).toFixed(0)}%`,
        detail:
          psr == null
            ? "PSR 데이터 없음 (중립 50점)"
            : `${(psr * 100).toFixed(0)}% (저평가 85%↓, 적정 100%↓, 고평가 100%↑)`,
      },
      {
        name: "데이터 신뢰도",
        score: relSc,
        info: `${dataReliability}%${idxBonus ? `(+${idxBonus})` : ""}${relNotice}`,
        detail: `${dataReliability}%${idxBonus ? ` +지수보정${idxBonus}` : ""}${relNotice} (80%↑신뢰, 50%↑보통, 30%↓추정)`,
      },
      {
        name: "택지비비율",
        score: landSc,
        info: apt.landCostRatio != null ? `${apt.landCostRatio}%` : "정보 없음",
        detail:
          apt.landCostRatio != null
            ? `${apt.landCostRatio}% (60%↑안정, 40%↑양호, 20%↓위험)`
            : "택지비 데이터 없음 (중립 50점)",
      },
    ],
  };
}
