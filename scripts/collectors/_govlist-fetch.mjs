// @ts-check
/**
 * 지자체 단지별 미분양 명단 — 내려받기 어댑터(대구 게시판 · 충남 행정자료실). 설계서
 * `docs/superpowers/plans/2026-11-01-govlist-unsold-source.md` §1·§5-⑦ · 조사 원문 `.omc/artifacts/session685/research-unsold-sources.md`.
 *
 * 회차당 호출 = 출처마다 3회(목록 1 · 글 1 · 첨부 1). 공공데이터 API·카카오 호출 0.
 * - 대구: `index.do` POST(menu_id=00002214 · bbsId=BBS_00153 · 제목 검색) → 「YYYY년 M월말 대구 공동주택 미분양 현황」 글 중
 *   **제목의 기준월이 가장 새 글**(게시 순서로 정하지 않는다) → 글 POST(menu_link=/icms/bbs/selectBoardArticle.do)
 *   → 첨부 중 **파일 이름이 .xlsx** 인 것(fileSn 순서가 달마다 xlsx/hwp 로 바뀐다) → `FileDown.do`.
 *   data.go.kr 15052622 는 같은 자료(XLSX)지만 내려받기가 페이지 스크립트를 거쳐 경로를 아직 못 풀었다(세션687 실측) — 후속.
 * - 충남: `list.do?searchWrd=미분양` → 「YYYY년 M월말 기준 미분양 주택현황」 중 기준월이 가장 새 글 → `view.do` → 첨부 .xlsx.
 *
 * 순수 함수(HTML → 목록·첨부)와 내려받기(fetch 주입)를 나눴다 — 시험은 저장한 원본 발췌로 순수 함수만 본다.
 */

/** @typedef {"daegu" | "chungnam"} GovlistSource */
/** @typedef {{ id: string; title: string; asOf: string }} ListItem */
/** @typedef {{ name: string; url: string }} Attachment */
/**
 * @typedef {{ source: GovlistSource; title: string; titleAsOf: string; postId: string; fileName: string; fileUrl: string;
 *   buffer: Buffer; calls: number }} FetchedFile
 */

export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) mibunyang-govlist";

const DAEGU_BASE = "https://www.daegu.go.kr";
const DAEGU_FORM = Object.freeze({ menu_id: "00002214", bbsId: "BBS_00153", bbsTyCode: "BBST01", bbsAttrbCode: "BBSA03" });
const CN_BASE = "https://www.chungnam.go.kr";
const CN_MENU = "5100253";

/** 출처 → 시도(apartments.region) */
export const SOURCE_REGION = Object.freeze(/** @type {Record<GovlistSource, string>} */ ({ daegu: "대구", chungnam: "충남" }));
/** 출처 → 손님에게 보일 기관 이름(로그·impact 용) */
export const SOURCE_AGENCY = Object.freeze(/** @type {Record<GovlistSource, string>} */ ({ daegu: "대구시", chungnam: "충남도" }));

/** @param {number} y @param {number} m 1~12 @returns {string} 그 달 말일 "YYYY-MM-DD" */
export function monthEnd(y, m) {
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** @param {string} s */
const stripTags = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/**
 * 제목의 「YYYY년 M월말」 → 그 달 말일. 없거나 월이 1~12 밖이면 null.
 * @param {string} title
 * @returns {string | null}
 */
export function titleMonthEnd(title) {
  const m = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*말/.exec(title);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return monthEnd(y, mo);
}

/**
 * 목록에서 기준월이 가장 새 글. 같은 기준월이 둘 이상이면 글 번호가 큰 쪽(재게시).
 * @param {ListItem[]} items
 * @returns {ListItem | null}
 */
export function pickLatest(items) {
  return [...items].sort((a, b) => (a.asOf < b.asOf ? 1 : a.asOf > b.asOf ? -1 : Number(b.id) - Number(a.id)))[0] ?? null;
}

/**
 * 대구 게시판 목록 HTML → 미분양 현황 글.
 * @param {string} html
 * @returns {ListItem[]}
 */
export function parseDaeguList(html) {
  /** @type {ListItem[]} */ const out = [];
  for (const m of html.matchAll(/fn_icms_navi_common\('view',\s*'(\d+)'\);return false;">([\s\S]*?)<\/a>/g)) {
    const title = stripTags(m[2]);
    if (!/대구\s*공동주택\s*미분양\s*현황/.test(title)) continue;
    const asOf = titleMonthEnd(title);
    if (asOf) out.push({ id: m[1], title, asOf });
  }
  return out;
}

/**
 * 대구 글 HTML → 첨부(이름 · 내려받기 주소).
 * @param {string} html
 * @returns {Attachment[]}
 */
export function parseDaeguView(html) {
  /** @type {Attachment[]} */ const out = [];
  for (const m of html.matchAll(/fn_egov_downFile\('([^']+)','(\d+)'\)"[^>]*>\s*<span>([^<]+)<\/span>/g)) {
    out.push({ name: m[3].trim(), url: `${DAEGU_BASE}/icms/cmm/fms/FileDown.do?atchFileId=${encodeURIComponent(m[1])}&fileSn=${m[2]}` });
  }
  return out;
}

/**
 * 충남 행정자료실 목록 HTML → 미분양 주택현황 글.
 * @param {string} html
 * @returns {ListItem[]}
 */
export function parseChungnamList(html) {
  /** @type {ListItem[]} */ const out = [];
  /** @type {Set<string>} */ const seen = new Set();
  for (const m of html.matchAll(/view\.do\?[^"']*?nttId=(\d+)[^"']*["'][^>]*>([\s\S]{0,400}?)<\/a>/g)) {
    const title = stripTags(m[2]);
    if (!/미분양\s*주택\s*현황/.test(title) || seen.has(m[1])) continue;
    const asOf = titleMonthEnd(title);
    if (!asOf) continue;
    seen.add(m[1]);
    out.push({ id: m[1], title, asOf });
  }
  return out;
}

/**
 * 충남 글 HTML → 첨부.
 * @param {string} html
 * @returns {Attachment[]}
 */
export function parseChungnamView(html) {
  /** @type {Attachment[]} */ const out = [];
  for (const m of html.matchAll(/([^\n>]+?\.(?:xlsx|xls|hwpx|hwp|pdf))\s*\[[\d,]+\s*byte\]\s*<a href="([^"]*fileDown\.do[^"]*)"/gi)) {
    out.push({ name: m[1].trim(), url: CN_BASE + m[2].replace(/&amp;/g, "&") });
  }
  return out;
}

/**
 * 첨부 중 이름이 .xlsx 인 것 하나. 둘 이상이면 "공개용"·"홈페이지" 표시가 있는 쪽, 그래도 여럿이면 첫째.
 * @param {Attachment[]} files
 * @returns {Attachment | null}
 */
export function pickXlsx(files) {
  const x = files.filter((f) => /\.xlsx$/i.test(f.name));
  if (x.length <= 1) return x[0] ?? null;
  return x.find((f) => /공개용|홈페이지/.test(f.name)) ?? x[0];
}

/** 내려받기 실패 — 수집기가 `GOVLIST_SKIP <source> fetch(...)` 로 기록한다. */
export class GovlistFetchError extends Error {
  /** @param {string} message */
  constructor(message) { super(message); this.name = "GovlistFetchError"; }
}

/** 누리집 호출 한 번의 시간 제한(ms) — 없으면 undici 기본 300초 × 3회를 러너가 기다린다(세션693 보완 B8 · adv🟡7). */
export const GOVLIST_FETCH_TIMEOUT_MS = 60000;

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
async function get(fetchImpl, url, init = {}, timeoutMs = GOVLIST_FETCH_TIMEOUT_MS) {
  /** @type {Response} */ let r;
  try {
    r = await fetchImpl(url, { ...init, headers: { "User-Agent": UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const name = /** @type {any} */ (e)?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new GovlistFetchError(`시간 제한 ${timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)}초` : `${timeoutMs}ms`} 넘김 ${url}`);
    throw e;
  }
  if (!r.ok) throw new GovlistFetchError(`HTTP ${r.status} ${url}`);
  return r;
}

/**
 * 가장 새 명단 파일을 받는다(호출 3회).
 * @param {GovlistSource} source
 * @param {{ fetchImpl?: typeof fetch; timeoutMs?: number }} [opts] timeoutMs = 호출 한 번 시간 제한(기본 GOVLIST_FETCH_TIMEOUT_MS · 시험 주입용)
 * @returns {Promise<FetchedFile>}
 */
export async function fetchLatestGovlist(source, { fetchImpl = fetch, timeoutMs = GOVLIST_FETCH_TIMEOUT_MS } = {}) {
  /** 호출마다 시간 제한(`timeoutMs`, 기본 60초)을 건다. @param {string} url @param {RequestInit} [init] */
  const g = (url, init) => get(fetchImpl, url, init, timeoutMs);
  let calls = 0;
  /** @type {ListItem | null} */ let post = null;
  /** @type {Attachment[]} */ let files = [];
  if (source === "daegu") {
    const form = (/** @type {Record<string, string>} */ o) => new URLSearchParams(o).toString();
    const post1 = { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } };
    calls++;
    const listHtml = await (await g(`${DAEGU_BASE}/index.do`, {
      ...post1, body: form({ ...DAEGU_FORM, nttId: "0", pageIndex: "1", searchCnd: "0", searchWrd: "공동주택 미분양 현황" }),
    })).text();
    post = pickLatest(parseDaeguList(listHtml));
    if (!post) throw new GovlistFetchError("대구 목록에서 미분양 현황 글을 못 찾음");
    calls++;
    const viewHtml = await (await g(`${DAEGU_BASE}/index.do`, {
      ...post1, body: form({ menu_id: DAEGU_FORM.menu_id, menu_link: "/icms/bbs/selectBoardArticle.do", bbsId: DAEGU_FORM.bbsId, nttId: post.id }),
    })).text();
    files = parseDaeguView(viewHtml);
  } else if (source === "chungnam") {
    calls++;
    const listHtml = await (await g(
      `${CN_BASE}/cnportal/bbs/B0000134/list.do?menuNo=${CN_MENU}&pageIndex=1&searchCnd=1&searchWrd=${encodeURIComponent("미분양")}`)).text();
    post = pickLatest(parseChungnamList(listHtml));
    if (!post) throw new GovlistFetchError("충남 목록에서 미분양 주택현황 글을 못 찾음");
    calls++;
    const viewHtml = await (await g(`${CN_BASE}/cnportal/bbs/B0000134/view.do?nttId=${post.id}&menuNo=${CN_MENU}`)).text();
    files = parseChungnamView(viewHtml);
  } else {
    throw new Error(`모르는 출처: ${source}`);
  }
  const x = pickXlsx(files);
  if (!x) throw new GovlistFetchError(`${source} 글 ${post.id} 에 .xlsx 첨부 없음(${files.map((f) => f.name).join(", ") || "첨부 0"})`);
  calls++;
  const buffer = Buffer.from(await (await g(x.url)).arrayBuffer());
  // xlsx = zip(PK\x03\x04). 오류 페이지(HTML)를 파일로 착각하지 않게.
  if (buffer.length < 4 || buffer.readUInt32BE(0) !== 0x504b0304) throw new GovlistFetchError(`${source} 첨부가 xlsx 가 아님(${buffer.length}B)`);
  return { source, title: post.title, titleAsOf: post.asOf, postId: post.id, fileName: x.name, fileUrl: x.url, buffer, calls };
}
