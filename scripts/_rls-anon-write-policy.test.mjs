// @ts-check
/**
 * RLS "Always True" 쓰기 정책 정적 가드 (세션566 PR-F) — Supabase 보안 고문 lint 0024
 * "RLS Policy Always True" 의 저장소 레벨 쌍둥이.
 *
 * 왜: 이 DB 의 anon key 는 자매 사이트 2u.pe.kr 의 JS 번들에 공개로 실려 있다. 그래서
 * anon/authenticated 대상 쓰기(INSERT/UPDATE/DELETE/ALL) 정책의 조건이 사실상 "항상 참"
 * (USING/WITH CHECK 가 true·(true)·1=1 또는 아예 없음)이면, 누구나 REST API 로 그 표에
 * 직접 쓸 수 있다 — 우리 API 의 검증·레이트리밋·동의 절차를 건너뛴다.
 * 세션566 이 마지막 2건(consults_anon_insert · "Anon insert" on subscribers)을
 * `20260923000000_drop_anon_insert_policies.sql` 로 지웠다. 이 가드는 미래의 마이그레이션이
 * 같은 종류의 정책을 다시 만들면 실패해야 한다.
 *
 * 설계 — supabase/migrations/*.sql 을 파일명 순으로 전부 재생(replay)해 테이블 상태를
 * 흉내 낸다(SQL 을 실행하지 않는다, 순수 텍스트 파싱):
 *   1) 주석 제거 (`--` 줄 주석, `/* *\/` 블록 주석) — 문자열 리터럴 안 텍스트는 보존
 *   2) `$$...$$` 함수 본문(트리거 등)은 세미콜론을 포함하므로 문 분리 전에 통째로 마스킹
 *      (이 저장소의 함수 본문에는 CREATE POLICY 가 없다 — 실측 확인됨, 있었다면 이 가드가
 *      못 보고 지나칠 수 있으므로 아래 §스캐너 자체 검증 픽스처로 최소한 존재는 감시)
 *   3) `;` 로 문을 나눠 순서대로 재생 — CREATE/DROP POLICY, DROP TABLE 을 Map 에 반영
 *   4) 최종 상태에서 "항상 참" 쓰기 정책이 있으면 실패
 *
 * ⚠️ 스캔 대상 — `_rollbacks/` 폴더와 이름에 "rollback" 이 들어간 파일은 제외한다. 롤백은
 * 실제로 적용된 상태가 아니라 "되돌리는 방법"을 적어 둔 문서이므로, 그 안에 옛 정책을
 * CREATE 하는 문이 있어도(되돌리기 목적) 이 가드가 "재발"로 오판하면 안 된다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";

const ROOT = path.resolve(process.cwd());
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");

/**
 * @typedef {{ table: string, name: string, cmd: string, roles: string[], using: string | null, withCheck: string | null, permissive: boolean }} PolicyState
 */

/** anon 키가 공개된 이 DB 에서 위험한 역할 3종 */
const RISKY_ROLES = new Set(["anon", "authenticated", "public"]);

/** USING/WITH CHECK 를 "항상 참"으로 보는 정규화 문자열 집합 */
const ALWAYS_TRUE = new Set(["true", "(true)", "1=1", "(1=1)"]);

/**
 * SQL 주석을 줄 수를 보존한 채 공백으로 지운다.
 * `--` 는 줄 끝까지, `/* *\/` 는 블록. SQL 에는 JS 의 정규식 리터럴·템플릿 보간이 없으므로
 * 문자열 리터럴(`'...'`)만 보호하면 된다 — 문자열 안의 `--`·`/*` 는 지우지 않는다.
 *
 * @param {string} src
 * @returns {string}
 */
export function stripSqlComments(src) {
  /** @type {string[]} */
  const out = src.split("");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "'") {
      // 문자열 리터럴 — SQL 표준 이스케이프는 '' (따옴표 두 번). 내용은 그대로 둔다.
      let j = i + 1;
      for (; j < src.length; j++) {
        if (src[j] === "'" && src[j + 1] === "'") {
          j++; // 이스케이프된 따옴표 — 건너뛴다
          continue;
        }
        if (src[j] === "'") break;
      }
      i = j;
      continue;
    }
    if (c === "-" && src[i + 1] === "-") {
      while (i < src.length && src[i] !== "\n") {
        out[i] = " ";
        i++;
      }
      i--;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) {
        if (src[i] !== "\n") out[i] = " ";
      }
      i--;
      continue;
    }
  }
  return out.join("");
}

/**
 * `$$...$$`(또는 `$tag$...$tag$`) 함수 본문을 공백으로 마스킹한다 — 안에 든 `;` 가 문
 * 분리를 방해하지 않도록. 태그가 있는 형태(`$tag$`)도 지원(같은 태그로 닫혀야 함).
 *
 * @param {string} src 주석이 이미 지워진 소스
 * @returns {string}
 */
export function maskDollarQuoted(src) {
  const out = src.split("");
  const re = /\$([A-Za-z_]*)\$/g;
  /** @type {RegExpExecArray | null} */
  let m;
  while ((m = re.exec(src)) !== null) {
    const tag = m[1];
    const openEnd = m.index + m[0].length;
    const closeRe = new RegExp(`\\$${tag}\\$`, "g");
    closeRe.lastIndex = openEnd;
    const closeMatch = closeRe.exec(src);
    // 안 닫힘 — 조용히 멈추면 짝 없는 $$ 가 뒤쪽의 엉뚱한 $$ 와 짝을 지어 그 사이 문장(진짜 CREATE POLICY 포함)이
    // 검사에서 빠진다(세션566 코드 검사관 재현: got=[] want=[t::x]). 모르는 형태는 시끄럽게 실패한다.
    if (!closeMatch) {
      throw new Error(`닫히지 않은 달러 인용 ${m[0]} (위치 ${m.index}) — 파일이 깨졌거나 문자열 안에 $$ 가 있다`);
    }
    const closeEnd = closeMatch.index + closeMatch[0].length;
    for (let i = m.index; i < closeEnd; i++) {
      if (src[i] !== "\n") out[i] = " ";
    }
    re.lastIndex = closeEnd;
  }
  return out.join("");
}

/**
 * 식별자를 정규화한다 — 선택적 `public.` 스키마 접두 제거, 큰따옴표 벗기기.
 * 큰따옴표 없는 식별자는 Postgres 규칙대로 소문자화한다.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeIdent(raw) {
  let s = raw.trim();
  if (s.toLowerCase().startsWith("public.")) s = s.slice("public.".length);
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s.slice(1, -1);
  }
  return s.toLowerCase();
}

/**
 * 괄호 균형을 지키며 `(` 로 시작하는 표현식 전체를 읽는다.
 * @param {string} s `(` 에서 시작하는 문자열
 * @returns {{ text: string, rest: string }}
 */
function readParenExpr(s) {
  if (s[0] !== "(") return { text: "", rest: s };
  let depth = 0;
  let i = 0;
  for (; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return { text: s.slice(0, i), rest: s.slice(i) };
}

/** 표현식 정규화 — 소문자화 + 공백 전부 제거 */
export function normalizeExpr(/** @type {string} */ expr) {
  return expr.toLowerCase().replace(/\s+/g, "");
}

/**
 * 하나의 `CREATE POLICY ...` 문(세미콜론 앞까지, 키워드는 이미 소비됨)을 파싱한다.
 * @param {string} stmt `CREATE POLICY` 뒤의 나머지 원문(트림 전)
 * @returns {PolicyState | null}
 */
export function parseCreatePolicy(stmt) {
  let s = stmt.trim();

  // 정책 이름 — 큰따옴표 문자열 또는 단순 식별자
  /** @type {string} */
  let name;
  if (s[0] === '"') {
    const end = s.indexOf('"', 1);
    if (end === -1) return null;
    name = s.slice(0, end + 1);
    s = s.slice(end + 1).trim();
  } else {
    const m = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(s);
    if (!m) return null;
    name = m[0];
    s = s.slice(m[0].length).trim();
  }

  // ON <table>
  const onM = /^ON\s+/i.exec(s);
  if (!onM) return null;
  s = s.slice(onM[0].length).trim();
  /** @type {string} */
  let tableRaw;
  if (s[0] === '"') {
    const end = s.indexOf('"', 1);
    if (end === -1) return null;
    tableRaw = s.slice(0, end + 1);
    s = s.slice(end + 1).trim();
  } else {
    const m = /^[A-Za-z_][A-Za-z0-9_$.]*/.exec(s);
    if (!m) return null;
    tableRaw = m[0];
    s = s.slice(m[0].length).trim();
  }

  let permissive = true;
  let cmd = "ALL";
  /** @type {string[]} */
  let roles = ["public"];
  /** @type {string | null} */
  let using = null;
  /** @type {string | null} */
  let withCheck = null;

  // 나머지 절을 순서 무관하게(표준 순서를 따르되) 반복 소비
  while (s.length > 0) {
    if (/^AS\s+PERMISSIVE/i.test(s)) {
      permissive = true;
      s = s.replace(/^AS\s+PERMISSIVE/i, "").trim();
      continue;
    }
    if (/^AS\s+RESTRICTIVE/i.test(s)) {
      permissive = false;
      s = s.replace(/^AS\s+RESTRICTIVE/i, "").trim();
      continue;
    }
    const forM = /^FOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)/i.exec(s);
    if (forM) {
      cmd = forM[1].toUpperCase();
      s = s.slice(forM[0].length).trim();
      continue;
    }
    if (/^TO\s+/i.test(s)) {
      s = s.replace(/^TO\s+/i, "");
      // 다음 절 키워드(USING/WITH) 전까지를 역할 목록으로 읽는다
      const stopM = /\b(USING|WITH)\b/i.exec(s);
      const rolesText = stopM ? s.slice(0, stopM.index) : s;
      roles = rolesText
        .split(",")
        .map((r) => r.trim().replace(/^"|"$/g, ""))
        .filter(Boolean)
        .map((r) => r.toLowerCase());
      s = stopM ? s.slice(stopM.index) : "";
      continue;
    }
    if (/^USING\s*\(/i.test(s)) {
      s = s.replace(/^USING\s*/i, "");
      const { text, rest } = readParenExpr(s);
      using = text;
      s = rest.trim();
      continue;
    }
    if (/^WITH\s+CHECK\s*\(/i.test(s)) {
      s = s.replace(/^WITH\s+CHECK\s*/i, "");
      const { text, rest } = readParenExpr(s);
      withCheck = text;
      s = rest.trim();
      continue;
    }
    // 알 수 없는 잔여 텍스트 — 더 못 읽으면 중단(무한루프 방지)
    break;
  }

  return {
    table: normalizeIdent(tableRaw),
    name: normalizeIdent(name),
    cmd,
    roles,
    using,
    withCheck,
    permissive,
  };
}

/**
 * 정적 마이그레이션 소스 전체를 재생해 최종 정책 상태 Map 을 만든다.
 * 키 = `${table}::${policyName}`.
 *
 * @param {string} rawSrc 이미 이어붙인(또는 단일 파일) SQL 원문
 * @param {Map<string, PolicyState>} state 누적 상태(파일 여러 개를 순서대로 재생할 때 재사용)
 * @returns {Map<string, PolicyState>}
 */
export function replayPolicies(rawSrc, state = new Map()) {
  const stripped = stripSqlComments(rawSrc);
  const masked = maskDollarQuoted(stripped);

  // masked 로 문 경계(세미콜론)를 찾되, 실제 텍스트는 stripped(주석만 지운 원문)에서 읽는다
  // — 길이가 같으므로 인덱스를 그대로 옮길 수 있다.
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== ";") continue;
    const stmt = stripped.slice(start, i);
    start = i + 1;
    processStatement(stmt, state);
  }
  // 마지막에 세미콜론 없는 잔여 문(있다면)도 시도
  const tail = stripped.slice(start).trim();
  if (tail) processStatement(tail, state);

  return state;
}

/**
 * @param {string} rawStmt
 * @param {Map<string, PolicyState>} state
 */
function processStatement(rawStmt, state) {
  const stmt = rawStmt.trim();
  if (!stmt) return;

  const createM = /^CREATE\s+POLICY\s+/i.exec(stmt);
  if (createM) {
    const policy = parseCreatePolicy(stmt.slice(createM[0].length));
    if (policy) state.set(`${policy.table}::${policy.name}`, policy);
    return;
  }

  const dropPolicyM = /^DROP\s+POLICY\s+(IF\s+EXISTS\s+)?/i.exec(stmt);
  if (dropPolicyM) {
    let rest = stmt.slice(dropPolicyM[0].length).trim();
    /** @type {string} */
    let name;
    if (rest[0] === '"') {
      const end = rest.indexOf('"', 1);
      name = rest.slice(0, end + 1);
      rest = rest.slice(end + 1).trim();
    } else {
      const m = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(rest);
      name = m ? m[0] : "";
      rest = m ? rest.slice(m[0].length).trim() : rest;
    }
    const onM = /^ON\s+/i.exec(rest);
    if (!onM) return;
    rest = rest.slice(onM[0].length).trim();
    /** @type {string} */
    let tableRaw;
    if (rest[0] === '"') {
      const end = rest.indexOf('"', 1);
      tableRaw = rest.slice(0, end + 1);
    } else {
      const m = /^[A-Za-z_][A-Za-z0-9_$.]*/.exec(rest);
      tableRaw = m ? m[0] : "";
    }
    const key = `${normalizeIdent(tableRaw)}::${normalizeIdent(name)}`;
    state.delete(key);
    return;
  }

  const dropTableM = /^DROP\s+TABLE\s+(IF\s+EXISTS\s+)?/i.exec(stmt);
  if (dropTableM) {
    const rest = stmt.slice(dropTableM[0].length);
    // CASCADE/RESTRICT 등 뒤 키워드를 잘라내고 콤마로 나눈 테이블 목록만 취한다
    const listText = rest.replace(/\bCASCADE\b|\bRESTRICT\b/gi, "");
    const tables = listText
      .split(",")
      .map((t) => normalizeIdent(t.trim()))
      .filter((t) => /^[a-z_][a-z0-9_]*$/.test(t));
    for (const [key, p] of [...state.entries()]) {
      if (tables.includes(p.table)) state.delete(key);
    }
    return;
  }

  // 지원하지 않는 ALTER POLICY 형태 — 조용히 넘기지 않고 명시 에러.
  // (이 저장소 마이그레이션에는 ALTER POLICY 가 0건이라 여기 걸릴 일이 없어야 정상이다.
  //  걸린다면 새 마이그레이션이 이 가드가 모르는 형태를 도입했다는 뜻 — 확장 필요.)
  if (/^ALTER\s+POLICY\s+/i.test(stmt)) {
    throw new Error(
      `unsupported ALTER POLICY — extend the guard (scripts/_rls-anon-write-policy.test.mjs): ${stmt.slice(0, 120)}`,
    );
  }
}

/**
 * 정책 하나가 "위험한 역할 + 항상 참 쓰기"인지 판정한다.
 * (공식 lint 0024 의 SELECT 제외 + always-true 판정 로직을 그대로 따른다.)
 * @param {PolicyState} p
 * @returns {boolean}
 */
export function isFlagged(p) {
  if (!p.permissive) return false;
  if (p.cmd === "SELECT") return false;
  if (!p.roles.some((r) => RISKY_ROLES.has(r))) return false;

  const usingAlwaysTrueOrNull =
    p.using === null || ALWAYS_TRUE.has(normalizeExpr(p.using));
  const checkAlwaysTrue = p.withCheck !== null && ALWAYS_TRUE.has(normalizeExpr(p.withCheck));

  if ((p.cmd === "UPDATE" || p.cmd === "DELETE" || p.cmd === "ALL") && usingAlwaysTrueOrNull) {
    return true;
  }
  if (checkAlwaysTrue) return true;
  if (p.withCheck === null && p.cmd === "INSERT") return true;
  if (p.withCheck === null && (p.cmd === "UPDATE" || p.cmd === "ALL") && usingAlwaysTrueOrNull) {
    return true;
  }
  return false;
}

/**
 * `supabase/migrations/*.sql` 최상위 파일만, `_rollbacks/` 및 이름에 "rollback" 포함 파일 제외,
 * 파일명 오름차순으로 목록을 만든다.
 * @returns {string[]} 절대 경로 배열
 */
export function listMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((n) => n.endsWith(".sql") && !isRollbackFile(n))
    .sort()
    .map((n) => path.join(MIGRATIONS_DIR, n));
}

/**
 * 여러 파일을 순서대로 재생해 최종 상태를 만든다.
 * @param {string[]} files
 * @returns {Map<string, PolicyState>}
 */
function replayFiles(files) {
  /** @type {Map<string, PolicyState>} */
  let state = new Map();
  for (const f of files) {
    const src = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
    try {
      state = replayPolicies(src, state);
    } catch (e) {
      throw new Error(`${path.basename(f)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return state;
}

/**
 * 되돌리기 파일 = `14자리 시각_rollback_…` 이름 규칙(세션566 실측: 본 폴더 17개 전부 이 꼴).
 * 이름 중간에 "rollback" 이 들어간 정방향 마이그레이션(예: `…_prevent_rollback_of_grants.sql`)은 검사 대상이다
 * — 옛 판정(`includes("rollback")`)은 그런 파일을 조용히 빼는 탈출구였다(세션566 코드 검사관).
 * @param {string} name 파일 이름(경로 없이)
 * @returns {boolean}
 */
export function isRollbackFile(name) {
  return /^\d{14}_rollback_/i.test(name);
}

describe("RLS anon 쓰기 정책 — 항상 참 조건 재발 방지(lint 0024 쌍둥이)", () => {
  const files = listMigrationFiles();

  it("supabase/migrations/*.sql 이 최소 1개는 발견된다(스캐너가 실제로 파일을 보고 있다)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("최종 상태 — 위험한 always-true 쓰기 정책이 없다", () => {
    const state = replayFiles(files);
    const offenders = [...state.values()].filter(isFlagged);
    const msg = offenders
      .map((p) => `${p.table}::${p.name} (FOR ${p.cmd} TO ${p.roles.join(",")})`)
      .join(", ");
    expect(
      offenders,
      offenders.length
        ? `anon key is public (2u.pe.kr bundle) — writes must go through the API with the ` +
          `service key; see supabase/CLAUDE.md (세션566). 위반: ${msg}`
        : undefined,
    ).toEqual([]);
  });

  it("(양성 대조군) 0923 드롭 마이그 이전까지 재생하면 정확히 그 2건이 플래그된다", () => {
    const before = files.filter((f) => path.basename(f) < "20260923000000");
    const state = replayFiles(before);
    const offenders = [...state.values()].filter(isFlagged).map((p) => `${p.table}::${p.name}`);
    expect(offenders.sort()).toEqual(["consults::consults_anon_insert", "subscribers::Anon insert"].sort());
  });

  it("(양성 대조군) 전체 재생 결과에 SELECT/service_role 정책이 살아있다 — 스트리퍼가 문을 안 먹었다", () => {
    const state = replayFiles(files);
    expect(state.has("apartments::Public read")).toBe(true);
    expect(state.get("apartments::Public read")?.cmd).toBe("SELECT");
    expect(state.has("consults::consults_service")).toBe(true);
    expect(state.get("consults::consults_service")?.roles).toEqual(["service_role"]);
  });
});

describe("파서/판정 픽스처 — 합성 SQL", () => {
  it("닫히지 않은 $$ 는 조용히 넘기지 않고 에러 — 뒤 문장이 검사에서 빠지는 탈출구를 막는다(세션566)", () => {
    const src = "DO $$ BEGIN PERFORM 1;\nCREATE POLICY x ON t FOR INSERT TO anon WITH CHECK (true);";
    expect(() => replayPolicies(src)).toThrow(/닫히지 않은 달러 인용/);
    expect(() => replayPolicies("SELECT $tag$ 열린 채로;")).toThrow(/닫히지 않은 달러 인용/);
  });

  it("되돌리기 파일은 이름 규칙으로만 가린다 — 이름 중간의 rollback 은 정방향으로 검사한다(세션566)", () => {
    expect(isRollbackFile("20260923000001_rollback_drop_anon_insert_policies.sql")).toBe(true);
    expect(isRollbackFile("20260924000000_prevent_rollback_of_grants.sql")).toBe(false);
    expect(isRollbackFile("rollback_notes.sql")).toBe(false);
  });

  it("INSERT TO anon WITH CHECK (true) = 위반", () => {
    const state = replayPolicies('CREATE POLICY x ON t FOR INSERT TO anon WITH CHECK (true);');
    expect(isFlagged(/** @type {PolicyState} */ (state.get("t::x")))).toBe(true);
  });

  it("ALL TO service_role USING (true) = 통과(위험 역할 아님)", () => {
    const state = replayPolicies('CREATE POLICY y ON t FOR ALL TO service_role USING (true);');
    expect(isFlagged(/** @type {PolicyState} */ (state.get("t::y")))).toBe(false);
  });

  it("SELECT USING (true) = 통과(SELECT 는 항상 제외)", () => {
    const state = replayPolicies('CREATE POLICY z ON t FOR SELECT USING (true);');
    expect(isFlagged(/** @type {PolicyState} */ (state.get("t::z")))).toBe(false);
  });

  it("FOR/TO 없이 USING (true) 만 = 기본 ALL + public = 위반", () => {
    const state = replayPolicies('CREATE POLICY w ON t USING (true);');
    expect(isFlagged(/** @type {PolicyState} */ (state.get("t::w")))).toBe(true);
  });

  it("CREATE 후 DROP POLICY = 통과(재생 결과에 남지 않음)", () => {
    const state = replayPolicies(
      'CREATE POLICY x ON t FOR INSERT TO anon WITH CHECK (true); DROP POLICY IF EXISTS x ON t;',
    );
    expect(state.has("t::x")).toBe(false);
  });

  it("UPDATE TO authenticated USING (auth.uid() = user_id) = 통과(항상 참 아님)", () => {
    const state = replayPolicies(
      "CREATE POLICY v ON t FOR UPDATE TO authenticated USING (auth.uid() = user_id);",
    );
    expect(isFlagged(/** @type {PolicyState} */ (state.get("t::v")))).toBe(false);
  });

  it("DROP TABLE 이 그 표의 모든 정책을 지운다", () => {
    const state = replayPolicies(
      'CREATE POLICY a ON t1 FOR INSERT TO anon WITH CHECK (true); DROP TABLE IF EXISTS t1;',
    );
    expect(state.has("t1::a")).toBe(false);
  });

  it("ALTER POLICY 는 명시적으로 에러를 던진다(조용히 무시하지 않는다)", () => {
    expect(() => replayPolicies("ALTER POLICY x ON t USING (true);")).toThrow(
      /unsupported ALTER POLICY/,
    );
  });

  it("public.<table> 스키마 접두는 벗겨져 같은 키로 취급된다", () => {
    const state = replayPolicies('CREATE POLICY x ON public.t FOR INSERT TO anon WITH CHECK (true);');
    expect(state.has("t::x")).toBe(true);
  });

  it("큰따옴표 정책 이름은 벗겨져 저장된다", () => {
    const state = replayPolicies('CREATE POLICY "Anon insert" ON t FOR INSERT TO anon WITH CHECK (true);');
    expect(state.has("t::Anon insert")).toBe(true);
  });

  it("WITH CHECK 없는 INSERT = 위반(WITH CHECK 생략은 암묵적 true)", () => {
    const state = replayPolicies("CREATE POLICY x ON t FOR INSERT TO anon;");
    expect(isFlagged(/** @type {PolicyState} */ (state.get("t::x")))).toBe(true);
  });

  it("줄 주석·블록 주석 안의 CREATE POLICY 텍스트는 무시된다", () => {
    const src = [
      "-- CREATE POLICY commented ON t FOR INSERT TO anon WITH CHECK (true);",
      "/* CREATE POLICY blocked ON t FOR INSERT TO anon WITH CHECK (true); */",
      "CREATE POLICY real ON t FOR INSERT TO anon WITH CHECK (true);",
    ].join("\n");
    const state = replayPolicies(src);
    expect(state.has("t::commented")).toBe(false);
    expect(state.has("t::blocked")).toBe(false);
    expect(state.has("t::real")).toBe(true);
  });

  it("문자열 리터럴 안 세미콜론이 문 분리를 방해하지 않는다", () => {
    const src =
      "CREATE POLICY x ON t FOR SELECT USING (note = 'a;b');\n" +
      "CREATE POLICY y ON t FOR INSERT TO anon WITH CHECK (true);";
    const state = replayPolicies(src);
    expect(state.has("t::x")).toBe(true);
    expect(state.has("t::y")).toBe(true);
    expect(isFlagged(/** @type {PolicyState} */ (state.get("t::y")))).toBe(true);
  });

  it("$$ 함수 본문 안 세미콜론이 문 분리를 방해하지 않는다", () => {
    const src = [
      "CREATE FUNCTION f() RETURNS TRIGGER AS $$",
      "BEGIN",
      "  NEW.x = 1; RETURN NEW;",
      "END;",
      "$$ LANGUAGE plpgsql;",
      "CREATE POLICY x ON t FOR INSERT TO anon WITH CHECK (true);",
    ].join("\n");
    const state = replayPolicies(src);
    expect(state.has("t::x")).toBe(true);
  });

  it("CRLF 줄바꿈도 정상 처리된다", () => {
    const src = 'CREATE POLICY x ON t FOR INSERT TO anon WITH CHECK (true);\r\n'.replace(/\n/g, "\r\n");
    const state = replayPolicies(src.replace(/\r\n/g, "\n"));
    expect(state.has("t::x")).toBe(true);
  });

  it("1=1 도 항상 참으로 정규화된다", () => {
    const state = replayPolicies("CREATE POLICY x ON t FOR DELETE TO anon USING (1=1);");
    expect(isFlagged(/** @type {PolicyState} */ (state.get("t::x")))).toBe(true);
  });

  it("괄호 안 나머지 공백이 섞여도 정규화 비교가 통과한다", () => {
    const state = replayPolicies("CREATE POLICY x ON t FOR DELETE TO anon USING ( TRUE );");
    expect(isFlagged(/** @type {PolicyState} */ (state.get("t::x")))).toBe(true);
  });
});
