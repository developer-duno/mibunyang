// @ts-check
/**
 * 카드 시공사 칸 = 공고 시공사(세션676 PR-C C2) — VIEW `apartments_flat.builder` 와 부채비율 연결(`builders.name`)의 JS 쌍둥이.
 *
 * 👤 결정(.omc/artifacts/session675/decisions.md 「바」): D1 목록(VIEW)에서만 시공사로 — 원표 `apartments.builder`·수집기 그대로 ·
 * D2 「현대건설 외 2」 + 점수·필터·부채비율은 대표사(공고에 맨 앞에 적힌 회사) · D3 등급표 회사 추가 없음.
 *
 * 흐름(SQL 과 JS 가 같은 문자열로 돈다 — `_card-title.mjs` 의 `WS` 와 같은 원칙: \s·\d 대신 명시 묶음·[0-9]):
 *   공고 시공사 원문(`presale_schedule_official.constructor`)
 *   → 꼬리 떼기(「 외 N(개사|개업체|사)」「 등」「컨소시엄」 — 「외 N」이면 N 을 센다)
 *   → 구분자로 쪼개기(`,` `，` `·` `/` `、` — `&` 는 사명 안 글자라 구분자 아님: 유림E&C·자이S&D·한미글로벌 E&C·DL e&c)
 *   → 첫 조각 = 대표사 → 법인격(㈜·(주)·주식회사·(쥬)) 떼고 공백 정리 → 이름 사전(키 → 표시·연결)
 *   → 카드 글자 = 표시 + (회사가 둘 이상이면 「 외 (n-1)」) · 부채비율 연결 = 연결 이름.
 *
 * 이름 사전 3칸(맹점 검사 🟠3 — 표시와 연결은 다른 이름일 수 있다):
 *   - 표시(= 등급 판정) 이름: `_shared.mjs` `BUILDER_CANONICALS`·`BUILDER_ALIASES`(= `src/constants/brands.ts` 쌍둥이)
 *   - 연결 이름(`builders.name` 에 있는 이름): `dart-builders.mjs` `BUILDER_CORP_CODES` 키 + `DART_ALIAS`
 *     예: 「계룡건설산업(주)」 → 표시 「계룡건설」(등급표 키) · 연결 「계룡건설산업」(DART 표 키)
 *   - 사전에 없는 회사: 표시 = 법인격만 뗀 원문 · 연결 = 그 표시 이름.
 */
import { BUILDER_CANONICALS, BUILDER_ALIASES } from "./_shared.mjs";
import { BUILDER_CORP_CODES, DART_ALIAS } from "./dart-builders.mjs";
import { WS, TRIM_SQL } from "./_card-title.mjs";

/** 법인격 표기 — ARE·JS 공통 */
export const CORP_SQL = "㈜|\\(주\\)|주식회사|\\(쥬\\)";
/** 구분자(앞뒤 공백 허용) */
export const SEP_SQL = `${WS}*[,，·/、]${WS}*`;
/** 끝 꼬리 — `regexp_replace(x, TAIL_SQL, '')` */
export const TAIL_SQL = `(?:${WS}+외${WS}*[0-9]+${WS}*(?:개사|개업체|사)?|${WS}+등|${WS}*컨소시엄)${WS}*$`;
/** 「외 N」 꼬리의 N — `substring(x from TAIL_N_SQL)`(첫 괄호 묶음 = 숫자) */
export const TAIL_N_SQL = `${WS}+외${WS}*([0-9]+)${WS}*(?:개사|개업체|사)?${WS}*$`;
/** 빈 글자·공백뿐 — `x !~ BLANK_SQL` 이면 내용 있음 */
export const BLANK_SQL = `^${WS}*$`;

const CORP_RE = new RegExp(CORP_SQL, "gu");
const SEP_RE = new RegExp(SEP_SQL, "u");
const TAIL_RE = new RegExp(TAIL_SQL, "u");
const TAIL_N_RE = new RegExp(TAIL_N_SQL, "u");
const BLANK_RE = new RegExp(BLANK_SQL, "u");
const TRIM_RE = new RegExp(TRIM_SQL, "gu");
const WS_RUN_RE = new RegExp(`${WS}+`, "gu");

/**
 * 법인격 떼고 앞뒤 공백 자르고 공백 묶음을 하나로 — 사전에 없는 회사의 표시 이름.
 * SQL: regexp_replace(regexp_replace(regexp_replace(x, CORP_SQL, '', 'g'), TRIM_SQL, '', 'g'), WS+, ' ', 'g')
 * @param {string} s
 */
export function cleanCompanyName(s) {
  return s.replace(CORP_RE, "").replace(TRIM_RE, "").replace(WS_RUN_RE, " ");
}

/** 사전 키 = 법인격·공백 전부 뗀 글자. @param {string} s */
export function builderKey(s) {
  return s.replace(CORP_RE, "").replace(WS_RUN_RE, "");
}

/**
 * 공고 시공사 원문 → 조각들과 「외 N」의 N. 내용이 없으면 null.
 * @param {unknown} raw
 * @returns {{ parts: string[], extra: number } | null}
 */
export function splitConstructor(raw) {
  if (typeof raw !== "string" || BLANK_RE.test(raw)) return null;
  const m = TAIL_N_RE.exec(raw);
  const extra = m ? Number(m[1]) : 0;
  const parts = raw.replace(TAIL_RE, "").split(SEP_RE).filter((p) => !BLANK_RE.test(p));
  return parts.length ? { parts, extra } : null;
}

/** @typedef {{ key: string, display: string | null, link: string }} CanonRow */

/** @type {CanonRow[] | null} */
let canonRows = null;
/**
 * 이름 사전(키 순 정렬). display = null 이면 「사전에 없는 회사」처럼 원문 정리 이름을 쓴다(DART 쪽에만 있는 표기).
 * @returns {CanonRow[]}
 */
export function builderCanonRows() {
  if (canonRows) return canonRows;
  /** @type {Map<string, string>} 키 → 표시(등급) 이름 — 먼저 넣은 것이 이긴다(정식 이름 우선, _shared 사전과 같은 순서) */
  const display = new Map();
  for (const c of BUILDER_CANONICALS) if (!display.has(builderKey(c))) display.set(builderKey(c), c);
  for (const [a, c] of Object.entries(BUILDER_ALIASES)) if (!display.has(builderKey(a))) display.set(builderKey(a), c);
  /** @type {Map<string, string>} 키 → 연결(DART) 이름 — 정식 키 먼저 */
  const link = new Map();
  for (const c of Object.keys(BUILDER_CORP_CODES)) if (!link.has(builderKey(c))) link.set(builderKey(c), c);
  for (const [a, c] of Object.entries(DART_ALIAS)) if (!link.has(builderKey(a))) link.set(builderKey(a), c);
  const keys = [...new Set([...display.keys(), ...link.keys()])].filter(Boolean).sort();
  canonRows = keys.map((key) => {
    const d = display.get(key) ?? null;
    const l = link.get(key) ?? (d != null ? (link.get(builderKey(d)) ?? d) : null);
    if (l == null) throw new Error(`연결 이름 없음: ${key}`); // 둘 중 하나엔 있으므로 오지 않는다
    return { key, display: d, link: l };
  });
  return canonRows;
}

/**
 * 공고 시공사 원문 → 대표사 표시·연결 이름과 회사 수. 내용이 없으면 null.
 * @param {unknown} raw
 * @returns {{ display: string, link: string, n: number } | null}
 */
export function resolveCardBuilder(raw) {
  const sp = splitConstructor(raw);
  if (!sp) return null;
  const clean = cleanCompanyName(sp.parts[0]);
  if (clean === "") return null;
  const row = builderCanonRows().find((r) => r.key === builderKey(clean));
  return { display: row?.display ?? clean, link: row?.link ?? clean, n: sp.parts.length + sp.extra };
}

/**
 * VIEW 의 builder 칸·부채비율 연결 이름(JS 쌍둥이). 공고 시공사가 없으면 지금 원표 builder 그대로.
 * @param {unknown} rawConstructor 고른 공고의 constructor
 * @param {string | null} fallback 재료 행의 원표 builder
 * @returns {{ builder: string | null, link: string | null }}
 */
export function cardBuilder(rawConstructor, fallback) {
  const r = resolveCardBuilder(rawConstructor);
  if (!r) return { builder: fallback, link: fallback };
  return { builder: r.n > 1 ? `${r.display} 외 ${r.n - 1}` : r.display, link: r.link };
}

/** @param {string} s */
const q = (s) => `'${s.replace(/'/g, "''")}'`;

/**
 * VIEW 안 이름 사전 — `(VALUES …) AS d(key, display, link)`. 마이그레이션 글자가 이 함수 결과와 같은지 시험이 잠근다.
 * @returns {string}
 */
export function builderCanonValuesSql() {
  const rows = builderCanonRows().map((r) => `    (${q(r.key)}, ${r.display == null ? "NULL" : q(r.display)}, ${q(r.link)})`);
  return `(VALUES\n${rows.join(",\n")}\n  ) AS d(key, display, link)`;
}
