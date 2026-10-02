// @ts-check
/**
 * 수집기 짝 짓기 게이트 — "이름만 비슷한 먼 단지 값"이 새로 들어오는 구멍을 막는 **순수 함수 모음** (세션589)
 *
 * 설계서: `docs/superpowers/specs/2026-10-02-collector-match-gates.md` §2(K1~K6 · N1·N2 · R3) · §3.
 * 실측 재료(깃 밖): `.omc/artifacts/session589/viz/gates/gates_report.md`.
 *
 * ## 왜 있나
 *
 * 수집기 넷이 거리·지역 확인 없이 남의 단지 값을 붙였다(평촌롯데캐슬르씨엘 ← 313km 밖 부산
 * `롯데캐슬드메르` 의 주차·용적률). K-apt 쪽(`molit-units`·`molit-building-info`·`collect-maintenance`)은
 * `_molit-api.mjs findBestMatch` = 시도 목록 전체에서 이름 유사도 0.5 였고, 구 가산(0.15)은
 * "수원시 장안구" 꼴 구에 한 번도 안 붙었다(K-apt 목록 `as2` 는 "수원장안구"). 네이버 쪽
 * (`sync-naver-complex` Phase 4)은 전국 이름 유사도 0.6 에 거리 확인이 없었다.
 * 규칙을 **이 파일 한 곳**에 두고 네 수집기가 같이 쓴다 — 한쪽만 고치면 조용히 어긋난다.
 *
 * ## 규칙 요약
 *
 * - K-apt 짝(`pickKaptMatch`, K1·K2·K3·K5): ① 완공월을 알아야 하고(K5) ② 입주 후 단지만 ③ 같은
 *   시군구(법정동코드 앞 5자리, 없으면 구 이름 글자) ④ 차수·블록 충돌 없음 ⑤ 정리한 이름
 *   유사도 ≥ 0.6 → **남은 후보 중 최고 점수**("걸러 놓고 고르기").
 * - K-apt 기본정보 확인(`usedateConsistent`, K4): 사용승인일이 우리 완공월과 24개월 넘게 다르면 버린다.
 * - 네이버 관리비·향(`pickNaverComplexForListing`, N1): 500m + 정리한 이름 ≥ 0.75 + 차수·블록 충돌
 *   없음 → 여럿이면 **가장 가까운 단지**. 500m 판정은 `sync-naver-complex.mjs` 의
 *   `withinMatchRange`/`distanceM` 을 **주입받는다**(그 규칙의 정본은 그 파일 — 여기서 다시 쓰지 않는다).
 * - 2u 창(`inSiblingKaptWindow`, R3): 자매 레포가 같은 K-apt 열쇠를 쓰는 시각에는 비켜 간다.
 *
 * ⚠️ `_` 접두 = 라이브러리. graceful/exit-quota/orphan 감사가 자동 제외한다(`_molit-api.mjs` 선례).
 * ⚠️ 시각은 전부 인자(`now`)로 받는다 — 시험이 실제 시각에 기대지 않게(`flaky-time-check`).
 */
import { stringSimilarity } from "./_shared.mjs";
import { stripRoundWords, phaseConsistent, blockConflict } from "./_kakao-poi.mjs";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** K3 — K-apt 짝의 정리한 이름 유사도 하한. 0.7 이면 지번·세대수가 맞는 진짜 4곳을 자른다(표본). */
export const KAPT_MIN_NAME_SIM = 0.6;
/** K4 — 사용승인일과 우리 완공월의 허용 차이(개월). 표본의 확실한 가짜 2곳은 36·289개월. */
export const USEDATE_MAX_DIFF_MONTHS = 24;
/** N1 — 네이버 단지(관리비·향) 짝의 정리한 이름 유사도 하한. 500m + 0.6 만으로는 형제 블록이 샌다. */
export const NAVER_MIN_NAME_SIM = 0.75;

/**
 * R3 — 자매 레포(naver-estate-web, 2u)가 K-apt 를 쓰는 창(KST, 분 단위, 양끝 포함).
 * 출처 = 2u 인계(메모리 `handoff_from_2u_2026-10-01_kapt_rate_limit.md` · 10-02 추가분).
 * 같은 열쇠라 둘이 겹치면 합계가 K-apt 한계(약 0.9콜/초)를 넘어 약 10분간 전부 04 가 된다.
 */
export const SIBLING_KAPT_WINDOWS_KST = Object.freeze([
  Object.freeze({ start: "06:20", end: "08:25" }),
  Object.freeze({ start: "12:40", end: "15:15" }),
  Object.freeze({ start: "21:00", end: "23:30" }),
]);

// ── 완공월 ──────────────────────────────────────────────────

/**
 * 완공월을 **월 일련번호**(연×12 + 월−1)로. 형식 불명·미기재는 null.
 *
 * ⚠️ `src/scoring/scorePrice.ts` 의 `parseCompletionMonth` 와 **같은 입력에 같은 답**이어야 한다
 * (TS 파일이라 scripts 에서 import 하지 못해 규칙을 옮겼다 — `_match-gates.test.mjs` 가 두 함수를
 * 같은 입력표로 맞댄다). 문자열을 `new Date` 에 넣지 않는다: `"202211-01"` 은 서기 202211년,
 * `"20266"` 은 서기 20266년이 되어 "미래" 판정이 조용히 전부 참이 된다
 * (`probe-must-be-self-verified.md` §4-2).
 * @param {unknown} completion
 * @returns {number | null}
 */
export function completionMonthIndex(completion) {
  if (completion == null) return null;
  const s = String(completion).trim();
  if (!s) return null;
  //                      "202605"                    "2025-06-01" / "2025-6"
  const m = /^(\d{4})(\d{2})$/.exec(s) ?? /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return Number(m[1]) * 12 + (month - 1);
}

/**
 * `now` 의 KST 월 일련번호.
 * @param {Date} now
 * @returns {number}
 */
export function monthIndexKst(now) {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return kst.getUTCFullYear() * 12 + kst.getUTCMonth();
}

/**
 * 입주 후 단지인가 — **완공월이 이번 달보다 앞**이어야 참. 완공월이 이번 달이거나 그 뒤면 거짓
 * (`scorePrice.ts isPresale` 의 `idx >= 이번 달` = 입주 전과 같은 경계). 완공월을 모르면 거짓(K5).
 * @param {unknown} completion
 * @param {Date} now
 * @returns {boolean}
 */
export function isMovedIn(completion, now) {
  const idx = completionMonthIndex(completion);
  return idx != null && idx < monthIndexKst(now);
}

// ── 이름 ────────────────────────────────────────────────────

/** 로마 숫자(유니코드 한 글자) → 아라비아 숫자. 대문자 Ⅰ~Ⅻ · 소문자 ⅰ~ⅻ. */
/** @type {Record<string, string>} */
const ROMAN_DIGITS = {
  "Ⅰ": "1", "Ⅱ": "2", "Ⅲ": "3", "Ⅳ": "4", "Ⅴ": "5", "Ⅵ": "6",
  "Ⅶ": "7", "Ⅷ": "8", "Ⅸ": "9", "Ⅹ": "10", "Ⅺ": "11", "Ⅻ": "12",
  "ⅰ": "1", "ⅱ": "2", "ⅲ": "3", "ⅳ": "4", "ⅴ": "5", "ⅵ": "6",
  "ⅶ": "7", "ⅷ": "8", "ⅸ": "9", "ⅹ": "10", "ⅺ": "11", "ⅻ": "12",
};
const ROMAN_RE = /[Ⅰ-Ⅻⅰ-ⅻ]/g;

/**
 * 이름에 든 로마 숫자 집합(아라비아로 바꾼 값) — `"넥스티엘Ⅲ"` → `{"3"}`.
 * @param {unknown} name
 * @returns {Set<string>}
 */
function romanNumbers(name) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const m of String(name ?? "").matchAll(ROMAN_RE)) {
    const v = ROMAN_DIGITS[m[0]];
    if (v) out.add(v);
  }
  return out;
}

/**
 * 유사도 비교용 이름 — 회차 낱말 떼기(`stripRoundWords`) → 괄호 제거 → 로마 숫자를 아라비아로.
 *
 * `"평택지제역자이 무순위(사후) 1차"` → `"평택지제역자이"`(1차는 단지 차수가 아니라 공고 회차).
 * 회차 낱말이 남으면 K-apt 정식 이름과의 유사도가 0.6 아래로 눌려 진짜 짝을 버린다.
 * @param {unknown} name
 * @returns {string}
 */
export function cleanMatchName(name) {
  return stripRoundWords(name)
    .replace(/\([^)]*\)/g, " ")
    .replace(ROMAN_RE, (ch) => ROMAN_DIGITS[ch] ?? ch)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 두 이름이 **같은 단지일 수 있는가** — 차수·블록·로마 숫자 중 하나라도 "둘 다 있는데 겹치지 않음"이면 거짓.
 *
 * 판정은 이미 있는 것을 쓴다(`_kakao-poi.mjs` `phaseConsistent` · `blockConflict` — 분양 매칭·좌표
 * 정정과 같은 잣대). 회차 낱말은 떼고(`stripRoundWords` — 괄호는 남긴다: `(A7BL)` 같은 블록 표기가
 * 거기 있다) 본다. 로마 숫자는 `PHASE_RE` 가 못 보므로 따로 본다(넥스티엘Ⅲ ↔ 넥스티엘Ⅰ).
 * 한쪽에만 차수가 있는 것(`"one-sided"`)은 막지 않는다 — 막는 건 **아는 차이**뿐이다
 * (K-apt 정식 이름은 차수 표기를 빼는 일이 흔하다: "반월자이 더 파크(1차)" ↔ "…반월자이더 파크아파트").
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function namesCompatible(a, b) {
  const sa = stripRoundWords(a);
  const sb = stripRoundWords(b);
  if (phaseConsistent(sa, sb) === "conflict") return false;
  if (blockConflict(sa, sb)) return false;
  const ra = romanNumbers(sa);
  const rb = romanNumbers(sb);
  if (ra.size > 0 && rb.size > 0 && ![...ra].some((v) => rb.has(v))) return false;
  return true;
}

// ── K-apt 짝 ────────────────────────────────────────────────

/**
 * @typedef {{ name: string; region?: string | null; gu?: string | null; bjd_code?: string | null; completion?: unknown }} GateApt
 * @typedef {{ kaptCode?: string; kaptName?: string; bjdCode?: string | number | null; as1?: string | null; as2?: string | null; as3?: string | null; [k: string]: unknown }} KaptListItem
 */

/**
 * 구 이름 비교 키 — 공백을 빼고 "…시 …구" 의 시를 뗀다("수원시 장안구" → "수원장안구" = K-apt `as2` 표기).
 * @param {unknown} gu
 * @returns {string}
 */
function guKey(gu) {
  return String(gu ?? "").trim().replace(/시\s+/, "").replace(/\s+/g, "");
}

/**
 * K2 — 같은 시군구인가. **법정동코드 앞 5자리**(`apartments.bjd_code` ↔ K-apt 목록 `bjdCode`)로 본다.
 * 우리 쪽 코드가 없으면 구 이름 글자(`guKey`)가 K-apt `as2` 와 같아야 한다. 둘 다 없으면 거짓
 * (모르면 붙이지 않는다). 세종은 시도 = 시라 `gu`·`as2` 가 비어 있는 것이 정상이다 — 시도 목록이
 * 이미 세종뿐이므로 참.
 *
 * 광주·전남은 같은 목록 "12" 를 받는다(2026-07 통합) — 시군구 코드가 갈라 주므로 광주 단지가
 * 전남 단지와 짝지어지지 않는다.
 * @param {GateApt} apt
 * @param {KaptListItem} item
 * @returns {boolean}
 */
export function sameSigungu(apt, item) {
  const ours = String(apt.bjd_code ?? "").trim();
  const theirs = String(item.bjdCode ?? "").trim();
  if (/^\d{5}/.test(ours)) return /^\d{5}/.test(theirs) && ours.slice(0, 5) === theirs.slice(0, 5);
  const gk = guKey(apt.gu);
  if (gk) return gk === guKey(item.as2);
  return apt.region === "세종";
}

/**
 * K1·K5 — K-apt 시도 목록에서 그 단지의 짝을 고른다. **걸러 놓고 고르기**: 게이트를 지난 후보 중
 * 정리한 이름 유사도가 가장 높은 것(같으면 목록 순서상 앞). 탈락하면 `match: null` + `reason`(로그용).
 * @template {KaptListItem} T
 * @param {GateApt} apt
 * @param {T[]} kaptList
 * @param {{ now: Date }} opts
 * @returns {{ match: T | null; score: number; reason: string | null }}
 */
export function pickKaptMatch(apt, kaptList, { now }) {
  if (completionMonthIndex(apt.completion) == null) {
    return { match: null, score: 0, reason: `완공월 모름(completion=${apt.completion ?? "null"}) — K-apt 매칭 안 함` };
  }
  if (!isMovedIn(apt.completion, now)) {
    return { match: null, score: 0, reason: `입주 전 단지(completion=${apt.completion}) — K-apt 매칭 안 함` };
  }
  const name = cleanMatchName(apt.name);
  /** @type {T | null} */
  let best = null;
  let bestScore = 0;
  let sameGu = 0;
  let compatible = 0;
  for (const item of kaptList) {
    if (!sameSigungu(apt, item)) continue;
    sameGu++;
    const kName = item.kaptName || item.as3 || "";
    if (!namesCompatible(apt.name, kName)) continue;
    compatible++;
    const score = stringSimilarity(name, cleanMatchName(kName));
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  const rounded = Math.round(bestScore * 100) / 100;
  if (sameGu === 0) return { match: null, score: 0, reason: "같은 시군구 후보 없음" };
  if (compatible === 0) return { match: null, score: 0, reason: `같은 시군구 ${sameGu}곳이 전부 차수·블록 충돌` };
  if (!best || bestScore < KAPT_MIN_NAME_SIM) {
    return { match: null, score: rounded, reason: `이름 유사도 < ${KAPT_MIN_NAME_SIM} (최고 ${rounded})` };
  }
  return { match: best, score: rounded, reason: null };
}

/**
 * K-apt `kaptUsedate`(사용승인일, 실측 형식 `"20010907"`)의 월 일련번호. 형식 불명·빈값은 null.
 * @param {unknown} v
 * @returns {number | null}
 */
function usedateMonthIndex(v) {
  const m = /^(\d{4})-?(\d{2})(?:-?\d{2})?$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return Number(m[1]) * 12 + (month - 1);
}

/**
 * K4 — K-apt 기본정보의 사용승인일이 우리 완공월과 24개월 안인가. 어느 쪽이든 모르면 **거짓**
 * (확인할 수 없는 짝은 쓰지 않는다 — K5 와 같은 쪽). 경계 포함: 정확히 24개월 차이는 통과.
 * @param {unknown} completion
 * @param {unknown} kaptUsedate
 * @returns {boolean}
 */
export function usedateConsistent(completion, kaptUsedate) {
  const a = completionMonthIndex(completion);
  const b = usedateMonthIndex(kaptUsedate);
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= USEDATE_MAX_DIFF_MONTHS;
}

// ── 네이버 단지 짝 (관리비·향) ──────────────────────────────

/**
 * @typedef {{ complex_no: string; complex_name: string | null; latitude: number | null; longitude: number | null }} NaverComplexLike
 * @typedef {{ name: string; lat: number | null; lng: number | null }} NaverGateApt
 */

/**
 * N1 — 한 아파트의 네이버 단지 후보 중 관리비·대표 향을 가져올 단지 하나. 500m 안 · 정리한 이름
 * ≥ 0.75 · 차수·블록 충돌 없음을 지난 것 중 **가장 가까운 단지**(같으면 단지 번호가 작은 쪽 — 회차마다
 * 같은 답). 통과한 게 없으면 null — 호출자는 **아무것도 쓰지 않는다**(기존 값도 지우지 않는다).
 *
 * 500m 판정·거리 함수는 `sync-naver-complex.mjs` 의 `withinMatchRange`·`distanceM` 을 주입받는다
 * (Phase 1 과 같은 정본 — 좌표가 하나라도 없으면 거짓인 fail-close 도 그쪽 규칙).
 * @template {NaverComplexLike} C
 * @param {NaverGateApt} apt
 * @param {C[]} candidates
 * @param {{ withinRange: (apt: NaverGateApt, cpx: C) => boolean; distance: (lat1: number, lng1: number, lat2: number, lng2: number) => number }} deps
 * @returns {C | null}
 */
export function pickNaverComplexForListing(apt, candidates, { withinRange, distance }) {
  const name = cleanMatchName(apt.name);
  /** @type {C | null} */
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    if (!withinRange(apt, c)) continue;
    if (!namesCompatible(apt.name, c.complex_name)) continue;
    if (stringSimilarity(name, cleanMatchName(c.complex_name)) < NAVER_MIN_NAME_SIM) continue;
    const d = distance(/** @type {number} */ (apt.lat), /** @type {number} */ (apt.lng), /** @type {number} */ (c.latitude), /** @type {number} */ (c.longitude));
    if (d < bestD || (d === bestD && best != null && c.complex_no < best.complex_no)) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

// ── 2u 창 ───────────────────────────────────────────────────

/** @param {string} hhmm @returns {number} */
function minutesOf(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * R3 — 지금(KST)이 자매 레포의 K-apt 창 안인가(분 단위, 양끝 포함: 06:20·08:25 는 안, 06:19·08:26 은 밖).
 * @param {Date} now
 * @returns {boolean}
 */
export function inSiblingKaptWindow(now) {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const m = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return SIBLING_KAPT_WINDOWS_KST.some((w) => m >= minutesOf(w.start) && m <= minutesOf(w.end));
}
