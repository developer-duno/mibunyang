// @ts-check
/**
 * 공유 DB 소유권 가드 (세션617 · 설계서 docs/superpowers/specs/2026-10-09-shared-db-ownership-registry-design.md §2-1)
 *
 * ## 왜 있나
 *
 * 같은 Supabase DB 를 두 레포(미분양 · 2u = naver-estate-web)가 쓴다. "어느 표·칸을 누가 쓰나"를
 * 사람이 쓴 문서에 두었더니 조용히 낡았고(문서 16곳이 틀림), 상대 칸에 쓰는 코드는 합친 뒤에야 들켰다.
 * → 정본 `supabase/ownership.json` 하나를 두고, 이 감사가 합치기 전에 대조한다.
 *
 * ## 판정 (설계서 §2-1)
 *
 * ① 등록제 — 파일 안에 공유(shared)·2u 소유 표 이름이 **글자로**(따옴표 안) 있고 쓰기 흔적
 *    (`.upsert(`·`.insert(`·`.update(`·`.delete(`·`.rpc(`·`upsertBatch(`·`ub(`)이 같은 파일에 있으면,
 *    그 파일은 `writers.mibunyang` 에 등록돼 있어야 한다. 쓰기 꼴을 다 열거하는 대신 파일 단위로
 *    등록을 강제한다 — 헬퍼가 파일마다 달라서(`ub(`·`SB.update(`·`from(table)`) 꼴 대조는 뚫린다.
 * ② 칸 기준선 — 등록된 파일 안의 글자 키(`"col":`·`col:`)가 그 파일이 쓰는 공유 표의 2u 칸·다툼 칸인데
 *    그 파일의 기준선(`writers.mibunyang[파일]` 의 칸 목록)에 없으면 빨강. "지금 쓰는 칸은 허용, 새로 늘면 빨강".
 *    열쇠 칸(`columns.key`)은 중립 — 판정하지 않는다.
 * ③ 행 삭제 — 삭제가 닿는 공유 표(① `from("표")…delete(` 같은 문장 ② `from(변수)…delete(` 이면
 *    파일 안 배열 리터럴·대입에 든 공유 표)가 `delete_allowed` 밖이면 빨강. 2u 칸까지 행째 지우는 사고(C4) 방지.
 * ④ 마이그 — 이번에 **새로 더한** `supabase/migrations/*.sql` 에서 읽는 쪽(`readers`)이 있는 표의
 *    `DROP COLUMN`·`RENAME`·`DROP TABLE` 은 빨강. 남의(2u·공유) 표 `ADD COLUMN`·2u 가 읽는 VIEW 재생성은
 *    🟡(통보 대상 — 규칙 위반 아님). `_rollbacks/` 는 제외(되돌리기 원고라 DROP 이 본업).
 * ⑤ 정본 자체 — 형식·owner 값·writers 파일 실재·칸 겹침 0.
 *
 * ## 끄는 법 (오탐일 때)
 *
 * 그 파일 머리(앞 40줄)에 `// ownership-guard: allow <표> <사유>`(py 는 `#`) 한 줄 — 그 표의 ①②③ 판정이
 * 🟡 로 내려가고 출력에 남는다. 전체 끄기는 없다(CI 단계를 지우는 PR 이 곧 끄기 — 리뷰에서 보인다).
 *
 * 실행: node scripts/audit-shared-db-ownership.mjs            (전체 판정)
 *       node scripts/audit-shared-db-ownership.mjs --schema   (⑤ 정본 검증만)
 *       node scripts/audit-shared-db-ownership.mjs --print <표>  (정본에서 그 표와 쓰는 파일 보기)
 * exit 0 = 통과(🟡 는 통과) / exit 1 = 🔴 있음
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))).replace(/\\/g, "/");
export const REGISTRY_PATH = "supabase/ownership.json";

export const OWNERS = ["mibunyang", "2u", "shared", "orphan"];
// key = 열쇠 칸(등록된 writer 누구나 쓰는 중립 칸 — ② 판정에서 제외, 새 미등록 파일은 ① 이 잡는다)
export const COLUMN_BUCKETS = ["key", "mibunyang", "2u", "contested", "orphan", "clock"];

/** 쓰기 흔적 — 표 이름이 같은 파일에 글자로 있을 때만 의미가 있다(①). */
const WRITE_TRACE_RE = /\.(?:upsert|insert|update|delete|rpc)\(|\bupsertBatch\(|\bub\(/;
const ALLOW_RE = /^\s*(?:\/\/|#)\s*ownership-guard:\s*allow\s+([A-Za-z_][\w]*)\s+(\S.*)$/;
const ALLOW_HEAD_LINES = 40;

/**
 * 주석 줄을 벗긴다(줄 머리가 `//`·`/*`·`*`·`#` 인 줄). 문자열 안 `//`(URL)을 건드리지 않으려고 줄 단위로만.
 * @param {string} text
 * @param {boolean} isPy
 */
export function stripCommentLines(text, isPy) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trimStart();
      if (isPy) return t.startsWith("#") ? "" : line;
      return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") ? "" : line;
    })
    .join("\n");
}

/** @param {string} s */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 파일 안에 글자로 든 표 이름(따옴표 안 정확히 그 이름).
 * @param {string} text 주석 벗긴 본문
 * @param {string[]} tables
 */
export function findTableLiterals(text, tables) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const t of tables) {
    if (new RegExp(`(["'\`])${escapeRe(t)}\\1`).test(text)) found.add(t);
  }
  return found;
}

/** @param {string} text */
export function hasWriteTrace(text) {
  return WRITE_TRACE_RE.test(text);
}

/**
 * 글자 키 — JS `"col":`·`'col':`·`col:` / py `"col":`·`'col':`. 소문자 snake 만(칸 이름 꼴).
 * @param {string} text
 * @param {boolean} isPy
 */
export function extractKeys(text, isPy) {
  /** @type {Set<string>} */
  const keys = new Set();
  for (const m of text.matchAll(/["']([a-z_][a-z0-9_]*)["']\s*:(?!:)/g)) keys.add(m[1]);
  if (!isPy) {
    for (const m of text.matchAll(/(?<![\w$."'`])([a-z_][a-z0-9_]*)\s*:(?![:/])/g)) keys.add(m[1]);
  }
  return keys;
}

/**
 * 삭제가 닿는 표.
 *  - `from("표")` 와 `.delete(` 가 같은 문장(`;` 전) → 그 표
 *  - `from(변수)` 와 `.delete(` 가 같은 문장 → 파일 안 배열 리터럴 `[…]`·`= "표"` 대입에 든 후보 표 전부
 *  - py `x.delete("표"` → 그 표
 * @param {string} text 주석 벗긴 본문
 * @param {string[]} candidates 살펴볼 표 이름(공유 표)
 * @param {boolean} isPy
 */
export function findDeleteTargets(text, candidates, isPy) {
  /** @type {Set<string>} */
  const targets = new Set();
  const cand = new Set(candidates);
  if (isPy) {
    for (const m of text.matchAll(/\.delete\(\s*["'](\w+)["']/g)) if (cand.has(m[1])) targets.add(m[1]);
    return targets;
  }
  for (const m of text.matchAll(/\bfrom\(\s*(["'`])(\w+)\1\s*\)[^;]*?\.delete\(/g)) {
    if (cand.has(m[2])) targets.add(m[2]);
  }
  if (/\bfrom\(\s*[A-Za-z_$][\w$.]*\s*\)[^;]*?\.delete\(/.test(text)) {
    for (const t of cand) {
      const q = `["'\`]${escapeRe(t)}["'\`]`;
      const inArray = new RegExp(`\\[[^\\]]*${q}[^\\]]*\\]`).test(text);
      const assigned = new RegExp(`=\\s*${q}`).test(text);
      if (inArray || assigned) targets.add(t);
    }
  }
  return targets;
}

/**
 * 머리 주석 끄기 표시. @returns {Map<string,string>} 표 → 사유
 * @param {string} text 원문(주석 포함)
 */
export function parseAllowMarkers(text) {
  /** @type {Map<string,string>} */
  const allow = new Map();
  for (const line of text.split(/\r?\n/).slice(0, ALLOW_HEAD_LINES)) {
    const m = line.match(ALLOW_RE);
    if (m) allow.set(m[1], m[2].trim());
  }
  return allow;
}

/**
 * SQL 이름 `public."x"` → `x`
 * @param {string} raw
 */
function sqlName(raw) {
  return raw.trim().replace(/"/g, "").split(".").pop() ?? "";
}

/**
 * ④ 마이그 한 파일 판정.
 * @param {string} sql
 * @param {any} registry
 * @returns {{ red: string[], yellow: string[] }} 표 이름이 든 사유 문장들
 */
export function checkMigrationSql(sql, registry) {
  /** @type {string[]} */
  const red = [];
  /** @type {string[]} */
  const yellow = [];
  const tables = registry.tables ?? {};
  const views = registry.views ?? {};
  /** @param {string} t */
  const readersOf = (t) => /** @type {string[]} */ (tables[t]?.readers ?? views[t]?.readers ?? []);
  const body = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  for (const raw of body.split(";")) {
    const stmt = raw.replace(/\s+/g, " ").trim();
    if (!stmt) continue;
    const alter = stmt.match(/\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?((?:"?\w+"?\.)?"?\w+"?)/i);
    if (alter) {
      const t = sqlName(alter[1]);
      const destructive =
        /\bdrop\s+column\b/i.test(stmt) ||
        /\brename\s+column\b/i.test(stmt) ||
        /\brename\s+to\b/i.test(stmt) ||
        /\brename\s+(?!to\b|column\b|constraint\b)"?\w+"?\s+to\b/i.test(stmt);
      if (destructive && readersOf(t).length) red.push(`${t}: 읽는 쪽(${readersOf(t).join(",")})이 있는 표의 칸 삭제·이름 변경 — ${stmt.slice(0, 120)}`);
      const owner = tables[t]?.owner;
      if (/\badd\s+column\b/i.test(stmt) && (owner === "2u" || owner === "shared")) {
        yellow.push(`${t}: ${owner === "2u" ? "2u 소유" : "공유"} 표에 칸 추가 — 🟡 통보 대상`);
      }
    }
    const drop = stmt.match(/\bdrop\s+table\s+(?:if\s+exists\s+)?(.+?)(?:\s+(?:cascade|restrict))?$/i);
    if (drop) {
      for (const part of drop[1].split(",")) {
        const t = sqlName(part);
        if (readersOf(t).length) red.push(`${t}: 읽는 쪽(${readersOf(t).join(",")})이 있는 표 삭제`);
      }
    }
    const view = stmt.match(/\b(?:drop\s+view\s+(?:if\s+exists\s+)?|create\s+or\s+replace\s+view\s+)((?:"?\w+"?\.)?"?\w+"?)/i);
    if (view) {
      const v = sqlName(view[1]);
      if ((views[v]?.readers ?? []).includes("2u")) yellow.push(`${v}: 2u 가 읽는 VIEW 다시 만듦 — 🟡 통보 대상`);
    }
  }
  return { red, yellow };
}

/**
 * ⑤ 정본 검증. @returns {string[]} 빨강 사유
 * @param {any} registry
 * @param {string} root
 */
export function validateRegistry(registry, root) {
  /** @type {string[]} */
  const errs = [];
  if (!registry || typeof registry !== "object") return ["정본이 객체가 아님"];
  if (registry.version !== 1) errs.push(`version 이 1 이 아님(${registry.version}) — 2u 가드도 version 을 본다`);
  const tables = registry.tables ?? {};
  const views = registry.views ?? {};
  if (!Object.keys(tables).length) errs.push("tables 가 비었음");
  for (const [name, t] of Object.entries(tables)) {
    if (!OWNERS.includes(t?.owner)) errs.push(`tables.${name}.owner 값이 이상함(${t?.owner})`);
    if (t?.owner === "shared" && (!t.columns || typeof t.columns !== "object")) errs.push(`tables.${name}: shared 표인데 columns 없음`);
    if (t?.columns) {
      /** @type {Map<string,string>} */
      const seen = new Map();
      for (const [bucket, cols] of Object.entries(t.columns)) {
        if (!COLUMN_BUCKETS.includes(bucket)) errs.push(`tables.${name}.columns.${bucket}: 모르는 칸 묶음`);
        if (!Array.isArray(cols)) {
          errs.push(`tables.${name}.columns.${bucket}: 배열이 아님`);
          continue;
        }
        for (const c of cols) {
          const prev = seen.get(c);
          if (prev) errs.push(`tables.${name}: 칸 ${c} 가 ${prev}·${bucket} 두 묶음에 겹침`);
          else seen.set(c, bucket);
        }
      }
    }
  }
  for (const [name, v] of Object.entries(views)) {
    if (!OWNERS.includes(v?.owner)) errs.push(`views.${name}.owner 값이 이상함(${v?.owner})`);
  }
  const mine = registry.writers?.mibunyang;
  if (!mine || typeof mine !== "object") errs.push("writers.mibunyang 없음");
  for (const [repo, files] of Object.entries(registry.writers ?? {})) {
    for (const [file, byTable] of Object.entries(/** @type {Record<string, any>} */ (files))) {
      if (repo === "mibunyang" && !fs.existsSync(path.join(root, file))) errs.push(`writers.mibunyang: 파일 없음 ${file}`);
      for (const [tbl, cols] of Object.entries(byTable ?? {})) {
        if (!tables[tbl] && !views[tbl]) errs.push(`writers.${repo}.${file}: 정본에 없는 표 ${tbl}`);
        if (!Array.isArray(cols)) errs.push(`writers.${repo}.${file}.${tbl}: 배열이 아님`);
      }
    }
  }
  for (const file of Object.keys(registry.delete_allowed?.mibunyang ?? {})) {
    if (!fs.existsSync(path.join(root, file))) errs.push(`delete_allowed.mibunyang: 파일 없음 ${file}`);
  }
  for (const file of registry.guard?.helpers ?? []) {
    if (!fs.existsSync(path.join(root, file))) errs.push(`guard.helpers: 파일 없음 ${file}`);
  }
  return errs;
}

/**
 * 검사 대상 파일 — scripts/**\/*.{mjs,py} + api/**\/*.ts (시험·scripts/probes 제외).
 * @param {string} root
 * @returns {string[]} root 기준 슬래시 경로
 */
export function listTargetFiles(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} rel @param {RegExp} ext */
  const walk = (rel, ext) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = `${rel}/${ent.name}`;
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || r === "scripts/probes") continue;
        walk(r, ext);
      } else if (ext.test(ent.name) && !ent.name.includes(".test.")) out.push(r);
    }
  };
  walk("scripts", /\.(mjs|py)$/);
  walk("api", /\.ts$/);
  return out.sort();
}

/**
 * 판정 본체 — 시험이 임시 폴더·가짜 정본을 넣는다.
 * @param {{ root: string, registry: any, changedMigrations?: string[], files?: string[] }} opts
 * @returns {{ red: string[], yellow: string[], perTable: Map<string,{red:number,yellow:number}> }}
 */
export function auditOwnership({ root, registry, changedMigrations = [], files }) {
  /** @type {string[]} */
  const red = [];
  /** @type {string[]} */
  const yellow = [];
  /** @type {Map<string,{red:number,yellow:number}>} */
  const perTable = new Map();
  /** @param {string} t @param {"red"|"yellow"} k */
  const bump = (t, k) => {
    const cur = perTable.get(t) ?? { red: 0, yellow: 0 };
    cur[k] += 1;
    perTable.set(t, cur);
  };

  for (const e of validateRegistry(registry, root)) {
    red.push(`⑤ 정본: ${e}`);
    bump("(정본)", "red");
  }

  const tables = registry?.tables ?? {};
  const sharedTables = Object.keys(tables).filter((t) => tables[t].owner === "shared");
  const otherTables = Object.keys(tables).filter((t) => tables[t].owner === "2u");
  const watched = [...sharedTables, ...otherTables];
  const mine = registry?.writers?.mibunyang ?? {};
  const helpers = new Set(registry?.guard?.helpers ?? []);
  const deleteAllowed = registry?.delete_allowed?.mibunyang ?? {};

  for (const file of files ?? listTargetFiles(root)) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    const raw = fs.readFileSync(abs, "utf8");
    const isPy = file.endsWith(".py");
    const text = stripCommentLines(raw, isPy);
    const allow = parseAllowMarkers(raw);
    /** @param {string} t @param {string} msg */
    const report = (t, msg) => {
      if (allow.has(t)) {
        yellow.push(`${msg} → 머리 주석 allow(${allow.get(t)})로 🟡`);
        bump(t, "yellow");
      } else {
        red.push(msg);
        bump(t, "red");
      }
    };
    const isHelper = helpers.has(file);
    const literals = findTableLiterals(text, watched);

    // ① 등록제
    if (!isHelper && literals.size && hasWriteTrace(text) && !mine[file]) {
      for (const t of literals) report(t, `🔴 ① 미등록 쓰기 후보 ${file} — 표 "${t}"(${tables[t].owner}) 글자 + 쓰기 흔적 · writers.mibunyang 에 등록하거나 머리 주석 allow`);
    }

    // ② 칸 기준선
    const byTable = mine[file];
    if (byTable) {
      const myShared = Object.keys(byTable).filter((t) => tables[t]?.owner === "shared");
      if (myShared.length) {
        const baseline = new Set(Object.values(byTable).flat());
        const keys = extractKeys(text, isPy);
        /** @type {Set<string>} */
        const flagged = new Set();
        for (const t of myShared) {
          const theirs = new Set([...(tables[t].columns?.["2u"] ?? []), ...(tables[t].columns?.contested ?? [])]);
          for (const k of keys) {
            if (theirs.has(k) && !baseline.has(k) && !flagged.has(`${t}.${k}`)) {
              flagged.add(`${t}.${k}`);
              report(t, `🔴 ② 기준선 밖 칸 ${file} — ${t}.${k}(${(tables[t].columns?.["2u"] ?? []).includes(k) ? "2u 칸" : "다툼 칸"}) · 정말 써야 하면 정본 PR 로 기준선에 더하고 2u 와 합의`);
            }
          }
        }
      }
    }

    // ③ 행 삭제
    if (!isHelper) {
      for (const t of findDeleteTargets(text, sharedTables, isPy)) {
        if (!(deleteAllowed[file] ?? []).includes(t)) report(t, `🔴 ③ 공유 표 행 삭제 ${file} — ${t} 는 상대 칸도 함께 지워진다 · 내 칸만 null UPDATE 로(설계서 C4)`);
      }
    }
  }

  // ④ 마이그
  for (const mig of changedMigrations) {
    const abs = path.join(root, mig);
    if (!fs.existsSync(abs)) continue;
    const r = checkMigrationSql(fs.readFileSync(abs, "utf8"), registry);
    for (const m of r.red) {
      red.push(`🔴 ④ 마이그 ${mig} — ${m}`);
      bump(m.split(":")[0], "red");
    }
    for (const m of r.yellow) {
      yellow.push(`🟡 ④ 마이그 ${mig} — ${m}`);
      bump(m.split(":")[0], "yellow");
    }
  }
  return { red, yellow, perTable };
}

/**
 * 이번 변경에서 새로 더한 마이그(.sql · _rollbacks 제외).
 * CI(GITHUB_ACTIONS): PR 은 합침 커밋의 첫 부모, push 는 직전 커밋과 비교 → `HEAD~1` (ci.yml fetch-depth 2 필요).
 * 로컬: origin/main...HEAD(없으면 main...HEAD) + 아직 추적 안 한 새 파일.
 * @param {string} root
 * @returns {{ files: string[], error: string | null }}
 */
export function changedMigrationFiles(root) {
  /** @param {string[]} args */
  const git = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  /** @type {Set<string>} */
  const set = new Set();
  try {
    if (process.env.GITHUB_ACTIONS) {
      git(["diff", "--name-only", "--diff-filter=A", "HEAD~1", "HEAD", "--", "supabase/migrations"]).split("\n").forEach((f) => set.add(f.trim()));
    } else {
      let out = "";
      try {
        out = git(["diff", "--name-only", "--diff-filter=A", "origin/main...HEAD", "--", "supabase/migrations"]);
      } catch {
        out = git(["diff", "--name-only", "--diff-filter=A", "main...HEAD", "--", "supabase/migrations"]);
      }
      out.split("\n").forEach((f) => set.add(f.trim()));
      git(["ls-files", "--others", "--exclude-standard", "--", "supabase/migrations"]).split("\n").forEach((f) => set.add(f.trim()));
    }
  } catch (e) {
    return { files: [], error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
  const files = [...set].filter((f) => f.endsWith(".sql") && !f.includes("/_rollbacks/"));
  return { files: files.sort(), error: null };
}

/** @param {string[]} argv */
function main(argv) {
  const regAbs = path.join(REPO_ROOT, REGISTRY_PATH);
  /** @type {any} */
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(regAbs, "utf8"));
  } catch (e) {
    console.error(`🔴 ⑤ 정본을 못 읽음(${REGISTRY_PATH}): ${e instanceof Error ? e.message : e}`);
    return 1;
  }

  const pi = argv.indexOf("--print");
  if (pi >= 0) {
    const t = argv[pi + 1];
    const entry = registry.tables?.[t] ?? registry.views?.[t];
    if (!entry) {
      console.error(`정본에 없는 표: ${t}`);
      return 1;
    }
    /** @type {Record<string, any>} */
    const writers = {};
    for (const [repo, files] of Object.entries(registry.writers ?? {})) {
      for (const [file, byTable] of Object.entries(/** @type {Record<string, any>} */ (files))) {
        if (byTable?.[t]) writers[`${repo}:${file}`] = byTable[t];
      }
    }
    console.log(JSON.stringify({ [t]: entry, writers }, null, 2));
    return 0;
  }

  if (argv.includes("--schema")) {
    const errs = validateRegistry(registry, REPO_ROOT);
    for (const e of errs) console.log(`🔴 ⑤ 정본: ${e}`);
    console.log(`ownership schema: 🔴 ${errs.length}`);
    return errs.length ? 1 : 0;
  }

  const mig = changedMigrationFiles(REPO_ROOT);
  const { red, yellow, perTable } = auditOwnership({ root: REPO_ROOT, registry, changedMigrations: mig.files });
  if (mig.error) {
    const msg = `④ 새 마이그 목록을 못 구함(${mig.error}) — CI 면 checkout fetch-depth 2 확인`;
    if (process.env.GITHUB_ACTIONS) red.push(`🔴 ${msg}`);
    else yellow.push(`🟡 ${msg}`);
  }
  for (const m of red) console.log(m);
  for (const m of yellow) console.log(m);
  for (const [t, c] of [...perTable.entries()].sort()) console.log(`  ${t} — 🔴 ${c.red} · 🟡 ${c.yellow}`);
  console.log(`  (새 마이그 ${mig.files.length}개 검사${mig.files.length ? ": " + mig.files.join(", ") : ""})`);
  console.log(`ownership audit: 🔴 ${red.length} · 🟡 ${yellow.length}`);
  if (red.length) {
    console.error(`
  공유 DB 정본(supabase/ownership.json)과 코드가 어긋난다.
    - 새로 공유·2u 표에 쓰는 파일이면: 정본 writers.mibunyang 에 등록(칸까지) → 합치면 2u 에 통보 이슈가 자동으로 간다
    - 오탐이면: 그 파일 머리에 // ownership-guard: allow <표> <사유>
  설계서: docs/superpowers/specs/2026-10-09-shared-db-ownership-registry-design.md`);
  }
  return red.length ? 1 : 0;
}

// CLI 로 직접 실행될 때만 — 시험이 import 하면 process.exit 이 시험을 죽인다(audit-customer-facing-excuses.mjs 와 같은 파일명 끝 비교).
const cliName = (process.argv[1] ?? "").split("/").pop()?.split(String.fromCharCode(92)).pop() ?? "";
const isCLI = cliName !== "" && import.meta.url.endsWith(cliName);
if (isCLI) process.exit(main(process.argv.slice(2)));
