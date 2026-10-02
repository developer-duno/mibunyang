// @ts-check
/**
 * 같은 단지 열쇠 — "한 단지 = 한 장"의 공용 규칙 (설계서 docs/superpowers/specs/2026-10-01-one-complex-one-card.md §4-1 · §4-7)
 *
 * 청약홈 행(ah-)과 네이버 분양 행(ap-), 같은 단지의 회차 공고들을 한 묶음으로 본다. 규칙은 이 파일 하나에만 둔다 —
 * VIEW(SQL)는 이 함수가 채운 칸(`apartments.complex_key`)을 읽고, JS 수집기는 이 함수를 직접 부른다.
 *
 * ⚠️ 열쇠는 **전 행을 한 번에** 넘겨야 정해진다(`assignComplexKeys`). 블록 표기(1BL·2단지)는 "같은 뼈대 이름 안에
 *    서로 다른 블록 무리가 둘 이상일 때만" 열쇠에 들어가므로, 행 하나만 보고는 답이 안 나온다.
 * ⚠️ 이 파일의 규칙을 바꾸면 내일 아침 카드가 합쳐지거나 갈라진다. 바꾸기 전에 `_same-complex.test.mjs` 의
 *    시제품 대조(표본 121행의 열쇠가 글자 그대로 같아야 한다)와 운영 dry-run(`assign-complex-keys.mjs`)의 바뀐 명단을 본다.
 */
import { haversineMeters } from "./_shared.mjs";
import { stripRoundWords } from "./_kakao-poi.mjs";
import { isLeaseUnit, LEASE_NAME_PATTERN } from "../../src/constants/leaseTypes.mjs";

/** 토큰 없는 행을 가장 가까운 블록 무리에 붙이는 한계(미터). */
export const ATTACH_MAX_M = 300;

const ROMAN = /** @type {Record<string, string>} */ ({ "Ⅰ": "1", "Ⅱ": "2", "Ⅲ": "3", "Ⅳ": "4", "Ⅴ": "5", "Ⅵ": "6", "Ⅶ": "7", "Ⅷ": "8", "Ⅸ": "9", "Ⅹ": "10" });
const LEASE_WORDS = new RegExp(`(?:${LEASE_NAME_PATTERN.source}|신혼희망|공공임대|민간임대|영구임대)`, "g");
const ROUND_IN_PAREN = /무순위|임의공급|사후|취소|회차|재당첨|청약전|거주|무주택|계약|잔여|선착순|대표전화|대표번호|할인분양|불법행위|재공급/;
const ROUND_OUTSIDE = /불법행위\s*재공급|\d+\s*회차|계약취소주택|조합원\s*취소분|취소\s*후\s*재공급|할인분양/g;
const BL_RE = /(?<![A-Z0-9])([A-Z]{0,3}\d+(?:[-,]\d+)*)\s*BL(?![A-Z])/g;
const DAN_RE = /(?<!\d)(\d+)\s*단지/g;

/**
 * @param {string} text
 * @param {Set<string>} bl
 * @param {Set<string>} dan
 */
function extractTokens(text, bl, dan) {
  return text
    .replace(BL_RE, (_, c) => { bl.add(String(c).replace(/\s+/g, "") + "BL"); return ""; })
    .replace(DAN_RE, (_, n) => { dan.add(String(Number(n)) + "단지"); return ""; });
}

/**
 * 단지 이름을 "뼈대 + 블록 토큰 + 임대 낱말 + 오피스텔 표시"로 가른다(설계서 §4-1 규칙 1~4).
 * @param {unknown} name
 * @returns {{ skel: string, bl: Set<string>, dan: Set<string>, lease: string, isOfficetel: boolean }}
 */
export function normalizeComplexName(name) {
  /** @type {Set<string>} */ const bl = new Set();
  /** @type {Set<string>} */ const dan = new Set();
  /** @type {Set<string>} */ const lease = new Set();
  let isOfficetel = false;
  let s = String(name ?? "");
  s = s.replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/g, (c) => ROMAN[c]).normalize("NFKC");
  s = s.replace(/[\[〈《【〔「『]/g, "(").replace(/[\]〉》】〕」』]/g, ")");
  s = stripRoundWords(s);
  s = s.toUpperCase().replace(/블럭|블록/g, "BL").replace(/(?<![A-Z])([A-Z]{1,3})-(\d)/g, "$1$2");
  s = s.replace(/SK\s*VIEW/g, "SK뷰").replace(/\s*&\s*/g, "앤");
  s = s.replace(/\(([^()]*)\)/g, (_, raw) => {
    const c = String(raw).trim();
    if (c === "오") { isOfficetel = true; return ""; }
    const lw = c.match(LEASE_WORDS);
    if (lw) { for (const w of lw) lease.add(w); return ""; }
    if (ROUND_IN_PAREN.test(c)) return "";
    if (/^\d+\s*차$/.test(c)) return "";
    if (/BL|단지/.test(c)) extractTokens(c, bl, dan);
    return "";
  });
  s = s.replace(ROUND_OUTSIDE, "");
  s = s.replace(LEASE_WORDS, (w) => { lease.add(w); return ""; });
  s = extractTokens(s, bl, dan);
  s = s.replace(/[\s()]/g, "");
  if (s.length > 4 && s.endsWith("아파트")) s = s.slice(0, -3);
  return { skel: s, bl, dan, lease: [...lease].sort().join("+"), isOfficetel };
}

/**
 * @typedef {{ id: string, name?: string | null, region?: string | null, gu?: string | null, lat?: number | null, lng?: number | null, presale_type?: string | null }} KeyRow
 * @typedef {{ always?: Array<[string, string]>, isolate?: string[] }} KeyExceptions
 */

/** @param {Set<string>} a @param {Set<string>} b */
const disjoint = (a, b) => { for (const v of a) if (b.has(v)) return false; return true; };

/**
 * 전 행의 "같은 단지 열쇠"를 한 번에 정한다(설계서 §4-1 규칙 5·6, §4-7 (6)).
 * 묶음 맥락(같은 뼈대 안에 서로 다른 블록 무리가 둘 이상일 때만 블록 토큰을 열쇠에 넣는다) 때문에
 * 행 하나만 보고는 못 정한다 — 반드시 전 행을 넘긴다.
 * @param {readonly KeyRow[]} rows
 * @param {KeyExceptions} [exceptions]
 * @returns {Map<string, string>} id → 열쇠
 */
export function assignComplexKeys(rows, exceptions = {}) {
  const guFirst = (/** @type {KeyRow} */ r) => (r.gu || "").split(/\s+/)[0];
  /** @type {Map<string, ReturnType<typeof normalizeComplexName> & { isOff: boolean, isLease: boolean, ctx: string, tokStr: string }>} */
  const info = new Map();
  for (const r of rows) {
    const n = normalizeComplexName(r.name);
    info.set(r.id, {
      ...n,
      isOff: n.isOfficetel || String(r.name ?? "").includes("(오)"),
      isLease: isLeaseUnit(r),
      ctx: `${n.skel}|${r.region || ""}|${guFirst(r)}`,
      tokStr: [...[...n.bl].sort(), ...[...n.dan].sort()].join("+"),
    });
  }
  const I = (/** @type {string} */ id) => /** @type {NonNullable<ReturnType<typeof info.get>>} */ (info.get(id));
  const hasCoord = (/** @type {KeyRow} */ r) => r.lat != null && r.lng != null;
  const dist = (/** @type {KeyRow} */ a, /** @type {KeyRow} */ b) =>
    hasCoord(a) && hasCoord(b) ? haversineMeters(Number(a.lat), Number(a.lng), Number(b.lat), Number(b.lng)) : null;

  /** @type {Map<string, KeyRow[]>} */
  const ctxGroups = new Map();
  for (const r of rows) { const c = I(r.id).ctx; if (!ctxGroups.has(c)) ctxGroups.set(c, []); /** @type {KeyRow[]} */ (ctxGroups.get(c)).push(r); }

  /** @type {Map<string, string>} 행 id → 열쇠의 토큰 부분 */
  const tokPart = new Map();
  for (const ms of ctxGroups.values()) {
    const tokened = ms.filter((r) => I(r.id).tokStr);
    /** @type {Map<string, string>} */
    const parent = new Map(tokened.map((r) => [r.id, r.id]));
    const find = (/** @type {string} */ x) => { while (parent.get(x) !== x) x = /** @type {string} */ (parent.get(x)); return x; };
    for (let i = 0; i < tokened.length; i++) for (let j = i + 1; j < tokened.length; j++) {
      const a = I(tokened[i].id), b = I(tokened[j].id);
      const conflict = (a.bl.size > 0 && b.bl.size > 0 && disjoint(a.bl, b.bl)) || (a.dan.size > 0 && b.dan.size > 0 && disjoint(a.dan, b.dan));
      const shares = !disjoint(a.bl, b.bl) || !disjoint(a.dan, b.dan);
      if (!conflict && shares) parent.set(find(tokened[i].id), find(tokened[j].id));
    }
    /** @type {Map<string, KeyRow[]>} */
    const clusters = new Map();
    for (const r of tokened) { const k = find(r.id); if (!clusters.has(k)) clusters.set(k, []); /** @type {KeyRow[]} */ (clusters.get(k)).push(r); }
    if (clusters.size <= 1) { for (const r of ms) tokPart.set(r.id, ""); continue; }
    /** @type {Map<string, string>} */
    const label = new Map();
    for (const [k, cms] of clusters) {
      /** @type {Set<string>} */ const all = new Set();
      for (const m of cms) for (const t of I(m.id).tokStr.split("+")) all.add(t);
      label.set(k, [...all].sort().join("+"));
    }
    for (const r of tokened) tokPart.set(r.id, /** @type {string} */ (label.get(find(r.id))));
    // 거리가 정확히 같으면 구성원의 가장 작은 id(글자 비교)가 더 작은 무리가 이긴다 — 입력 순서와 무관하게(세션589 검사관 A #8).
    /** @type {Map<string, string>} */
    const minId = new Map();
    for (const [k, cms] of clusters) minId.set(k, cms.map((m) => m.id).reduce((a, b) => (b < a ? b : a)));
    for (const r of ms) {
      if (I(r.id).tokStr) continue;
      /** @type {string | null} */ let best = null;
      let bestD = Infinity;
      for (const [k, cms] of clusters) for (const m of cms) {
        const d = dist(r, m);
        if (d == null) continue;
        if (d < bestD || (d === bestD && best != null && /** @type {string} */ (minId.get(k)) < /** @type {string} */ (minId.get(best)))) { bestD = d; best = k; }
      }
      tokPart.set(r.id, best != null && bestD <= ATTACH_MAX_M ? /** @type {string} */ (label.get(best)) : `보류:${r.id}`);
    }
  }

  /** @type {Map<string, string>} */
  const keys = new Map();
  for (const r of rows) {
    const i = I(r.id);
    // 이름이 비어 뼈대가 없는 행은 서로 묶지 않는다 — 빈 뼈대끼리 같은 시도·구라는 이유만으로 한 장이 되면 안 된다.
    keys.set(r.id, i.skel === ""
      ? `#only:${r.id}`
      : `${i.skel}#${tokPart.get(r.id) ?? ""}#${i.lease}#L${i.isLease ? 1 : 0}#${r.region || ""}#${guFirst(r)}`);
  }

  // 예외 명단 — 규칙 열쇠 뒤에 적용한다. always: 두 id 가 속한 묶음을 통째로 합친다. isolate: 그 행만 떼어 낸다.
  for (const [a, b] of exceptions.always ?? []) {
    const ka = keys.get(a), kb = keys.get(b);
    if (ka == null || kb == null || ka === kb) continue;
    for (const [id, k] of keys) if (k === ka) keys.set(id, kb);
  }
  for (const id of exceptions.isolate ?? []) {
    const k = keys.get(id);
    if (k != null) keys.set(id, `${k}#only:${id}`);
  }
  return keys;
}

/**
 * 예외 명단(JSON)을 읽어 모양을 검사한다. 모양이 틀리면 throw — 조용히 빈 명단으로 넘어가지 않는다.
 * @param {unknown} json `docs/audits/same-complex-exceptions.json` 을 JSON.parse 한 값
 * @returns {Required<KeyExceptions>}
 */
export function parseComplexExceptions(json) {
  const j = /** @type {{ always?: unknown, isolate?: unknown }} */ (json);
  if (!j || typeof j !== "object") throw new Error("예외 명단이 객체가 아닙니다");
  const ID = /^(ah|ap)-\d+$/;
  const always = Array.isArray(j.always) ? j.always : null;
  const isolate = Array.isArray(j.isolate) ? j.isolate : null;
  if (!always || !isolate) throw new Error("예외 명단에 always·isolate 배열이 있어야 합니다");
  /** @type {Array<[string, string]>} */
  const outAlways = [];
  for (const e of always) {
    const ids = /** @type {{ ids?: unknown }} */ (e)?.ids;
    if (!Array.isArray(ids) || ids.length !== 2 || !ids.every((x) => typeof x === "string" && ID.test(x)) || ids[0] === ids[1]) {
      throw new Error(`always 항목의 ids 는 서로 다른 단지 id 둘이어야 합니다: ${JSON.stringify(e)}`);
    }
    outAlways.push([String(ids[0]), String(ids[1])]);
  }
  /** @type {string[]} */
  const outIsolate = [];
  for (const e of isolate) {
    const id = /** @type {{ id?: unknown }} */ (e)?.id;
    if (typeof id !== "string" || !ID.test(id)) throw new Error(`isolate 항목의 id 가 단지 id 가 아닙니다: ${JSON.stringify(e)}`);
    // 같은 id 를 두 번 떼면 열쇠에 `#only:` 가 겹친다(세션589 검사관 A #9) — 받지 않는다.
    if (outIsolate.includes(id)) throw new Error(`isolate 에 같은 id 가 두 번 있습니다: ${id}`);
    outIsolate.push(id);
  }
  // 같은 id 가 always 와 isolate 양쪽에 있으면 적용 순서에 따라 결과가 갈린다 — 받지 않는다.
  const inAlways = new Set(outAlways.flat());
  const both = outIsolate.filter((id) => inAlways.has(id));
  if (both.length > 0) throw new Error(`같은 id 가 always 와 isolate 양쪽에 있습니다: ${both.join(", ")}`);
  return { always: outAlways, isolate: outIsolate };
}

/**
 * 한 묶음 안에 임대·분양이 섞였거나 시도가 섞인 묶음을 찾는다. 규칙만으로는 생기지 않고(열쇠에 임대 표시와 시도가
 * 들어 있다) 예외 명단 `always` 가 잘못 적혔을 때만 생긴다 — 채우기 배치는 이게 하나라도 있으면 쓰지 않는다.
 * @param {readonly KeyRow[]} rows
 * @param {ReadonlyMap<string, string>} keys
 * @returns {Array<{ key: string, why: string, ids: string[] }>}
 */
export function findMixedBundles(rows, keys) {
  /** @type {Map<string, KeyRow[]>} */
  const groups = new Map();
  for (const r of rows) {
    const k = keys.get(r.id);
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    /** @type {KeyRow[]} */ (groups.get(k)).push(r);
  }
  /** @type {Array<{ key: string, why: string, ids: string[] }>} */
  const out = [];
  for (const [key, ms] of groups) {
    if (ms.length < 2) continue;
    const why = [];
    if (new Set(ms.map((m) => isLeaseUnit(m))).size > 1) why.push("임대·분양 섞임");
    if (new Set(ms.map((m) => m.region || "")).size > 1) why.push("시도 섞임");
    if (why.length > 0) out.push({ key, why: why.join(" · "), ids: ms.map((m) => m.id).sort() });
  }
  return out;
}

/**
 * 예외 명단이 가리키는데 지금 행 목록에 없는 id — 행이 지워졌거나 오타다. 조용히 넘기지 않고 호출자가 로그에 남긴다.
 * @param {KeyExceptions} exceptions
 * @param {ReadonlySet<string>} ids
 * @returns {string[]}
 */
export function missingExceptionIds(exceptions, ids) {
  const want = [...(exceptions.always ?? []).flat(), ...(exceptions.isolate ?? [])];
  return [...new Set(want.filter((id) => !ids.has(id)))].sort();
}

/**
 * @typedef {{ id: string, name?: string | null, naver_presale_no?: string | number | null, presale_min_price?: number | null, units?: number | null, unit_source?: string | null }} MemberRow
 */

/** @param {MemberRow} m */
const isOffRow = (m) => String(m.name ?? "").includes("(오)");
/** @param {MemberRow} m */
const isAh = (m) => m.id.startsWith("ah-");
/** 번호 주인 네이버 행인가(`ap-<자기 분양 번호>`). @param {MemberRow} m */
export const isPresaleOwner = (m) => m.id.startsWith("ap-") && m.naver_presale_no != null && m.id === `ap-${m.naver_presale_no}`;

/**
 * 대표 행(카드 id·이름) — (오) 뒤로 → 청약홈 먼저 → id 오름차순(D11).
 * @param {readonly MemberRow[]} members
 * @returns {string}
 */
export function pickRepresentativeId(members) {
  return [...members].sort((a, b) =>
    (Number(isOffRow(a)) - Number(isOffRow(b))) || (Number(!isAh(a)) - Number(!isAh(b))) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0].id;
}

/**
 * 재료 행(좌표·파생표·분양 칸·가격) — (오) 뒤로 → 번호 주인 네이버 행(최저가 낮은 것 → id 작은 것)
 * → 청약홈 id 내림차순 → 나머지 id 내림차순(설계서 §4-7 (3)).
 * @param {readonly MemberRow[]} members
 * @returns {string}
 */
export function pickMaterialId(members) {
  const rank = (/** @type {MemberRow} */ m) => (isPresaleOwner(m) ? 0 : isAh(m) ? 1 : 2);
  return [...members].sort((a, b) => {
    const o = Number(isOffRow(a)) - Number(isOffRow(b)); if (o) return o;
    const r = rank(a) - rank(b); if (r) return r;
    if (rank(a) === 0) {
      const pa = a.presale_min_price ?? Infinity, pb = b.presale_min_price ?? Infinity;
      if (pa !== pb) return pa - pb;
      return a.id < b.id ? -1 : 1;
    }
    return a.id < b.id ? 1 : -1;
  })[0].id;
}

const UNIT_RANK = /** @type {Record<string, number>} */ ({ naver_presale: 0, naver: 1, molit: 2, applyhome: 3 });

/**
 * 묶음 세대수 — 번호 주인 네이버 행의 분양 총세대수 > 네이버 단지 표(+ 주인이 아닌 행의 네이버 분양 값) > 국토부 >
 * 청약홈 > 출처 빈 값(D7). (오) 행·1 이하는 뺀다.
 * `naver_presale` 표시가 맨 앞 순위를 받는 것은 **그 행이 번호 주인일 때만**이다 — 주인이 아닌 행의 값은 남의 번호를
 * 쥔 채 남았거나 사람이 옮겨 적은 값이라 주인 값이 있으면 그쪽이 이긴다(세션588 검사관 C).
 * 같은 순위면 큰 값(네이버 회차 행은 단지 전체 세대수를 똑같이 갖는다 — 합치지 않는다).
 * @param {readonly MemberRow[]} members
 * @returns {{ units: number, source: string | null, fromId: string } | null}
 */
export function pickBundleUnits(members) {
  const cand = members.filter((m) => !isOffRow(m) && m.units != null && m.units > 1);
  if (cand.length === 0) return null;
  const rank = (/** @type {MemberRow} */ m) =>
    m.unit_source === "naver_presale" && !isPresaleOwner(m) ? UNIT_RANK.naver : (UNIT_RANK[m.unit_source ?? ""] ?? 4);
  const best = [...cand].sort((a, b) => (rank(a) - rank(b)) || (Number(b.units) - Number(a.units)) || (a.id < b.id ? -1 : 1))[0];
  return { units: Number(best.units), source: best.unit_source ?? null, fromId: best.id };
}
