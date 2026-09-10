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
 *   - 그래도 남는 사각을 막으려고 **총 호출 수 >= MIN_TOTAL_CALLS** 와 "selectAll 을 쓰는 파일은
 *     최소 1건이 보인다"를 함께 단언한다(2026-09-11 실측 71). 스트리퍼·마스커가 코드를 먹으면 먼저 무너진다.
 *
 * 3층 보강 (세션546 M2) — "3번째 인자가 비지 않았다"만 보면 다음이 전부 통과했다:
 *   ① **비고유 키**(`"region"`·`"deal_month"`) → 페이지 경계 동률 행이 에러 없이 사라진다
 *      (세션514 실측 교집합 64/91). `KNOWN_UNIQUE_KEYS` 로 표별 PK 를 대조한다.
 *   ② **select 에 그 키가 없음** → `_shared.mjs` 가 런타임에 throw 하지만, 1,000행 미만 표에서는
 *      그 throw 조차 안 난다(M1 로 첫 페이지에서 나게 고쳤어도 "돌려 봐야 안다"는 사실은 그대로).
 *   ③ **식별자·템플릿**(`selectAll(fn, sb, keyVar)`) → 런타임에 `undefined` 면 커서가 아예 안 켜져
 *      무정렬 OFFSET 으로 조용히 되돌아간다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { stripComments, maskCode } from "./_source-mask.mjs";

const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

/** 스캔 대상에서 뺄 디렉토리 (gitignore 되는 탐침) */
const EXCLUDED_DIRS = new Set(["probes", "node_modules"]);
/** `selectAll` **정의** 파일 — 호출이 아니라 선언이므로 검사 대상 아님 */
const DEFINITION_FILE = "collectors/_shared.mjs";

/**
 * 실측 총 호출 수 하한 — 스트리퍼·마스커가 코드를 먹으면 이 수가 먼저 무너진다.
 *
 * 2026-09-11 실측 **71**(세션546 M2 — #485 31곳 전환 + #487 remap 도구 4곳 포함).
 * 여유를 두지 않는다: 옛 값 60 은 실측 66 대비 6건이나 남아 **마스커가 6건을 먹어도 초록**이었다.
 * 호출을 늘리거나 줄이면 이 수도 같이 고친다(사람이 한 번 확인하는 자리).
 * 재측정: `npx vitest run scripts/_selectall-keycol-coverage.test.mjs` 의 실패 메시지가 실제 수를 알려준다.
 */
export const MIN_TOTAL_CALLS = 71;

/**
 * 표별 **고유** 키 — 커서 키가 고유하지 않으면 페이지 경계의 동률 행이 **에러 없이 사라진다**
 * (세션514 실측: `deal_month` 로 정렬한 같은 오프셋 2회 조회 교집합 64/91).
 * 가드가 "3번째 인자가 비지 않았다"만 보면 `"region"` 같은 비고유 키가 그대로 통과한다.
 *
 * ⚠️ 여기 없는 표는 `default`("id")로 대조하되 **별도 테스트가 미등재로 red** 를 낸다 —
 * 새 표를 쓰는 사람이 그 표의 PK 를 한 번 확인하고 이 목록에 적게 만드는 자리다.
 * (`id` 컬럼 자체가 없는 표가 있다: articles·complexes — 기본값으로 두면 조회가 죽는다.)
 */
export const KNOWN_UNIQUE_KEYS = {
  default: "id",
  apartments: "id",
  apartments_flat: "id",
  applyhome_unit_supply: "id",
  articles: "article_no",
  complexes: "complex_no",
  dev_plans: "id",
  infra: "apartment_id",
  notification_logs: "id",
  presale_schedule_official: "id",
  prices: "id",
  regions: "id",
  schools: "apartment_id",
  subscribers: "id",
  trades: "id",
  trade_stats: "apartment_id",
  transport: "apartment_id",
};

// 주석 제거·리터럴 마스킹은 공용 모듈(세션546 M6) — audit-declared-deps.mjs 와 같은 구현을 쓴다.
// 이 파일의 픽스처 (7)(8)(9) 가 그 모듈의 회귀 가드다.
export { stripComments, maskCode };

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
 * 3번째 인자가 **따옴표로 시작하는 한 줄 문자열 리터럴** 인가 (마스크 사본 기준 —
 * 리터럴 내용이 공백으로 덮여 있으므로 `"id"` 는 `"  "` 로 보인다).
 * 식별자(`keyVar`)·템플릿(`` `id` ``)·식(`a + b`)은 전부 탈락 — 런타임에 `undefined` 면
 * 커서 모드가 아예 안 켜지는데(3번째 인자가 falsy) 가드는 통과하는 구멍이 생긴다.
 */
const LITERAL_KEY = /^"[^"]*"$|^'[^']*'$/;

/**
 * 마스크 사본에서 리터럴 위치를 잡고 **원본에서 값을 읽는다**.
 * @param {string} judgedArg 마스크된 인자 텍스트
 * @param {string} rawArg 같은 범위의 원본 텍스트(길이 동일)
 * @returns {string | null}
 */
export function literalValue(judgedArg, rawArg) {
  const dq = judgedArg.indexOf('"');
  const sq = judgedArg.indexOf("'");
  const start = dq === -1 ? sq : sq === -1 ? dq : Math.min(dq, sq);
  if (start === -1) return null;
  const quote = judgedArg[start];
  const end = judgedArg.indexOf(quote, start + 1);
  if (end === -1) return null;
  return rawArg.slice(start + 1, end);
}

/**
 * 인자 텍스트의 `[from, to)` 구간에 있는 문자열 리터럴 값들(원본 기준).
 * 백틱(템플릿)은 보간이 코드로 남아 경계를 못 믿으므로 건너뛴다.
 * @param {string} judged
 * @param {string} raw
 * @param {number} from
 * @param {number} to
 * @returns {string[]}
 */
function literalsIn(judged, raw, from, to) {
  /** @type {string[]} */
  const out = [];
  for (let i = from; i < to; i++) {
    const c = judged[i];
    if (c !== '"' && c !== "'") continue;
    const end = judged.indexOf(c, i + 1);
    if (end === -1 || end >= to) break;
    out.push(raw.slice(i + 1, end));
    i = end;
  }
  return out;
}

/**
 * `<이름>(` 호출의 인자 구간을 괄호 균형으로 잘라낸다.
 * @param {string} judged 마스크 사본
 * @param {string} name 함수 이름 (예: "select")
 * @returns {Array<[number, number]>} 여는 괄호 **다음**부터 닫는 괄호 직전까지
 */
function callRanges(judged, name) {
  /** @type {Array<[number, number]>} */
  const out = [];
  const re = new RegExp(`\\b${name}\\s*\\(`, "g");
  /** @type {RegExpExecArray | null} */
  let m;
  while ((m = re.exec(judged)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < judged.length; i++) {
      const c = judged[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        depth--;
        if (depth === 0) {
          out.push([open + 1, i]);
          break;
        }
      }
    }
  }
  return out;
}

/**
 * 층 1 — 1번째 인자에서 `.from("<표>")` 의 표 이름.
 * 변수(`from(tbl)`)면 null → 위반(사람이 PK 를 못 확인하는 자리).
 * @param {string} judged0
 * @param {string} raw0
 * @returns {string | null}
 */
export function extractTable(judged0, raw0) {
  for (const [s, e] of callRanges(judged0, "from")) {
    const lits = literalsIn(judged0, raw0, s, e);
    if (lits.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(lits[0])) return lits[0];
  }
  return null;
}

/**
 * 층 2 — `select(...)` 안에 커서 키가 실제로 보이는가.
 * `select("*")` 통과 · `select("id, name")` 통과 · 배열 `.join(", ")` 조립도
 * 원소 리터럴을 그대로 보므로 통과(`infra-kakao.mjs` 사례).
 *
 * ⚠️ 리터럴 수집을 **`select(` 안으로 한정**한다. 인자 전체에서 찾으면
 * `.not("id", "is", null)` 같은 필터의 컬럼명이 select 를 대신 증명해 버린다.
 * @param {string} judged0
 * @param {string} raw0
 * @param {string} key
 * @returns {boolean}
 */
export function selectHasKey(judged0, raw0, key) {
  for (const [s, e] of callRanges(judged0, "select")) {
    for (const lit of literalsIn(judged0, raw0, s, e)) {
      if (lit.trim() === "*") return true;
      if (lit.split(",").some((tok) => tok.trim() === key)) return true;
    }
  }
  return false;
}

/**
 * 이미 스캔한 호출 목록에서 위반을 추린다 — 3층(세션546 M2).
 *   ① 표의 **고유** 키인가 (`KNOWN_UNIQUE_KEYS`)
 *   ② 그 키가 **select 에 들어 있는가** (없으면 `_shared.mjs` 가 런타임에 throw)
 *   ③ 3번째 인자가 **문자열 리터럴**인가 (식별자면 `undefined` 로 커서가 안 켜질 수 있다)
 * @param {Array<{ line: number, args: string[], judged?: string[] }>} calls
 * @param {Record<string, string>} [known]
 * @returns {Array<{ line: number, reason: string }>}
 */
export function keylessFrom(calls, known = KNOWN_UNIQUE_KEYS) {
  return calls.flatMap(({ line, args, judged }) => {
    const j = judged ?? args; // 판정은 마스크 사본으로 — `null // 주석` 도 null 로 읽힌다
    if (j.length < 3) return [{ line, reason: `인자 ${j.length}개 — keyCol 미지정` }];
    const third = j[2].trim();
    if (EMPTY_KEY.test(third)) return [{ line, reason: `keyCol=${(args[2] ?? third).trim()}` }];
    // ③ 리터럴 강제
    if (!LITERAL_KEY.test(third)) {
      return [{ line, reason: `keyCol 이 문자열 리터럴이 아님 — 식별자·템플릿 금지 (${third.slice(0, 40)})` }];
    }
    const key = literalValue(j[2], args[2] ?? "");
    if (!key) return [{ line, reason: "keyCol 리터럴 값을 읽지 못함" }];

    /** @type {Array<{ line: number, reason: string }>} */
    const out = [];
    // ① 표의 고유 키
    const table = extractTable(j[0] ?? "", args[0] ?? "");
    if (!table) {
      out.push({ line, reason: 'from("<표>") 을 못 읽음 — 표 이름은 문자열 리터럴이어야 한다' });
    } else {
      const expected = known[table] ?? known.default;
      if (key !== expected) {
        out.push({ line, reason: `${table} 의 고유키는 "${expected}" 인데 keyCol="${key}" (비고유 키면 동률 행이 샌다)` });
      }
    }
    // ② select 배선
    if (!selectHasKey(j[0] ?? "", args[0] ?? "", key)) {
      out.push({ line, reason: `select 에 "${key}" 가 안 보인다 — 커서 키는 select 에 포함돼야 한다` });
    }
    return out;
  });
}

/**
 * 스캔한 호출들이 쓰는 표 이름 집합.
 * @param {Array<{ args: string[], judged?: string[] }>} calls
 * @returns {string[]}
 */
export function tablesFrom(calls) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const { args, judged } of calls) {
    const t = extractTable((judged ?? args)[0] ?? "", args[0] ?? "");
    if (t) out.add(t);
  }
  return [...out].sort();
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

  it("keyCol 위반이 없다 — 미지정·비고유 키·select 누락·비리터럴 (3층)", () => {
    const bad = scanned.flatMap(({ rel, violations }) =>
      violations.map((v) => `${rel}:${v.line} (${v.reason})`),
    );
    expect(bad).toEqual([]);
  });

  // 새 표를 쓰면 **사람이 그 표의 PK 를 한 번 확인**하고 목록에 적게 만드는 자리.
  // `default: "id"` 폴백만 두면 PK 가 id 가 아닌 새 표(articles·complexes 같은)가 조용히 통과한다.
  it("스캔된 표가 전부 KNOWN_UNIQUE_KEYS 에 등재돼 있다", () => {
    const tables = tablesFrom(scanned.flatMap(({ calls }) => calls));
    expect(tables.length).toBeGreaterThan(0); // 표를 하나도 못 읽으면 위 대조가 무의미하다
    const unknown = tables.filter((t) => !(t in KNOWN_UNIQUE_KEYS));
    expect(unknown).toEqual([]);
  });
});

// 스캐너 자체 픽스처 (가드가 뭘 검사하는지 모른 채 통과하는 걸 막는다)
describe("스캐너 픽스처", () => {
  it("(1) 한 줄 무키 호출 = 위반", () => {
    const src = 'const a = await selectAll((s) => s.from("apartments").select("id"), sb);\n';
    expect(findKeylessCalls(src)).toEqual([{ line: 1, reason: "인자 2개 — keyCol 미지정" }]);
  });

  it("(2) 여러 줄 무키 호출(콤마가 다음 줄) = 위반", () => {
    const src = ["const a = await selectAll(", '  (s) => s.from("apartments").select("id"),', "  sb,", ");", ""].join("\n");
    expect(findKeylessCalls(src).map((v) => v.line)).toEqual([1]);
  });

  it("(3) 키 있음 = 통과", () => {
    const src = 'const a = await selectAll((s) => s.from("apartments").select("id"), sb, "id");\n';
    expect(findKeylessCalls(src)).toEqual([]);
    expect(scanSelectAllCalls(src)).toHaveLength(1);
  });

  it("(4) 주석 처리된 무키 호출 = 위반 아님", () => {
    const block = ["/**", ' * const a = await selectAll((s) => s.from("apartments").select("id"), sb);', " */", ""].join("\n");
    const lineC = '  // await selectAll((s) => s.from("apartments").select("id"), sb);\n';
    const trailing = 'const x = 1; // await selectAll((s) => s.from("apartments").select("id"), sb);\n';
    expect(scanSelectAllCalls(block)).toEqual([]);
    expect(scanSelectAllCalls(lineC)).toEqual([]);
    expect(scanSelectAllCalls(trailing)).toEqual([]);
  });

  it("(5) 문자열 안 selectAll( 텍스트 = 위반 아님", () => {
    const src =
      'const msg = "await selectAll((s) => x, sb)";\nconst ok = await selectAll((s) => s.from("apartments").select("id"), sb, "id");\n';
    expect(scanSelectAllCalls(src)).toHaveLength(1);
    expect(findKeylessCalls(src)).toEqual([]);
  });

  it("(6) 인자 안에 콤마·괄호가 있는 2인자 호출 = 위반", () => {
    const src = 'const a = await selectAll((s) => s.from("apartments").select("id").in("id", [x, y, z]), sb);\n';
    expect(findKeylessCalls(src)).toEqual([{ line: 1, reason: "인자 2개 — keyCol 미지정" }]);
  });

  it("(7) 한 방 스트리퍼가 먹는 자리 — Accept 헤더 뒤 코드가 살아 있다", () => {
    const src = [
      'const H = { Accept: "application/json, text/plain, */*" };',
      "/** @type {any} */",
      'const a = await selectAll((s) => s.from("apartments").select("id"), sb);',
      "",
    ].join("\n");
    // 한 방 정규식이면 1줄 Accept 헤더부터 2줄 JSDoc 닫기까지 먹혀 위반이 사라진다.
    // 두 단계 스트리퍼는 3줄을 그대로 보므로 위반이 잡힌다.
    expect(findKeylessCalls(src)).toEqual([{ line: 3, reason: "인자 2개 — keyCol 미지정" }]);
  });

  it("(8) 정규식 리터럴 안 따옴표가 뒤 코드를 먹지 않는다", () => {
    const src = [
      "const P = /token\\s*[:=]\\s*[\"'](eyJ[A-Za-z0-9._-]+)[\"']/;",
      'const a = await selectAll((s) => s.from("apartments").select("id"), sb);',
      "",
    ].join("\n");
    expect(findKeylessCalls(src)).toEqual([{ line: 2, reason: "인자 2개 — keyCol 미지정" }]);
  });

  it("(9) 나눗셈은 정규식으로 오독하지 않는다", () => {
    const src = [
      "const r = total / count;",
      'const a = await selectAll((s) => s.from("apartments").select("id"), sb);',
      "",
    ].join("\n");
    expect(findKeylessCalls(src)).toEqual([{ line: 2, reason: "인자 2개 — keyCol 미지정" }]);
  });

  it("(10) ★ sb 뒤 줄 중간 주석은 3번째 인자가 아니다 — 키 누락은 위반, \"id\" // 주석 은 통과, null // 주석 은 위반", () => {
    // 세션544 독립 리뷰 중간1: 원본 텍스트로 pop 을 판정하면 ` // keyCol 은 다음에` 가 인자로 세어져 통과했다.
    const missing = ["const a = await selectAll(", '  (s) => s.from("apartments").select("id"),', "  sb, // keyCol 은 다음 PR 에서", ");", ""].join("\n");
    expect(findKeylessCalls(missing)).toEqual([{ line: 1, reason: "인자 2개 — keyCol 미지정" }]);
    const keyed = ["const a = await selectAll(", '  (s) => s.from("apartments").select("id"),', '  sb, "id", // 커서 키', ");", ""].join("\n");
    expect(findKeylessCalls(keyed)).toEqual([]);
    const nulled = ["const a = await selectAll(", '  (s) => s.from("apartments").select("id"),', "  sb, null, // 아직", ");", ""].join("\n");
    expect(findKeylessCalls(nulled).map((v) => v.reason)).toEqual(["keyCol=null"]);
  });
});

// 3층 픽스처 (세션546 M2) — 층마다 최소 1건씩. 층을 하나 지우는 뮤테이션에 그 층의 케이스가 red.
describe("3층 픽스처 — 고유키 · select 배선 · 리터럴", () => {
  /**
   * 3인자 호출 한 줄 (표·select·키를 자유롭게 조립)
   * @param {string} table @param {string} sel @param {string} key
   */
  const call = (table, sel, key) =>
    `const a = await selectAll((s) => s.from("${table}").select(${sel}), sb, ${key});\n`;

  it('(11) 층① 비고유 키 = 위반 — trades 의 PK 는 "id" 다', () => {
    const v = findKeylessCalls(call("trades", '"id, region, deal_month"', '"deal_month"'));
    expect(v).toHaveLength(1);
    expect(v[0].reason).toMatch(/trades 의 고유키는 "id"/);
  });

  it("(12) 층① 표마다 다른 PK 를 그대로 요구한다 — articles·complexes·transport", () => {
    expect(findKeylessCalls(call("articles", '"article_no, complex_no"', '"article_no"'))).toEqual([]);
    expect(findKeylessCalls(call("complexes", '"complex_no"', '"complex_no"'))).toEqual([]);
    expect(findKeylessCalls(call("transport", '"apartment_id"', '"apartment_id"'))).toEqual([]);
    // articles 에 "id" 를 쓰면 위반 — 그 표엔 id 컬럼 자체가 없어 조회가 죽는다
    const v = findKeylessCalls(call("articles", '"id"', '"id"'));
    expect(v.map((x) => x.reason).join(" ")).toMatch(/articles 의 고유키는 "article_no"/);
  });

  it("(13) 층① 표 이름이 변수면 위반 — PK 를 확인할 방법이 없다", () => {
    const src = 'const a = await selectAll((s) => s.from(tbl).select("id"), sb, "id");\n';
    expect(findKeylessCalls(src).map((v) => v.reason)).toEqual([
      'from("<표>") 을 못 읽음 — 표 이름은 문자열 리터럴이어야 한다',
    ]);
  });

  it('(14) 층② select 에 키가 없으면 위반 — select("*")·배열 join 은 통과', () => {
    expect(findKeylessCalls(call("apartments", '"name, region"', '"id"'))[0].reason).toMatch(
      /select 에 "id" 가 안 보인다/,
    );
    expect(findKeylessCalls(call("apartments", '"*"', '"id"'))).toEqual([]);
    // infra-kakao.mjs 식 배열 조립 — 원소 리터럴이 그대로 보인다
    const joined =
      'const a = await selectAll((s) => s.from("infra").select(["apartment_id", "updated_at", ...C.map((c) => c.key)].join(", ")), sb, "apartment_id");\n';
    expect(findKeylessCalls(joined)).toEqual([]);
  });

  it("(15) 층② 필터의 컬럼명은 select 를 대신하지 못한다", () => {
    // 리터럴을 인자 전체에서 찾으면 `.not("id", …)` 가 select 를 증명해 버려 가드가 무의미해진다.
    const src =
      'const a = await selectAll((s) => s.from("apartments").select("name").not("id", "is", null), sb, "id");\n';
    expect(findKeylessCalls(src).map((v) => v.reason)).toEqual([
      'select 에 "id" 가 안 보인다 — 커서 키는 select 에 포함돼야 한다',
    ]);
  });

  it("(16) 층③ 식별자·템플릿·식 keyCol = 위반 (런타임 undefined 면 커서가 안 켜진다)", () => {
    expect(findKeylessCalls(call("apartments", '"id"', "keyVar"))[0].reason).toMatch(/문자열 리터럴이 아님/);
    expect(findKeylessCalls(call("apartments", '"id"', "`id`"))[0].reason).toMatch(/문자열 리터럴이 아님/);
    expect(findKeylessCalls(call("apartments", '"id"', '"i" + "d"'))[0].reason).toMatch(/문자열 리터럴이 아님/);
    expect(findKeylessCalls(call("apartments", '"id"', "'id'"))).toEqual([]); // 홑따옴표는 통과
  });

  it("(17) 미등재 표는 default(id) 로 대조하고, 등재 여부는 tablesFrom 이 드러낸다", () => {
    const src = call("brand_new_table", '"id"', '"id"');
    expect(findKeylessCalls(src)).toEqual([]);
    expect(tablesFrom(scanSelectAllCalls(src))).toEqual(["brand_new_table"]);
  });
});
