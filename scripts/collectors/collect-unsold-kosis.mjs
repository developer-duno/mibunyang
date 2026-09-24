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
 *
 * 청약홈(applyhome) 값 만료 C6(세션569): applyhome 값은 공고일(unsold_as_of) + 6개월까지만 존중하고,
 * 지나면 KOSIS 가 덮는다. 공고일이 비면 존중을 유지하되 APPLYHOME_NO_DATE 마커로 기록한다
 * (규칙 정본 = shouldSkipKosisFill·planUnsoldUpdates 머리말, 기간·판정 함수 = _shared.mjs isApplyhomeExpired).
 */
import { loadEnv, getSupabase, log, logError, REGION_MAP, resolveRegionName, fetchWithRetry, upsertBatch, recordApiQuota, recordCollectorRun, setupGracefulShutdown, today, selectAll, isApplyhomeExpired, APPLYHOME_EXPIRY_MONTHS, formatApplyhomeNoDate, joinRunMessage } from "./_shared.mjs";
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
 * KOSIS 공식 미분양 비례배분을 **건너뛸지** 판정 (세션559 신설, 세션568-3 규칙 전면 개정)
 *
 * ## 세션568-3 — 사장님 결정으로 판정 축이 "휴리스틱"에서 "출처 칸"으로 바뀌었다
 *
 * 옛 판정(세션559~568-2)은 `naver_sell_count`·총세대수 초과 등 **값의 모양으로 매물 유래를
 * 추측**했다. 그런데 그 휴리스틱은 이 수집기 자신이 쓴 KOSIS 값도 우연히 통과시켜(세대수 이하·
 * 매물 수와 다름) 862곳이 다음 회차부터 동결되는 사고(세션568)를 냈고, 정정한 조건(H1/H2)도
 * "매칭 실패를 0 취급"하는 새 위험을 낳았다(세션568-2). 사장님이 **원칙 자체를 바꿨다**(2026-09-24
 * 3차): "출처 모르는 옛 값(NULL, 값>0)도 이제 KOSIS 가 덮는다. KOSIS 가 0 이라 말하면 null 로
 * 비우지 말고 0 을 쓴다(위험 점수가 '모름'(40)이 되는 게 더 나쁘다)." 청약홈(`applyhome`)만 계속
 * 존중한다.
 *
 * ## 지금 규칙(존중 여부만 — "무엇을 쓸지"는 planUnsoldUpdates 가 정한다)
 * 1. 지역·구·세대수(≤1) 무효 → 존중(=skip, 채울 재료가 없다)
 * 2. `unsold_source === "applyhome"` → 존중(청약홈 단지별 실측은 구 단위 비례배분보다 정확) — **단 C6(세션569)**:
 *    공고일(`unsold_as_of`) + 6개월이 지났으면 존중하지 않는다(KOSIS 가 정한다). 공고일이 비었으면
 *    판정할 수 없으므로 존중을 유지한다(호출부가 `skip_applyhome_no_date` 로 세고 경고 마커를 남긴다).
 * 3. `unsold === 0 && unsold_source == null` → 존중(옛 완판 실측 — 출처가 없던 시절의 값이라도
 *    "0"은 계측이지 빈칸이 아니다. **출처가 kosis/applyhome 이면 이 규칙에 해당 안 됨** — applyhome
 *    은 2번에서 이미 걸러졌고, kosis 는 자기 값이므로 KOSIS 최신 회차가 덮는다(자기잠금 방지))
 * 4. 그 밖(출처 kosis·출처 NULL 인 값>0·값 자체 없음) → **KOSIS 가 정한다**(존중 안 함, false)
 *
 * @param {{ unsold: number | null; units: number | null; region: string | null; gu: string | null; naver_sell_count?: number | null; unsold_source?: string | null; unsold_as_of?: string | null }} apt
 * @param {Date} [now] 만료 판정 기준 시각 — 호출부가 넣는다(시험이 실제 시각에 기대지 않게). 없으면 지금.
 * @returns {boolean} true 면 이 단지는 KOSIS 로 채우지 않는다(기존 값 존중)
 */
export function shouldSkipKosisFill(apt, now = new Date()) {
  const guOk = !!apt.gu || apt.region === "세종"; // 세션567: 세종은 gu=null 이 정상 구조
  if (!apt.region || !guOk || !apt.units || apt.units <= 1) return true;
  // 청약홈 실측은 공고일 + 6개월까지만 존중(C6). 공고일이 없으면(null) 판정 불가 → 존중 유지.
  if (apt.unsold_source === "applyhome") return applyhomeStatus(apt, now) !== "expired";
  // ⚠️ `unsold === 0` 은 옛 "다 팔렸다"는 단지별 실측이다 — 단, **출처가 없을 때만**(NULL).
  //    출처가 kosis 면 자기 자신이 쓴 0 이므로 최신 KOSIS 회차가 덮어써야 한다(자기잠금 방지,
  //    검사관 M3 지적). applyhome 은 위 2번에서 이미 걸러졌다.
  if (apt.unsold === 0 && apt.unsold_source == null) return true;
  return false; // 그 밖(kosis 출처·NULL 출처 값>0·값 없음)은 전부 KOSIS 가 정한다
}

/**
 * applyhome 값의 만료 상태(세션569 C6). DB 접근 없는 순수 함수.
 * @param {{ unsold_source?: string | null; unsold_as_of?: string | null }} apt
 * @param {Date} now
 * @returns {"not_applyhome" | "no_date" | "valid" | "expired"}
 */
export function applyhomeStatus(apt, now) {
  if (apt.unsold_source !== "applyhome") return "not_applyhome";
  const expired = isApplyhomeExpired(apt.unsold_as_of, now, APPLYHOME_EXPIRY_MONTHS);
  if (expired == null) return "no_date";
  return expired ? "expired" : "valid";
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
 * apartments 배분 계획을 순수 함수로 산출한다 (세션567 신설 — 시험 가능하게 분리. 세션568-3 규칙 전면 개정).
 *
 * ## 판정 순서 (사장님 결정 2026-09-24 3차 — 위에서부터)
 * 1. 무효(지역·구·세대수≤1) → `skip_invalid`
 * 2. 임대형(presale_type) → `skip_lease`(분모에서도 제외)
 * 3. `unsold_source === "applyhome"` → `skip_preserved`(존중). **C6(세션569)**: 공고일 + 6개월이 지났으면
 *    존중하지 않고 5번으로 간다(행에 `applyhomeExpired: true` 표시 — 전이표에서 따로 센다). 공고일이
 *    비었으면 `skip_applyhome_no_date`(존중 유지 + 경고 마커 APPLYHOME_NO_DATE).
 * 4. `unsold === 0 && unsold_source == null`(옛 완판 실측) → `skip_preserved`
 * 5. 그 밖(출처 kosis·NULL 출처 값>0·값 없음) → **KOSIS 가 정한다**:
 *    a. `kosisKey` 없음 또는 그 구 데이터 자체가 응답에 없음 → `skip_no_match`(값 유지) + 경고
 *    b. `guUnsold <= 0` → `write_zero`(0 을 쓴다 + 출처 kosis) — 비우면 위험점수가 '모름'(40)이 되어 더 나쁘다(사장님 결정)
 *    c. 반올림 추정이 0 이하(합계>0인데 비례배분 결과가 거의 0) → `write_zero`(같은 원칙)
 *    d. 추정률 > 100%(비정상) → `skip_no_estimate`(값 유지)
 *    e. 추정률 ≥ 50% → `hold_ge50`(값 유지, 신뢰 불가)
 *    f. 그 밖 → `write`(추정치를 쓴다 + 출처 kosis)
 *
 * `clear_listing_derived`·`clear_kosis_stale`(null 로 비우는 action)은 **폐지**됐다 — 전부 0 쓰기
 * (`write_zero`)로 대체됐다. 매물 유래 판정(`listingDerived`, 세션567~568-2)도 **삭제**했다:
 * applyhome 이 3번에서 먼저 존중되므로 그 경로에선 자연히 해결되고, kosis·NULL 출처는 이제
 * "매물처럼 보이는가"가 아니라 "출처가 무엇인가"만으로 갈린다(더 단순하고 더 안전하다).
 *
 * ⚠️ **검사관 H1(매칭 실패를 0 취급하지 않는다)은 유지**된다 — a 는 "그 구 응답 자체가 없다"이고
 * b/c 는 "그 구 응답이 왔고 값이 0"이다. 전혀 다른 사건이라 절대 섞지 않는다.
 *
 * ⚠️ **검사관 M3(자기잠금 방지)**: `unsold === 0` 존중(규칙 4)은 `unsold_source == null` 일 때만
 * 적용된다. kosis 출처의 0(write_zero 로 쓴 값)은 이 규칙에 안 걸려 다음 회차가 다시 갱신한다
 * (`shouldSkipKosisFill` 이 kosis 출처를 항상 false 로 돌려주므로).
 *
 * @param {{
 *   apartments: Array<{ id: string; name: string; region: string | null; gu: string | null; units: number | null; unsold: number | null; unsold_rate: number | null; naver_sell_count: number | null; presale_type?: string | null; unsold_source?: string | null; unsold_as_of?: string | null }>;
 *   unsoldByRegionGu: UnsoldByRegionGu;
 *   now?: Date;
 * }} params  now = applyhome 만료 판정 기준 시각(없으면 지금 — main 은 항상 넣는다)
 * @returns {Array<{
 *   id: string; name: string; region: string | null; gu: string | null;
 *   action: "write" | "write_zero" | "hold_ge50" | "skip_preserved" | "skip_applyhome_no_date" | "skip_lease" | "skip_no_match" | "skip_no_estimate" | "skip_invalid";
 *   kosisKey: string | null;
 *   guUnsold: number | null;
 *   totalUnitsInGu: number | null;
 *   newEstimate: number | null;
 *   newRate: number | null;
 *   currentUnsold: number | null;
 *   currentRate: number | null;
 *   currentSource: string | null;
 *   applyhomeExpired: boolean;
 * }>}
 */
export function planUnsoldUpdates({ apartments, unsoldByRegionGu, now = new Date() }) {
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
      currentSource: apt.unsold_source ?? null,
      applyhomeExpired: applyhomeStatus(apt, now) === "expired",
    };

    // 규칙 1 — 무효(지역·구·세대수<=1). shouldSkipKosisFill 도 이 조건에서 true 를 주지만,
    // 그건 "존중"(규칙3·4용)과 의미가 다르므로 skip_invalid 로 먼저 갈라낸다(검사관 지적:
    // units<=1 무효 단지가 규칙3·4 의 skip_preserved 로 잘못 섞이던 결함 수정).
    const guOkForInvalid = !!apt.gu || apt.region === "세종";
    if (!apt.region || !guOkForInvalid || !apt.units || apt.units <= 1) {
      plan.push({ ...base, action: "skip_invalid" });
      continue;
    }

    // 규칙 2 — 임대형.
    if (isLeasePresale(apt.presale_type)) {
      plan.push({ ...base, action: "skip_lease" });
      continue;
    }

    // 규칙 3·4 — shouldSkipKosisFill 이 존중으로 판정한 값(applyhome·NULL출처 완판)은 KOSIS
    // 매칭을 시도하지도 않고 그대로 존중한다. 새 추정치는 참고용으로 계산해 함께 기록한다.
    // (여기 도달했다는 것은 이미 규칙1 무효 검사를 통과했다는 뜻이다.)
    if (shouldSkipKosisFill(apt, now)) {
      const guMapForRef = apt.region ? unsoldByRegionGu[apt.region] : undefined;
      const kosisKeyForRef = keyByAptId.get(apt.id) ?? null;
      /** @type {number | null} */
      let refEstimate = null;
      /** @type {number | null} */
      let refRate = null;
      if (kosisKeyForRef && guMapForRef) {
        const guUnsoldForRef = /** @type {Record<string, number>} */ (guMapForRef)[kosisKeyForRef];
        if (guUnsoldForRef != null) {
          const denomKeyForRef = `${apt.region}::${kosisKeyForRef}`;
          const totalForRef = unitsByKosisKey[denomKeyForRef] || apt.units || 0;
          const refResult = calcProportionalUnsold(guUnsoldForRef, apt.units, totalForRef);
          if (refResult) { refEstimate = refResult.estimated; refRate = refResult.unsoldRate; }
        }
      }
      // C6 — 공고일 빈 applyhome 은 존중하되 따로 센다(조용히 넘기면 영구 동결 — 경고 마커로 올린다).
      const preservedAction = applyhomeStatus(apt, now) === "no_date" ? "skip_applyhome_no_date" : "skip_preserved";
      plan.push({ ...base, action: preservedAction, kosisKey: kosisKeyForRef, newEstimate: refEstimate, newRate: refRate });
      continue;
    }

    // 규칙 5 — 여기부터는 출처 kosis·NULL 출처 값>0·값 없음. KOSIS 가 정한다.
    const guMap = apt.region ? unsoldByRegionGu[apt.region] : undefined;
    const kosisKey = keyByAptId.get(apt.id) ?? null;

    // 5a — 매칭 실패(검사관 H1: 시도/구 응답 자체가 없다 ≠ 값이 0). 값을 유지한다.
    if (!kosisKey) {
      plan.push({ ...base, action: "skip_no_match" });
      continue;
    }
    const guUnsold = /** @type {Record<string, number>} */ (guMap)[kosisKey];
    if (guUnsold == null) {
      plan.push({ ...base, action: "skip_no_match", kosisKey });
      continue;
    }

    // 5b — 그 구 응답은 왔고 값이 0 이하. 0 을 쓴다(비우지 않는다 — 사장님 결정).
    if (guUnsold <= 0) {
      plan.push({ ...base, action: "write_zero", kosisKey, guUnsold, newEstimate: 0, newRate: 0 });
      continue;
    }

    // 비례배분 분모 — 같은 kosisKey 로 모인 시 전체(비임대) 합. 세션567 사장님 결정 ①.
    const denomKey = `${apt.region}::${kosisKey}`;
    const totalUnitsInGu = unitsByKosisKey[denomKey] || apt.units || 0;

    const result = calcProportionalUnsold(guUnsold, apt.units, totalUnitsInGu);
    if (!result) {
      // 5c — 합계는 0 초과인데 비례배분 결과(반올림)가 0 이하(단지가 그 구에서 아주 작은 비중).
      // 5d — 100% 초과(비정상)는 값을 유지한다(비우지도, 0 을 쓰지도 않는다).
      const rawEstimate = totalUnitsInGu > 0 && apt.units ? Math.round(guUnsold * (apt.units / totalUnitsInGu)) : null;
      if (rawEstimate != null && rawEstimate <= 0) {
        plan.push({ ...base, action: "write_zero", kosisKey, guUnsold, totalUnitsInGu, newEstimate: 0, newRate: 0 });
        continue;
      }
      plan.push({ ...base, action: "skip_no_estimate", kosisKey, guUnsold, totalUnitsInGu });
      continue;
    }

    const { estimated, unsoldRate } = result;

    // 5e — 추정률 50% 이상은 신뢰 못 할 만큼 커서 보류(값 유지).
    if (unsoldRate >= UNRELIABLE_RATE_THRESHOLD) {
      plan.push({
        ...base, action: "hold_ge50", kosisKey, guUnsold, totalUnitsInGu,
        newEstimate: estimated, newRate: unsoldRate,
      });
      continue;
    }

    // 5f — 정상 추정치를 쓴다.
    plan.push({
      ...base, action: "write", kosisKey, guUnsold, totalUnitsInGu,
      newEstimate: estimated, newRate: unsoldRate,
    });
  }

  return plan;
}

/**
 * KOSIS 가 단지 값을 쓸 때의 UPDATE 내용(write·write_zero 공용). DB 접근 없는 순수 함수.
 * `unsold_as_of` 는 null 로 비운다(세션569 C6 검사관) — 만료된 applyhome 행을 덮을 때 출처 kosis 인 행에
 * 옛 공고일이 남으면 감시 ⑫·다음 판정이 그 날짜를 청약홈 값의 공고일로 오해한다.
 * @param {number | null} unsold
 * @param {number | null} unsoldRate
 * @param {string} [nowIso]
 */
export function kosisWritePayload(unsold, unsoldRate, nowIso = new Date().toISOString()) {
  return { unsold, unsold_rate: unsoldRate, unsold_source: "kosis", unsold_as_of: null, updated_at: nowIso };
}

/** 0-쓰기 차단기 기본 임계(%) — `--expect-zero` 로 우회하지 않으면 이 비율로 판정한다. @type {number} */
export const DEFAULT_ZERO_RATIO_LIMIT = 10;

/**
 * "값>0 인데 0 으로 바뀌는" 행 비율을 판정한다(세션568-4·568-5 개정). DB 접근 없는 순수 함수.
 *
 * ## 세션568-5 — 우회 방식이 "임계를 낮춘다"에서 "정확한 개수를 안다"로 바뀌었다
 *
 * `expectZero` 가 주어지면(사장님이 사전에 전이표를 보고 실제로 0 이 될 행 수를 안다는 뜻),
 * **비율(10%)이 아니라 그 개수와 정확히 같을 때만** 통과시킨다. 하나라도 다르면(더 많아도,
 * 적어도) 발동 — 사장님이 예상 못 한 추가 변화가 섞여 있다는 신호이기 때문이다. `expectZero`
 * 가 없으면(null) 기본 10% 비율 판정 그대로.
 *
 * @param {ReturnType<typeof planUnsoldUpdates>} plan
 * @param {number | null} expectZero 지정하면 zeroChanges 가 이 값과 정확히 같을 때만 통과. null 이면 비율(10%) 판정.
 * @returns {{ fired: boolean; zeroChanges: number; denominator: number; ratio: number; limit: number; expectZero: number | null }}
 */
export function evaluateZeroBreaker(plan, expectZero) {
  const kosisJudgedNonZero = plan.filter((p) =>
    (p.currentUnsold ?? 0) > 0 &&
    ["write", "write_zero", "hold_ge50", "skip_no_match", "skip_no_estimate"].includes(p.action),
  );
  const willBecomeZero = kosisJudgedNonZero.filter((p) => p.action === "write_zero");
  const denominator = kosisJudgedNonZero.length;
  const ratio = denominator > 0 ? (willBecomeZero.length / denominator) * 100 : 0;
  const fired = expectZero != null
    ? willBecomeZero.length !== expectZero
    : (denominator > 0 && ratio > DEFAULT_ZERO_RATIO_LIMIT);
  return { fired, zeroChanges: willBecomeZero.length, denominator, ratio, limit: DEFAULT_ZERO_RATIO_LIMIT, expectZero: expectZero ?? null };
}

/**
 * `--expect-zero=<N>` 인자를 파싱한다. 없으면 null(기본 비율 판정), 음수·비수치면 무효로
 * 보고 null 로 폴백하며 경고 로그를 남긴다(호출부에서 로그).
 *
 * @param {string[]} argv
 * @returns {{ expectZero: number | null; explicit: boolean; invalid: boolean; raw: string | null }}
 */
export function parseExpectZeroArg(argv) {
  const arg = argv.find((a) => a.startsWith("--expect-zero="));
  if (!arg) return { expectZero: null, explicit: false, invalid: false, raw: null };
  const raw = arg.slice("--expect-zero=".length);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    return { expectZero: null, explicit: false, invalid: true, raw };
  }
  return { expectZero: n, explicit: true, invalid: false, raw };
}

// 세션 395: try/catch/finally 하드닝 — KOSIS 실패가 collector_runs 에 0행으로
// 남는 사각 정정 (PR #97 collect-regional-economy 패턴 답습).
export async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const impactOutArg = process.argv.find((a) => a.startsWith("--impact-out="));
  const impactOutPath = impactOutArg ? impactOutArg.slice("--impact-out=".length) : null;
  const expectZeroParsed = parseExpectZeroArg(process.argv);
  if (expectZeroParsed.invalid) {
    logError(PHASE, `--expect-zero 값이 유효하지 않음(${expectZeroParsed.raw}) — 무시하고 기본 비율(${DEFAULT_ZERO_RATIO_LIMIT}%) 판정 사용`);
  }
  log(PHASE, `차단기 임계 ${DEFAULT_ZERO_RATIO_LIMIT}% · expect-zero ${expectZeroParsed.expectZero != null ? `${expectZeroParsed.expectZero}(지정)` : "없음"}`);
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  let ok = 0;
  let errorMessage = /** @type {string | undefined} */ (undefined);
  /** C6 공고일 빈 applyhome 경고 마커(세션569) — status 는 그대로 두고 error_message 에만 남긴다. @type {string | null} */
  let noDateMarker = null;
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

    // 세션568-5 — 차단기 판정을 "DB 에 무엇이든 쓰기 전"으로 옮긴다. 옛 순서(regions 먼저
    // 쓰고 apartments 단계에서 차단기가 던지면)는 regions 는 이미 반영되고 apartments 만
    // 안 쓰이는 **부분 반영**을 낳는다(사장님·검사관 지적). 새 순서: regions 는 갱신 대상
    // 목록만 계산(쓰지 않음) → apartments 계획(plan) → 차단기 판정 → (통과했을 때만)
    // regions 쓰기 → apartments write/write_zero 쓰기.

    // 1. regions 갱신 대상 계산 (쓰기는 뒤로 미룬다)
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

    /** @type {Array<{ id: string; region: string; gu: string | null; regional_unsold: number | null; newValue: number }>} */
    const regionUpdates = [];
    if (rErr) {
      logError(PHASE, `regions 조회 실패: ${rErr.message}`);
    } else {
      for (const reg of /** @type {Array<{ id: string; region: string; gu: string | null; regional_unsold: number | null }>} */ (regions)) {
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
        regionUpdates.push({ ...reg, newValue: unsoldValue });
      }
    }

    // 2. apartments unsold 추정 (KOSIS 비례배분) — 계획만 세운다, 아직 쓰지 않는다.
    // 세션549: 무정렬 select 는 3,068행 표에서 1,000행만 매칭한다(unordered-pagination-loses-rows.md §1).
    // 세션566: apartments 는 selectAll(..., "id") 로 전수 확보한다(1,000행 컷 수리).
    /** @typedef {{ id: string; name: string; region: string | null; gu: string | null; units: number | null; unsold: number | null; unsold_rate: number | null; naver_sell_count: number | null; presale_type: string | null; unsold_source: string | null; unsold_as_of: string | null }} AptRow */
    /** @type {AptRow[]} */
    let apartmentsTyped;
    try {
      apartmentsTyped = /** @type {any} */ (
        await selectAll((s) => s.from("apartments").select("id, name, region, gu, units, unsold, unsold_rate, naver_sell_count, presale_type, unsold_source, unsold_as_of"), sb, "id")
      );
    } catch (e) {
      // 세션569 검사관: return 하면 finally 가 success ok=0 으로 조용히 기록한다(마이그보다 머지가 먼저라
      // 새 칸 조회가 실패하는 사고를 감시가 못 잡는다). throw 해서 collector_runs 에 failure 로 남긴다.
      logError(PHASE, `apartments 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
      throw new Error(`apartments 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
    }

    const plan = planUnsoldUpdates({ apartments: apartmentsTyped, unsoldByRegionGu, now });

    /** @type {Record<string, number>} */
    const actionCounts = {};
    for (const p of plan) actionCounts[p.action] = (actionCounts[p.action] || 0) + 1;
    log(PHASE, `apartments 계획: ${Object.entries(actionCounts).map(([a, n]) => `${a}=${n}`).join(", ")}`);

    // C6(세션569) — 만료된 applyhome 은 이번 회차 KOSIS 판정을 받는다(전이표에서 따로 센다).
    //   로그는 **실제로 쓰는 행**(write·write_zero)만 적는다 — 보류(hold_ge50)·매칭 실패는 값이 그대로다.
    const expiredPlans = plan.filter((p) => p.applyhomeExpired);
    const expiredWrites = expiredPlans.filter((p) => p.action === "write" || p.action === "write_zero");
    if (expiredPlans.length > 0) {
      log(PHASE, `[C6 만료] 공고 ${APPLYHOME_EXPIRY_MONTHS}개월 지난 applyhome ${expiredPlans.length}건 중 KOSIS 로 씀 ${expiredWrites.length}건${expiredWrites.length > 0 ? `: ${expiredWrites.map((p) => `${p.name}(${p.id}) ${p.currentUnsold}→${p.newEstimate}`).join(", ")}` : ""}`);
    }
    const noDateIds = plan.filter((p) => p.action === "skip_applyhome_no_date").map((p) => p.id);
    noDateMarker = formatApplyhomeNoDate(noDateIds);
    if (noDateMarker) {
      logError(PHASE, `[경고][C6 공고일 없음] applyhome ${noDateIds.length}건은 만료를 판정할 수 없어 존중 유지 — unsold_as_of 를 채워야 한다: ${noDateIds.join(", ")}`);
    }

    const heldIds = plan.filter((p) => p.action === "hold_ge50").map((p) => `${p.name}(${p.id})`);
    if (heldIds.length > 0) {
      log(PHASE, `[보류·미신뢰(≥${UNRELIABLE_RATE_THRESHOLD}%)] ${heldIds.length}건 — 쓰지 않음: ${heldIds.join(", ")}`);
    }

    // 검사관 H1 — kosis 출처인데 이번 회차 매칭이 실패한 행(skip_no_match)은 값을 유지하지만,
    // "그 지역 KOSIS 응답이 이번 회차에 통째로 빠졌을 가능성"을 사람이 알아채도록 경고 로그를
    // 남긴다. apartmentsTyped 는 select 에 unsold_source 를 포함하므로 그대로 대조한다.
    /** @type {Map<string, string | null>} apt.id → unsold_source */
    const sourceByAptId = new Map(apartmentsTyped.map((a) => [a.id, a.unsold_source ?? null]));
    const kosisNoMatch = plan.filter((p) => p.action === "skip_no_match" && sourceByAptId.get(p.id) === "kosis");
    if (kosisNoMatch.length > 0) {
      // 한 시도가 응답에서 통째로 빠졌으면 사람이 바로 보게 시도 이름을 모아 보여준다.
      const regionsMissing = [...new Set(kosisNoMatch.map((p) => p.region).filter(Boolean))];
      const sample = kosisNoMatch.slice(0, 10).map((p) => `${p.name}(${p.id})`);
      logError(PHASE, `[경고][매칭실패] kosis 출처 ${kosisNoMatch.length}건이 이번 회차 매칭 실패(skip_no_match) — 값 유지, 지역 응답 누락 의심(시도: ${regionsMissing.join(", ") || "?"}): ${sample.join(", ")}${kosisNoMatch.length > 10 ? ` 외 ${kosisNoMatch.length - 10}건` : ""}`);
    }

    // 3. 검사관 H1 차단기(세션568-5 최종 개정) — "지금 값 > 0 인데 0 으로 바뀌는" 행
    // (write_zero 이면서 currentUnsold > 0)이 "지금 값 > 0 인 대상 행"(이번 회차 KOSIS
    // 판정을 받은 행 중 값이 있던 것) 전체의 10% 를 넘으면 발동한다. `--expect-zero=<N>` 이
    // 있으면(사장님이 전이표로 미리 아는 정확한 개수) 비율 대신 그 개수와 정확히 같을
    // 때만 통과 — DB 에 무엇이든 쓰기 **전**에 판정하므로, regions 쓰기가 apartments 보다
    // 앞서던 옛 순서에서 나던 부분 반영이 사라진다.
    const breaker = evaluateZeroBreaker(plan, expectZeroParsed.expectZero);
    log(PHASE, `0-쓰기 차단기 판정: ${breaker.zeroChanges}/${breaker.denominator} = ${breaker.ratio.toFixed(1)}% (임계 ${breaker.limit}%${breaker.expectZero != null ? ` · expect-zero=${breaker.expectZero}` : ""}, ${breaker.fired ? "발동" : "미발동"})`);

    // impact-out 은 차단기 발동·정상 종료 어느 경우든 항상 쓴다(계획을 세운 시점의 전체
    // 그림을 남겨야 사람이 판단할 수 있다 — 차단기가 막았다고 계획 자체가 사라지면 무엇이
    // 왜 막혔는지 재구성할 방법이 없다). regionUpdates 개수도 함께 남겨 부분 반영 여부를
    // 사후에 점검할 수 있게 한다.
    if (impactOutPath) {
      try {
        writeFileSync(impactOutPath, JSON.stringify({
          generatedAt: new Date().toISOString(), actionCounts, breaker,
          applyhomeExpiredCount: expiredPlans.length, applyhomeNoDateIds: noDateIds,
          regionUpdateCount: regionUpdates.length, plan,
        }, null, 2), "utf8");
        log(PHASE, `[IMPACT] 계획 ${plan.length}행 저장(breaker 포함): ${impactOutPath}`);
      } catch (e) {
        logError(PHASE, `impact-out 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (breaker.fired) {
      const msg = `KOSIS 0-쓰기 차단기 발동 — 값>0 인데 0 으로 바뀌는 행 ${breaker.zeroChanges}/${breaker.denominator} ` +
        `(${breaker.ratio.toFixed(1)}%)${breaker.expectZero != null ? ` (expect-zero=${breaker.expectZero} 와 불일치)` : ` 가 임계 ${breaker.limit}% 를 초과`}` +
        ` — regions·apartments 어느 것도 쓰지 않고 전체를 중단합니다`;
      if (dryRun) {
        // dry-run 은 미리보기라 아무것도 안 쓴다 — 경고만 남기고 정상 종료(exit 0).
        logError(PHASE, `[DRY-RUN 경고] ${msg}`);
        ok = 0;
        return;
      }
      throw new Error(msg);
    }

    // 4. 차단기를 통과했을 때만 실제로 쓴다 — regions 먼저, 그 다음 apartments.
    let regUpdated = 0;
    for (const reg of regionUpdates) {
      if (isInterrupted()) break;  // 세션 321: graceful shutdown

      if (dryRun) {
        log(PHASE, `  [DRY-RUN] regions ${reg.region} ${reg.gu || ""}: ${reg.regional_unsold} → ${reg.newValue}`);
        regUpdated++;
        continue;
      }

      const { error } = await sb.from("regions").update({
        regional_unsold: reg.newValue,
      }).eq("id", reg.id);

      if (error) logError(PHASE, `  regions ${reg.id} UPDATE 실패: ${error.message}`);
      else regUpdated++;
    }
    log(PHASE, `regions 갱신: ${regUpdated}건`);

    let aptUpdated = 0;
    for (const p of plan) {
      if (p.action !== "write") continue;

      if (dryRun) {
        log(PHASE, `  [DRY-RUN] ${p.name} (${p.region} ${p.gu}): unsold=${p.newEstimate}, rate=${p.newRate}%`);
        aptUpdated++;
        continue;
      }

      const { error } = await sb.from("apartments").update(kosisWritePayload(p.newEstimate, p.newRate)).eq("id", p.id);

      if (error) logError(PHASE, `  ${p.name} UPDATE 실패: ${error.message}`);
      else aptUpdated++;
    }

    log(PHASE, `apartments 미분양 추정 갱신: ${aptUpdated}건`);

    // 세션568-3 — KOSIS 가 "그 시군구 미분양 0"이라 말하면 null 로 비우지 않고 0 을 쓴다
    // (사장님 결정: 비우면 위험 점수가 '모름'(40)이 되어 오히려 나빠진다). clear_listing_derived·
    // clear_kosis_stale(비우기)은 폐지 — 전부 write_zero 로 대체됐다.
    let aptZeroed = 0;
    for (const p of plan) {
      if (p.action !== "write_zero") continue;

      if (dryRun) {
        log(PHASE, `  [DRY-RUN][0으로 씀] ${p.name} (${p.region} ${p.gu}): unsold ${p.currentUnsold} → 0`);
        aptZeroed++;
        continue;
      }

      const { error } = await sb.from("apartments").update(kosisWritePayload(0, 0)).eq("id", p.id);

      if (error) logError(PHASE, `  ${p.name} 0-쓰기 UPDATE 실패: ${error.message}`);
      else aptZeroed++;
    }

    log(PHASE, `KOSIS 0-쓰기: ${aptZeroed}건 (값>0 대비 0 으로 바뀜 ${breaker.zeroChanges}/${breaker.denominator} = ${breaker.ratio.toFixed(1)}%, 차단기 기준 ${breaker.limit}%)`);
    log(PHASE, `요약 — action 별: ${Object.entries(actionCounts).map(([a, n]) => `${a}=${n}`).join(", ")} · KOSIS 출처 갱신(write) ${aptUpdated} · 0-쓰기 ${aptZeroed} · 보류(≥${UNRELIABLE_RATE_THRESHOLD}%) ${heldIds.length}`);

    // 3. unsold_history 시계열 upsert (세션134, 방향 A)
    // KOSIS 단일 API 호출 응답(3개월 범위)을 재파싱하여 월별 시계열 저장.
    // API 재호출 아님 → 쿼터 증가 0.
    // ⚠️ 이 시계열은 **순수 KOSIS 비례배분 계열**이다 — apartments 쪽 판정(skip_preserved 로
    //    applyhome·완판값을 존중하는 것)을 적용하지 않는다(설계). 그래서 보존 값을 가진 단지는
    //    헤드라인 unsold 와 차트 계열이 다를 수 있다(세션567 검사관 확인 — 보존 138곳 조사 때 함께 본다).
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
    ok = regUpdated + aptUpdated + aptZeroed;

    log(PHASE, "\n=== 완료 ===");
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await recordCollectorRun(PHASE, errorMessage
      ? { ok, status: "failure", errorMessage: joinRunMessage(errorMessage, noDateMarker) }
      : (noDateMarker ? { ok, errorMessage: noDateMarker } : { ok }));
  }
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((/** @type {unknown} */ err) => {
  logError(PHASE, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
