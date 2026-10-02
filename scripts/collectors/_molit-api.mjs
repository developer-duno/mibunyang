// @ts-check
/**
 * 국토부 공동주택 API 공유 모듈
 *
 * molit-units.mjs, molit-building-info.mjs 공통 코드:
 *   - 시도 코드 매핑, API URL, 레이트리밋 상수
 *   - API 호출 (재시도 + 선형 백오프)
 *   - 시도별 단지 목록 페이지네이션
 *   - 이름 매칭 (유사도 + 구 보너스) — ⚠️ 세 수집기는 세션589 부터 `_match-gates.mjs pickKaptMatch` 를 쓴다
 *     (`findBestMatch` 는 시도 전체에서 이름 0.5 라 남의 단지 값을 붙였다). 이 함수는 지우지 않고 둔다.
 *   - K-apt 호출 간격 1.5초 · 결과 코드 검사(`KaptResultError`) — 세션589 R1·R2
 */

/**
 * @typedef {object} MolitApiResponse
 * @property {{ body?: { totalCount?: number | string; items?: unknown } } | undefined} [response]
 *
 * @typedef {{
 *   kaptCode?: string;
 *   kaptName?: string;
 *   as1?: string;
 *   as2?: string;
 *   as3?: string;
 *   [k: string]: unknown;
 * }} MolitAptItem
 */

import { stringSimilarity, sleep, log } from "./_shared.mjs";

// ── 상수 ─────────────────────────────────────────────────────
// 2026-08-19 data.go.kr 인증체계 개편으로 V3/V4 는 폐기(NO_OPENAPI_SERVICE_ERROR) —
// V4/V5 로 교체 (세션388 naver-estate-web 라이브 실측, 필드명은 V4→V5 동일 유지 확인).
export const API_LIST_BASE = "https://apis.data.go.kr/1613000/AptListService4";
export const API_DETAIL_BASE = "https://apis.data.go.kr/1613000/AptBasisInfoServiceV5";
export const MIN_SIMILARITY = 0.5;
export const REQUEST_DELAY = 400; // ms — API 레이트리밋 방지 (건축HUB `collect-building-hub.mjs` 도 쓴다 — K-apt 간격은 아래 별도)

/**
 * K-apt 호출 간격(ms) — 세션589 R1. K-apt 서비스 3종(`AptListService4` · `AptBasisInfoServiceV5` ·
 * `AptIndvdlzManageCostServiceV3`)이 **함께** 지킨다(모듈 안 마지막 K-apt 호출 시각 기준).
 * 2u 인계(2026-10-01, 서버 밖 측정): 0.3초 간격이면 33번째 콜부터 약 10분간 K-apt 전체가 04,
 * 1.5초는 400콜·10분 동안 04 0건. ⚠️ 한 프로세스 안에서만 지켜진다 — 자매 레포가 같은 열쇠로
 * 같은 시각에 부르면 합쳐서 넘는다(그래서 `_match-gates.mjs inSiblingKaptWindow` 가 따로 있다).
 */
export const KAPT_MIN_INTERVAL_MS = 1500;
/** 시도 목록 한 쪽 크기 — 경기 5,665건이 한 번에 온다(옛 500씩 12콜이 속도 제한을 앞당겼다). */
export const KAPT_LIST_PAGE_SIZE = 6000;
/** K-apt 서비스 판별 — `/1613000/Apt…Service…` (목록·기본정보·관리비). 건축HUB 등은 해당 없음. */
const KAPT_BASE_RE = /\/1613000\/Apt[A-Za-z]*Service/;
/**
 * data.go.kr 일시 오류 코드 — 기다리면 풀릴 수 있다(2u `kapt_api.py _TRANSIENT_REASON_CODES` 와 같은 분류).
 * 04 = 속도 제한 벌칙 중에 오는 코드(실측). 벌칙 중 계속 부르면 길어지므로 수집기는 회차를 멈춘다.
 */
export const KAPT_TRANSIENT_CODES = Object.freeze(["01", "02", "04", "05", "99"]);
/** 03 = 자료 없음 — 실패가 아니라 빈 결과. */
const KAPT_NODATA_CODE = "03";

let lastKaptCallAt = -Infinity;

/**
 * K-apt 호출 직전에 부른다 — 직전 K-apt 호출에서 `KAPT_MIN_INTERVAL_MS` 가 안 지났으면 나머지를 기다린다.
 * @returns {Promise<void>}
 */
async function waitForKaptSlot() {
  const wait = lastKaptCallAt + KAPT_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastKaptCallAt = Date.now();
}

/**
 * K-apt 결과 코드가 00(정상)·03(자료 없음)이 아닌 응답 — "자료 없음"이 아니라 **실패**다(세션589 R2).
 * 메시지는 `KAPT_RESULT_<코드>` 로 시작한다(수집기가 `collector_runs.error_message` 머리말로 쓴다).
 */
export class KaptResultError extends Error {
  /**
   * @param {string} code 두 자리 사유 코드("04")
   * @param {string | null} reason 응답 문구
   * @param {string} endpoint
   */
  constructor(code, reason, endpoint) {
    super(`KAPT_RESULT_${code} ${endpoint}${reason ? ` (${reason})` : ""}`);
    this.name = "KaptResultError";
    this.code = code;
    this.transient = KAPT_TRANSIENT_CODES.includes(code);
  }
}

/**
 * 사유 코드 정규화 — 숫자면 두 자리 문자열(4·"4" → "04", 0 → "00"). 빈 값은 null.
 * @param {unknown} v
 * @returns {string | null}
 */
function normCode(v) {
  if (v == null) return null;
  const t = String(v).trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? t.padStart(2, "0") : t;
}

/**
 * 응답에서 결과 코드와 문구를 찾는다. 정상 모양 `response.header.resultCode` · 오류 봉투
 * `OpenAPI_ServiceResponse.cmmMsgHeader.returnReasonCode`(또는 최상위 `cmmMsgHeader`). 없으면 null.
 * @param {any} json
 * @returns {{ code: string; reason: string | null } | null}
 */
function resultCodeOf(json) {
  if (!json || typeof json !== "object") return null;
  const header = json.response?.header;
  if (header && typeof header === "object" && header.resultCode != null) {
    const code = normCode(header.resultCode);
    return code ? { code, reason: header.resultMsg != null ? String(header.resultMsg) : null } : null;
  }
  const env = json.OpenAPI_ServiceResponse?.cmmMsgHeader ?? json.cmmMsgHeader;
  if (env && typeof env === "object") {
    const code = normCode(env.returnReasonCode);
    const reason = env.returnAuthMsg ?? env.errMsg;
    return code ? { code, reason: reason != null ? String(reason) : null } : null;
  }
  return null;
}

// API 재시도 정책 (scripts/CLAUDE.md § API Rate Limit 참조)
const MOLIT_MAX_RETRIES = 3;
const MOLIT_TIMEOUT_MS = 30000;        // 30초
const MOLIT_BACKOFF_429_MS = 2000;     // 429 Rate Limit: (i+1)×2초
const MOLIT_BACKOFF_5XX_MS = 1000;     // 5XX 서버에러: (i+1)×1초

// 시도 약칭 → 시도 코드 (법정동 코드 앞 2자리)
// ⚠️ 광주·전남 = 같은 시도코드 "12" (2026-07-01 전남광주통합특별시 출범, 옛 29·46 폐지).
//    두 region 그룹이 같은 1,758건 목록을 각각 받는다 — 광주 단지가 전남 단지와 짝지어지지 않게
//    하는 것은 `_match-gates.mjs sameSigungu`(법정동코드 앞 5자리)다(세션589 — 옛 구 가산은 거의 안 붙었다).
/** @type {import("../types.ts").RegionMap} */
export const SIDO_CODE = {
  "서울": "11", "부산": "26", "대구": "27", "인천": "28",
  "광주": "12", "대전": "30", "울산": "31", "세종": "36",
  "경기": "41", "강원": "51", "충북": "43", "충남": "44",
  "전북": "52", "전남": "12", "경북": "47", "경남": "48", "제주": "50",
};
// ⚠️ 강원 "51"(2023-06-11 강원특별자치도) · 전북 "52"(2024-01-18 전북특별자치도) — 세션589 V7.
//    옛 42·45 는 K-apt 목록이 0건이라 두 도가 통째로 매칭 대상에서 빠져 있었다(조사반 G 실측).

// ── 재시도 불가 에러 (4xx, XML 응답 등 즉시 실패) ───────────
class NonRetryableError extends Error {
  /** @param {string} message */
  constructor(message) { super(message); this.name = "NonRetryableError"; }
}

// ── API 호출 (재시도 + 선형 백오프) ──────────────────────────
// phase: 로그 프리픽스, apiKey: 모듈 스코프 대신 파라미터로 주입
// opts: 호출처가 timeout/retry 를 좁힐 수 있음 (기본 = 공유 상수 30s×3). collect-maintenance 의
//   fetchTotalHouseholds 는 8s/1retry 로 좁혀 hang 누적을 막음(세션 451). 미전달 시 molit-units·
//   molit-building-info 는 기존 30s×3 그대로 동작 → cross-collector 회귀 0.
/**
 * @param {string} phase
 * @param {string} baseUrl
 * @param {string} endpoint
 * @param {Record<string, string>} params
 * @param {string} apiKey
 * @param {{ timeoutMs?: number; maxRetries?: number }} [opts]
 * @returns {Promise<MolitApiResponse>}
 */
export async function molitApiCall(phase, baseUrl, endpoint, params, apiKey, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? MOLIT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? MOLIT_MAX_RETRIES;
  const qs = new URLSearchParams({ serviceKey: apiKey, type: "json", ...params });
  const url = `${baseUrl}/${endpoint}?${qs}`;
  const isKapt = KAPT_BASE_RE.test(baseUrl);
  let lastStatus = 0;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (isKapt) await waitForKaptSlot(); // 재시도도 한 번의 호출이다 — 매번 간격을 지킨다
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });

      // 재시도 가능: 429/500/503
      if (res.status === 429) {
        lastStatus = 429;
        if (attempt === maxRetries - 1) break;
        await sleep((attempt + 1) * MOLIT_BACKOFF_429_MS);
        continue;
      }
      if (res.status === 500 || res.status === 503) {
        lastStatus = res.status;
        log(phase, `  API ${res.status} (시도 ${attempt + 1}/${maxRetries})`);
        if (attempt === maxRetries - 1) break;
        await sleep((attempt + 1) * MOLIT_BACKOFF_5XX_MS);
        continue;
      }

      // 즉시 throw (재시도 불가): 4xx
      if (!res.ok) throw new NonRetryableError(`HTTP ${res.status}`);

      const text = await res.text();
      // data.go.kr sometimes returns XML error even with type=json
      if (text.startsWith("<?xml") || text.startsWith("<")) {
        if (text.includes("SERVICE_KEY_IS_NOT_REGISTERED")) {
          throw new NonRetryableError("API 키 미등록 — data.go.kr에서 서비스 신청 필요");
        }
        // 오류 봉투가 XML 로 오는 엔드포인트가 있다(2u 실측) — 사유 코드가 있으면 결과 코드 실패로.
        const xmlCode = normCode(/<returnReasonCode>\s*(\d+)\s*<\/returnReasonCode>/.exec(text)?.[1] ?? /<resultCode>\s*(\d+)\s*<\/resultCode>/.exec(text)?.[1]);
        if (xmlCode && xmlCode !== "00") {
          if (xmlCode === KAPT_NODATA_CODE) return {};
          const xmlReason = /<returnAuthMsg>([^<]*)<\/returnAuthMsg>/.exec(text)?.[1] ?? /<(?:errMsg|resultMsg)>([^<]*)<\//.exec(text)?.[1] ?? null;
          throw new KaptResultError(xmlCode, xmlReason, endpoint);
        }
        throw new NonRetryableError(`XML 응답: ${text.slice(0, 200)}`);
      }

      const json = JSON.parse(text);
      // 결과 코드 검사(세션589 R2) — HTTP 200 + JSON 이어도 00 이 아니면 자료 없음이 아니라 실패다.
      // 03(자료 없음)만 빈 결과로 돌려준다(body 를 비워 호출처가 "항목 없음"으로 읽게).
      const rc = resultCodeOf(json);
      if (rc && rc.code !== "00") {
        if (rc.code === KAPT_NODATA_CODE) return { response: { body: { totalCount: 0 } } };
        throw new KaptResultError(rc.code, rc.reason, endpoint);
      }
      return json;
    } catch (err) {
      // NonRetryableError·결과 코드 실패 → 즉시 re-throw (재시도 안 함 — 벌칙 중에 더 부르면 길어진다)
      if (err instanceof NonRetryableError || err instanceof KaptResultError) throw err;
      // 타임아웃/네트워크 에러 → 재시도
      if (attempt === maxRetries - 1) throw err;
      lastStatus = 0;
      await sleep((attempt + 1) * MOLIT_BACKOFF_5XX_MS);
    }
  }
  // 429/500/503 재시도 소진
  throw new Error(`${endpoint}: ${maxRetries}회 재시도 소진 (마지막 상태: ${lastStatus})`);
}

// ── 시도별 단지 목록 조회 (V3: AptListService3 — 페이지네이션) ─
/**
 * @param {string} phase
 * @param {string} sidoCode
 * @param {string} apiKey
 * @returns {Promise<MolitAptItem[]>}
 */
export async function fetchSidoAptList(phase, sidoCode, apiKey) {
  /** @type {MolitAptItem[]} */
  const allItems = [];
  let pageNo = 1;

  while (true) {
    const params = { numOfRows: String(KAPT_LIST_PAGE_SIZE), pageNo: String(pageNo), sidoCode };
    const json = await molitApiCall(phase, API_LIST_BASE, "getSidoAptList4", params, apiKey);
    const body = json?.response?.body;
    if (!body || body.totalCount === 0) break;

    // V3: body.items가 바로 배열 (V1에서는 body.items.item이었음)
    const items = body.items;
    const rawItems = Array.isArray(items)
      ? items
      : (/** @type {{ item?: unknown }} */ (items))?.item;
    if (!rawItems) break;
    const page = Array.isArray(rawItems) ? rawItems : [rawItems];
    allItems.push(...page);

    const totalCount = parseInt(String(body.totalCount ?? "0"), 10) || 0;
    if (allItems.length >= totalCount || page.length < KAPT_LIST_PAGE_SIZE) break;

    pageNo++; // 쪽 사이 간격은 molitApiCall 의 K-apt 간격(1.5초)이 지킨다
  }

  return allItems;
}

// ── 이름 정규화 ──────────────────────────────────────────────
/**
 * @param {string | null | undefined} name
 * @returns {string}
 */
export function cleanName(name) {
  // 괄호 내용 제거, 공백 정리
  return (name || "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

// ── 이름 매칭 ────────────────────────────────────────────────
// opts.guField    : "address" (as1+as2+as3) | "kaptName" (단지명)
// opts.guBonus    : 구 일치 시 보너스 점수 (기본 0.15)
// opts.attachScore: 결과에 matchScore 필드 첨부 여부 (기본 true)
/**
 * @param {string} targetName
 * @param {string | null | undefined} targetGu
 * @param {MolitAptItem[]} aptList
 * @param {{ guField?: "address" | "kaptName"; guBonus?: number; attachScore?: boolean }} [opts]
 * @returns {(MolitAptItem & { matchScore?: number }) | null}
 */
export function findBestMatch(targetName, targetGu, aptList, opts = {}) {
  const { guField = "address", guBonus = 0.15, attachScore = true } = opts;
  const cleaned = cleanName(targetName);
  let best = null;
  let bestScore = 0;

  for (const apt of aptList) {
    const kaptName = apt.kaptName || apt.as3 || "";
    let score = stringSimilarity(cleaned, cleanName(kaptName));

    // 구 이름 매칭 보너스
    if (targetGu) {
      if (guField === "address") {
        const addr = (apt.as1 || "") + (apt.as2 || "") + (apt.as3 || "");
        if (addr.includes(targetGu)) score += guBonus;
      } else {
        if (kaptName.includes(targetGu)) score += guBonus;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = attachScore
        ? { ...apt, matchScore: Math.round(score * 100) / 100 }
        : apt;
    }
  }

  return bestScore >= MIN_SIMILARITY ? best : null;
}
