import { AGE_PREMIUM, PRESALE_PREMIUM_COEFF } from "@/constants/brands";
import {
  tierMin,
  DEV_SCORE_TIERS,
  DEV_SCORE_NEGATIVE_MULT,
  DEV_SCORE_BASE,
  DEV_BAND_LABEL,
  LAND_COST_TIERS,
  LAND_COST_LOW,
  LAND_COST_NULL,
  PRICE_NO_DATA_DEFAULTS,
  PIR_SCORE_TIERS,
  PRICE_SUB_WEIGHTS,
  TRADE_SCOPE_PER_M2_TOL_M2,
  TRADE_SCOPE_PEER_YEARS,
  AREA_BUCKET_TOLERANCE_M2,
} from "@/constants/scoringTiers";
import type { Apt, Res } from "@/types/scoring";

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
export function currentMonthIndexKst(nowMs: number = Date.now()): number {
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
export function parseCompletionMonth(completion: string | null | undefined): number | null {
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
 * 준공시점 기반 연식 보정계수.
 * ⚠️ 세션607(시세 비교 범위 좁히기 다)부터 `scorePrice` 의 적정가에 **곱하지 않는다** — 적정가가 같은 단지·
 *   같은 동 또래 실거래라 연식 보정이 이중이 된다(설계서 D8·R5). 남은 소비처 = 화면 설명용(grep 으로 확인) ·
 *   안 쓰게 되면 `AGE_PREMIUM` 과 함께 정리 PR 에서 삭제.
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
 * ⚠️ 세션607 부터 `scorePrice` 는 이 계수를 쓰지 않는다(적정가 = 같은 평수 실거래 · 설계서 D8) — 정리 PR 에서 삭제 후보.
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
 * ⚠️ 세션607 부터 `scorePrice` 의 적정가 경로가 아니다(구 전체 버킷 = 폴백 삭제, 설계서 §5-3) — 정리 PR 에서 삭제 후보.
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
 * 적정가 근거 한 마디 — 괴리도 `detail` 끝에 붙는다. 숫자(건수·기간·연식·면적 폭)는 값·상수에서 읽는다
 * (문구에 숫자를 손으로 적지 않는다 — 세션565 관습). 문구 안은 설계서 §5-4(라 그림에서 확정).
 */
function fairBasisText(
  scope: "complex" | "dong_peer",
  src: "sale" | "presale" | null,
  n: number,
  months: number | null,
  areaMode: unknown
): string {
  const period = months != null && months > 0 ? `(최근 ${months}개월)` : "";
  const base =
    scope === "dong_peer"
      ? `같은 동 비슷한 연식(±${TRADE_SCOPE_PEER_YEARS}년)·같은 평수 실거래 ${n}건 대비`
      : src === "presale"
        ? `이 단지 분양권 거래 ${n}건${period} 대비`
        : `이 단지 실거래 ${n}건${period} 대비`;
  const perM2 = areaMode === "per_m2" ? ` (면적 ${TRADE_SCOPE_PER_M2_TOL_M2}㎡ 이내 ㎡당 환산)` : "";
  return `${base}${perM2}`;
}

/**
 * 가격 매력도 점수 (가중치 `PRICE_SUB_WEIGHTS` 합 1.00, total 0~100 클램핑).
 * 서브스코어 5개: 괴리도 0.55 / 전세가율 0.20 / PIR 0.15 / 신뢰도 0.07 / 택지비 0.03
 *   (세션607 시세 비교 범위 좁히기 다 — 설계서 R4·D12. PSR 축은 없앴다).
 *
 * 적정가(설계서 §5-3 · D8 · D10 · R1·R5):
 *   - 입력 = `cmpFairPrice`(trade_stats.cmp_fair_price) — `cmpScope` 가 complex(같은 단지) 또는
 *     dong_peer(같은 동 또래)이고 값 > 0 일 때만. 연식·면적·브랜드 계수를 **곱하지 않는다**(자기 단지·또래 값).
 *   - 폴백 없음 — 옛 평수대 버킷(`priceByArea`)·구 중위(`nearbyMedian`)·시도 평균(`avgPriceSqm`)·
 *     분양 평당가(`presalePp`)는 점수에서 읽지 않는다. 그래서 신뢰도 차감도 없다.
 *   - 적정가가 없거나 분양가가 없으면 **괴리도만 중립**(`PRICE_NO_DATA_DEFAULTS.dev`) —
 *     전세가율·PIR·신뢰도·택지비는 각자 판정한다(옛 코드는 넷 다 중립이었다).
 * 전세가율 입력 = `complexJeonseRate`(같은 단지 전세 ÷ 매매, R3) — null 이면 중립. 옛 `jeonseRate`(구)는 안 읽는다.
 * PIR 구간: ≤10→100, ≤20→80~100 선형, ≤30→60~80 선형, >30→60-(pir-30)×2 (0 하한, 세션108).
 * priceIndex(분양가격지수) 보정은 세션592 에 껐다 — 원천(KOSIS)이 2025-10 에서 멈췄다.
 */
export function scorePrice(apt: Apt): Res {
  const W = PRICE_SUB_WEIGHTS;
  const scopeIn = apt.cmpScope === "complex" || apt.cmpScope === "dong_peer" ? apt.cmpScope : null;
  const cmpFair = Number(apt.cmpFairPrice);
  const scope: "complex" | "dong_peer" | null = scopeIn && cmpFair > 0 ? scopeIn : null;
  const fairPrice = scope ? cmpFair : 0;
  const fairPriceSrc: "sale" | "presale" | null =
    scope == null ? null : scope === "dong_peer" ? "sale" : apt.cmpSrc === "presale" ? "presale" : "sale";
  const fairPriceN = scope ? Number(apt.cmpN ?? 0) || 0 : 0;

  // 택지비 비율 서브스코어 (공통)
  const landSc: number =
    apt.landCostRatio != null ? tierMin(apt.landCostRatio, LAND_COST_TIERS, LAND_COST_LOW) : LAND_COST_NULL;
  const dataReliability = (apt.dataReliability ?? 30) as number;
  const relSc = Math.min(dataReliability, 100);
  const price = (apt.price ?? 0) as number;

  // 괴리도 — 적정가와 분양가가 둘 다 있을 때만 판정, 아니면 중립(D10)
  const hasDev = fairPrice > 0 && price > 0;
  const dev = hasDev ? ((fairPrice - price) / fairPrice) * 100 : 0;
  let devSc: number = PRICE_NO_DATA_DEFAULTS.dev;
  if (hasDev) {
    type DevTier = { min: number; score?: number; base?: number; span?: number; range?: number };
    const tiers = DEV_SCORE_TIERS as DevTier[];
    devSc =
      dev >= tiers[0].min
        ? (tiers[0].score as number)
        : dev >= tiers[1].min
          ? (tiers[1].base as number) + ((dev - tiers[1].min) / (tiers[1].span as number)) * (tiers[1].range as number)
          : dev >= tiers[2].min
            ? (tiers[2].base as number) +
              ((dev - tiers[2].min) / (tiers[2].span as number)) * (tiers[2].range as number)
            : dev >= tiers[3].min
              ? (tiers[3].base as number) + (dev / (tiers[3].span as number)) * (tiers[3].range as number)
              : Math.max(0, DEV_SCORE_BASE + dev * DEV_SCORE_NEGATIVE_MULT);
    devSc = Math.max(0, Math.min(devSc, 100));
  }
  const devDetail = hasDev
    ? `${dev > 0 ? "+" : ""}${dev.toFixed(1)}% (${DEV_BAND_LABEL}) — ${fairBasisText(scope as "complex" | "dong_peer", fairPriceSrc, fairPriceN, apt.cmpMonths ?? null, apt.cmpAreaMode)}`
    : !price || price <= 0
      ? classifyNoPrice(apt)
      : `비교할 실거래가 아직 없어요 (중립 ${PRICE_NO_DATA_DEFAULTS.dev}점)`;

  // 전세가율 — 같은 단지 전세 ÷ 같은 단지 매매(R3). 구 전세가율(jeonseRate)·네이버 값은 쓰지 않는다.
  const jr = apt.complexJeonseRate ?? null;
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

  const total = devSc * W.dev + jrSc * W.jr + pirSc * W.pir + relSc * W.rel + landSc * W.land;
  return {
    total: Math.round(Math.max(0, Math.min(total, 100))),
    // `fairPrice > 0` = "괴리도를 판정했다"의 판별자(카드 칩·catVerdict 규약) — 판정 못 하면 0 · "0.0"
    fairPrice: hasDev ? Math.round(fairPrice) : 0,
    deviation: hasDev ? dev.toFixed(1) : "0.0",
    // 어느 범위로 적정가를 구했는지 **밖으로 알린다**. 화면이 "산출 과정"·칩 근거를 설명하려면
    // 이 사실이 필요한데, 없으면 `AdminScoreBreakdown` 처럼 **화면이 제 나름대로 다시 계산**해
    // 같은 모달 안에서 서로 다른 괴리율 두 개가 뜬다(세션527 적대검증이 실제로 잡은 결함).
    // detail 문자열을 정규식으로 훑어 판정하면 문구를 고칠 때 조용히 깨지므로 값으로 준다.
    fairPriceScope: scope ?? "none",
    fairPriceSrc,
    fairPriceN,
    subs: [
      {
        name: "적정가 괴리도",
        score: Math.round(devSc),
        info: hasDev ? `${dev > 0 ? "+" : ""}${dev.toFixed(1)}%` : "데이터 부재",
        detail: devDetail,
      },
      {
        name: "전세가율",
        score: Math.round(jrSc),
        info: jr == null ? "데이터 부재" : `${jr}%`,
        detail:
          jr == null
            ? `같은 단지 전세·매매 거래 부족 (중립 ${PRICE_NO_DATA_DEFAULTS.jr}점)`
            : `${jr}% — 이 단지 전세 ${apt.complexJeonseN ?? "?"}건 ÷ 매매 ${apt.complexSaleN ?? "?"}건 (적정 70~80%, 위험 40%↓, 과열 90%↑)`,
      },
      {
        name: "PIR",
        score: Math.round(pirSc),
        info: pir == null ? "데이터 부재" : `${pir}배`,
        detail:
          pir == null
            ? `PIR 데이터 없음 (중립 ${PRICE_NO_DATA_DEFAULTS.pir}점)`
            : `${pir}배 (우수 10↓, 양호 20↓, 보통 30↓, 부담 30↑)`,
      },
      {
        name: "데이터 신뢰도",
        score: relSc,
        info: `${dataReliability}%`,
        detail: `${dataReliability}% (80%↑신뢰, 50%↑보통, 30%↓추정)`,
      },
      {
        name: "택지비비율",
        score: landSc,
        info: apt.landCostRatio != null ? `${apt.landCostRatio}%` : "정보 없음",
        detail:
          apt.landCostRatio != null
            ? `${apt.landCostRatio}% (${LAND_COST_TIERS[0].min}%↑안정, ${LAND_COST_TIERS[1].min}%↑양호, ${LAND_COST_TIERS[2].min}%↓위험)` // 경계 숫자는 표에서 읽는다(세션565)
            : "택지비 데이터 없음 (중립 50점)",
      },
    ],
  };
}
