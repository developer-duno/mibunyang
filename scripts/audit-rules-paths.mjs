#!/usr/bin/env node
/**
 * .claude/rules/ 의 paths frontmatter 감사 (문서 다이어트 2단계 가드)
 *
 * 무엇을 막는가:
 *   paths 패턴이 실제 추적 파일에 0개 매칭이면, 그 규칙은 **영영 안 불려온다**.
 *   그런데 frontmatter 가 붙어 있으니 "on-demand 로 잘 동작 중"이라 오해하게 된다.
 *   = 규칙이 조용히 무력화된 상태. 세션551 에서 실제로 2건 잡혔다
 *     (src/hooks/ 에 .tsx 없음 · scripts/ 는 전부 .mjs 라 *.js 0건).
 *
 * 무엇을 검사하는가:
 *   1) frontmatter 를 파싱할 수 있는가 (깨진 YAML = 규칙이 통째로 안 읽힐 수 있음)
 *   2) 각 glob 패턴이 git 추적 파일에 1개 이상 매칭되는가
 *
 * 실행: node scripts/audit-rules-paths.mjs
 * exit 0 = 통과 / exit 1 = 죽은 패턴 발견
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RULES_DIR = ".claude/rules";

/** git 추적 파일 전체 (posix 구분자) */
function trackedFiles() {
  const out = execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return out.split("\n").filter(Boolean);
}

/**
 * .md 파일들을 재귀 수집
 * @param {string} dir
 * @returns {string[]}
 */
function ruleFiles(dir) {
  /** @type {string[]} */
  const acc = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.posix.join(dir, e.name);
    if (e.isDirectory()) acc.push(...ruleFiles(p));
    else if (e.name.endsWith(".md")) acc.push(p);
  }
  return acc;
}

/**
 * 맨 앞 frontmatter 에서 paths 목록을 뽑는다.
 * 의도적으로 YAML 라이브러리를 안 쓴다 — 이 자리는 `paths: [- "glob"]` 한 가지 모양만 쓰며,
 * 의존성을 늘리면 감사 스크립트 자체가 깨질 여지가 생긴다.
 * @param {string} file
 * @returns {{ hasFrontmatter: boolean, paths: string[], malformed: boolean }}
 */
function readPaths(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { hasFrontmatter: false, paths: [], malformed: false };

  const end = lines.indexOf("---", 1);
  if (end === -1) return { hasFrontmatter: true, paths: [], malformed: true }; // 닫는 --- 없음

  const block = lines.slice(1, end);
  const idx = block.findIndex((l) => /^paths:\s*$/.test(l));
  if (idx === -1) return { hasFrontmatter: true, paths: [], malformed: false }; // frontmatter 는 있으나 paths 없음

  /** @type {string[]} */
  const globs = [];
  for (const line of block.slice(idx + 1)) {
    const m = line.match(/^\s*-\s*["']?([^"']+)["']?\s*$/);
    if (m) globs.push(m[1]);
    else if (/^\S/.test(line)) break; // 다음 최상위 키
  }
  return { hasFrontmatter: true, paths: globs, malformed: false };
}

/**
 * Claude 의 paths glob 을 정규식으로 옮긴다.
 *   **  = 경로 구분자 포함 임의 (0개 이상 디렉토리)
 *   *   = 구분자 제외 임의
 *   {a,b} = 택일
 * 순서가 중요하다 — 두 별을 한 별보다 먼저 처리하지 않으면 이중 치환된다.
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` 는 "0개 이상 디렉토리" — a/**/b 가 a/b 에도 맞아야 한다
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "{") {
      const close = glob.indexOf("}", i);
      if (close === -1) {
        re += "\\{";
      } else {
        const alts = glob.slice(i + 1, close).split(",");
        re += "(?:" + alts.map((/** @type {string} */ a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")";
        i = close;
      }
    } else if (".+?^$()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

function main() {
  const files = trackedFiles();
  const rules = ruleFiles(RULES_DIR).sort();
  /** @type {{rule: string, glob: string}[]} */
  const dead = [];
  /** @type {string[]} */
  const malformed = [];
  let onDemand = 0;
  let always = 0;

  for (const rule of rules) {
    const { paths, malformed: bad } = readPaths(rule);
    if (bad) {
      malformed.push(rule);
      continue;
    }
    if (paths.length === 0) {
      always++;
      continue;
    }
    onDemand++;
    for (const g of paths) {
      const re = globToRegExp(g);
      const hits = files.filter((f) => re.test(f)).length;
      if (hits === 0) dead.push({ rule, glob: g });
    }
  }

  console.log(`규칙 ${rules.length}개 = 상시 ${always} + on-demand ${onDemand}`);

  if (malformed.length) {
    console.error("\n❌ frontmatter 가 깨진 규칙 (닫는 --- 없음):");
    for (const m of malformed) console.error(`   ${m}`);
  }
  if (dead.length) {
    console.error("\n❌ 추적 파일에 0개 매칭 = 이 규칙은 영영 안 불려온다:");
    for (const d of dead) console.error(`   ${d.rule}\n      glob: ${d.glob}`);
    console.error("\n   → 패턴을 실제 파일에 맞게 고치거나, 그 줄을 제거할 것.");
  }

  if (dead.length || malformed.length) process.exit(1);
  console.log("✅ 죽은 glob 0건 · frontmatter 파싱 정상");
}

main();
