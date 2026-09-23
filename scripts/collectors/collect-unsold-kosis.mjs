// @ts-check
/**
 * KOSIS 시군구별 미분양 세대수 수집기
 *
 * KOSIS 국가통계포털 DT_MLTM_2082 테이블에서 (세션 222 통계표 이전: DT_1YL202001E → DT_MLTM_2082)
 * 시군구별 월별 미분양 세대수를 수집하여
 * regions.regional_unsold + apartments.unsold/unsold_rate 업데이트
 *
 * 사용법:
 *   node scripts/collectors/collect-unsold-kosis.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-unsold-kosis.mjs --dry-run    (미리보기만)
 *   node scripts/collectors/collect-unsold-kosis.mjs --dry-run --impact-out=<경로>   (계획 전체를 JSON 저장)
 */
import { loadEnv, getSupabase, log, logError, REGION_MAP, resolveRegionName, fetchWithRetry, upsertBatch, recordApiQuota, recordCollectorRun, setupGracefulShutdown, today, selectAll } from "./_shared.mjs";
import { isLeasePresale } from "../../src/constants/leaseTypes.mjs";
import { writeFileSync } from "node:fs";

/** @typedef {{ C1_NM: string; C2_NM: string; PRD_DE: string; DT: string }} KosisRow */
/** @typedef {Record<string, Record<string, Record<string, number>>>} UnsoldByRegionGuMonth */
/** @typedef {Record<string, Record<string, number>>} UnsoldByRegionGu */
/** @typedef {Record<string, number>} RegionTotals */

loadEnv();

const PHASE = "kosis-unsold";
const KOSIS_KEY = process.env.KOSIS_KEY;

/** 새 추정 미분양률이 이 값 이상이면 신뢰할 수 없다고 보고 쓰지 않는다(사장님 결정 세션567). */
const UNRELIABLE_RATE_THRESHOLD = 50;

/**
 * KOSIS 응답 행 → 시군구별 월별 미분양 맵 (전 월 유지)
 * 구조: { "서울::강남구": { "202601": 42, "202602": 38, "202603": 35 } }
 *
 * parseKosisRows 와 달리 모든 월 데이터를 보존 → unsold_history 시계열 upsert 용도.
 * 기존 parseKosisRows 는 "최신 월 단일값" 으로 regions/apartments 갱신에 사용 (병존).
 * PRD_DE 정규식 가드: KOSIS 응답이 YYYYMM 외 포맷(분기/반기 등) 반환 시 방어.
 *
 * 세션567: C1_NM → 시도 판정은 `REGION_MAP[C1_NM] ?? resolveRegionName(C1_NM, C2_NM)` 으로
 * 통합 시도("전남광주")도 구 이름으로 갈라 받는다. "계"(시도 합계, C2_NM="계") 행은
 * 통합 시도를 못 가르므로 버린다 — 광주·전남의 시도 합계는 구 값을 합산해 재구성한다
 * (aggregateRegionTotals 의 기존 합산 경로).
 *
 * @param {KosisRow[]} rows
 * @returns {UnsoldByRegionGuMonth}
 */
export function parseKosisRowsAllMonths(rows) {
  /** @type {UnsoldByRegionGuMonth} */
  const unsoldByRegionGuMonth = {};
  for (const row of rows) {
    if (!/^\d{6}$/.test(row.PRD_DE)) continue;
    const region = /** @type {Record<string, string>} */ (REGION_MAP)[row.C1_NM] ?? resolveRegionName(row.C1_NM, row.C2_NM);
    if (!region) continue;
    const gu = row.C2_NM === "계" ? "_total" : row.C2_NM;
    const period = row.PRD_DE;
    const value = parseInt(row.DT, 10);
    if (isNaN(value)) continue;

    if (!unsoldByRegionGuMonth[region]) unsoldByRegionGuMonth[region] = {};
    if (!unsoldByRegionGuMonth[region][gu]) unsoldByRegionGuMonth[region][gu] = {};
    unsoldByRegionGuMonth[region][gu][period] = value;
  }
  return unsoldByRegionGuMonth;
}

/**
 * KOSIS 응답 행 → 시군구별 미분양 집계 (최신 월만)
 * @param {KosisRow[]} rows
 * @returns {UnsoldByRegionGu}
 */
export function parseKosisRows(rows) {
  /** @type {UnsoldByRegionGu} */
  const unsoldByRegionGu = {};
  /** @type {Record<string, string>} */
  const latestPeriod = {};

  for (const row of rows) {
    const region = /** @type {Record<string, string>} */ (REGION_MAP)[row.C1_NM] ?? resolveRegionName(row.C1_NM, row.C2_NM);
    if (!region) continue;

    const gu = row.C2_NM === "계" ? "_total" : row.C2_NM;
    const period = row.PRD_DE;
    const value = parseInt(row.DT, 10);
    if (isNaN(value)) continue;

    const key = `${region}::${gu}`;
    if (!latestPeriod[key] || period > latestPeriod[key]) {
      latestPeriod[key] = period;
      if (!unsoldByRegionGu[region]) unsoldByRegionGu[region] = {};
      unsoldByRegionGu[region][gu] = value;
    }
  }

  return unsoldByRegionGu;
}

/**
 * 시군구 미분양 맵 → 시도별 합계
 * @param {UnsoldByRegionGu} unsoldByRegionGu
 * @returns {RegionTotals}
 */
export function aggregateRegionTotals(unsoldByRegionGu) {
  /** @type {RegionTotals} */
  const regionTotals = {};
  for (const [region, guMap] of Object.entries(unsoldByRegionGu)) {
    if (guMap["소계"] != null) {
      regionTotals[region] = guMap["소계"];
    } else if (guMap["_total"] != null) {
      regionTotals[region] = guMap["_total"];
    } else {
      regionTotals[region] = Object.values(guMap).reduce((s, v) => s + v, 0);
    }
  }
  return regionTotals;
}

/**
 * 비례배분 미분양 추정
 * @param {number | null | undefined} guUnsold
 * @param {number | null | undefined} aptUnits
 * @param {number | null | undefined} totalUnitsInGu
 * @returns {{ estimated: number; unsoldRate: number } | null}
 */
export function calcProportionalUnsold(guUnsold, aptUnits, totalUnitsInGu) {
  if (!guUnsold || guUnsold <= 0 || !aptUnits || aptUnits <= 0 || !totalUnitsInGu || totalUnitsInGu <= 0) return null;
  const estimated = Math.round(guUnsold * (aptUnits / totalUnitsInGu));
  if (estimated <= 0) return null;
  const unsoldRate = Math.round(estimated / aptUnits * 1000) / 10;
  if (unsoldRate > 100) return null; // 비정상 값 방지
  return { estimated, unsoldRate };
}

/**
 * KOSIS 공식 미분양 비례배분을 **건너뛸지** 판정 (세션559 신설)
 *
 * ## 왜 함수로 뺐나
 * 옛 코드는 루프 안 인라인 조건 3줄이었고, 그중 두 줄이 **공식 통계를 막고 있었다**:
 *
 * ```js
 * // 옛 코드 — 주석에 '우선순위: 청약홈 > 네이버 > KOSIS' 라고 적혀 있었다
 * if (apt.unsold != null && apt.unsold > 0) continue;                      // 옛 매물값이 있으면 영영 못 덮음
 * if (apt.naver_sell_count != null && apt.naver_sell_count > 0) continue;  // 매물이 공식보다 우선
 * ```
 *
 * 매물이 하나라도 있는 단지는 **공식 통계를 영원히 못 받았다**. 실측(세션559):
 * 1,989곳 중 1,157곳(58%)의 `unsold` 가 `naver_sell_count` 와 동일했고,
 * 81곳은 미분양이 총세대수를 넘었다(세종더샵예미지 L4블록 = 1세대인데 18, 미분양률 최대 11,800%(익산 제일풍경채 어바니티 = 1세대에 118)).
 *
 * ## 지금 규칙 — 공식만 남긴다
 * · `naver_sell_count` 는 **판정에 쓰지 않는다** — 매물은 미분양이 아니다
 * · `unsold` 가 있어도 **총세대수를 넘으면 오염된 값**이므로 덮어쓴다
 * · 나머지 유효한 기존 값(청약홈 단지별 실측)은 존중한다 — 구 단위 비례배분보다 정확하다
 *
 * ⚠️ `units <= 1` 은 비례배분의 분모가 될 수 없어 제외한다(옛 조건 유지).
 *
 * ## ⚠️ 세션559 말미 정정 — 첫 판에 1,090곳이 영구 보존되고 있었다
 *
 * 처음엔 "총세대수를 넘는 것만 오염"으로 봤는데, **매물 유래 값은 대부분 세대수 이내**라
 * `unsold <= units` 조건에 걸려 **"유효한 기존 값"으로 분류돼 영원히 안 덮어써졌다.**
 * 적대검증이 실제로 돌려 확인: 매물 유래 의심 1,090곳 중 **1,090곳(100%)을 건너뛰었다.**
 * 그중 **196곳은 미분양률 15% 초과**로 안전 점수를 깎는 중이었다
 * (두산위브 트리니뷰 구명역: **31세대인데 미분양 30**(=매물 30건) = 96.8%).
 *
 * PR #547 본문에 "1,090곳은 KOSIS 가 다음 회차에 덮어쓴다"고 적은 것은 **사실이 아니었다.**
 *
 * ## 지금 규칙
 * · `naver_sell_count` 는 판정에 쓰지 않는다 — **단, 값이 정확히 같으면 매물 유래로 본다**(아래)
 * · `unsold > units` → 오염값, 덮어쓴다
 * · **`unsold === naver_sell_count` → 매물 유래, 덮어쓴다** (세션559 말미 추가)
 * · 나머지 유효한 기존 값(청약홈 단지별 실측)은 존중한다
 *
 * ⚠️ **우연 일치 위험**: `unsold` 가 1~3 처럼 작으면 진짜 미분양이 매물 수와 우연히 같을 수 있다
 * (실측 166곳). 그래도 덮어쓰는 쪽을 택한 이유 — KOSIS 공식 통계가 매물 수보다 정확하므로
 * 덮어써서 손해 볼 게 없다. 반대로 남겨 두면 매물 수가 미분양으로 계속 행세한다.
 *
 * 세션567: 세종(gu=null)은 이전엔 이 함수가 통째로 건너뛰었지만, 이제 apartments 쪽에서
 * `resolveKosisGuKey` 가 세종을 "세종시" 키로 판정하므로 **세종을 더 이상 무조건 건너뛰지 않는다**
 * (gu=null 이어도 region==="세종" 이면 통과시킨다). 나머지 검사(총세대수 초과·매물 유래 등)는
 * 그대로 적용된다.
 *
 * @param {{ unsold: number | null; units: number | null; region: string | null; gu: string | null; naver_sell_count?: number | null }} apt
 * @returns {boolean} true 면 이 단지는 KOSIS 로 채우지 않는다
 */
export function shouldSkipKosisFill(apt) {
  const guOk = !!apt.gu || apt.region === "세종"; // 세션567: 세종은 gu=null 이 정상 구조
  if (!apt.region || !guOk || !apt.units || apt.units <= 1) return true;
  // ⚠️ `unsold === 0` 은 **"다 팔렸다"는 단지별 실측**이다 — 값 없음이 아니다(세션559 말미 정정).
  //    옛 코드는 `<= 0` 이라 완판 91곳을 구 단위 추정치로 덮어썼다. 그건 이 수집기가 내세운
  //    원칙("단지별 실측이 구 단위 비례배분보다 정확하다")과 정면으로 어긋난다.
  //    ⚠️ 다만 `hideNoUnsold`(기본 켜짐)가 `unsold > 0` 만 목록에 남기므로 이 113곳은
  //    손님 목록에 안 뜬다 — 그건 "미분양 단지 목록"이라는 화면 성격상 의도된 동작이다.
  if (apt.unsold == null) return false; // 진짜 값 없음 → 채운다
  if (apt.unsold === 0) return true;    // 완판 실측 → 존중
  // 총세대수를 넘는 미분양은 오염값이다 — 덮어쓴다(= 건너뛰지 않는다)
  if (apt.unsold > apt.units) return false;
  // 매물 수와 정확히 같으면 매물이 흘러든 것이다 — 덮어쓴다
  if (apt.naver_sell_count != null && apt.unsold === apt.naver_sell_count) return false;
  return true; // 그 밖의 유효한 기존 값(청약홈 실측)은 존중
}

/**
 * 단지의 (region, gu)를 KOSIS 시군구 키로 옮긴다 — "시 구" 두 단어 표기를 "시" 로,
 * 세종(gu=null)을 "세종시" 로 판정한다. **시도 합계로 폴백하지 않는다**(사장님 결정 세션567) —
 * 못 맞추면 null 을 돌려주고 호출자가 skip 한다.
 *
 * ## 왜 필요한가
 * KOSIS `DT_MLTM_2082` 는 경기·충남·충북·경북·경남·전북에서 시군구를 **시 단위**로만
 * 준다("천안시=5100", "수원시=55") — 우리 `apartments.gu` 는 세션95 화성 방어선 이후
 * "천안시 동남구"처럼 **시+일반구 두 단어**(34쌍 494곳)로 저장돼 있어 그대로는 못 맞춘다.
 * 옛 코드는 이걸 못 맞추면 **시도 전체 합계**를 그 구 하나에 몰아줬다(천안 동남구가
 * 충남 미분양의 87.9%를 받는 식) — 삭제 대상 결함.
 *
 * ## 판정 순서
 * 1. `guMap[gu]` 정확 일치 → 그대로
 * 2. gu 가 두 단어 이상이고 첫 토큰이 `guMap` 에 있으면 → 첫 토큰(시 단위)
 * 3. region === "세종" 이고 gu 가 비어 있으면 → "세종시"(guMap 에 있을 때만)
 * 4. 그 밖 → null
 *
 * `hasOwnProperty` 로 조회한다 — `guMap?.[gu]` 는 `gu` 가 `"constructor"`·`"toString"`
 * 이면 프로토타입 체인의 **함수를 돌려주는 함정**이 있다([[admin-district-code-reform]] §3).
 *
 * @param {string | null | undefined} region
 * @param {string | null | undefined} gu
 * @param {Record<string, number> | undefined} guMap KOSIS 응답의 그 시도 시군구별 맵(키 = C2_NM)
 * @returns {string | null} guMap 에서 그대로 조회 가능한 키, 못 맞추면 null
 */
export function resolveKosisGuKey(region, gu, guMap) {
  if (!guMap) return null;
  const has = (/** @type {string} */ k) => Object.prototype.hasOwnProperty.call(guMap, k);
  if (gu && has(gu)) return gu;
  if (gu) {
    const first = gu.trim().split(/\s+/)[0];
    if (first && first !== gu && has(first)) return first;
  }
  if (!gu && region === "세종" && has("세종시")) return "세종시";
  return null;
}

/**
 * apartments 배분 계획을 순수 함수로 산출한다 (세션567 신설 — 시험 가능하게 분리).
 *
 * 각 단지의 처리 결과를 action 으로 분류한다:
 * - "write": KOSIS 로 새로 채운다(estimated/rate 계산됨)
 * - "hold_ge50": 새 추정 미분양률이 50% 이상이라 신뢰할 수 없어 쓰지 않는다(사장님 결정)
 * - "skip_preserved": shouldSkipKosisFill 이 "존중"으로 판정한 기존 값 — **새 추정치는 참고용으로 함께 기록**
 * - "skip_lease": 임대형(presale_type) — 대상에서 제외
 * - "skip_no_match": resolveKosisGuKey 가 매칭 못 함(시도 합계로 폴백하지 않음)
 * - "skip_kosis_zero": KOSIS 값이 0 이하이고 매물 유래가 아님 — 단순 매칭 없음과 구분(세션567 추가분)
 * - "clear_listing_derived": 매물 유래 값인데 KOSIS 가 덮지 못함(0/거의 0/추정 0/100%초과 아님) → 비운다(null, 세션567 추가분)
 * - "skip_no_estimate": guUnsold 는 있으나 calcProportionalUnsold 가 null(비정상 비율 등) — 매물 유래가 아니거나, 100% 초과처럼 비우면 안 되는 경우
 * - "skip_invalid": shouldSkipKosisFill 이 true 이고 값 자체가 없거나 분모가 안 되는 경우
 *
 * ⚠️ 임대형은 **대상에서도 분모(totalUnitsInGu)에서도** 제외한다(사장님 결정) — 그래서
 * `unitsByGu` 는 이 함수 안에서 임대형을 거른 뒤 계산한다.
 *
 * ## 세션567 추가분 — "매물 유래인데 KOSIS 가 덮지 못하는 곳" 은 비운다(null)
 *
 * 세션559 규칙(`unsold === naver_sell_count` 면 매물 유래로 보고 덮어씀)은 KOSIS 값이
 * 있어야만 작동한다. KOSIS 가 0 또는 거의 0(반올림 추정이 0 이하) 이거나, 추정이 100% 를
 * 넘어 못 쓰는 경우는 매물 유래 값이 **그대로 남는다.** 사장님 결정(2026-09-24):
 * 매물 유래 값은 미분양이 아니므로 **0 으로 넣지 않고 null 로 비운다** — 0 은
 * `shouldSkipKosisFill` 이 "완판 실측"으로 영구 보존하기 때문이다. null 로 비우면
 * `hideNoUnsold` 목록에서 빠지고, 다음 달 KOSIS 값이 생기면 자동 재채움된다.
 *
 * 단, 추정이 **100% 를 넘어** 못 쓰는 경우(KOSIS 가 오히려 많다고 말하는 경우)는 비우지
 * 않는다 — 그건 "KOSIS 값이 없다"가 아니라 "KOSIS 값이 이상하다"이므로 `skip_no_estimate`
 * 그대로 둔다(실측 1곳 `ah-2022910258`).
 *
 * @param {{
 *   apartments: Array<{ id: string; name: string; region: string | null; gu: string | null; units: number | null; unsold: number | null; unsold_rate: number | null; naver_sell_count: number | null; presale_type?: string | null }>;
 *   unsoldByRegionGu: UnsoldByRegionGu;
 * }} params
 * @returns {Array<{
 *   id: string; name: string; region: string | null; gu: string | null;
 *   action: "write" | "hold_ge50" | "skip_preserved" | "skip_lease" | "skip_no_match" | "skip_kosis_zero" | "clear_listing_derived" | "skip_no_estimate" | "skip_invalid";
 *   kosisKey: string | null;
 *   guUnsold: number | null;
 *   totalUnitsInGu: number | null;
 *   newEstimate: number | null;
 *   newRate: number | null;
 *   currentUnsold: number | null;
 *   currentRate: number | null;
 * }>}
 */
export function planUnsoldUpdates({ apartments, unsoldByRegionGu }) {
  // 1단계 — 각 단지의 kosisKey 를 먼저 계산한다(분모를 그 키 단위로 모으기 위해).
  // "천안시 동남구"·"천안시 서북구" 는 서로 다른 gu 지만 같은 kosisKey("천안시")로 모여야
  // "분모는 그 시 전체"(사장님 결정 ①)가 성립한다. 임대형은 분모에서도 제외(사장님 결정 ④).
  /** @type {Map<string, string | null>} apt.id → kosisKey */
  const keyByAptId = new Map();
  /** @type {Record<string, number>} kosisKey 단위 분모("${region}::${kosisKey}") */
  const unitsByKosisKey = {};
  for (const apt of apartments) {
    if (!apt.region || !apt.units) { keyByAptId.set(apt.id, null); continue; }
    const guMap = unsoldByRegionGu[apt.region];
    const kosisKey = resolveKosisGuKey(apt.region, apt.gu, guMap);
    keyByAptId.set(apt.id, kosisKey);
    if (!kosisKey || isLeasePresale(apt.presale_type)) continue;
    const denomKey = `${apt.region}::${kosisKey}`;
    unitsByKosisKey[denomKey] = (unitsByKosisKey[denomKey] || 0) + apt.units;
  }

  /** @type {ReturnType<typeof planUnsoldUpdates>} */
  const plan = [];

  for (const apt of apartments) {
    /** @type {ReturnType<typeof planUnsoldUpdates>[number]} */
    const base = {
      id: apt.id, name: apt.name, region: apt.region, gu: apt.gu,
      action: "skip_invalid",
      kosisKey: null, guUnsold: null, totalUnitsInGu: null,
      newEstimate: null, newRate: null,
      currentUnsold: apt.unsold, currentRate: apt.unsold_rate,
    };

    if (isLeasePresale(apt.presale_type)) {
      plan.push({ ...base, action: "skip_lease" });
      continue;
    }

    const guMap = apt.region ? unsoldByRegionGu[apt.region] : undefined;
    const kosisKey = keyByAptId.get(apt.id) ?? null;
    if (!kosisKey) {
      plan.push({ ...base, action: "skip_no_match" });
      continue;
    }

    // 세션567 추가분 — 매물이 흘러든 값인지(사장님 결정: 이 경우만 KOSIS 부재를 null 로 비운다).
    // shouldSkipKosisFill 의 "매물 수와 정확히 같으면 매물 유래" 판정과 같은 조건을 그대로 쓴다.
    const listingDerived = !!(apt.unsold != null && apt.unsold > 0 && apt.naver_sell_count != null && apt.unsold === apt.naver_sell_count);

    const guUnsold = /** @type {Record<string, number>} */ (guMap)[kosisKey];
    if (guUnsold == null) {
      plan.push({ ...base, action: "skip_no_match", kosisKey });
      continue;
    }
    if (guUnsold <= 0) {
      // KOSIS 값이 0(또는 이하) — 매물 유래면 비운다, 아니면 "매칭은 됐으나 값이 0"으로 구분.
      plan.push({ ...base, action: listingDerived ? "clear_listing_derived" : "skip_kosis_zero", kosisKey, guUnsold });
      continue;
    }

    // 비례배분 분모 — 같은 kosisKey 로 모인 시 전체(비임대) 합. 세션567 사장님 결정 ①.
    const denomKey = `${apt.region}::${kosisKey}`;
    const totalUnitsInGu = unitsByKosisKey[denomKey] || apt.units || 0;

    const result = calcProportionalUnsold(guUnsold, apt.units, totalUnitsInGu);
    if (!result) {
      // 세션567 추가분 — 반올림한 원추정이 0 이하(거의 0)이고 매물 유래면 비운다.
      // 단 100% 초과처럼 "KOSIS 값이 이상해서" null 인 경우는 비우지 않는다(사장님 결정).
      const rawEstimate = totalUnitsInGu > 0 && apt.units ? Math.round(guUnsold * (apt.units / totalUnitsInGu)) : null;
      if (listingDerived && rawEstimate != null && rawEstimate <= 0) {
        plan.push({ ...base, action: "clear_listing_derived", kosisKey, guUnsold, totalUnitsInGu });
        continue;
      }
      plan.push({ ...base, action: "skip_no_estimate", kosisKey, guUnsold, totalUnitsInGu });
      continue;
    }

    const { estimated, unsoldRate } = result;
    const skip = shouldSkipKosisFill(apt);

    if (skip) {
      // 보존되는 기존 값이라도 새 추정치는 비교용으로 함께 기록한다(사장님 결정).
      plan.push({
        ...base, action: "skip_preserved", kosisKey, guUnsold, totalUnitsInGu,
        newEstimate: estimated, newRate: unsoldRate,
      });
      continue;
    }

    if (unsoldRate >= UNRELIABLE_RATE_THRESHOLD) {
      plan.push({
        ...base, action: "hold_ge50", kosisKey, guUnsold, totalUnitsInGu,
        newEstimate: estimated, newRate: unsoldRate,
      });
      continue;
    }

    plan.push({
      ...base, action: "write", kosisKey, guUnsold, totalUnitsInGu,
      newEstimate: estimated, newRate: unsoldRate,
    });
  }

  return plan;
}

// 세션 395: try/catch/finally 하드닝 — KOSIS 실패가 collector_runs 에 0행으로
// 남는 사각 정정 (PR #97 collect-regional-economy 패턴 답습).
export async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const impactOutArg = process.argv.find((a) => a.startsWith("--impact-out="));
  const impactOutPath = impactOutArg ? impactOutArg.slice("--impact-out=".length) : null;
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  let ok = 0;
  let errorMessage = /** @type {string | undefined} */ (undefined);
  try {
    if (!KOSIS_KEY) throw new Error("KOSIS_KEY not configured");

    const isInterrupted = setupGracefulShutdown(PHASE);  // 세션 321: graceful shutdown
    const sb = getSupabase();

    // 월간 데이터 조회 (DT_MLTM_2082 시군구별 미분양, 1~2개월 지연)
    const now = new Date();
    const endMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const startMonth = `${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, "0")}`;

    log(PHASE, `KOSIS 미분양 조회: ${startMonth} ~ ${endMonth}`);

    // KOSIS API 호출
    const params = new URLSearchParams({
      method: "getList",
      apiKey: KOSIS_KEY,
      orgId: "116",
      tblId: "DT_MLTM_2082",
      itmId: "ALL",
      objL1: "ALL",
      objL2: "ALL",
      prdSe: "M",
      startPrdDe: startMonth,
      endPrdDe: endMonth,
      format: "json",
      jsonVD: "Y",
    });

    // 세션118: raw https.request → fetchWithRetry (429/500/503 + ECONNRESET 지수 백오프 3회).
    // AbortSignal.timeout(30s)은 fetchWithRetry 내부에 포함. 에러 prefix `KOSIS ...` 유지.
    const apiUrl = `https://kosis.kr/openapi/Param/statisticsParameterData.do?${params}`;
    let data;
    try {
      const res = await fetchWithRetry(apiUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
      try {
        data = await res.json();
      } catch {
        throw new Error("JSON 파싱 실패");
      }
    } catch (err) {
      throw new Error(`KOSIS ${err instanceof Error ? err.message : String(err)}`);
    }
    if (data.err) throw new Error(`KOSIS 에러: ${data.errMsg || data.err}`);

    const rows = Array.isArray(data) ? data : [];
    log(PHASE, `KOSIS 응답: ${rows.length}건`);

    if (rows.length === 0) {
      log(PHASE, "데이터 없음 — 종료");
      return;
    }

    const unsoldByRegionGu = parseKosisRows(rows);
    const regionTotals = aggregateRegionTotals(unsoldByRegionGu);

    log(PHASE, `시도별 미분양: ${Object.entries(regionTotals).map(([r, v]) => `${r}=${v}`).join(", ")}`);

    // 1. regions 테이블 업데이트
    // 세션549: 무정렬 select 는 2,249행 표에서 1,000행만 매칭한다(unordered-pagination-loses-rows.md §1).
    // selectAll 은 조회 실패 시 throw 하므로, 기존 fail-open(로그만 남기고 계속) 의미를 try/catch 로 보존한다.
    /** @type {Array<{ id: string; region: string; gu: string | null; regional_unsold: number | null }> | null} */
    let regions = null;
    /** @type {{ message: string } | null} */
    let rErr = null;
    try {
      regions = /** @type {any} */ (
        await selectAll((s) => s.from("regions").select("id, region, gu, regional_unsold"), sb, "id")
      );
    } catch (e) {
      rErr = { message: e instanceof Error ? e.message : String(e) };
    }

    let regUpdated = 0;
    if (rErr) {
      logError(PHASE, `regions 조회 실패: ${rErr.message}`);
    } else {
      for (const reg of /** @type {Array<{ id: string; region: string; gu: string | null; regional_unsold: number | null }>} */ (regions)) {
        if (isInterrupted()) break;  // 세션 321: graceful shutdown
        const guMap = unsoldByRegionGu[reg.region];

        // 세션567: 시군구 매칭도 resolveKosisGuKey 로 통일 — 시도 합계 폴백 삭제.
        // gu 없는 시도 행(reg.gu === null)만 시도 합계를 쓴다.
        /** @type {number | null} */
        let unsoldValue = null;
        if (reg.gu) {
          const key = resolveKosisGuKey(reg.region, reg.gu, guMap);
          if (key) unsoldValue = /** @type {Record<string, number>} */ (guMap)[key] ?? null;
        } else if (regionTotals[reg.region] != null) {
          unsoldValue = regionTotals[reg.region];
        }

        if (unsoldValue == null || unsoldValue === reg.regional_unsold) continue;

        if (dryRun) {
          log(PHASE, `  [DRY-RUN] regions ${reg.region} ${reg.gu || ""}: ${reg.regional_unsold} → ${unsoldValue}`);
          regUpdated++;
          continue;
        }

        const { error } = await sb.from("regions").update({
          regional_unsold: unsoldValue,
        }).eq("id", reg.id);

        if (error) logError(PHASE, `  regions ${reg.id} UPDATE 실패: ${error.message}`);
        else regUpdated++;
      }
      log(PHASE, `regions 갱신: ${regUpdated}건`);
    }

    // 2. apartments unsold 추정 (KOSIS 비례배분)
    // 세션549: 무정렬 select 는 3,068행 표에서 1,000행만 매칭한다(unordered-pagination-loses-rows.md §1).
    // 세션566: apartments 는 selectAll(..., "id") 로 전수 확보한다(1,000행 컷 수리).
    /** @typedef {{ id: string; name: string; region: string | null; gu: string | null; units: number | null; unsold: number | null; unsold_rate: number | null; naver_sell_count: number | null; presale_type: string | null }} AptRow */
    /** @type {AptRow[]} */
    let apartmentsTyped;
    try {
      apartmentsTyped = /** @type {any} */ (
        await selectAll((s) => s.from("apartments").select("id, name, region, gu, units, unsold, unsold_rate, naver_sell_count, presale_type"), sb, "id")
      );
    } catch (e) {
      logError(PHASE, `apartments 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const plan = planUnsoldUpdates({ apartments: apartmentsTyped, unsoldByRegionGu });

    /** @type {Record<string, number>} */
    const actionCounts = {};
    for (const p of plan) actionCounts[p.action] = (actionCounts[p.action] || 0) + 1;
    log(PHASE, `apartments 계획: ${Object.entries(actionCounts).map(([a, n]) => `${a}=${n}`).join(", ")}`);

    const heldIds = plan.filter((p) => p.action === "hold_ge50").map((p) => `${p.name}(${p.id})`);
    if (heldIds.length > 0) {
      log(PHASE, `[보류·미신뢰(≥${UNRELIABLE_RATE_THRESHOLD}%)] ${heldIds.length}건 — 쓰지 않음: ${heldIds.join(", ")}`);
    }

    let aptUpdated = 0;
    for (const p of plan) {
      if (p.action !== "write") continue;

      if (dryRun) {
        log(PHASE, `  [DRY-RUN] ${p.name} (${p.region} ${p.gu}): unsold=${p.newEstimate}, rate=${p.newRate}%`);
        aptUpdated++;
        continue;
      }

      const { error } = await sb.from("apartments").update({
        unsold: p.newEstimate,
        unsold_rate: p.newRate,
        updated_at: new Date().toISOString(),
      }).eq("id", p.id);

      if (error) logError(PHASE, `  ${p.name} UPDATE 실패: ${error.message}`);
      else aptUpdated++;
    }

    log(PHASE, `apartments 미분양 추정 갱신: ${aptUpdated}건`);

    // 세션567 추가분 — 매물 유래 값인데 KOSIS 가 덮지 못하는 곳은 null 로 비운다(사장님 결정).
    // 0 으로 넣지 않는 이유: shouldSkipKosisFill 이 0 을 "완판 실측"으로 영구 보존하기 때문.
    let clearedListingDerived = 0;
    for (const p of plan) {
      if (p.action !== "clear_listing_derived") continue;

      if (dryRun) {
        log(PHASE, `  [DRY-RUN][비움·매물유래] ${p.name} (${p.region} ${p.gu}): unsold ${p.currentUnsold} → null`);
        clearedListingDerived++;
        continue;
      }

      const { error } = await sb.from("apartments").update({
        unsold: null,
        unsold_rate: null,
        updated_at: new Date().toISOString(),
      }).eq("id", p.id);

      if (error) logError(PHASE, `  ${p.name} 비움 UPDATE 실패: ${error.message}`);
      else clearedListingDerived++;
    }

    log(PHASE, `매물 유래 비움: ${clearedListingDerived}건`);

    if (impactOutPath) {
      try {
        writeFileSync(impactOutPath, JSON.stringify({ generatedAt: new Date().toISOString(), actionCounts, plan }, null, 2), "utf8");
        log(PHASE, `[IMPACT] 계획 ${plan.length}행 저장: ${impactOutPath}`);
      } catch (e) {
        logError(PHASE, `impact-out 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 3. unsold_history 시계열 upsert (세션134, 방향 A)
    // KOSIS 단일 API 호출 응답(3개월 범위)을 재파싱하여 월별 시계열 저장.
    // API 재호출 아님 → 쿼터 증가 0.
    // ⚠️ 이 시계열은 **순수 KOSIS 비례배분 계열**이다 — apartments 쪽 판정(skip_preserved 청약홈 실측 존중 ·
    //    clear_listing_derived 매물 유래 비움)을 적용하지 않는다(설계). 그래서 보존 값을 가진 단지는 헤드라인
    //    unsold 와 차트 계열이 다를 수 있다(세션567 검사관 확인 — 보존 138곳 조사 때 함께 본다).
    // 세션567: 시군구 매칭은 resolveKosisGuKey 로 통일(시 단위·세종 포함) — 임대형 제외,
    // 새 추정 미분양률 50% 이상은 저장하지 않는다(사장님 결정).
    const allMonthsMap = parseKosisRowsAllMonths(rows);
    // 세션567: 각 단지의 kosisKey 를 먼저 계산해 그 키 단위로 분모를 모은다(§ planUnsoldUpdates
    // 와 동일한 이유 — "천안시 동남구"·"천안시 서북구" 가 같은 "천안시" 분모를 공유해야 한다).
    // 분모에서도 임대형 제외(사장님 결정 ④).
    /** @type {Map<string, string | null>} apt.id → kosisKey(월별 맵 기준) */
    const historyKeyByAptId = new Map();
    /** @type {Record<string, number>} */
    const unitsByGuForHistory = {};
    for (const apt of apartmentsTyped) {
      if (!apt.region || !apt.units || apt.units <= 1) { historyKeyByAptId.set(apt.id, null); continue; }
      const monthMap = allMonthsMap[apt.region];
      const kosisKey = monthMap ? resolveKosisGuKey(apt.region, apt.gu, /** @type {any} */ (monthMap)) : null;
      historyKeyByAptId.set(apt.id, kosisKey);
      if (!kosisKey || isLeasePresale(apt.presale_type)) continue;
      const denomKey = `${apt.region}::${kosisKey}`;
      unitsByGuForHistory[denomKey] = (unitsByGuForHistory[denomKey] || 0) + apt.units;
    }

    /** @type {Array<{ apartment_id: string; base_month: string; unsold_count: number; post_completion_unsold: number | null; change: number | null; recorded_at: string }>} */
    const historyRows = [];
    let heldHistoryCount = 0;
    const todayDate = today(); // KST 고정 (루프 밖 1회 — 자정 경계 중복 0)
    for (const apt of apartmentsTyped) {
      if (!apt.region || !apt.units || apt.units <= 1) continue;
      if (isLeasePresale(apt.presale_type)) continue;

      const monthMap = allMonthsMap[apt.region];
      if (!monthMap) continue;
      const kosisKey = historyKeyByAptId.get(apt.id) ?? null;
      if (!kosisKey) continue;
      const periodMap = /** @type {any} */ (monthMap)[kosisKey];
      if (!periodMap) continue;

      const denomKey = `${apt.region}::${kosisKey}`;
      const totalUnitsInGu = unitsByGuForHistory[denomKey] || apt.units;

      for (const [period, guUnsold] of Object.entries(periodMap)) {
        const result = calcProportionalUnsold(/** @type {number} */ (guUnsold), apt.units, totalUnitsInGu);
        if (!result) continue;
        if (result.unsoldRate >= UNRELIABLE_RATE_THRESHOLD) { heldHistoryCount++; continue; }
        historyRows.push({
          apartment_id: apt.id,
          base_month: period,
          unsold_count: result.estimated,
          post_completion_unsold: null,
          change: null,
          recorded_at: todayDate,
        });
      }
    }

    if (heldHistoryCount > 0) log(PHASE, `unsold_history 보류(≥${UNRELIABLE_RATE_THRESHOLD}%): ${heldHistoryCount}건 — 저장 안 함`);

    if (dryRun) {
      log(PHASE, `[DRY-RUN] unsold_history: ${historyRows.length}건 예상`);
    } else if (historyRows.length > 0) {
      const inserted = await upsertBatch("unsold_history", historyRows, "apartment_id,base_month", 500, sb);
      log(PHASE, `unsold_history 저장: ${inserted}건`);
    } else {
      log(PHASE, "unsold_history 저장: 0건 (대상 없음)");
    }

    // 4. API 쿼터 기록 (KOSIS 단일 호출)
    if (!dryRun) await recordApiQuota(PHASE, "KOSIS_KEY", 1);
    ok = regUpdated + aptUpdated + clearedListingDerived;

    log(PHASE, "\n=== 완료 ===");
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await recordCollectorRun(PHASE, errorMessage
      ? { ok, status: "failure", errorMessage }
      : { ok });
  }
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((/** @type {unknown} */ err) => {
  logError(PHASE, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
