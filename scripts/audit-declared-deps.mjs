// @ts-check
/*
 * scripts/ 가 import 하는 외부 패키지가 package.json 에 선언돼 있는지 감사
 *
 * 사고 배경 (세션 518): `js-yaml` 이 dependencies·devDependencies 어디에도 없이
 * **eslint 의 transitive 로만** 존재했다. eslint 10 시험 업그레이드가 46개 패키지를
 * 정리하면서 그 사슬을 끊자 감사·테스트 5개가 통째로 죽었다
 * (`Cannot find package 'js-yaml' imported from scripts/audit-env-keys.mjs`).
 * `@types/js-yaml` 만 devDependencies 에 있어 "선언돼 있다"는 착시까지 있었다.
 *
 * 왜 기존 도구로 못 잡나: `npm run lint` 는 `eslint src/` 라 **scripts/ 를 아예 안 본다**.
 * 그래서 eslint-plugin-import 의 no-extraneous-dependencies 같은 규칙이 닿지 않는다.
 *
 * 실행: node scripts/audit-declared-deps.mjs
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { builtinModules } from "node:module";
import { stripComments } from "./audit-orphan-collectors.mjs";

const SCRIPTS_DIR = "scripts";
const PKG = "package.json";

/**
 * 훑지 않는 경로. `scripts/probes/` 는 `.gitignore` 대상(줄 108)이라 CI 체크아웃에는
 * 아예 없다 — 훑으면 로컬만 빨갛고 CI 는 초록인 상태가 되어 판정이 갈린다.
 */
const SKIP_DIRS = new Set(["probes", "node_modules"]);

/** Node 내장 모듈은 선언 대상이 아니다. `node:` 접두사가 붙은 형태도 함께 막는다. */
const BUILTINS = new Set(builtinModules);

/**
 * import 지정자를 뽑는 패턴들.
 *
 * ⚠️ **`from` 뒤 공백이 핵심**이다. import 문은 `from "pkg"`(괄호 없음)인데
 * Supabase 쿼리는 `sb.from("apartments")`(괄호 있음)라, 괄호를 허용하면 **테이블 이름이
 * 전부 패키지로 잡힌다**(첫 시도에서 실제로 26종 오검출). 앞의 `(?<![.\w])` 는
 * `.from` 같은 메서드 호출을 한 번 더 막는 이중 방어다.
 */
const IMPORT_PATTERNS = [
  /(?<![.\w])\bfrom\s+["']([^"']+)["']/g, // import x from "p" · export * from "p"
  /(?:^|[\s;{])import\s+["']([^"']+)["']/gm, // import "p" (side-effect)
  /\bimport\s*\(\s*["']([^"']+)["']/g, // 동적 import("p")
  /(?<![.\w])\brequire\s*\(\s*["']([^"']+)["']/g, // CJS require("p")
];

/**
 * 순수 함수 — 텍스트에서 "외부 패키지 이름" 집합을 뽑는다.
 *
 * 걸러내는 것: `node:` 접두사 · Node 내장 · `@/` 별칭(alias-loader) · 상대/절대 경로.
 * scoped 패키지(`@scope/name`)는 두 조각까지가 패키지 이름이고, 그 외에는 첫 조각만이
 * 이름이다(`js-yaml/dist/...` → `js-yaml`).
 *
 * ⚠️ 주석을 먼저 걷어낸다 — 주석에 적힌 import 가 "실제로 쓴다"는 증거가 되면
 * 안 되고(가짜 양성), 반대로 주석 처리된 줄 때문에 미선언이 가려져도 안 된다.
 * (`audit-orphan-collectors.mjs` stripComments 재사용)
 *
 * @param {string} text
 * @returns {Set<string>}
 */
export function extractBareImports(text) {
  const src = stripComments(text);
  /** @type {Set<string>} */
  const out = new Set();
  /** @type {string[]} */
  const specifiers = [];
  for (const re of IMPORT_PATTERNS) {
    for (const m of src.matchAll(re)) specifiers.push(m[1]);
  }

  for (const spec of specifiers) {
    if (spec.startsWith(".") || spec.startsWith("/")) continue; // 상대·절대 경로
    if (spec.startsWith("@/")) continue; // alias-loader 별칭
    if (spec.startsWith("node:")) continue; // 명시적 내장
    const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    if (BUILTINS.has(name)) continue; // `fs` 처럼 접두사 없이 쓴 내장
    out.add(name);
  }
  return out;
}

/**
 * 순수 함수 — 쓰이는데 선언되지 않은 패키지 이름을 정렬해 돌려준다.
 * @param {Set<string>|string[]} used
 * @param {Set<string>|string[]} declared
 * @returns {string[]}
 */
export function findUndeclared(used, declared) {
  const dec = declared instanceof Set ? declared : new Set(declared);
  return [...used].filter((name) => !dec.has(name)).sort();
}

/**
 * scripts/ 아래의 검사 대상 파일 경로를 모은다(SKIP_DIRS 제외).
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function collectFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...(await collectFiles(p)));
    } else if (/\.(mjs|cjs|js)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

async function main() {
  const pkg = JSON.parse(await readFile(PKG, "utf8"));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);

  const files = await collectFiles(SCRIPTS_DIR);
  /** @type {Map<string, string[]>} */
  const usedBy = new Map();
  for (const f of files) {
    for (const name of extractBareImports(await readFile(f, "utf8"))) {
      if (!usedBy.has(name)) usedBy.set(name, []);
      (usedBy.get(name) ?? []).push(f);
    }
  }

  const undeclared = findUndeclared([...usedBy.keys()], declared);

  console.log(`검사 파일: ${files.length}개 · 외부 패키지: ${usedBy.size}종`);
  if (undeclared.length > 0) {
    console.error(`\n❌ package.json 에 선언되지 않은 패키지 ${undeclared.length}종:`);
    for (const name of undeclared) {
      console.error(`  - ${name}  ← ${(usedBy.get(name) ?? []).join(", ")}`);
    }
    console.error(
      `\n다른 패키지의 transitive 로만 존재하면, 그 패키지를 올리는 순간 조용히 사라진다.\n` +
        `해결: npm i -D <이름>  (버전은 지금 해석되는 것과 같은 메이저로 고정할 것)`,
    );
    process.exit(1);
  }
  console.log("✅ scripts/ 의 외부 패키지가 모두 package.json 에 선언돼 있음");
  process.exit(0);
}

const isCLI =
  !!process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    console.error("audit error:", err);
    process.exit(2);
  });
}
