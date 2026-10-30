// @ts-check
/**
 * 카드 제목에서 회차·안내 문구 괄호 떼기 — "한 단지 = 한 장" 다)(사장님 결정 2026-10-13 §6-10).
 *
 * 카드가 단지를 뜻하므로 "(무순위 2차)"·"(청약전 반드시 대표전화 문의…)" 는 제목에서 뗀다. 블록(A4BL)·N단지·
 * 주상복합·장기전세·나눔형·공공분양·(오) 는 단지를 가르는 글자라 남긴다. **낱말 목록의 정본은 픽스처**
 * `docs/audits/card-title-paren-fixture.json` 이고, VIEW(SQL) 는 `NOTICE_PAREN_SQL` 로 같은 규칙을 쓴다 —
 * 두 쪽을 함께 고치고, 운영 리허설에서 VIEW 의 name 과 이 함수 결과를 전 행 맞댄다.
 *
 * ⚠️ 이 모듈은 묶음 열쇠(`_same-complex.mjs`)와 무관하다 — 열쇠는 `stripRoundWords` 를 쓰고, 여기는 **표시용**이다.
 */

/** 괄호 안쪽 글자에 적용 — 회차 꼴(낱말 또는 숫자+차가 **하나는** 있어야 한다 — 빈 괄호·공백만은 아님) 또는 안내문 낱말. */
export const ROUND_WORDS = "무순위|임의공급|사후|추가(?:모집)?|잔여(?:세대)?|선착순";
export const NOTICE_WORDS = "계약취소주택|취소후\\s*재공급|조합원\\s*취소분|불법행위\\s*재공급|재공급|청약|문의|재당첨|거주자|무주택|세대구성원|자격상실|제명";
const ROUND_FORM = `(?:(?:${ROUND_WORDS})\\s*(?:\\d+\\s*(?:차|회차|회))?|\\d+\\s*(?:차|회차|회))`;
export const NOTICE_WORD_RE = new RegExp(`^\\s*${ROUND_FORM}\\s*$|${NOTICE_WORDS}`);

/** Postgres ARE — `name ~ 패턴` 과 `regexp_replace(name, 패턴, ' ', 'g')` 에 쓴다(괄호째). 위 JS 와 **같은 낱말 문자열**로 조립한다. */
export const NOTICE_PAREN_SQL = `\\((?:\\s*${ROUND_FORM}\\s*|[^()]*(?:${NOTICE_WORDS})[^()]*)\\)`;

// ── 세션676 PR-C C1: 괄호 밖 **끝**에 남은 회차·공고 종류 낱말 떼기 ──
// 괄호 떼기(아래 stripNoticeWords / VIEW 의 NOTICE_PAREN_SQL) 뒤에 「더샵 하남에디피스 사후」처럼 끝에 남는 낱말을 뗀다.
// 끝에 있을 때만(가운데 「6차」「1」 은 안 건드림) · 앞에 공백이 있는 독립 낱말일 때만 · 반복(「계약취소주택 재공급」은 둘 다).
// 「(우선) 분양전환 후 잔여세대」는 「잔여세대」가 끝 낱말이라 구절째 한 덩어리로 뗀다(계획서 v2 C1 · 메인 판정 10/31 A안).
// SQL(VIEW)과 JS 가 **같은 문자열**로 돈다 — ARE·JS 가 같은 뜻으로 읽는 문법만 쓴다: \s·\d 대신 아래 글자 묶음과 [0-9]
// (PG 의 \s·\d 는 로캘에 따라 범위가 달라질 수 있고, PG btrim 은 ASCII 공백만 자른다 — 운영 이름 12장에 전각 공백 U+3000).
/** 공백 글자 묶음 — 반각 공백·탭·줄바꿈·폼피드·세로탭·NBSP·전각 공백 */
export const WS = "[ \\t\\n\\r\\f\\v\\u00a0\\u3000]";
/** 끝에서 뗄 낱말(긴 꼴 먼저) — 회차 낱말 + 공고 종류 낱말 + 「(우선) 분양전환 후 잔여세대」 구절 */
export const TRAILING_WORDS =
  `(?:우선${WS}*)?분양전환${WS}*후${WS}*잔여세대|무순위|임의공급|사후|추가(?:모집)?|잔여(?:세대)?|선착순` +
  `|계약취소주택|불법행위${WS}*재공급|취소후${WS}*재공급|조합원${WS}*취소분|재공급`;
/** 끝 낱말(+ 선택 N차/N회차/N회)이 하나 이상 이어져 끝나는 꼬리 — `regexp_replace(x, TRAILING_SQL, '')`(g 없음) · JS `replace` 도 같다 */
export const TRAILING_SQL = `(?:${WS}+(?:${TRAILING_WORDS})(?:${WS}*[0-9]+${WS}*(?:차|회차|회))?)+${WS}*$`;
/** 앞뒤 공백(위 묶음) — `regexp_replace(x, TRIM_SQL, '', 'g')` */
export const TRIM_SQL = `^${WS}+|${WS}+$`;

/** @param {string} inner 괄호 안쪽 글자 */
export function isNoticeParen(inner) {
  const s = inner.trim();
  if (s === "") return false; // 빈 괄호는 건드리지 않는다
  return NOTICE_WORD_RE.test(s);
}

/** @param {unknown} name */
export function stripNoticeWords(name) {
  const src = String(name ?? "");
  if (!src.includes("(")) return src;
  let changed = false;
  const out = src.replace(/\s*\(([^()]*)\)/g, (whole, inner) => {
    if (!isNoticeParen(String(inner))) return whole;
    changed = true;
    return " ";
  });
  if (!changed) return src;
  return out.replace(/\s{2,}/g, " ").trim();
}

const TRAILING_RE = new RegExp(TRAILING_SQL, "u");
const TRIM_RE = new RegExp(TRIM_SQL, "gu");

/**
 * 카드 제목 = VIEW `apartments_flat.name` 의 JS 쌍둥이(세션676 PR-C C1).
 * ① 괄호 떼기(stripNoticeWords) → ② 끝 낱말 떼기(TRAILING_SQL) → ③ 앞뒤 공백(전각 포함) 자르기 → ④ 빈 글자면 원래 이름.
 * @param {unknown} name
 * @returns {string}
 */
export function cardTitle(name) {
  const src = String(name ?? "");
  const out = stripNoticeWords(src).replace(TRAILING_RE, "").replace(TRIM_RE, "");
  return out === "" ? src : out;
}

/**
 * 어느 끝 낱말이 떼였나(전/후 명단용 — 사장님께 보여 드리는 칸). 없으면 "".
 * @param {unknown} name
 * @returns {string}
 */
export function trailingRemoved(name) {
  const m = TRAILING_RE.exec(stripNoticeWords(String(name ?? "")));
  if (!m || cardTitle(name) === String(name ?? "")) return ""; // 빈 결과라 원래 이름으로 돌아간 경우도 "안 뗌"
  return m[0].replace(TRIM_RE, "");
}
