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
 *
 * 사람 보류 hold(세션570): `unsold_source = 'hold'` 행은 계획에서 skip_hold, DB 쓰기 WHERE 로도 막고,
 * unsold_history 도 만들지 않는다. 분모에는 남긴다. 해제는 backfill-unsold-source.mjs 계획 파일로만.
 */
import { loadEnv, getSupabase, log, logError, REGION_MAP, resolveRegionName, fetchWithRetry, upsertBatch, recordApiQuota, recordCollectorRun, setupGracefulShutdown, today, selectAll, isApplyhomeExpired, APPLYHOME_EXPIRY_MONTHS, formatApplyhomeNoDate, joinRunMessage } from "./_shared.mjs";
import { isLeaseUnit } from "../../src/constants/leaseTypes.mjs";
import { foldForUnsold } from "./_unsold-bundle.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

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
 * 0. `unsold_source === "hold"` → 존중(사람 보류 — "자료 없음"을 사람이 확정했다. 세션570). 만료 없음 —
 *    해제는 backfill-unsold-source.mjs 계획 파일(release_hold_to_null / release_hold_to_applyhome)로만.
 *    값이 NULL 인 hold 행을 이 규칙 없이 두면 4번에 걸려 KOSIS 가 반올림 0(완판)으로 되돌린다.
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
  if (apt.unsold_source === "hold") return true; // 0 — 사람 보류는 영구 존중(세션570)
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
 * 묶음 시도·구 갈림 판정용 짝 함수 — 구성원을 그 회차 KOSIS 지도로 풀어 `<시도>|<KOSIS 시군구>`, 못 풀면 null(세션636 보완 2).
 * 구 원문("창원시"·"창원시 성산구")이 아니라 KOSIS 가 실제로 나누는 단위로 센다 — 분모를 세는 단위와 같아야 두 번 세지 않는다.
 * @param {Record<string, Record<string, unknown> | undefined>} byRegion 시도 → (KOSIS 시군구 → 값) 지도(최신 월 또는 월별)
 * @returns {(m: { region: string | null; gu: string | null }) => string | null}
 */
export function kosisPairOf(byRegion) {
  return (m) => {
    if (!m.region) return null;
    const k = resolveKosisGuKey(m.region, m.gu, /** @type {any} */ (byRegion[m.region]));
    return k ? `${m.region}|${k}` : null;
  };
}

/**
 * apartments 배분 계획을 순수 함수로 산출한다 (세션567 신설 — 시험 가능하게 분리. 세션568-3 규칙 전면 개정).
 *
 * ## 판정 순서 (사장님 결정 2026-09-24 3차 — 위에서부터)
 * 0. `unsold_source === "hold"`(사람 보류, 세션570) → `skip_hold` — 무효·임대형 판정보다 **먼저**(보류는
 *    사람 결정이라 어떤 자동 판정에도 섞지 않는다). **분모(`unitsByKosisKey`)에는 그대로 남는다** —
 *    빼면 같은 시의 다른 단지 추정치가 바뀐다(보류는 "이 단지 값을 안 쓴다"이지 "이 단지가 없다"가 아니다).
 * 1. 무효(지역·구·세대수≤1) → `skip_invalid`
 * 2. 임대형(presale_type 또는 이름 — isLeaseUnit, 세션577) → `skip_lease`(분모에서도 제외)
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
 * ## 세션635 — 분모·추정치는 묶음 단위(`_unsold-bundle.mjs`), 받는 행 전부 같은 값
 * 행을 같은 단지 묶음(`complex_key ?? id`, `(오)` 행은 따로)으로 접어 분모 = 같은 KOSIS 키 안 **묶음 세대수(D7) 합**,
 * 추정치·률은 묶음마다 한 번 계산해 받는 구성원 전부에 같은 값을 준다. hold·존중 행은 그 행만 안 받는다(사장님 결정
 * §6-9). 무효(규칙 1) 판정의 세대수도 행이 아니라 묶음 세대수다. 계획 행에 `bundleKey`·`bundleUnits`·`bundleSize`.
 *
 * @param {{
 *   apartments: Array<{ id: string; name: string; region: string | null; gu: string | null; units: number | null; unsold: number | null; unsold_rate: number | null; naver_sell_count: number | null; presale_type?: string | null; unsold_source?: string | null; unsold_as_of?: string | null; complex_key?: string | null; naver_presale_no?: string | null; unit_source?: string | null }>;
 *   unsoldByRegionGu: UnsoldByRegionGu;
 *   now?: Date;
 * }} params  now = applyhome 만료 판정 기준 시각(없으면 지금 — main 은 항상 넣는다)
 * @returns {Array<{
 *   id: string; name: string; region: string | null; gu: string | null;
 *   action: "write" | "write_zero" | "hold_ge50" | "skip_hold" | "skip_preserved" | "skip_applyhome_no_date" | "skip_lease" | "skip_no_match" | "skip_no_estimate" | "skip_invalid";
 *   kosisKey: string | null;
 *   guUnsold: number | null;
 *   totalUnitsInGu: number | null;
 *   newEstimate: number | null;
 *   newRate: number | null;
 *   currentUnsold: number | null;
 *   currentRate: number | null;
 *   currentSource: string | null;
 *   applyhomeExpired: boolean;
 *   bundleKey: string; bundleUnits: number | null; bundleSize: number;
 *   rowUnits: number | null;
 * }>}
 */
export function planUnsoldUpdates({ apartments, unsoldByRegionGu, now = new Date() }) {
  // 0단계(세션635) — 행을 같은 단지 묶음으로 접는다. 존중 판정(유효 applyhome·옛 완판)은 행 단위 그대로.
  const isRespected = (/** @type {any} */ apt) =>
    apt.unsold_source !== "hold" && !!apt.region && (!!apt.gu || apt.region === "세종") && shouldSkipKosisFill({ ...apt, units: 2 }, now);
  //   ↑ shouldSkipKosisFill 의 무효 분기(units<=1)를 피하려고 units 를 2 로 넘긴다 — 무효는 아래에서 묶음 세대수로 따로 판정한다.
  const bundles = foldForUnsold(/** @type {any} */ (apartments), { isRespected, pairOf: kosisPairOf(unsoldByRegionGu) });
  /** @type {Map<string, import("./_unsold-bundle.mjs").UnsoldBundle>} apt.id → 묶음 */
  const bundleOfApt = new Map();
  for (const b of bundles) for (const m of b.members) bundleOfApt.set(m.id, b);

  // 1단계 — 묶음마다 kosisKey 를 계산하고 분모를 그 키 단위로 모은다(묶음 세대수 D7 을 한 번만 더한다).
  /** @type {Map<string, string | null>} 묶음 key → kosisKey */
  const keyByBundle = new Map();
  /** @type {Record<string, number>} */
  const unitsByKosisKey = {};
  for (const b of bundles) {
    if (!b.region || !b.units) { keyByBundle.set(b.key, null); continue; }
    const kosisKey = resolveKosisGuKey(b.region, b.gu, unsoldByRegionGu[b.region]);
    keyByBundle.set(b.key, kosisKey);
    if (!kosisKey || b.lease) continue;
    const denomKey = `${b.region}::${kosisKey}`;
    unitsByKosisKey[denomKey] = (unitsByKosisKey[denomKey] || 0) + b.units;
  }

  /** @type {ReturnType<typeof planUnsoldUpdates>} */
  const plan = [];

  for (const apt of apartments) {
    const b = /** @type {import("./_unsold-bundle.mjs").UnsoldBundle} */ (bundleOfApt.get(apt.id));
    const kosisKey = keyByBundle.get(b.key) ?? null;
    /** @type {ReturnType<typeof planUnsoldUpdates>[number]} */
    const base = {
      id: apt.id, name: apt.name, region: apt.region, gu: apt.gu,
      action: "skip_invalid",
      kosisKey: null, guUnsold: null, totalUnitsInGu: null,
      newEstimate: null, newRate: null,
      currentUnsold: apt.unsold, currentRate: apt.unsold_rate,
      currentSource: apt.unsold_source ?? null,
      applyhomeExpired: applyhomeStatus(apt, now) === "expired",
      bundleKey: b.key, bundleUnits: b.units, bundleSize: b.members.length,
      rowUnits: apt.units, // 세션636 F8 — 그 행 세대수(미분양 > 행 세대수 명단을 impact 만으로 뽑게)
    };

    // 규칙 0 — 사람 보류(그 행만). 분모(묶음 세대수)에는 이미 들어 있다.
    if (apt.unsold_source === "hold") { plan.push({ ...base, action: "skip_hold", kosisKey }); continue; }

    // 규칙 1 — 무효: 지역·구 없음, 또는 묶음 세대수 재료 없음(구성원 전부 1 이하·(오)뿐).
    const guOkForInvalid = !!apt.gu || apt.region === "세종";
    if (!apt.region || !guOkForInvalid || !b.units || b.units <= 1) { plan.push({ ...base, action: "skip_invalid" }); continue; }

    // 규칙 2 — 임대형(행 단위. 임대 행은 접기에서 자기 묶음 `#lease:<id>` 로 떨어져 분모에도 안 든다 — 세션636 F1).
    if (isLeaseUnit(apt)) { plan.push({ ...base, action: "skip_lease" }); continue; }

    // 규칙 3·4 — 존중(유효 applyhome·공고일 없음·옛 완판). 참고 추정치는 묶음 값으로 적는다.
    if (b.respected.includes(apt.id)) {
      const ref = kosisKey ? estimateBundle(b, kosisKey) : null;
      const preservedAction = applyhomeStatus(apt, now) === "no_date" ? "skip_applyhome_no_date" : "skip_preserved";
      plan.push({ ...base, action: preservedAction, kosisKey, newEstimate: ref?.estimated ?? null, newRate: ref?.rate ?? null });
      continue;
    }

    // 규칙 5 — 받는 행(b.receivers)만 묶음마다 한 번 계산한 값을 받는다(세션636 F1). 접기 규칙상 hold·존중·임대가 아닌
    // 행은 전부 받는 행이라 아래 분기는 생기지 않는 꼴이다 — 생기면 쓰지 않는다(묶음 접기가 바뀌어도 받는 행 명단 밖엔 안 쓴다).
    if (!b.receivers.includes(apt.id)) { plan.push({ ...base, action: "skip_invalid" }); continue; }
    if (!kosisKey) { plan.push({ ...base, action: "skip_no_match" }); continue; }
    // F3(세션636) — 시도가 응답에 통째로 없으면 예외 대신 매칭 실패(skip_no_match).
    const guUnsold = unsoldByRegionGu[/** @type {string} */ (apt.region)]?.[kosisKey];
    if (guUnsold == null) { plan.push({ ...base, action: "skip_no_match", kosisKey }); continue; }
    if (guUnsold <= 0) { plan.push({ ...base, action: "write_zero", kosisKey, guUnsold, newEstimate: 0, newRate: 0 }); continue; }

    const denomKey = `${apt.region}::${kosisKey}`;
    const totalUnitsInGu = unitsByKosisKey[denomKey] || b.units;
    const result = calcProportionalUnsold(guUnsold, b.units, totalUnitsInGu);
    if (!result) {
      const rawEstimate = totalUnitsInGu > 0 ? Math.round(guUnsold * (b.units / totalUnitsInGu)) : null;
      if (rawEstimate != null && rawEstimate <= 0) { plan.push({ ...base, action: "write_zero", kosisKey, guUnsold, totalUnitsInGu, newEstimate: 0, newRate: 0 }); continue; }
      plan.push({ ...base, action: "skip_no_estimate", kosisKey, guUnsold, totalUnitsInGu });
      continue;
    }
    const { estimated, unsoldRate } = result;
    if (unsoldRate >= UNRELIABLE_RATE_THRESHOLD) {
      plan.push({ ...base, action: "hold_ge50", kosisKey, guUnsold, totalUnitsInGu, newEstimate: estimated, newRate: unsoldRate });
      continue;
    }
    plan.push({ ...base, action: "write", kosisKey, guUnsold, totalUnitsInGu, newEstimate: estimated, newRate: unsoldRate });
  }
  return plan;

  /** 존중 행의 참고 추정치(묶음 값). @param {import("./_unsold-bundle.mjs").UnsoldBundle} b @param {string} kosisKey */
  function estimateBundle(b, kosisKey) {
    const guMap = b.region ? unsoldByRegionGu[b.region] : undefined;
    const guUnsold = guMap ? /** @type {Record<string, number>} */ (guMap)[kosisKey] : undefined;
    if (guUnsold == null || !b.units) return null;
    const total = unitsByKosisKey[`${b.region}::${kosisKey}`] || b.units;
    const r = calcProportionalUnsold(guUnsold, b.units, total);
    return r ? { estimated: r.estimated, rate: r.unsoldRate } : null;
  }
}

/** 규칙 5(받는 행)에 닿은 계획 action — 묶음 요약의 "받는 행". */
const RECEIVER_ACTIONS = new Set(["write", "write_zero", "hold_ge50", "skip_no_match", "skip_no_estimate"]);

/**
 * 묶음 요약(impact `fold` · `[묶음]` 로그) — **계획 결과(존중 판정 뒤)** 로 센다(세션636 F9: 옛 요약은 존중 판정 전 접기라
 * 받는 행이 부풀고 존중이 늘 0 이었다). 받는 행 = 규칙 5 에 닿은 행 · 존중 = skip_preserved·skip_applyhome_no_date ·
 * hold = skip_hold · 시도·구 갈림 = `#rg:` 로 나뉜 원래 열쇠 수. DB 접근 없는 순수 함수.
 * @param {ReturnType<typeof planUnsoldUpdates>} plan
 */
export function summarizePlanFold(plan) {
  const keys = new Set(), multiKeys = new Set(), rgBase = new Set();
  let receivers = 0, holdsInMulti = 0, respectedInMulti = 0;
  for (const p of plan) {
    keys.add(p.bundleKey);
    const multi = p.bundleSize >= 2;
    if (multi) multiKeys.add(p.bundleKey);
    if (RECEIVER_ACTIONS.has(p.action)) receivers++;
    if (multi && p.action === "skip_hold") holdsInMulti++;
    if (multi && (p.action === "skip_preserved" || p.action === "skip_applyhome_no_date")) respectedInMulti++;
    const i = p.bundleKey.indexOf("#rg:");
    if (i >= 0) rgBase.add(p.bundleKey.slice(0, i));
  }
  return { bundles: keys.size, multi: multiKeys.size, receivers, holdsInMulti, respectedInMulti, rgSplit: rgBase.size };
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

/** DB 쪽 hold 보호 조건 — 출처가 NULL 이거나 hold 가 아닌 행만 쓴다(PostgREST `neq` 는 NULL 을 빼므로 `is.null` 을 함께 건다). */
export const NOT_HOLD_FILTER = "unsold_source.is.null,unsold_source.neq.hold";

/**
 * apartments 한 행에 KOSIS 값을 쓴다 — 출처가 hold(사람 보류)인 행은 **DB 조건으로** 막는다(세션570 A6).
 * 계획은 조회 시점의 출처로 skip_hold 를 가르지만, 그 사이 사람이 hold 로 바꾼 행(경합 창)은 이 WHERE 가
 * 닫는다. 성공은 **돌아온 행**으로 센다(보낸 수 아님 — [[count-results-not-sent]]).
 * @param {any} sb Supabase 클라이언트(시험에서는 같은 모양의 가짜)
 * @param {string} id
 * @param {Record<string, unknown>} payload
 * @returns {Promise<{ status: "updated" | "protected" } | { status: "error"; message: string }>}
 */
export async function updateApartmentUnlessHold(sb, id, payload) {
  const { data, error } = await sb.from("apartments").update(payload).eq("id", id).or(NOT_HOLD_FILTER).select("id");
  if (error) return { status: "error", message: error.message };
  return (data?.length ?? 0) > 0 ? { status: "updated" } : { status: "protected" };
}

/**
 * 계획에서 hold 명단과 "빈칸 → 0" 명단을 뽑는다(세션570 A5). DB 접근 없는 순수 함수.
 * 빈칸 → 0 = write_zero 인데 지금 값이 NULL 인 행 — 사람이 비운 자리가 0(완판)으로 채워지는 경로라
 * 개수만이 아니라 **명단**을 로그·impact 에 남긴다([[expect-ids-not-counts]]).
 * @param {ReturnType<typeof planUnsoldUpdates>} plan
 * @returns {{ holdIds: string[]; nullToZeroIds: string[] }}
 */
export function summarizeHoldAndNullToZero(plan) {
  return {
    holdIds: plan.filter((p) => p.action === "skip_hold").map((p) => p.id),
    nullToZeroIds: plan.filter((p) => p.action === "write_zero" && p.currentUnsold == null).map((p) => p.id),
  };
}

/**
 * unsold_history 에 쓸 단지에서 hold 를 뺀다(세션570 A7). 사람이 "자료 없음"을 확정한 단지에 KOSIS 추정
 * 시계열을 쌓으면 화면 차트가 보류와 모순된다. **분모에는 남긴다**(planUnsoldUpdates 와 같은 이유 — 빼면
 * 같은 시 이웃 단지의 시계열 값이 바뀐다). 호출부는 행 생성 루프에만 `kept` 를 쓴다.
 * @template {{ id: string; unsold_source?: string | null }} T
 * @param {T[]} apartments
 * @returns {{ kept: T[]; excludedIds: string[] }}
 */
export function excludeHoldFromHistory(apartments) {
  /** @type {T[]} */
  const kept = [];
  /** @type {string[]} */
  const excludedIds = [];
  for (const a of apartments) {
    if (a.unsold_source === "hold") excludedIds.push(a.id);
    else kept.push(a);
  }
  return { kept, excludedIds };
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

/**
 * `--apply-from=<승인한 impact json>` 인자를 읽는다(세션635, 맹점 O8 · `data-changing-run-approval` §2 — 행마다 값이
 * 다른 반영은 숫자 하나로 승인하지 않는다). 값이 비었거나 두 번 나오거나 `--expect-zero` 와 같이 주면 던진다(승인 수단은 하나).
 * @param {string[]} argv
 * @returns {{ applyFrom: string | null }}
 */
export function parseApplyFromArg(argv) {
  const args = argv.filter((a) => a.startsWith("--apply-from"));
  if (args.length === 0) return { applyFrom: null };
  if (args.length > 1) throw new Error("--apply-from 이 두 번 나왔습니다 — 승인한 계획 파일은 하나만 줍니다");
  const m = /^--apply-from=(.+)$/.exec(args[0]);
  if (!m) throw new Error(`--apply-from 에는 승인한 계획 파일 경로가 필요합니다: ${args[0]}`);
  if (argv.some((a) => a.startsWith("--expect-zero"))) {
    throw new Error("--apply-from 과 --expect-zero 는 같이 줄 수 없습니다 — 승인 수단은 하나입니다(계획 파일 대조가 곧 승인)");
  }
  // 같은 경로면 impact-out 이 승인 파일을 이번 계획으로 덮어써 승인 기록이 사라진다(세션635 — assign-complex-keys 의 --out 거부와 같은 이유).
  const impactArg = argv.find((a) => a.startsWith("--impact-out="));
  if (impactArg) {
    const norm = (/** @type {string} */ p) => (process.platform === "win32" ? resolvePath(p).toLowerCase() : resolvePath(p));
    if (norm(impactArg.slice("--impact-out=".length)) === norm(m[1])) {
      throw new Error("--apply-from 과 --impact-out 이 같은 파일입니다 — 승인한 계획 파일을 이번 계획으로 덮어쓰게 됩니다. 다른 경로를 주세요");
    }
  }
  return { applyFrom: m[1] };
}

/**
 * 다시 세운 계획이 사람이 승인한 계획 파일(`--impact-out` 의 `plan`)과 **쓰는 행의 내용까지** 같은가. DB 접근 없는 순수 함수.
 * 비교 대상 = 양쪽에서 `action ∈ {write, write_zero}` 인 행만, 비교 칸 = `id·currentUnsold·newEstimate·newRate·action`.
 * 개수만 맞추면 그 사이 다른 행이 바뀐 반영을 통과시킨다 — 그래서 id 로 맞대 명단을 낸다(`assign-complex-keys.mjs` 의 같은 이름 함수 꼴).
 * @param {ReadonlyArray<any>} current 지금 다시 세운 계획(`planUnsoldUpdates` 결과)
 * @param {unknown} approved 승인한 계획 파일의 `plan`
 * @returns {{ same: boolean, onlyCurrent: string[], onlyApproved: string[], changed: Array<{ id: string, cur: unknown, app: unknown }> }}
 */
export function comparePlanToApproved(current, approved) {
  if (!Array.isArray(approved)) throw new Error("승인한 계획 파일에 plan 배열이 없습니다");
  // 세션636 F10 — 같은 id 가 두 줄이면 뒤 줄이 조용히 이긴다 → 어느 줄이 승인인지 모르므로 던진다.
  const seenIds = new Set();
  for (const p of approved) {
    const id = String(p?.id);
    if (seenIds.has(id)) throw new Error(`승인한 계획 파일에 같은 id 가 두 줄 있습니다: ${id} — 어느 줄이 승인인지 알 수 없어 쓰지 않습니다`);
    seenIds.add(id);
  }
  const writesOf = (/** @type {ReadonlyArray<any>} */ arr) => {
    /** @type {Map<string, { currentUnsold: unknown, newEstimate: unknown, newRate: unknown, action: unknown }>} */
    const m = new Map();
    for (const p of arr) {
      if (p?.action !== "write" && p?.action !== "write_zero") continue;
      m.set(String(p.id), { currentUnsold: p.currentUnsold ?? null, newEstimate: p.newEstimate ?? null, newRate: p.newRate ?? null, action: p.action });
    }
    return m;
  };
  const cur = writesOf(current);
  const app = writesOf(approved);
  const onlyCurrent = [...cur.keys()].filter((id) => !app.has(id)).sort();
  const onlyApproved = [...app.keys()].filter((id) => !cur.has(id)).sort();
  /** @type {Array<{ id: string, cur: unknown, app: unknown }>} */
  const changed = [];
  for (const [id, c] of cur) {
    const a = app.get(id);
    if (a && JSON.stringify(c) !== JSON.stringify(a)) changed.push({ id, cur: c, app: a });
  }
  changed.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return { same: onlyCurrent.length === 0 && onlyApproved.length === 0 && changed.length === 0, onlyCurrent, onlyApproved, changed };
}

/** `--apply-from` 으로 묶음 배분을 반영한 성공 회차가 `collector_runs.error_message` 에 남기는 표식(세션636 F6). */
export const KOSIS_BUNDLE_APPLIED_MARKER = "KOSIS_BUNDLE_APPLIED";

/**
 * 묶음 배분을 사람이 승인해 반영(`--apply-from` 성공)한 회차가 있었나 — 같은 수집기·success·표식 포함 행 1건(세션636 F6).
 * 조회 실패는 던진다(확인 못 하면 쓰지 않는다).
 * @param {any} sb Supabase 클라이언트(시험에서는 같은 모양의 가짜)
 * @returns {Promise<boolean>}
 */
export async function hasBundleApplied(sb) {
  const { data, error } = await sb.from("collector_runs").select("id").eq("collector", PHASE).eq("status", "success")
    .like("error_message", `%${KOSIS_BUNDLE_APPLIED_MARKER}%`).limit(1);
  if (error) throw new Error(`collector_runs 조회 실패 — 묶음 배분 첫 반영 여부를 확인 못 해 쓰지 않습니다: ${error.message}`);
  return (data?.length ?? 0) > 0;
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
  /** F6(세션636) — `--apply-from` 반영이 끝난 회차면 true(성공 기록에 KOSIS_BUNDLE_APPLIED 표식). */
  let bundleApplied = false;
  try {
    if (!KOSIS_KEY) throw new Error("KOSIS_KEY not configured");

    // 세션635(맹점 O8) — 승인한 계획 파일은 DB·KOSIS 를 보기 **전에** 읽어 plan 배열인지 확인한다(try 안 — 실패도 기록에 남게).
    const { applyFrom } = parseApplyFromArg(process.argv);
    /** @type {any[] | null} */
    let approvedPlan = null;
    if (applyFrom != null) {
      const approved = /** @type {{ plan?: unknown }} */ (JSON.parse(readFileSync(applyFrom, "utf8")))?.plan;
      if (!Array.isArray(approved)) throw new Error(`승인한 계획 파일에 plan 배열이 없습니다: ${applyFrom}`);
      approvedPlan = approved;
      log(PHASE, `--apply-from: 승인한 계획 ${approvedPlan.length}행 — 이번 계획과 write/write_zero 행이 전부 같을 때만 씁니다`);
    }

    const isInterrupted = setupGracefulShutdown(PHASE);  // 세션 321: graceful shutdown
    const sb = getSupabase();

    // 세션636 F6(맹점 🟠1) — 인자 없는 쓰기 실행은 묶음 배분을 사람이 승인해 처음 반영(--apply-from)한 뒤에만 쓴다.
    // 0-쓰기 차단기는 "값→0" 만 세어 묶음 배분(값→다른 값)이 승인 없이 쓰일 수 있었다. KOSIS 조회 **전에** 막는다.
    if (!dryRun && applyFrom == null && !(await hasBundleApplied(sb))) {
      const msg = "[차단] KOSIS_BUNDLE_NOT_APPLIED — 첫 반영(--apply-from) 전이라 쓰지 않는다";
      logError(PHASE, msg);
      throw new Error(msg);
    }

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
    /** @typedef {{ id: string; name: string; region: string | null; gu: string | null; units: number | null; unsold: number | null; unsold_rate: number | null; naver_sell_count: number | null; presale_type: string | null; unsold_source: string | null; unsold_as_of: string | null; complex_key: string | null; naver_presale_no: string | null; unit_source: string | null }} AptRow */
    /** @type {AptRow[]} */
    let apartmentsTyped;
    try {
      apartmentsTyped = /** @type {any} */ (
        await selectAll((s) => s.from("apartments").select("id, name, region, gu, units, unsold, unsold_rate, naver_sell_count, presale_type, unsold_source, unsold_as_of, complex_key, naver_presale_no, unit_source"), sb, "id")
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
    const fold = summarizePlanFold(plan);
    log(PHASE, `[묶음] 묶음 ${fold.bundles} · 2행+ ${fold.multi} · 받는 행 ${fold.receivers} · 2행+ 존중 ${fold.respectedInMulti} · 2행+ hold ${fold.holdsInMulti} (계획 결과 기준)`);
    log(PHASE, `[묶음] 시도·구 갈림 ${fold.rgSplit}묶음`);

    // 세션570 A5 — 사람 보류(hold)와 "빈칸 → 0" 은 개수만이 아니라 명단을 남긴다(다음 회차 뒤 대조용).
    const { holdIds, nullToZeroIds } = summarizeHoldAndNullToZero(plan);
    log(PHASE, `[hold] ${holdIds.length}건: ${holdIds.join(",")}`);
    log(PHASE, `[빈칸→0] ${nullToZeroIds.length}건: ${nullToZeroIds.join(",")}`);

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
          holdIds, nullToZeroIds,
          regionUpdateCount: regionUpdates.length, fold, plan,
        }, null, 2), "utf8");
        log(PHASE, `[IMPACT] 계획 ${plan.length}행 저장(breaker 포함): ${impactOutPath}`);
      } catch (e) {
        logError(PHASE, `impact-out 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 세션635(맹점 O8) — 승인한 계획 파일로만 쓰는 실행. write/write_zero 행의 id·현재값·새값·률·action 이 전부 같을 때만
    // 쓴다(같으면 그 계획이 곧 승인이라 0-쓰기 차단기는 보지 않는다 — `--expect-zero` 와 같이 못 주는 이유). 다르면 regions·
    // apartments 어느 것도 쓰지 않고 failure 로 남긴다(impact-out 은 위에서 이미 썼다).
    if (approvedPlan) {
      const cmp = comparePlanToApproved(plan, approvedPlan);
      if (!cmp.same) {
        const n = cmp.onlyCurrent.length + cmp.onlyApproved.length + cmp.changed.length;
        if (cmp.onlyCurrent.length > 0) log(PHASE, `  어긋남(이번에만 씀) ${cmp.onlyCurrent.length}건: ${cmp.onlyCurrent.slice(0, 20).join(",")}`);
        if (cmp.onlyApproved.length > 0) log(PHASE, `  어긋남(승인에만 있음) ${cmp.onlyApproved.length}건: ${cmp.onlyApproved.slice(0, 20).join(",")}`);
        for (const c of cmp.changed.slice(0, 20)) log(PHASE, `  어긋남(값 다름) ${c.id}: 승인 ${JSON.stringify(c.app)} → 지금 ${JSON.stringify(c.cur)}`);
        const msg = `KOSIS_PLAN_MISMATCH ${n}건 — 승인한 계획 파일과 지금 계획이 다릅니다(이번에만 ${cmp.onlyCurrent.length} · 승인에만 ${cmp.onlyApproved.length} · 값 다름 ${cmp.changed.length})` +
          ` — regions·apartments 어느 것도 쓰지 않습니다. 미리보기를 다시 떠서 승인받으세요`;
        if (dryRun) {
          logError(PHASE, `[DRY-RUN 경고] ${msg}`);
          ok = 0;
          return;
        }
        throw new Error(msg);
      }
      log(PHASE, `승인한 계획 파일과 일치(write/write_zero 행 기준) — 반영합니다(0-쓰기 차단기는 보지 않음)`);
    } else if (breaker.fired) {
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
    /** 보완 2(재검사 🟡) — 로그만 남기는 쓰기 실패 수. 0 일 때만 첫 반영 표식을 남긴다(일부 실패 회차로 차단기가 풀리지 않게). */
    let writeFailures = 0;
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

      if (error) { writeFailures++; logError(PHASE, `  regions ${reg.id} UPDATE 실패: ${error.message}`); }
      else regUpdated++;
    }
    log(PHASE, `regions 갱신: ${regUpdated}건`);

    let aptUpdated = 0;
    // 세션570 A6 — 계획 뒤 사람이 hold 로 바꾼 행은 DB 조건이 막는다(0행 반환). 따로 센다.
    let protectedByHold = 0;
    for (const p of plan) {
      if (p.action !== "write") continue;

      if (dryRun) {
        log(PHASE, `  [DRY-RUN] ${p.name} (${p.region} ${p.gu}): unsold=${p.newEstimate}, rate=${p.newRate}%`);
        aptUpdated++;
        continue;
      }

      const r = await updateApartmentUnlessHold(sb, p.id, kosisWritePayload(p.newEstimate, p.newRate));
      if (r.status === "error") { writeFailures++; logError(PHASE, `  ${p.name} UPDATE 실패: ${r.message}`); }
      else if (r.status === "protected") { protectedByHold++; log(PHASE, `  ${p.name}(${p.id}) hold 보호로 건너뜀`); }
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

      const r = await updateApartmentUnlessHold(sb, p.id, kosisWritePayload(0, 0));
      if (r.status === "error") { writeFailures++; logError(PHASE, `  ${p.name} 0-쓰기 UPDATE 실패: ${r.message}`); }
      else if (r.status === "protected") { protectedByHold++; log(PHASE, `  ${p.name}(${p.id}) 0-쓰기 hold 보호로 건너뜀`); }
      else aptZeroed++;
    }

    log(PHASE, `KOSIS 0-쓰기: ${aptZeroed}건 (값>0 대비 0 으로 바뀜 ${breaker.zeroChanges}/${breaker.denominator} = ${breaker.ratio.toFixed(1)}%, 차단기 기준 ${breaker.limit}%)`);
    log(PHASE, `요약 — action 별: ${Object.entries(actionCounts).map(([a, n]) => `${a}=${n}`).join(", ")} · KOSIS 출처 갱신(write) ${aptUpdated} · 0-쓰기 ${aptZeroed} · 보류(≥${UNRELIABLE_RATE_THRESHOLD}%) ${heldIds.length} · hold=${holdIds.length} · hold 보호로 건너뜀 ${protectedByHold}`);

    // 3. unsold_history 시계열 upsert (세션134, 방향 A)
    // KOSIS 단일 API 호출 응답(3개월 범위)을 재파싱하여 월별 시계열 저장.
    // API 재호출 아님 → 쿼터 증가 0.
    // ⚠️ 이 시계열은 **순수 KOSIS 비례배분 계열**이다 — apartments 쪽 판정(skip_preserved 로
    //    applyhome·완판값을 존중하는 것)을 적용하지 않는다(설계). 그래서 보존 값을 가진 단지는
    //    헤드라인 unsold 와 차트 계열이 다를 수 있다(세션567 검사관 확인 — 보존 138곳 조사 때 함께 본다).
    // 세션567: 시군구 매칭은 resolveKosisGuKey 로 통일(시 단위·세종 포함) — 임대형 제외,
    // 새 추정 미분양률 50% 이상은 저장하지 않는다(사장님 결정).
    const allMonthsMap = parseKosisRowsAllMonths(rows);
    // 세션635: 분모·추정치는 묶음 단위(planUnsoldUpdates 와 같은 접기). hold 행은 시계열 행을 만들지 않는다(A7).
    const historyBundles = foldForUnsold(/** @type {any} */ (apartmentsTyped), { isRespected: () => false, pairOf: kosisPairOf(allMonthsMap) });
    /** @type {Map<string, string | null>} 묶음 key → kosisKey(월별 맵 기준) */
    const historyKeyByBundle = new Map();
    /** @type {Record<string, number>} */
    const unitsByGuForHistory = {};
    for (const b of historyBundles) {
      if (!b.region || !b.units || b.units <= 1) { historyKeyByBundle.set(b.key, null); continue; }
      const monthMap = allMonthsMap[b.region];
      const kosisKey = monthMap ? resolveKosisGuKey(b.region, b.gu, /** @type {any} */ (monthMap)) : null;
      historyKeyByBundle.set(b.key, kosisKey);
      if (!kosisKey || b.lease) continue;
      const denomKey = `${b.region}::${kosisKey}`;
      unitsByGuForHistory[denomKey] = (unitsByGuForHistory[denomKey] || 0) + b.units;
    }

    /** @type {Array<{ apartment_id: string; base_month: string; unsold_count: number; post_completion_unsold: number | null; change: number | null; recorded_at: string }>} */
    const historyRows = [];
    let heldHistoryCount = 0;
    const todayDate = today(); // KST 고정 (루프 밖 1회 — 자정 경계 중복 0)
    let holdHistoryExcluded = 0;
    for (const b of historyBundles) {
      if (!b.region || !b.units || b.units <= 1 || b.lease) continue;
      const monthMap = allMonthsMap[b.region];
      const kosisKey = historyKeyByBundle.get(b.key) ?? null;
      if (!monthMap || !kosisKey) continue;
      const periodMap = /** @type {any} */ (monthMap)[kosisKey];
      if (!periodMap) continue;
      const totalUnitsInGu = unitsByGuForHistory[`${b.region}::${kosisKey}`] || b.units;
      // 받는 행 = hold 가 아닌 구성원 전부(존중 행도 시계열은 KOSIS 계열 그대로 — 지금 설계).
      const targets = b.members.filter((m) => m.unsold_source !== "hold").map((m) => m.id);
      holdHistoryExcluded += b.holds.length;
      for (const [period, guUnsold] of Object.entries(periodMap)) {
        const result = calcProportionalUnsold(/** @type {number} */ (guUnsold), b.units, totalUnitsInGu);
        if (!result) continue;
        if (result.unsoldRate >= UNRELIABLE_RATE_THRESHOLD) { heldHistoryCount += targets.length; continue; }
        for (const apartment_id of targets) {
          historyRows.push({ apartment_id, base_month: period, unsold_count: result.estimated, post_completion_unsold: null, change: null, recorded_at: todayDate });
        }
      }
    }
    if (holdHistoryExcluded > 0) log(PHASE, `unsold_history hold 제외: ${holdHistoryExcluded}건`);

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
    if (!dryRun && approvedPlan && writeFailures === 0) bundleApplied = true; // F6 — 다음 인자 없는 회차가 이 표식을 찾는다(쓰기 실패 0 일 때만)
    else if (!dryRun && approvedPlan) logError(PHASE, `[경고] --apply-from 반영 중 쓰기 실패 ${writeFailures}건 — 첫 반영 표식(${KOSIS_BUNDLE_APPLIED_MARKER})을 남기지 않는다. 실패 원인을 고치고 미리보기를 다시 떠 승인받은 뒤 --apply-from`);

    log(PHASE, "\n=== 완료 ===");
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const successMessage = joinRunMessage(bundleApplied ? KOSIS_BUNDLE_APPLIED_MARKER : null, noDateMarker);
    await recordCollectorRun(PHASE, errorMessage
      ? { ok, status: "failure", errorMessage: joinRunMessage(errorMessage, noDateMarker) }
      : (successMessage ? { ok, errorMessage: successMessage } : { ok }));
  }
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((/** @type {unknown} */ err) => {
  logError(PHASE, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
