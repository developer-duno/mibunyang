// @ts-check
/**
 * 보육정보공개 cpmsapi030 (어린이집 70 필드 상세) → regions.childcare.facilities[] 7→70 필드 확장 (세션 254 W6-D2 · 세션606 시군구 단위로 고침)
 *
 * 자원: info.childcare.go.kr 보육정보공개 API
 * endpoint: http://api.childcare.go.kr/mediate/rest/cpmsapi030/cpmsapi030/request
 * 요청 parameter: key (인증키) + arcode (시군구코드 5자 = GU_LAWD_MAP) — stcode 는 넣지 않는다
 * 응답 형식: REST + XML, 1 arcode = 그 시군구 시설 전체(<item> 여러 개, 좌표+상세)
 *   세션606 탐침(.omc/artifacts/session603/probe_1007.log): 파주 41480 → 346건, 겹침 330/330.
 *   2u 실측(childcare_api.py): stcode 키를 빈 값으로라도 넣으면 ERROR-100, key 를 먼저.
 *
 * 70 필드 그룹:
 *   - 위치 6: la / lo / sidoname / sigunname / zipcode / craddr
 *   - 기본 8: stcode / crname / crtypename / crstatusname / crtelno / crfaxno / crhome / crrepname
 *   - 시설 6: nrtrroomcnt / nrtrroomsize / plgrdco / cctvinstlcnt / chcrtescnt / crcargbname
 *   - 정원/현원 2: crcapat / crchcnt
 *   - 일자 6: crcnfmdt / crpausebegindt / crpauseenddt / crabldt / datastdrdt / crspec
 *   - CLASS_CNT 11 (반수): 00~05 + M2/M3/M5/SP/TOT
 *   - CHILD_CNT 11 (아동수): 00~05 + M2/M3/M5/SP/TOT
 *   - EM_CNT 15 (교직원 자격별): 0Y/1Y/2Y/4Y/6Y/A1~A10/TOT
 *   - EW_CNT 8 (입소대기): 00~05 + M6/TOT
 *
 * 작업 흐름 (세션606):
 *   1. regions 전 행을 selectAll 커서로 읽고 (region, gu) 최신행만 고른다(옛 행은 건드리지 않는다)
 *   2. 최신행 facilities 가 있는 시군구마다 cpmsapi030 1회(arcode = GU_LAWD_MAP, 없으면 skip)
 *   3. 응답 시설을 stcode 로 최신행 facilities 에 상세만 덧입힌다(시설 추가·삭제 없음 — 목록은 childcare-info 소유)
 *   4. 바뀐 시군구만 UPDATE(같으면 skip — 멱등)
 *   5. 0건 차단기: 시설이 있는데 0건 응답인 시군구 비율 > 10% 면 failure + exit 1
 *   매일 04:30 로컬 러너(childcare-local-runner.mjs) — 정상 회차 호출 ≈260회.
 *
 * 사용:
 *   node scripts/collectors/childcare-detail.mjs                          (regions UPDATE)
 *   node scripts/collectors/childcare-detail.mjs --dry-run                (미리보기 — 호출은 같다)
 *   node scripts/collectors/childcare-detail.mjs --dry-run --only=경기:파주시  (시군구 하나만, 호출 1회)
 *
 * 필요 env:
 *   CHILDCARE_BASIC_API_KEY  — info.childcare.go.kr cpmsapi030 인증키 (cpmsapi021 의 CHILDCARE_API_KEY 와 별 키)
 *   DAILY_LIMIT              — 일일 호출 한도 (기본 1000, 단위 = 시군구 호출)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, logError, createReporter, fetchWithRetry, recordApiQuota, recordCollectorRun, sleep, selectAll, GU_LAWD_MAP } from "./_shared.mjs";
import { extractTag, pickLatestPerKey } from "./childcare-info.mjs";
import { JEJU_ARCODE_MAP } from "./childcare-info-jeju.mjs";

loadEnv();

const API_KEY = process.env.CHILDCARE_BASIC_API_KEY;
const BASE_URL = "http://api.childcare.go.kr/mediate/rest/cpmsapi030/cpmsapi030/request";
const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT ?? "1000", 10);
// 연속으로 이 수만큼 시군구 호출이 네트워크 실패하면 전역 종료(단위 = 시군구 호출, 세션606).
// GH 러너(해외 IP) 가 api.childcare.go.kr(평문 HTTP) 에 막히면 호출마다 ~30s×3 재시도로 매달려
// timeout 으로 잘렸다(세션 398 raw 로그: 세종 fetch failed 연쇄, KOSIS 6/9 사고와 같은 꼴).
const GLOBAL_DEAD_CIRCUIT = parseInt(process.env.GLOBAL_DEAD_CIRCUIT ?? "5", 10);

/**
 * cpmsapi030 응답 XML 의 결과코드가 "오늘 더 호출 불가"(쿼터 초과 INFO-300 / 키 만료 INFO-400)
 * 인지 검사. 해당 시 throw — 호출부가 "응답 부재 skip"(시설 개별 사정)과 구분해 전역 종료한다.
 * INFO-200(검색결과 없음)·기타 코드는 통과시켜 0건 응답 흐름(그 시군구 skip + 0건 차단기)으로 보낸다.
 *
 * 사고 답습(세션 400): 가드 부재 시 INFO-300 응답에 <item> 이 없어 parseChildcareDetailXml 이
 * null 반환 → "응답 부재 skip" + processed++ 로 묻혀 1000건 쿼터 초과를 success 로 기록(데이터
 * 0건인데 모니터 정상 표시). childcare-info.mjs assertNoErrorCode 답습 + detail 전역종료 특성 반영.
 * @param {string} xml
 * @throws {QuotaExceededError} INFO-300/INFO-400 시
 */
export function assertNoQuotaError(xml) {
  const m = /\b(INFO-(?:300|400))\b/.exec(xml);
  if (m) throw new QuotaExceededError(m[1]);
}

/** 일 요청 초과(INFO-300) 또는 키 만료(INFO-400) — 오늘 더 호출 불가, 전역 종료 신호. */
export class QuotaExceededError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(`cpmsapi030 ${code} (일 요청 초과/키 만료) — 오늘 더 호출 불가`);
    this.name = "QuotaExceededError";
    this.code = code;
  }
}

/**
 * fetch 실패 메시지가 네트워크 레벨 실패(연결 불가/타임아웃/재시도 소진)인지 판정.
 * HTTP 4xx/5xx(서버가 응답은 한 경우)와 구분 — 후자는 시설별 개별 사정이라 circuit 대상 아님.
 * @param {string} msg
 * @returns {boolean}
 */
export function isNetworkError(msg) {
  return (
    /fetch failed/i.test(msg) ||
    /재시도 소진/.test(msg) ||
    /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(msg) ||
    /\b(timeout|aborted)\b/i.test(msg)
  );
}

/**
 * @typedef {Object} ChildcareDetail
 * @property {string} stcode
 * @property {string} crname
 * @property {string|null} la               - 위도
 * @property {string|null} lo               - 경도
 * @property {string|null} sidoname
 * @property {string|null} sigunname
 * @property {string|null} zipcode
 * @property {string|null} craddr
 * @property {string|null} crtypename       - 시설 유형 (국공립/민간/가정 등)
 * @property {string|null} crstatusname     - 운영 상태 (정상/폐원/휴원)
 * @property {string|null} crtelno
 * @property {string|null} crfaxno
 * @property {string|null} crhome
 * @property {string|null} crrepname        - 대표자명
 * @property {number} nrtrroomcnt           - 보육실수
 * @property {number} nrtrroomsize          - 보육실 면적
 * @property {number} plgrdco               - 놀이터 수
 * @property {number} cctvinstlcnt          - CCTV 설치 대수
 * @property {number} chcrtescnt            - 차량수
 * @property {string|null} crcargbname      - 차량종류
 * @property {number} crcapat               - 정원
 * @property {number} crchcnt               - 현원
 * @property {string|null} crcnfmdt         - 인가일
 * @property {string|null} crpausebegindt
 * @property {string|null} crpauseenddt
 * @property {string|null} crabldt          - 폐지일
 * @property {string|null} datastdrdt       - 자료기준일
 * @property {string|null} crspec           - 비고
 * @property {Record<string, number>} class_cnt   - 반수 11종
 * @property {Record<string, number>} child_cnt   - 아동수 11종
 * @property {Record<string, number>} em_cnt      - 교직원수 15종
 * @property {Record<string, number>} ew_cnt      - 입소대기 8종
 */

/**
 * @typedef {Object} ExistingFacility
 * @property {string} stcode
 * @property {string} crname
 * @property {string} [crtel]
 * @property {string} [crfax]
 * @property {string} [craddr]
 * @property {string} [crhome]
 * @property {number} [crcapat]
 * @property {string} [crtypename]  - 70 필드 상세가 붙어 있으면 채워짐
 * @property {string|null} [la]     - 위도(상세에서 옴)
 * @property {string|null} [lo]     - 경도(상세에서 옴)
 */

const CLASS_KEYS = ["00", "01", "02", "03", "04", "05", "M2", "M3", "M5", "SP", "TOT"];
const CHILD_KEYS = ["00", "01", "02", "03", "04", "05", "M2", "M3", "M5", "SP", "TOT"];
const EM_KEYS = ["0Y", "1Y", "2Y", "4Y", "6Y", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "TOT"];
const EW_KEYS = ["00", "01", "02", "03", "04", "05", "M6", "TOT"];

/**
 * cpmsapi030 응답 XML 파싱 → 70 필드 추출.
 * @param {string} xml
 * @returns {ChildcareDetail | null}
 */
export function parseChildcareDetailXml(xml) {
  // cpmsapi030 응답 = 단일 item 블록 (시설 1건)
  const itemMatch = /<item>([\s\S]*?)<\/item>/.exec(xml);
  if (!itemMatch) return null;
  const block = itemMatch[1];

  const stcode = extractTag(block, "stcode");
  const crname = extractTag(block, "crname");
  if (!stcode || !crname) return null;

  /** @type {Record<string, number>} */
  const class_cnt = {};
  for (const k of CLASS_KEYS) {
    class_cnt[k] = parseInt(extractTag(block, `CLASS_CNT_${k}`) ?? "0", 10) || 0;
  }
  /** @type {Record<string, number>} */
  const child_cnt = {};
  for (const k of CHILD_KEYS) {
    child_cnt[k] = parseInt(extractTag(block, `CHILD_CNT_${k}`) ?? "0", 10) || 0;
  }
  /** @type {Record<string, number>} */
  const em_cnt = {};
  for (const k of EM_KEYS) {
    em_cnt[k] = parseInt(extractTag(block, `EM_CNT_${k}`) ?? "0", 10) || 0;
  }
  /** @type {Record<string, number>} */
  const ew_cnt = {};
  for (const k of EW_KEYS) {
    ew_cnt[k] = parseInt(extractTag(block, `EW_CNT_${k}`) ?? "0", 10) || 0;
  }

  return {
    stcode,
    crname,
    la: extractTag(block, "la"),
    lo: extractTag(block, "lo"),
    sidoname: extractTag(block, "sidoname"),
    sigunname: extractTag(block, "sigunname"),
    zipcode: extractTag(block, "zipcode"),
    craddr: extractTag(block, "craddr"),
    crtypename: extractTag(block, "crtypename"),
    crstatusname: extractTag(block, "crstatusname"),
    crtelno: extractTag(block, "crtelno"),
    crfaxno: extractTag(block, "crfaxno"),
    crhome: extractTag(block, "crhome"),
    crrepname: extractTag(block, "CRREPNAME"),  // 운영 응답 = 대문자 태그 (extractTag 대소문자 구분)
    nrtrroomcnt: parseInt(extractTag(block, "nrtrroomcnt") ?? "0", 10) || 0,
    nrtrroomsize: parseInt(extractTag(block, "nrtrroomsize") ?? "0", 10) || 0,
    plgrdco: parseInt(extractTag(block, "plgrdco") ?? "0", 10) || 0,
    cctvinstlcnt: parseInt(extractTag(block, "cctvinstlcnt") ?? "0", 10) || 0,
    chcrtescnt: parseInt(extractTag(block, "chcrtescnt") ?? "0", 10) || 0,
    crcargbname: extractTag(block, "crcargbname"),
    crcapat: parseInt(extractTag(block, "crcapat") ?? "0", 10) || 0,
    crchcnt: parseInt(extractTag(block, "crchcnt") ?? "0", 10) || 0,
    crcnfmdt: extractTag(block, "crcnfmdt"),
    crpausebegindt: extractTag(block, "crpausebegindt"),
    crpauseenddt: extractTag(block, "crpauseenddt"),
    crabldt: extractTag(block, "crabldt"),
    datastdrdt: extractTag(block, "datastdrdt"),
    crspec: extractTag(block, "crspec"),
    class_cnt,
    child_cnt,
    em_cnt,
    ew_cnt,
  };
}

/**
 * 시군구 하나의 질의 주소 — key 먼저, arcode 만. stcode 는 넣지 않는다(빈 값도 금지):
 * 2u 실측(`childcare_api.py`) stcode 키가 있으면 ERROR-100, 없으면 그 시군구 시설 전체를 준다.
 * arcode 는 GU_LAWD_MAP 코드여야 한다 — 시설번호 앞자리(파주 40400 등)는 INFO-200 0건(세션606 원인 ①).
 * @param {string} key
 * @param {string} arcode
 * @returns {string}
 */
export function buildDetailUrl(key, arcode) {
  return `${BASE_URL}?key=${encodeURIComponent(key)}&arcode=${arcode}`;
}

/**
 * 시군구 응답 XML → 시설 상세 배열. `<item>` 블록을 전부 나누고(탐침 `probe_cpms_1007.mjs:20` 정규식)
 * 블록 하나는 기존 parseChildcareDetailXml 로 읽는다(대문자 CRREPNAME 등 태그 처리 그대로).
 * stcode·crname 이 없는 블록은 버린다.
 * @param {string} xml
 * @returns {ChildcareDetail[]}
 */
export function parseRegionDetailXml(xml) {
  /** @type {ChildcareDetail[]} */
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const d = parseChildcareDetailXml(`<item>${m[1]}</item>`);
    if (d) out.push(d);
  }
  return out;
}

/** childcare-info(cpmsapi021) 가 주인인 7필드 — 상세 수집기는 덮지 않는다(두 창구 값이 달라 매일 UPDATE 가 나는 것 방지). */
const INFO_OWNED_KEYS = /** @type {const} */ (["stcode", "crname", "crtel", "crfax", "craddr", "crhome", "crcapat"]);

/**
 * 기존 7 필드 facility + cpmsapi030 70 필드 detail 통합.
 * - info 소유 7필드(INFO_OWNED_KEYS)는 기존 값이 있으면 그대로 두고 상세만 덧입힌다(세션606 검사관 A·B).
 * - 새 la/lo 가 비었거나(null·"") 없으면 옛 좌표를 지킨다(세션606 검사관 A — 응답에 좌표 없는 시설).
 * @param {ExistingFacility} facility
 * @param {ChildcareDetail} detail
 * @returns {ChildcareDetail & { crtel: string, crfax: string }}
 */
export function mergeDetailIntoFacility(facility, detail) {
  /** @type {any} */
  const merged = {
    crtel: facility.crtel ?? "",
    crfax: facility.crfax ?? "",
    // cpmsapi030 70 필드 (위치 6 + 기본 8 + 시설 6 + 정원/현원 2 + 일자 6 + 4 배열)
    ...detail,
  };
  const fac = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (facility));
  for (const k of INFO_OWNED_KEYS) {
    if (fac[k] !== undefined) merged[k] = fac[k];
  }
  for (const k of ["la", "lo"]) {
    const next = merged[k];
    if ((next == null || next === "") && fac[k] != null && fac[k] !== "") merged[k] = fac[k];
  }
  return merged;
}

/**
 * 키 순서와 무관한 비교용 직렬화. DB jsonb 는 객체 키 순서를 바꿔 돌려주므로 JSON.stringify 만으로
 * 비교하면 같은 값도 매일 "바뀜"이 되어 멱등이 깨진다.
 * @param {unknown} v
 * @returns {string}
 */
function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = /** @type {Record<string, unknown>} */ (v);
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * 최신행 시설 목록에 응답 상세만 stcode 로 덧입힌다. 시설을 더하거나 빼지 않는다
 * (목록은 childcare-info 소유 — 응답에만 있는 시설은 버리고, 응답에 없는 시설은 그대로 둔다).
 * @param {ExistingFacility[]} facilities
 * @param {ChildcareDetail[]} details
 * @returns {{ facilities: Array<ExistingFacility | (ChildcareDetail & { crtel: string, crfax: string })>, matched: number, changed: boolean }}
 */
export function mergeRegionDetails(facilities, details) {
  const byStcode = new Map(details.map((d) => [d.stcode, d]));
  let matched = 0;
  const next = facilities.map((fac) => {
    const d = byStcode.get(fac.stcode);
    if (!d) return fac;
    matched++;
    return mergeDetailIntoFacility(fac, d);
  });
  return { facilities: next, matched, changed: stableStringify(next) !== stableStringify(facilities) };
}

/** 차단기 경계 — 시도한 시군구 중 (0건 응답 + 호출 실패) 비율이 이 값을 넘으면 failure. */
export const ZERO_RESPONSE_FAIL_RATIO = 0.1;

/**
 * 회차 판정. 다음 중 하나라도 있으면 failure(+ errorMessage), 아니면 success(중단 신호면 partial).
 * - (0건 응답 시군구 + 호출 실패 시군구) ÷ 시도한 시군구 > 10% — 사장님 결정 2026-10-07 "호출 시군구"
 * - 전역 종료(INFO-300/400 · 연속 네트워크 실패) — 전부 실패해도 success 로 묻히던 구멍(세션606 검사관 A·B)
 * - UPDATE 실패
 * 호출 실패 몇 곳이 10% 안이면 success 다(다음 회차가 다시 부른다) — fail_count 에는 남는다.
 * @param {{ attempted: number, zeroRegions: number, failedRegions: number, updateFails: number, stopReason: string | null, interrupted: boolean }} s
 * @returns {{ status: "success" | "failure" | "partial", errorMessage: string | null }}
 */
export function decideRunStatus(s) {
  /** @type {string[]} */
  const reasons = [];
  if (s.stopReason) reasons.push(s.stopReason);
  if (s.attempted > 0 && (s.zeroRegions + s.failedRegions) / s.attempted > ZERO_RESPONSE_FAIL_RATIO) {
    reasons.push(`0건 ${s.zeroRegions}·실패 ${s.failedRegions} / 시도 ${s.attempted} 시군구 > ${ZERO_RESPONSE_FAIL_RATIO * 100}%`);
  }
  if (s.updateFails > 0) reasons.push(`UPDATE 실패 ${s.updateFails}`);
  if (reasons.length > 0) return { status: "failure", errorMessage: reasons.join(" · ") };
  return { status: s.interrupted ? "partial" : "success", errorMessage: null };
}

/**
 * @typedef {{ id: number, region: string, gu: string | null, recorded_at: string, childcare: { facilities?: ExistingFacility[] } | null }} RegionRow
 */

/**
 * regions 전 행 → (region, gu) 최신행만. childcare-info.mjs:270-290 패턴 그대로
 * (selectAll 결과를 recorded_at 내림·id 내림으로 정렬한 뒤 pickLatestPerKey).
 * 옛 행은 대상에서 빠진다 — PATCH 를 최신행 id 로만 보내기 위함.
 * @param {RegionRow[]} allRegions
 * @returns {RegionRow[]}
 */
export function selectLatestRegions(allRegions) {
  const sorted = allRegions.slice().sort((a, b) => {
    if (a.recorded_at !== b.recorded_at) return a.recorded_at > b.recorded_at ? -1 : 1;
    return b.id - a.id;
  });
  const latestMap = pickLatestPerKey(sorted);
  const latestIds = new Set([...latestMap.values()].map((v) => v.id));
  return sorted.filter((r) => latestIds.has(r.id));
}

/**
 * 시군구 코드를 꺼낸다. 없으면 null(호출자가 skip + 로그). 표에서 키를 꺼낼 땐 hasOwnProperty
 * (admin-district-code-reform §3).
 * 제주는 GU_LAWD_MAP(50110/50130)이 아니라 제주 수집기의 49xxx 를 쓴다 — 세션606 탐침 2026-10-07 05:23
 * (`probe_jeju_city.mjs`): cpmsapi030 49110 → 270건 · 49130 → 99건 · 50110 → INFO-200 0건.
 * @param {string} region
 * @param {string | null} gu
 * @returns {string | null}
 */
export function resolveArcode(region, gu) {
  if (!gu) return null;
  if (region === "제주") {
    return Object.prototype.hasOwnProperty.call(JEJU_ARCODE_MAP, gu) ? JEJU_ARCODE_MAP[gu] : null;
  }
  const map = /** @type {Record<string, Record<string, string>>} */ (GU_LAWD_MAP);
  if (!Object.prototype.hasOwnProperty.call(map, region)) return null;
  const sido = map[region];
  return Object.prototype.hasOwnProperty.call(sido, gu) ? sido[gu] : null;
}

/**
 * 시군구 하나를 부를지 정한다(순수 함수 — main 은 이 결과대로만 움직인다).
 * 시설 0곳이면 호출하지 않고(0건으로도 안 센다), 코드가 없으면 skip.
 * arcode 는 resolveArcode 로만 — 시설번호 앞자리(옛 원인 ①)로 만들지 않는다.
 * @param {RegionRow} row
 * @returns {{ action: "none" } | { action: "noArcode" } | { action: "call", arcode: string, facilities: ExistingFacility[] }}
 */
export function planRegion(row) {
  const facilities = /** @type {ExistingFacility[]} */ (row.childcare?.facilities ?? []);
  if (facilities.length === 0) return { action: "none" };
  const arcode = resolveArcode(row.region, row.gu);
  if (!arcode) return { action: "noArcode" };
  return { action: "call", arcode, facilities };
}

/**
 * 시군구 하나의 응답을 처리한다(순수 함수). 파싱 → 0건 판정 → 상세 덧입힘 → 바뀜 판정.
 * @param {{ facilities: ExistingFacility[], xml: string }} input
 * @returns {{ parsed: number, zero: boolean, code: string | null, merged: Array<ExistingFacility | (ChildcareDetail & { crtel: string, crfax: string })>, matched: number, changed: boolean }}
 */
export function processRegion({ facilities, xml }) {
  const details = parseRegionDetailXml(xml);
  const code = /\b((?:INFO|ERROR)-\d+)\b/.exec(xml)?.[1] ?? null;
  if (details.length === 0) {
    return { parsed: 0, zero: facilities.length > 0, code, merged: facilities, matched: 0, changed: false };
  }
  const m = mergeRegionDetails(facilities, details);
  return { parsed: details.length, zero: false, code, merged: m.facilities, matched: m.matched, changed: m.changed };
}

/**
 * @typedef {{ attempted: number, processed: number, zeroRegions: number, failedRegions: number, updateFails: number, consecutiveNetFails: number, stopReason: string | null }} RunCounters
 */

/** @returns {RunCounters} */
export function initRunCounters() {
  return { attempted: 0, processed: 0, zeroRegions: 0, failedRegions: 0, updateFails: 0, consecutiveNetFails: 0, stopReason: null };
}

/**
 * 반복 한 바퀴의 결과로 회차 셈을 갱신한다(순수 함수 — main 은 이 결과로만 셈을 바꾸고,
 * `stopReason` 이 생기면 반복을 끝낸다). 세션606 재검사관 C: main 배선이 시험 밖이었다.
 * - fetched: 응답 받음 → 시도+1 · 응답+1 · 연속 네트워크 실패 0 · zero 면 0건+1
 * - quota: INFO-300/400 → 시도+1 · 전역 종료
 * - fetchFail: 호출 실패 → 시도+1 · 실패+1 · 네트워크 실패면 연속+1(임계 도달 = 전역 종료), 아니면 연속 0
 * - updateFail: UPDATE 실패 → +1 (시도는 fetched 에서 이미 셈)
 * @param {RunCounters} c
 * @param {{ type: "fetched", zero: boolean } | { type: "quota", code: string } | { type: "fetchFail", network: boolean } | { type: "updateFail" }} ev
 * @param {number} [circuit] 연속 네트워크 실패 임계(기본 GLOBAL_DEAD_CIRCUIT)
 * @returns {RunCounters}
 */
export function advanceRunCounters(c, ev, circuit = GLOBAL_DEAD_CIRCUIT) {
  switch (ev.type) {
    case "fetched":
      return {
        ...c,
        attempted: c.attempted + 1,
        processed: c.processed + 1,
        consecutiveNetFails: 0,
        zeroRegions: c.zeroRegions + (ev.zero ? 1 : 0),
      };
    case "quota":
      return { ...c, attempted: c.attempted + 1, stopReason: `${ev.code} 전역 종료` };
    case "fetchFail": {
      const consecutiveNetFails = ev.network ? c.consecutiveNetFails + 1 : 0;
      return {
        ...c,
        attempted: c.attempted + 1,
        failedRegions: c.failedRegions + 1,
        consecutiveNetFails,
        stopReason:
          ev.network && consecutiveNetFails >= circuit
            ? `연속 네트워크 실패 ${consecutiveNetFails} 시군구 전역 종료`
            : c.stopReason,
      };
    }
    case "updateFail":
      return { ...c, updateFails: c.updateFails + 1 };
  }
}

async function main() {
  if (!API_KEY) {
    logError("init", "CHILDCARE_BASIC_API_KEY 환경변수 필요");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  // --only=<region>:<gu> — 시군구 하나만(호출 1회). 구현 확인용 dry-run 한도.
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length) : null;
  log("init", `DAILY_LIMIT=${DAILY_LIMIT}${dryRun ? " --dry-run" : ""}${only ? ` --only=${only}` : ""}`);

  const sb = getSupabase();

  // regions 전 행을 고유키 커서로 읽고 (region, gu) 최신행만(세션606 원인 ② — 옛 코드는 무정렬 1,000행).
  /** @type {RegionRow[]} */
  let allRegions;
  try {
    allRegions = /** @type {any} */ (
      await selectAll((s) => s.from("regions").select("id, region, gu, recorded_at, childcare"), sb, "id")
    );
  } catch (e) {
    throw new Error(`regions 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  let targets = selectLatestRegions(allRegions);
  if (only) {
    targets = targets.filter((r) => `${r.region}:${r.gu}` === only);
    if (targets.length === 0) {
      logError("init", `--only=${only}: 해당 (region, gu) 최신행 없음`);
      process.exit(1);
    }
  }
  log("init", `regions ${allRegions.length}행 → (region, gu) 최신행 ${targets.length}건`);

  // 회차 셈(시도·응답·0건·실패·UPDATE 실패·연속 네트워크 실패·전역 종료 사유)은 advanceRunCounters 로만 바꾼다.
  //   attempted = 시도한 시군구 수(성공+실패) — DAILY_LIMIT·차단기 분모 · processed = 응답 받은 수(쿼터 기록)
  let c = initRunCounters();
  let updatedRegions = 0;
  let unchangedRegions = 0;
  const rpt = createReporter("childcare-detail");

  for (const r of targets) {
    if (rpt.interrupted()) break;
    const plan = planRegion(r);
    if (plan.action === "none") continue;  // 시설 0 = 호출하지 않는다
    if (plan.action === "noArcode") {
      log("skip", `${r.region} ${r.gu}: GU_LAWD_MAP 에 없음 — skip`);
      rpt.skip(1);
      continue;
    }
    const { arcode, facilities } = plan;

    // 시도(attempted) 기준 — 실패 호출도 진행으로 쳐야 네트워크 차단 시에도 종료조건이 발동한다.
    if (c.attempted >= DAILY_LIMIT) {
      log("limit", `DAILY_LIMIT ${DAILY_LIMIT} 도달 — 남은 시군구는 다음 회차`);
      break;
    }

    /** @type {string} */
    let xml;
    try {
      const res = await fetchWithRetry(buildDetailUrl(API_KEY, arcode));
      xml = await res.text();
      assertNoQuotaError(xml);  // INFO-300/400 = 전역 종료 신호 (0건 응답과 구분)
      await sleep(300);  // rate limit (population-sex-age L144 답습)
    } catch (e) {
      // INFO-300/400 = 오늘 더 호출 불가 → 즉시 전역 종료, failure 로 기록(다음 회차 재시도).
      if (e instanceof QuotaExceededError) {
        logError("quota", `${r.region} ${r.gu}: ${e.message} — 전역 종료 (다음 회차 재시도)`);
        c = advanceRunCounters(c, { type: "quota", code: e.code });
        break;
      }
      const msg = e instanceof Error ? e.message : String(e);
      // 네트워크 레벨 실패(해외 IP 차단 등)가 연속 N 시군구면 전면 차단 → 전역 종료(stopReason).
      c = advanceRunCounters(c, { type: "fetchFail", network: isNetworkError(msg) });
      logError("fetch", `${r.region} ${r.gu} (${arcode}): ${msg}`);
      rpt.fail(1);
      if (c.stopReason) {
        logError("circuit", `연속 ${c.consecutiveNetFails}개 시군구 네트워크 실패 — 전역 종료 (api.childcare.go.kr 해외 IP 차단 의심, 다음 회차 재시도)`);
        break;
      }
      continue;
    }

    const out = processRegion({ facilities, xml });
    c = advanceRunCounters(c, { type: "fetched", zero: out.zero });
    if (out.zero) {
      log("zero", `${r.region} ${r.gu} (${arcode}): 0건 응답(${out.code ?? "코드 없음"}) — 시설 ${facilities.length}곳 그대로, skip`);
      rpt.skip(1);
      continue;
    }

    const tag = `${r.region} ${r.gu} (${arcode}): 응답 ${out.parsed} · 병합 ${out.matched}/${facilities.length}`;
    if (!out.changed) {
      unchangedRegions++;
      log("same", `${tag} — 바뀐 것 없음, UPDATE 안 함`);
      rpt.skip(1);
      continue;
    }

    if (dryRun) {
      const sample = /** @type {any} */ (out.merged.find((f) => f.crtypename));
      log("dry-run", `${tag} — sample crtypename=${sample?.crtypename}, cctv=${sample?.cctvinstlcnt}, la=${sample?.la}`);
      updatedRegions++;
      continue;
    }

    // 최신행 id 로만 UPDATE (옛 행 0)
    const { error: updErr } = await sb
      .from("regions")
      .update({ childcare: { ...r.childcare, facilities: out.merged } })
      .eq("id", r.id);
    if (updErr) {
      logError("update", `${r.region} ${r.gu}: ${updErr.message}`);
      c = advanceRunCounters(c, { type: "updateFail" });
      rpt.fail(1);
    } else {
      updatedRegions++;
      rpt.success(1);
      log("update", `${tag} (${c.processed}/${DAILY_LIMIT})`);
    }
  }

  log("done", `cpmsapi030 시도 ${c.attempted}회 (응답 ${c.processed} · 실패 ${c.failedRegions}) / 0건 ${c.zeroRegions} / 바뀜 없음 ${unchangedRegions} / regions UPDATE ${updatedRegions}건${c.stopReason ? ` / ${c.stopReason}` : ""}`);

  if (!dryRun) await recordApiQuota("childcare-detail", "CHILDCARE_BASIC_API_KEY", c.processed);
  const summary = rpt.summary();
  const verdict = decideRunStatus({
    attempted: c.attempted,
    zeroRegions: c.zeroRegions,
    failedRegions: c.failedRegions,
    updateFails: c.updateFails,
    stopReason: c.stopReason,
    interrupted: summary.status === "partial",
  });
  if (verdict.errorMessage) logError("verdict", `failure — ${verdict.errorMessage} (이미 UPDATE 한 시군구는 그대로)`);
  await recordCollectorRun("childcare-detail", { ...summary, status: verdict.status, errorMessage: verdict.errorMessage });
  if (verdict.status === "failure") process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });
