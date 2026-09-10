// @ts-check
/**
 * 소스 grep 가드용 **주석 제거 + 리터럴 마스킹** 공용 모듈 (세션546 PR-D M6).
 *
 * 왜 공용인가: 소스를 정규식으로 훑는 가드는 전부 같은 두 함정을 밟는다.
 *   1) 한 방 주석 정규식이 문자열 안 `Accept: "application/json, ... <별-슬래시-별>"` 의
 *      별-슬래시를 주석 시작으로 오인해 **코드를 통째로 먹는다**([[guards-must-be-mutation-tested]]
 *      §"주석을 걷어낸 사본 자체가 코드를 먹을 수 있다" — 세션531·539 실사고).
 *   2) 정규식 리터럴 안 따옴표가 **가짜 문자열을 열어** 뒤 코드를 삼키거나,
 *      반대로 정규식 안 텍스트가 진짜 코드로 오독된다.
 *      실측 오탐(세션545): `audit-declared-deps.mjs` 가 테스트 파일의
 *      정규식 리터럴 `/… from "\.\/_shared\.mjs"/` 를 import 로 읽어
 *      `\.\` 를 "미선언 패키지" 로 보고 exit 1 을 냈다.
 *
 * 원본은 `scripts/_selectall-keycol-coverage.test.mjs`(세션544)에 있던 구현이고,
 * 그 테스트가 이 모듈의 회귀 가드 역할을 계속한다(픽스처 7·8·9번).
 *
 * 쓰는 법 — **구조는 마스크 사본에서, 텍스트는 원본에서** 읽는다.
 * 마스킹은 리터럴의 *내용만* 공백으로 덮고 구분자(따옴표·괄호)와 길이·줄바꿈을
 * 보존하므로, 마스크 사본에서 찾은 인덱스를 원본에 그대로 대입할 수 있다.
 */

/** 한 글자를 공백으로 덮되 줄바꿈은 보존(줄 번호 유지) */
function blankChar(/** @type {string[]} */ out, /** @type {number} */ i) {
  if (out[i] !== undefined && out[i] !== "\n") out[i] = " ";
}

/**
 * 주석을 **줄 수를 보존한 채** 공백으로 지운다.
 * @param {string} src
 * @returns {string}
 */
export function stripComments(src) {
  const blank = (/** @type {string} */ m) => m.replace(/[^\n]/g, " ");
  return (
    src
      // (1) 줄머리 블록 주석 — 문자열 리터럴은 줄머리에서 시작하지 않는다
      .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, blank)
      // (2) 줄 중간 블록 주석 — 별 뒤의 슬래시-별(= 문자열 안 Accept 헤더)만 제외
      .replace(/(?<!\*)\/\*[\s\S]*?\*\//g, blank)
      // (3) 줄머리 줄 주석만 — 문자열 안 URL 의 // 를 건드리지 않는다
      .replace(/^[ \t]*\/\/[^\n]*/gm, blank)
  );
}

/** 이 낱말 뒤의 `/` 는 나눗셈이 아니라 정규식 리터럴이다 */
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "case",
  "do",
  "else",
  "yield",
  "await",
  "throw",
]);

/**
 * 앞 문맥으로 보아 이 `/` 가 정규식 리터럴의 시작인가(아니면 나눗셈인가).
 * @param {string} src
 * @param {number} idx `/` 의 인덱스
 * @returns {boolean}
 */
export function isRegexStart(src, idx) {
  const before = src.slice(0, idx).replace(/\s+$/, "");
  if (before === "") return true;
  const pv = before[before.length - 1];
  if (!/[A-Za-z0-9_$)\]]/.test(pv)) return true;
  const word = before.match(/[A-Za-z_$][A-Za-z0-9_$]*$/);
  return !!word && REGEX_PRECEDING_KEYWORDS.has(word[0]);
}

/**
 * 문자열·템플릿·정규식 리터럴·남은 주석의 **내용만** 공백으로 덮은 사본
 * (구분자·줄바꿈·길이 보존). 구조(괄호·콤마)를 읽는 유일한 기준.
 *
 * ⚠️ 문자열이 줄바꿈에서 끝난다고 가정하지 **않는다**. 그 가정을 넣으면 한 방 스트리퍼로
 * 되돌리는 뮤테이션에서 망가진 따옴표가 한 줄만 먹고 말아 픽스처가 초록으로 통과한다.
 * @param {string} src 주석이 지워진 소스
 * @returns {string}
 */
export function maskCode(src) {
  const out = src.split("");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    // 줄 중간 줄 주석 — stripComments 는 줄머리만 지운다
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") blankChar(out, i++);
      continue;
    }
    // 줄 중간 블록 주석 (stripComments 를 빠져나온 자리)
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      while (i < stop) blankChar(out, i++);
      i--;
      continue;
    }
    if (c === "/" && isRegexStart(src, i)) {
      let j = i + 1;
      let inClass = false;
      for (; j < src.length; j++) {
        const d = src[j];
        if (d === "\\") {
          blankChar(out, j);
          blankChar(out, j + 1);
          j++;
          continue;
        }
        // 정규식은 줄을 넘지 않는다 — 나눗셈으로 오판했을 때 피해를 한 줄로 가둔다
        if (d === "\n") break;
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
        blankChar(out, j);
      }
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      for (; j < src.length; j++) {
        const d = src[j];
        if (d === "\\") {
          blankChar(out, j);
          blankChar(out, j + 1);
          j++;
          continue;
        }
        if (d === quote) break;
        if (quote === "`" && d === "$" && src[j + 1] === "{") {
          // 보간 안은 코드다 — 덮지 않고 중괄호 균형으로 건너뛴다
          let depth = 0;
          j += 1;
          for (; j < src.length; j++) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}") {
              depth--;
              if (depth === 0) break;
            }
          }
          continue;
        }
        blankChar(out, j);
      }
      i = j;
      continue;
    }
  }
  return out.join("");
}

/**
 * `maskCode(stripComments(src))` — 구조를 읽을 사본.
 * 원본과 **길이·줄바꿈 위치가 같다**(인덱스 그대로 원본에 대입 가능).
 * @param {string} src
 * @returns {string}
 */
export function maskedSource(src) {
  return maskCode(stripComments(src));
}
