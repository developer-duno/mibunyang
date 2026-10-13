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
export const NOTICE_WORDS = "계약취소주택|취소후\\s*재공급|조합원\\s*취소분|불법행위\\s*재공급|재공급|청약|문의|재당첨|거주자|무주택|세대구성원";
const ROUND_FORM = `(?:(?:${ROUND_WORDS})\\s*(?:\\d+\\s*(?:차|회차|회))?|\\d+\\s*(?:차|회차|회))`;
export const NOTICE_WORD_RE = new RegExp(`^\\s*${ROUND_FORM}\\s*$|${NOTICE_WORDS}`);

/** Postgres ARE — `name ~ 패턴` 과 `regexp_replace(name, 패턴, ' ', 'g')` 에 쓴다(괄호째). 위 JS 와 **같은 낱말 문자열**로 조립한다. */
export const NOTICE_PAREN_SQL = `\\((?:\\s*${ROUND_FORM}\\s*|[^()]*(?:${NOTICE_WORDS})[^()]*)\\)`;

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
