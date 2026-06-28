// @ts-check
/**
 * 국토부 공동주택 API 공유 모듈
 *
 * molit-units.mjs, molit-building-info.mjs 공통 코드:
 *   - 시도 코드 매핑, API URL, 레이트리밋 상수
 *   - API 호출 (재시도 + 선형 백오프)
 *   - 시도별 단지 목록 페이지네이션
 *   - 이름 매칭 (유사도 + 구 보너스)
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
export const API_LIST_BASE = "https://apis.data.go.kr/1613000/AptListService3";
export const API_DETAIL_BASE = "https://apis.data.go.kr/1613000/AptBasisInfoServiceV4";
export const MIN_SIMILARITY = 0.5;
export const REQUEST_DELAY = 400; // ms — API 레이트리밋 방지

// API 재시도 정책 (scripts/CLAUDE.md § API Rate Limit 참조)
const MOLIT_MAX_RETRIES = 3;
const MOLIT_TIMEOUT_MS = 30000;        // 30초
const MOLIT_BACKOFF_429_MS = 2000;     // 429 Rate Limit: (i+1)×2초
const MOLIT_BACKOFF_5XX_MS = 1000;     // 5XX 서버에러: (i+1)×1초

// 시도 약칭 → 시도 코드 (법정동 코드 앞 2자리)
/** @type {import("../types.ts").RegionMap} */
export const SIDO_CODE = {
  "서울": "11", "부산": "26", "대구": "27", "인천": "28",
  "광주": "29", "대전": "30", "울산": "31", "세종": "36",
  "경기": "41", "강원": "42", "충북": "43", "충남": "44",
  "전북": "45", "전남": "46", "경북": "47", "경남": "48", "제주": "50",
};

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
  let lastStatus = 0;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
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
        throw new NonRetryableError(`XML 응답: ${text.slice(0, 200)}`);
      }

      return JSON.parse(text);
    } catch (err) {
      // NonRetryableError → 즉시 re-throw (재시도 안 함)
      if (err instanceof NonRetryableError) throw err;
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
    const params = { numOfRows: "500", pageNo: String(pageNo), sidoCode };
    const json = await molitApiCall(phase, API_LIST_BASE, "getSidoAptList3", params, apiKey);
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
    if (allItems.length >= totalCount || page.length < 500) break;

    pageNo++;
    await sleep(REQUEST_DELAY);
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
