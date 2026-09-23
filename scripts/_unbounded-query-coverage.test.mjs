// @ts-check
/**
 * 무제한(unbounded) Supabase 쿼리 정적 가드 (세션566 PR-E) — 큰 표를 훑는 체인 중
 * "안전 신호가 하나도 없는" 자리를 찾는다.
 *
 * 왜: PostgREST 는 요청당 최대 1,000행만 준다. 필터도 상한 신호(`.range`/`.limit`/`.single`/
 * `.maybeSingle`/`count head`)도 없는 `.from("<큰 표>").select(...)` 는 그 표가 1,000행을
 * 넘는 날부터 **에러 없이** 잘린다(`.claude/rules/collectors/unordered-pagination-loses-rows.md`).
 * `.range(` 를 쓰면서 `.order(` 가 없는 것도 같은 결함의 다른 얼굴이다 — 페이지마다 다른
 * 표본을 줘서 행이 샌다(같은 문서 §1).
 *
 * 스캔 방식: `_selectall-keycol-coverage.test.mjs`(세션544)와 같은 두 함정을 피한다 —
 *   ① 한 방 주석 정규식이 문자열 안 `Accept: "application/json, ... 별-슬래시-별"` 을 주석
 *      시작으로 오인해 뒤 코드를 통째로 먹는다 → `stripComments`+`maskCode`(공용 `_source-mask.mjs`,
 *      세션546) 로 구조는 마스크 사본에서, 텍스트는 원본에서 읽는다.
 *   ② 단일줄 정규식은 여러 줄에 걸친 체인을 반드시 놓친다 → `.from("<T>")` 를 찾은 뒤
 *      **뒤따르는 `.식별자(...)` 체인 링크를 괄호 균형으로 계속 삼켜** 체인 전체를 얻는다
 *      (콤마·세미콜론·줄바꿈 위치와 무관 — `Promise.all([...])` 안에 줄바꿈으로 나열된
 *      호출도 같은 방식으로 잡힌다).
 *
 * ⚠️ 알려진 사각(문서화 — 이 가드로는 못 잡는다):
 *   - **필터가 걸려 있어도 1,000행을 넘는 원시 쿼리**(예: `.in("apartment_id", 2천개_id)`)는
 *     G1 을 통과한다(필터가 있으니 "무제한"이 아니라고 판정). 그런 호출은 결과 건수가
 *     `count:"exact"` 대조 없이는 안 드러난다 — `unordered-pagination-loses-rows.md` §4 로 검증.
 *   - `.from(변수)`(표 이름이 리터럴이 아님)는 표를 특정 못 해 **검사 대상에서 제외**한다
 *     (오탐보다 누락이 낫다는 판단 — BIG_TABLES 매칭 자체가 안 되므로 조용히 넘어간다).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { stripComments, maskCode } from "./_source-mask.mjs";

const ROOT = path.resolve(process.cwd());
const SCRIPTS_DIR = path.join(ROOT, "scripts");
const API_DIR = path.join(ROOT, "api");

/** 스캔 대상에서 뺄 디렉토리 */
const EXCLUDED_DIRS = new Set(["probes", "node_modules"]);

/**
 * 큰 표 목록 — 2026-09-23 실측(작업 지시서 값 그대로 박제, 재측정은 `select("*",{count:"exact",
 * head:true})`): apartments 3,068 · apartments_flat 2,456 · schools/transport/infra/trade_stats
 * 각 3,068 · prices 13,716 · regions 2,359 · applyhome_events 1,327 · complexes ~64k ·
 * articles ~1.37M · complex_price_history ~396k · trades ~795k.
 * @type {string[]}
 */
export const BIG_TABLES = [
  "apartments",
  "apartments_flat",
  "schools",
  "transport",
  "infra",
  "trade_stats",
  "prices",
  "regions",
  "applyhome_events",
  "complexes",
  "articles",
  "complex_price_history",
  "trades",
];

/**
 * ALLOWLIST — 현재 합법적인 예외(파일 + 표 + 근거 1줄). 작게 유지한다.
 * 형식: "relPath::table" → 근거.
 *
 * ⚠️ 세션566 실측 — 이 가드가 처음 돌며 찾은 진짜 위반 4건: childcare-info·childcare-info-jeju,
 * collect-unsold-kosis(1,000행 컷)는 같은 세션·세션567 에 각각 고쳤다(ALLOWLIST 에서 뺐다).
 * 남은 1건 — collect-data phase9(옛 경로, 백로그). 나머지 1건은 스캐너 한계(api/supabase).
 * 고치면 그 줄을 지운다.
 * @type {Record<string, string>}
 */
export const ALLOWLIST = {
  // 진짜 결함(다른 PR 대상) — complexes ~64,000행, 1,000행 초과. filter/bound 없는 select() 라
  // 오늘도 조용히 잘리고 있을 수 있다.
  "scripts/collect-data.mjs::complexes":
    "L919-921: 필터·range 없는 complexes 전체 select — complexes ~64,000행이라 1,000행 컷 위험이 가장 크다. " +
    "phase9_naver 는 daily-deploy(--from-supabase-only)가 9단계 전에 끝나 실행되지 않는 옛 경로(collect-data.mjs:1178) — 백로그.",
  // 스캐너 한계(진짜 결함 아님) — buildQuery 가 반환한 쿼리에 .range() 를 호출부(L44/L53/L67)가
  // 나중에 붙인다. 정적 스캐너는 .from( 체인 안에서 직접 이어지는 메서드만 보므로, 함수 경계를
  // 넘어 나중에 붙는 .range() 를 못 본다. 실제로는 배치 페이지네이션이 이미 구현돼 있다(§명시적
  // limit/offset 분기는 range, 기본 분기는 BATCH_SIZE 단위 range 반복).
  "api/supabase/apartments.ts::apartments_flat":
    "L22: buildQuery() 가 반환한 쿼리 빌더에 호출부(L44 단일/L53+L67 배치)가 .range() 를 나중에 체이닝한다 — 실제로는 페이지네이션됨. 스캐너가 함수 경계를 못 넘어 오탐.",
};

/**
 * `.from("<table>")` 뒤에 이어지는 **필터** 메서드 — 하나라도 있으면 G1 통과.
 * (`unordered-pagination-loses-rows.md` §4 대조에 쓰는 `count:"exact"` 자체는 필터가 아니다.)
 */
const FILTER_METHODS = new Set([
  "eq", "neq", "in", "is", "gt", "gte", "lt", "lte",
  "like", "ilike", "match", "filter", "or", "not", "contains",
]);

/** `.from("<table>")` 뒤에 이어지는 **상한 신호** — 하나라도 있으면 G1 통과(필터 없이도). */
const BOUND_METHODS = new Set(["range", "limit", "single", "maybeSingle"]);

/**
 * payload 쓰기 메서드 — 이게 체인에 있으면 G1 대상에서 제외한다. `.upsert([row], ...)`/
 * `.insert(rows)` 는 **넘긴 payload 만큼만** 쓰는 호출이라 PostgREST 의 "요청당 최대 1,000행"
 * 응답 상한과 무관하다(그 상한은 *읽어서 돌려주는* 행 수에 적용된다). `.update(`/`.delete(` 는
 * 여기 넣지 않는다 — 필터 없는 bulk update/delete 는 여전히 위험한 신호라 G1 이 계속 봐야 한다.
 * 실측(2026-09-23): `infra-kakao.mjs`·`trade-stats.mjs`·`collect-childcare.mjs` 등의
 * `.from("<표>").upsert(...)` 가 필터·상한 없이 G1 에 걸렸으나 전부 단건/소량 upsert 였다.
 */
const PAYLOAD_WRITE_METHODS = new Set(["upsert", "insert"]);

/**
 * 한 파일 소스에서 `.from("<literal>")` 로 시작하는 메서드 체인을 전부 찾는다.
 * 체인 = `.from(...)` 바로 뒤로 괄호 균형을 지키며 이어지는 `.식별자(...)` 링크의 나열.
 * 링크가 아닌 것(세미콜론·콤마·닫는 괄호 등)을 만나면 체인이 끝난다.
 *
 * @param {string} rawSrc
 * @returns {Array<{ line: number, table: string, methods: string[], hasHeadTrue: boolean, chainText: string, startIdx: number }>}
 */
export function scanFromChains(rawSrc) {
  const src = stripComments(rawSrc);
  const masked = maskCode(src);
  /** @type {Array<{ line: number, table: string, methods: string[], hasHeadTrue: boolean, chainText: string, startIdx: number }>} */
  const out = [];
  // .from( 뒤 첫 인자가 따옴표(백틱 포함)로 시작하는 리터럴인 자리만 — 변수는 표를 특정
  // 못 해 스킵. 백틱 템플릿은 maskCode 가 `${...}` 보간 구간을 지우지 않고 그대로 남기므로
  // (§ maskCode 주석 "보간 안은 코드다"), 그 안에 `${` 가 있으면 정적 문자열이 아니라
  // 동적 표 이름이다 — 다른 변수 표 이름과 똑같이 스킵한다(§26 문서 주석과 일관).
  // ⚠️ 캡처 그룹 값은 **마스크 사본**에서 읽으면 리터럴 내용이 공백으로 덮여 있다
  // (maskCode 가 문자열 내용만 지우고 구분자·길이는 보존). 표 이름은 반드시 **원본**의
  // 같은 인덱스 구간에서 읽는다(`_selectall-keycol-coverage.test.mjs` 의 literalValue 와 같은 원리).
  const re = /\.from\s*\(\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/gd;
  /** @type {RegExpExecArray | null} */
  let m;
  while ((m = re.exec(masked)) !== null) {
    // ⚠️ `.from(` 은 메서드 호출이라 그 앞 글자는 항상 식별자(`sb.from(` 의 `b` 등)다 —
    // "앞 글자가 식별자 문자면 오매칭" 이라는 나이브한 체크(bare 함수 호출용 관용구)를
    // 여기 그대로 옮기면 **모든 호출이 걸러진다**. 정규식 자체(`\.from\s*\(`)가 이미
    // `.fromEntries(` 같은 다른 메서드와 구분하므로 별도 방어가 불필요하다.
    // 원본에서 표 이름을 읽는다 — `d` 플래그의 `.indices[2]` 가 group 2 의 정확한 [start,end).
    const indices = /** @type {any} */ (m).indices;
    const [g2Start, g2End] = indices[2];
    // 백틱 템플릿의 마스크 사본은 `${...}` 보간 내부를 지우지 않으므로(maskCode 가 코드로
    // 취급), 그 구간에 실제 `${` 가 있으면 정적 리터럴이 아니라 동적 표 이름 — 스킵.
    if (m[1] === "`" && masked.slice(g2Start, g2End).includes("${")) continue;
    const tableName = src.slice(g2Start, g2End);

    // `.from("<table>")` 호출 자체의 닫는 괄호 위치를 괄호 균형으로 찾는다.
    const openIdx = masked.indexOf("(", m.index);
    let depth = 0;
    let i = openIdx;
    for (; i < masked.length; i++) {
      const c = masked[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (i >= masked.length) continue; // 괄호가 안 닫힘 — 스캔 실패, 스킵
    let cursor = i + 1; // .from(...) 다음 위치

    /** @type {string[]} */
    const methods = [];
    let hasHeadTrue = false;

    // 뒤따르는 .식별자(...) 체인 링크를 계속 삼킨다.
    while (true) {
      // 공백/개행은 체인으로 안 끊는다(여러 줄 체인 지원)
      let j = cursor;
      while (j < masked.length && /\s/.test(masked[j])) j++;
      if (masked[j] !== ".") break;
      const linkMatch = /^\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(masked.slice(j));
      if (!linkMatch) break;
      const methodName = linkMatch[1];
      const linkOpen = j + linkMatch[0].length - 1;
      let d = 0;
      let k = linkOpen;
      for (; k < masked.length; k++) {
        const c = masked[k];
        if (c === "(" || c === "[" || c === "{") d++;
        else if (c === ")" || c === "]" || c === "}") {
          d--;
          if (d === 0) break;
        }
      }
      if (k >= masked.length) break; // 안 닫힘 — 체인 스캔 중단(찾은 것까지는 유효)
      methods.push(methodName);
      // select("*", { count:"exact", head:true }) 처럼 select 의 2번째 인자에 head:true 가
      // 있으면 "이미 개수만 요청" 신호 — 이건 상한 신호가 아니라 참고용으로만 기록한다
      // (원 코드가 head:true 쓰는 select 는 대개 count 조회 목적이라 G1 오탐 여지가 있어
      //  BOUND_METHODS 취급하지 않고 별도 플래그로만 남긴다. G1 판정에는 영향 없음).
      if (methodName === "select") {
        const argText = masked.slice(linkOpen + 1, k);
        if (/head\s*:\s*true/.test(argText)) hasHeadTrue = true;
      }
      cursor = k + 1;
    }

    const line = src.slice(0, m.index).split("\n").length;
    const chainText = src.slice(m.index, cursor);
    out.push({ line, table: tableName, methods, hasHeadTrue, chainText, startIdx: m.index });
  }
  return out;
}

/**
 * G1 — 필터도 상한 신호도 없는 체인. G2 — `.range(` 는 있는데 `.order(` 가 없는 체인.
 * `selectAll(`/`fetchAllPages(` 호출 **안에서** 시작하는 `.from(` 은 옵트인 커서 경로이므로
 * 제외한다(그 경로의 키 고유성은 `_selectall-keycol-coverage.test.mjs` 가 따로 지킨다).
 *
 * @param {string} rawSrc
 * @returns {Array<{ line: number, table: string, kind: "G1" | "G2", reason: string }>}
 */
export function findUnboundedChains(rawSrc) {
  const src = stripComments(rawSrc);
  const masked = maskCode(src);
  const chains = scanFromChains(rawSrc);
  /** @type {Array<{ line: number, table: string, kind: "G1" | "G2", reason: string }>} */
  const out = [];

  // selectAll(/fetchAllPages( 호출 구간(괄호 균형)을 미리 전부 찾아, 그 구간에서 시작하는
  // .from( 체인은 옵트인 커서 경로로 보고 건너뛴다.
  /** @type {Array<[number, number]>} */
  const optInRanges = [];
  for (const name of ["selectAll", "fetchAllPages"]) {
    const re = new RegExp(`\\b${name}\\s*\\(`, "g");
    /** @type {RegExpExecArray | null} */
    let om;
    while ((om = re.exec(masked)) !== null) {
      const openIdx = om.index + om[0].length - 1;
      let depth = 0;
      let i = openIdx;
      for (; i < masked.length; i++) {
        const c = masked[i];
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      optInRanges.push([om.index, Math.min(i, masked.length - 1)]);
    }
  }
  const isOptIn = (/** @type {number} */ idx) =>
    optInRanges.some(([s, e]) => idx >= s && idx <= e);

  for (const { line, table, methods, startIdx, hasHeadTrue } of chains) {
    if (!BIG_TABLES.includes(table)) continue;
    // 이 체인의 .from( 시작 위치가 selectAll(/fetchAllPages( 구간 안이면 옵트인 커서 경로.
    if (isOptIn(startIdx)) continue;
    // payload 쓰기(.upsert/.insert) 는 응답 행 수 상한과 무관 — G1 대상 밖.
    if (methods.some((m2) => PAYLOAD_WRITE_METHODS.has(m2))) continue;

    const hasFilter = methods.some((m2) => FILTER_METHODS.has(m2));
    // head:true 는 select 의 2번째 인자에 실려 있어 methods 목록(메서드 이름만)엔 안 잡힌다 —
    // "개수만 요청"(count 조회 목적)이라 상한 신호와 동급으로 취급한다.
    const hasBound = methods.some((m2) => BOUND_METHODS.has(m2)) || hasHeadTrue;
    if (!hasFilter && !hasBound) {
      out.push({
        line,
        table,
        kind: "G1",
        reason: `필터·상한 신호 없이 "${table}" 전체를 요청 — 메서드: [${methods.join(",") || "(없음)"}]`,
      });
      continue; // G1 위반이면 같은 체인에 G2 도 함께 보고하지 않는다(중복 소음 방지)
    }
    if (methods.includes("range") && !methods.includes("order")) {
      out.push({
        line,
        table,
        kind: "G2",
        reason: `.range( 는 있는데 .order( 가 없음 — 정렬 없는 페이징은 동률 경계에서 행이 샌다`,
      });
    }
  }
  return out;
}

/**
 * 대상 파일 목록 — scripts/**\/*.mjs (테스트·probes 제외) + api/**\/*.ts (테스트 제외).
 * @returns {string[]} ROOT 기준 상대경로(슬래시 구분)
 */
export function listTargets() {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir @param {string} rel @param {(name: string) => boolean} matchExt */
  const walk = (dir, rel, matchExt) => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(abs).isDirectory()) {
        if (EXCLUDED_DIRS.has(name)) continue;
        walk(abs, r, matchExt);
        continue;
      }
      if (!matchExt(name)) continue;
      out.push(r);
    }
  };
  walk(SCRIPTS_DIR, "scripts", (n) => n.endsWith(".mjs") && !n.includes(".test."));
  walk(API_DIR, "api", (n) => n.endsWith(".ts") && !n.includes(".test."));
  return out;
}

describe("무제한(unbounded) Supabase 쿼리 커버리지 — 큰 표(BIG_TABLES)", () => {
  const scanned = listTargets().map((rel) => {
    const abs = path.join(ROOT, rel);
    const src = readFileSync(abs, "utf8");
    const chains = scanFromChains(src);
    const violations = findUnboundedChains(src).filter((v) => {
      const key = `${rel}::${v.table}`;
      return !(key in ALLOWLIST);
    });
    return { rel, src, chains, violations };
  });

  it("스캐너가 실제로 코드를 보고 있다 — .from(\"<큰 표>\") 체인이 최소 30건 발견된다", () => {
    const total = scanned.reduce(
      (n, f) => n + f.chains.filter((c) => BIG_TABLES.includes(c.table)).length,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(30);
  });

  it("G1/G2 위반이 없다(ALLOWLIST 제외) — 필터·상한 신호 없는 전체 조회 · order 없는 range", () => {
    const bad = scanned.flatMap(({ rel, violations }) =>
      violations.map((v) => `${rel}:${v.line} [${v.kind}] ${v.table} — ${v.reason}`),
    );
    expect(bad).toEqual([]);
  });
});

// ── 스캐너 자체 픽스처 ──────────────────────────────────────────
describe("스캐너 픽스처", () => {
  it("(1) 필터·상한 신호 없는 큰 표 조회 = G1 위반", () => {
    const src = 'const { data } = await sb.from("apartments").select("id");\n';
    const v = findUnboundedChains(src);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("G1");
    expect(v[0].table).toBe("apartments");
  });

  it("(2) .eq 필터가 있으면 통과", () => {
    const src = 'const { data } = await sb.from("apartments").select("id").eq("region", "서울");\n';
    expect(findUnboundedChains(src)).toEqual([]);
  });

  it("(3) .range 상한 신호가 있으면 G1 통과(단 order 없으면 G2)", () => {
    const src = 'const { data } = await sb.from("apartments").select("id").range(0, 999);\n';
    const v = findUnboundedChains(src);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("G2");
  });

  it("(4) .range + .order 둘 다 있으면 완전 통과", () => {
    const src = 'const { data } = await sb.from("apartments").select("id").order("id").range(0, 999);\n';
    expect(findUnboundedChains(src)).toEqual([]);
  });

  it("(5) .single()/.limit()/head:true 는 상한 신호로 통과", () => {
    expect(findUnboundedChains('await sb.from("apartments").select("id").single();\n')).toEqual([]);
    expect(findUnboundedChains('await sb.from("apartments").select("id").limit(5);\n')).toEqual([]);
    expect(findUnboundedChains('await sb.from("apartments").select("*", { count: "exact", head: true });\n')).toEqual([]);
  });

  it("(6) BIG_TABLES 에 없는 표는 스캔 대상 밖(예: builders)", () => {
    const src = 'const { data } = await sb.from("builders").select("name");\n';
    expect(findUnboundedChains(src)).toEqual([]);
  });

  it("(7) 여러 줄에 걸친 체인도 잡는다", () => {
    const src = [
      "const { data } = await sb",
      '  .from("apartments")',
      '  .select("id")',
      ";",
      "",
    ].join("\n");
    const v = findUnboundedChains(src);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(2);
  });

  it("(8) 문자열 안 .from(\"apartments\") 텍스트는 위반 아님", () => {
    const src = 'const msg = \'.from("apartments").select("id")\';\n';
    expect(findUnboundedChains(src)).toEqual([]);
  });

  it("(9) 주석 처리된 무제한 호출은 위반 아님", () => {
    const src = '// await sb.from("apartments").select("id");\n';
    expect(findUnboundedChains(src)).toEqual([]);
  });

  it("(10) selectAll(/fetchAllPages( 안에서 시작하는 .from( 은 옵트인 커서 경로 — 제외", () => {
    const src = 'const rows = await selectAll((s) => s.from("apartments").select("id"), sb, "id");\n';
    expect(findUnboundedChains(src)).toEqual([]);
  });

  it("(11) Accept 헤더 문자열의 */* 뒤 코드가 안 먹힌다", () => {
    const src = [
      'const H = { Accept: "application/json, text/plain, */*" };',
      'const { data } = await sb.from("apartments").select("id");',
      "",
    ].join("\n");
    const v = findUnboundedChains(src);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(2);
  });

  it("(12) Promise.all([...]) 안에 나열된 여러 .from( 호출도 각각 잡힌다", () => {
    const src = [
      "await Promise.all([",
      '  sb.from("apartments").select("id"),',
      '  sb.from("prices").select("id").eq("apartment_id", x),',
      "]);",
      "",
    ].join("\n");
    const v = findUnboundedChains(src);
    expect(v).toHaveLength(1); // apartments 만 위반, prices 는 .eq 있어 통과
    expect(v[0].table).toBe("apartments");
  });

  it("(13) .from(변수) 는 표를 특정 못 해 스캔 대상 밖", () => {
    const src = 'const t = "apartments"; await sb.from(t).select("id");\n';
    expect(findUnboundedChains(src)).toEqual([]);
  });

  it("(14) ALLOWLIST 형식 — file::table 키 조회", () => {
    expect(Object.keys(ALLOWLIST).every((k) => k.includes("::"))).toBe(true);
  });

  it("(15) 백틱 리터럴 큰 표 — 필터·상한 없으면 G1 위반", () => {
    const src = "const { data } = await sb.from(`apartments`).select(\"id\");\n";
    const v = findUnboundedChains(src);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("G1");
    expect(v[0].table).toBe("apartments");
  });

  it("(16) 백틱 + ${...} 보간이 있으면 동적 표 이름 — 스캔 대상 밖", () => {
    const src = 'const t = "apartments"; await sb.from(`${t}`).select("id");\n';
    expect(findUnboundedChains(src)).toEqual([]);
  });
});
