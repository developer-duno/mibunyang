// @ts-check
/**
 * `selectAll` keyCol 커버리지 정적 가드 (세션544 PR-B) — **ALLOWLIST 없음(예외 0)**.
 *
 * 왜: ORDER BY 없는 OFFSET 페이징은 1,000행을 넘는 표에서 **에러 없이** 행이 샌다
 * (같은 offset 두 번 조회 교집합 0 실측 — `.claude/rules/collectors/unordered-pagination-loses-rows.md`).
 * `selectAll(fn, sb, keyCol)` 은 세션534에 **옵트인** 커서로 들어갔고 세션543이 명단 4곳만 옮겼다.
 * 세션544가 남은 무키 호출을 전부 옮기면서, 다시 무키 호출이 생기지 못하게 이 가드를 단다.
 *
 * 스캔 방식 (규칙 문서 §"스캔 맹점 1·2" 답습):
 *   - 단일줄 정규식은 **반드시 놓친다**(콤마가 다음 줄에 있는 호출). 그래서 `selectAll(` 마다
 *     **괄호 균형**으로 닫는 괄호를 찾고 최상위 콤마로 인자 수를 센다.
 *   - 주석 제거(`stripComments`)는 두 단계다(§"주석을 걷어낸 사본 자체가 코드를 먹을 수 있다" +
 *     §"줄머리 고정만으로는 부족하다"). 한 방 정규식은 문자열 안 Accept 헤더의 별-슬래시-별을
 *     주석 시작으로 오인해 **코드를 통째로 먹는다** — 그러면 가드는 무엇을 넣어도 통과한다.
 *   - 그 위에 `maskCode` 로 **문자열·정규식 리터럴·남은 주석의 내용만** 덮은 사본을 만들어
 *     구조(괄호·콤마)를 읽는다. 정규식 리터럴을 모르면 naver-listings.mjs 의
 *     `/token\s*[:=]\s*["'](eyJ…)["']/` 안 따옴표가 가짜 문자열을 열어 **그 파일의 호출이
 *     통째로 사라진다**(실측: 이 처리를 넣기 전 그 파일 호출 0건으로 집계됐다).
 *   - 그래도 남는 사각을 막으려고 **총 호출 수 >= 60** 과 "selectAll 을 쓰는 파일은 최소 1건이
 *     보인다"를 함께 단언한다(2026-09-09 실측 65). 스트리퍼·마스커가 코드를 먹으면 먼저 무너진다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

/** 스캔 대상에서 뺄 디렉토리 (gitignore 되는 탐침) */
const EXCLUDED_DIRS = new Set(["probes", "node_modules"]);
/** `selectAll` **정의** 파일 — 호출이 아니라 선언이므로 검사 대상 아님 */
const DEFINITION_FILE = "collectors/_shared.mjs";

/** 실측 총 호출 수 하한 — 스트리퍼·마스커가 코드를 먹으면 이 수가 먼저 무너진다 */
export const MIN_TOTAL_CALLS = 60;

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
function isRegexStart(src, idx) {
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
 * 되돌리는 뮤테이션(G3)에서 망가진 따옴표가 한 줄만 먹고 말아 픽스처가 초록으로 통과한다.
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
 * `selectAll(` 호출 하나의 인자 **범위**를 괄호 균형으로 잘라낸다.
 * 입력은 반드시 `maskCode` 를 지난 사본이어야 한다(문자열 안 괄호·콤마가 지워진 상태).
 * @param {string} masked
 * @param {number} openIdx 여는 괄호의 인덱스
 * @returns {{ ranges: Array<[number, number]>, endIdx: number } | null}
 */
export function sliceCallArgs(masked, openIdx) {
  /** @type {Array<[number, number]>} */
  const ranges = [];
  let depth = 0;
  let start = openIdx + 1;
  for (let i = openIdx; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        ranges.push([start, i]);
        return { ranges, endIdx: i };
      }
      continue;
    }
    if (c === "," && depth === 1) {
      ranges.push([start, i]);
      start = i + 1;
    }
  }
  return null;
}

/**
 * 한 파일 소스에서 `selectAll(` 호출을 전부 찾는다.
 * @param {string} rawSrc
 * @returns {Array<{ line: number, args: string[], judged: string[] }>}
 */
export function scanSelectAllCalls(rawSrc) {
  const src = stripComments(rawSrc);
  // 구조는 마스크 사본에서, 인자 텍스트는 원본에서
  // (인자에 `"id"` 같은 리터럴이 그대로 있어야 keyCol 판정이 된다).
  const masked = maskCode(src);
  /** @type {Array<{ line: number, args: string[], judged: string[] }>} */
  const out = [];
  const re = /selectAll\s*\(/g;
  /** @type {RegExpExecArray | null} */
  let m;
  while ((m = re.exec(masked)) !== null) {
    const before = m.index > 0 ? masked[m.index - 1] : "";
    // `mySelectAll(` / `x.selectAll(` 같은 다른 심볼은 제외
    if (/[A-Za-z0-9_$.]/.test(before)) continue;
    const sliced = sliceCallArgs(masked, m.index + m[0].length - 1);
    if (!sliced) continue;
    const args = sliced.ranges.map(([s, e]) => src.slice(s, e));
    // 판정용 = **마스크 사본**의 같은 구간(주석·문자열 내용이 공백). 원본으로 판정하면
    // `sb, // keyCol 은 다음에\n)` 의 줄 중간 주석이 "3번째 인자"로 세어져 무키 호출이 통과한다
    // (세션544 독립 리뷰 중간1 — 픽스처 (10)). 따옴표는 남으므로 `""` 와 `"id"`(→ `"  "`)는 구분된다.
    const judged = sliced.ranges.map(([s, e]) => masked.slice(s, e));
    // 마지막 인자가 비어 있으면 = 인자 없음 `selectAll()` 또는 **트레일링 콤마**(주석만 남은 자리 포함).
    // 트레일링 콤마를 인자로 세면 `selectAll(fn,\n sb,\n)` 이 3인자로 보여 위반이 새어 나간다.
    if (judged.length > 0 && judged[judged.length - 1].trim() === "") {
      args.pop();
      judged.pop();
    }
    out.push({ line: src.slice(0, m.index).split("\n").length, args, judged });
  }
  return out;
}

/** 3번째 인자가 "키를 안 넘긴 것"인가 */
const EMPTY_KEY = /^(null|undefined|""|''|``)$/;

/**
 * 이미 스캔한 호출 목록에서 위반(= 무키)만 추린다.
 * @param {Array<{ line: number, args: string[], judged?: string[] }>} calls
 * @returns {Array<{ line: number, reason: string }>}
 */
export function keylessFrom(calls) {
  return calls.flatMap(({ line, args, judged }) => {
    const j = judged ?? args; // 판정은 마스크 사본으로 — `null // 주석` 도 null 로 읽힌다
    if (j.length < 3) return [{ line, reason: `인자 ${j.length}개 — keyCol 미지정` }];
    const third = j[2].trim();
    if (EMPTY_KEY.test(third)) return [{ line, reason: `keyCol=${(args[2] ?? third).trim()}` }];
    return [];
  });
}

/**
 * 위반(= 무키) 호출 목록.
 * @param {string} rawSrc
 * @returns {Array<{ line: number, reason: string }>}
 */
export function findKeylessCalls(rawSrc) {
  return keylessFrom(scanSelectAllCalls(rawSrc));
}

/**
 * scripts/ 아래 검사 대상 .mjs 상대경로(슬래시 구분).
 * @param {string} [dir]
 * @param {string} [rel]
 * @returns {string[]}
 */
export function listTargets(dir = SCRIPTS_DIR, rel = "") {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(abs).isDirectory()) {
      if (EXCLUDED_DIRS.has(name)) continue;
      out.push(...listTargets(abs, r));
      continue;
    }
    if (!name.endsWith(".mjs") || name.endsWith(".test.mjs")) continue;
    if (r === DEFINITION_FILE) continue;
    out.push(r);
  }
  return out;
}

describe("selectAll keyCol 커버리지 (ALLOWLIST 없음)", () => {
  const scanned = listTargets().map((rel) => {
    const src = readFileSync(path.join(SCRIPTS_DIR, rel), "utf8");
    // `selectAll` 이라는 글자가 아예 없는 파일은 호출도 0건이다 — 비싼 마스킹을 건너뛴다.
    // (전수 스캔이 워커 CPU 를 먹으면 옆 테스트의 5초 타임아웃을 건드린다. 실측: 이 필터 없이
    //  scripts/ 전체를 돌리면 kakao-radius.test.mjs 가 간헐 타임아웃했다.)
    const mentions = src.includes("selectAll");
    const calls = mentions ? scanSelectAllCalls(src) : []; // 파일당 한 번만 스캔한다
    return { rel, src, mentions, calls, violations: keylessFrom(calls) };
  });

  it(`스캐너가 실제로 코드를 보고 있다 — 총 selectAll 호출 >= ${MIN_TOTAL_CALLS}`, () => {
    const total = scanned.reduce((n, f) => n + f.calls.length, 0);
    expect(total).toBeGreaterThanOrEqual(MIN_TOTAL_CALLS);
  });

  it("selectAll 을 쓰는 파일은 최소 1건이 보인다 — 마스커가 파일을 통째로 먹지 않았다", () => {
    // naver-listings.mjs 는 정규식 리터럴 안 따옴표 때문에 마스커가 파일 전체를 먹은 적이 있다.
    const blind = scanned
      .filter(({ src, mentions, calls }) => mentions && calls.length === 0 && /\bselectAll\s*\(/.test(stripComments(src)))
      .map(({ rel }) => rel);
    expect(blind).toEqual([]);
  });

  it("keyCol 없는 selectAll 호출이 없다", () => {
    const bad = scanned.flatMap(({ rel, violations }) =>
      violations.map((v) => `${rel}:${v.line} (${v.reason})`),
    );
    expect(bad).toEqual([]);
  });
});

// 스캐너 자체 픽스처 (가드가 뭘 검사하는지 모른 채 통과하는 걸 막는다)
describe("스캐너 픽스처", () => {
  it("(1) 한 줄 무키 호출 = 위반", () => {
    const src = 'const a = await selectAll((s) => s.from("t").select("id"), sb);\n';
    expect(findKeylessCalls(src)).toEqual([{ line: 1, reason: "인자 2개 — keyCol 미지정" }]);
  });

  it("(2) 여러 줄 무키 호출(콤마가 다음 줄) = 위반", () => {
    const src = ["const a = await selectAll(", '  (s) => s.from("t").select("id"),', "  sb,", ");", ""].join("\n");
    expect(findKeylessCalls(src).map((v) => v.line)).toEqual([1]);
  });

  it("(3) 키 있음 = 통과", () => {
    const src = 'const a = await selectAll((s) => s.from("t").select("id"), sb, "id");\n';
    expect(findKeylessCalls(src)).toEqual([]);
    expect(scanSelectAllCalls(src)).toHaveLength(1);
  });

  it("(4) 주석 처리된 무키 호출 = 위반 아님", () => {
    const block = ["/**", ' * const a = await selectAll((s) => s.from("t").select("id"), sb);', " */", ""].join("\n");
    const lineC = '  // await selectAll((s) => s.from("t").select("id"), sb);\n';
    const trailing = 'const x = 1; // await selectAll((s) => s.from("t").select("id"), sb);\n';
    expect(scanSelectAllCalls(block)).toEqual([]);
    expect(scanSelectAllCalls(lineC)).toEqual([]);
    expect(scanSelectAllCalls(trailing)).toEqual([]);
  });

  it("(5) 문자열 안 selectAll( 텍스트 = 위반 아님", () => {
    const src =
      'const msg = "await selectAll((s) => x, sb)";\nconst ok = await selectAll((s) => s.from("t").select("id"), sb, "id");\n';
    expect(scanSelectAllCalls(src)).toHaveLength(1);
    expect(findKeylessCalls(src)).toEqual([]);
  });

  it("(6) 인자 안에 콤마·괄호가 있는 2인자 호출 = 위반", () => {
    const src = 'const a = await selectAll((s) => s.from("t").select("id").in("id", [x, y, z]), sb);\n';
    expect(findKeylessCalls(src)).toEqual([{ line: 1, reason: "인자 2개 — keyCol 미지정" }]);
  });

  it("(7) 한 방 스트리퍼가 먹는 자리 — Accept 헤더 뒤 코드가 살아 있다", () => {
    const src = [
      'const H = { Accept: "application/json, text/plain, */*" };',
      "/** @type {any} */",
      'const a = await selectAll((s) => s.from("t").select("id"), sb);',
      "",
    ].join("\n");
    // 한 방 정규식이면 1줄 Accept 헤더부터 2줄 JSDoc 닫기까지 먹혀 위반이 사라진다.
    // 두 단계 스트리퍼는 3줄을 그대로 보므로 위반이 잡힌다.
    expect(findKeylessCalls(src)).toEqual([{ line: 3, reason: "인자 2개 — keyCol 미지정" }]);
  });

  it("(8) 정규식 리터럴 안 따옴표가 뒤 코드를 먹지 않는다", () => {
    const src = [
      "const P = /token\\s*[:=]\\s*[\"'](eyJ[A-Za-z0-9._-]+)[\"']/;",
      'const a = await selectAll((s) => s.from("t").select("id"), sb);',
      "",
    ].join("\n");
    expect(findKeylessCalls(src)).toEqual([{ line: 2, reason: "인자 2개 — keyCol 미지정" }]);
  });

  it("(9) 나눗셈은 정규식으로 오독하지 않는다", () => {
    const src = [
      "const r = total / count;",
      'const a = await selectAll((s) => s.from("t").select("id"), sb);',
      "",
    ].join("\n");
    expect(findKeylessCalls(src)).toEqual([{ line: 2, reason: "인자 2개 — keyCol 미지정" }]);
  });

  it("(10) ★ sb 뒤 줄 중간 주석은 3번째 인자가 아니다 — 키 누락은 위반, \"id\" // 주석 은 통과, null // 주석 은 위반", () => {
    // 세션544 독립 리뷰 중간1: 원본 텍스트로 pop 을 판정하면 ` // keyCol 은 다음에` 가 인자로 세어져 통과했다.
    const missing = ["const a = await selectAll(", '  (s) => s.from("t").select("id"),', "  sb, // keyCol 은 다음 PR 에서", ");", ""].join("\n");
    expect(findKeylessCalls(missing)).toEqual([{ line: 1, reason: "인자 2개 — keyCol 미지정" }]);
    const keyed = ["const a = await selectAll(", '  (s) => s.from("t").select("id"),', '  sb, "id", // 커서 키', ");", ""].join("\n");
    expect(findKeylessCalls(keyed)).toEqual([]);
    const nulled = ["const a = await selectAll(", '  (s) => s.from("t").select("id"),', "  sb, null, // 아직", ");", ""].join("\n");
    expect(findKeylessCalls(nulled).map((v) => v.reason)).toEqual(["keyCol=null"]);
  });
});
