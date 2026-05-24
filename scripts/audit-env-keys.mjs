// @ts-check
/**
 * ETL 환경변수 이름 3-way 동기화 감사.
 *
 * 사고 박제: 세션 232 — collect-migration.yml 이 MOIS_POP_KEY 만 주입했는데
 * migration.mjs 는 KOSIS_MIGRATION_KEY 를 요구. 1개월 schedule fail 방치.
 *
 * 본 audit:
 *   1. scripts/collectors/<name>.mjs 의 process.env.X 추출
 *   2. .github/workflows/collect-<name>.yml 의 env block 의 X 추출
 *   3. data-fill.mjs 의 envKeys 배열에서 collector 별 X 추출
 *   4. 3-way mismatch 시 exit 1 + 누락 위치 표시
 *
 * exit code: 0=clean, 1=mismatch, 2=parse error
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const COLLECTORS_DIR = "scripts/collectors";
const WORKFLOWS_DIR = ".github/workflows";
const DATA_FILL = "scripts/collectors/data-fill.mjs";

const MATRIX_ORCHESTRATORS = [
  ".github/workflows/fill-missing-data.yml",
];

const SECRET_PATTERN = /^[A-Z][A-Z0-9_]*_(KEY|TOKEN|URL|SECRET)$/;

// 알려진 시스템 환경변수 (audit 제외)
const SYSTEM_ENV = new Set([
  "NODE_ENV", "CI", "PATH", "HOME", "USER", "TMPDIR", "TZ",
  "GITHUB_TOKEN", "GITHUB_ACTOR", "GITHUB_REPOSITORY",
]);

/** @param {string} file @returns {Promise<Set<string>>} */
async function extractCodeEnvVars(file) {
  const text = await readFile(file, "utf-8");
  const set = new Set();
  const re = /process\.env\.([A-Z][A-Z0-9_]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    if (SYSTEM_ENV.has(name)) continue;
    if (!SECRET_PATTERN.test(name)) continue;
    set.add(name);
  }
  return set;
}

/** @param {string} file @returns {Promise<{envBlock: Set<string>, validateRefs: Set<string>}>} */
async function extractYmlEnvVars(file) {
  const text = await readFile(file, "utf-8");
  const envBlock = new Set();
  const validateRefs = new Set();

  // env: 아래 KEY: ${{ secrets.X }} 패턴
  const envRe = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*\$\{\{\s*secrets\.([A-Z][A-Z0-9_]*)\s*\}\}/gm;
  let m;
  while ((m = envRe.exec(text)) !== null) {
    if (!SECRET_PATTERN.test(m[1])) continue;
    envBlock.add(m[1]);
  }

  // validate step shell 의 $VAR 참조 추출 (-z "$X" 패턴)
  const validateRe = /-z\s+"?\$([A-Z][A-Z0-9_]*)"?/g;
  while ((m = validateRe.exec(text)) !== null) {
    if (!SECRET_PATTERN.test(m[1])) continue;
    validateRefs.add(m[1]);
  }

  return { envBlock, validateRefs };
}

/**
 * matrix orchestrator yml 답습 → matrix script 항목별 env 매핑
 * @param {string} file
 * @returns {Promise<Map<string, {envBlock: Set<string>, validateRefs: Set<string>}>>}
 */
export async function extractMatrixJobs(file) {
  const text = await readFile(file, "utf-8");
  /** @type {Map<string, {envBlock: Set<string>, validateRefs: Set<string>}>} */
  const result = new Map();

  const jobBlockPattern = /^ {2}([a-z][a-z0-9-]*):\n([\s\S]*?)(?=^ {2}[a-z]|^[a-z]|$(?![\s\S]))/gm;
  let m;
  while ((m = RegExp.prototype.exec.call(jobBlockPattern, text)) !== null) {
    const jobBody = m[2];

    /** @type {string[]} */
    const scriptNames = [];
    const scriptPattern = /-\s*\{\s*name:\s*"[^"]*",\s*cmd:\s*"([^"]+)"/g;
    let cm;
    while ((cm = RegExp.prototype.exec.call(scriptPattern, jobBody)) !== null) {
      scriptNames.push(cm[1]);
    }
    if (scriptNames.length === 0) continue;

    /** @type {Set<string>} */
    const envBlock = new Set();
    /** @type {Set<string>} */
    const validateRefs = new Set();

    const envPattern = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*\$\{\{\s*secrets\.([A-Z][A-Z0-9_]*)\s*\}\}/gm;
    let em;
    while ((em = RegExp.prototype.exec.call(envPattern, jobBody)) !== null) {
      if (!SECRET_PATTERN.test(em[1])) continue;
      envBlock.add(em[1]);
    }

    const validatePattern = /-z\s+"?\$([A-Z][A-Z0-9_]*)"?/g;
    let vm;
    while ((vm = RegExp.prototype.exec.call(validatePattern, jobBody)) !== null) {
      if (!SECRET_PATTERN.test(vm[1])) continue;
      validateRefs.add(vm[1]);
    }

    for (const name of scriptNames) {
      result.set(name, { envBlock, validateRefs });
    }
  }

  return result;
}

/** @returns {Promise<Map<string, Set<string>>>} */
async function extractDataFillEnvKeys() {
  const text = await readFile(DATA_FILL, "utf-8");
  const map = new Map();
  // { category: "X", phase: N, scripts: ["a.mjs", "b.mjs"], args: [...], envKeys: ["KEY1", "KEY2"] }
  const re = /scripts:\s*\[([^\]]+)\][^}]*envKeys:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const scripts = m[1].match(/"([^"]+\.mjs)"/g)?.map(s => s.slice(1, -1)) ?? [];
    const keys = m[2].match(/"([^"]+)"/g)?.map(s => s.slice(1, -1)) ?? [];
    for (const s of scripts) {
      const existing = map.get(s) ?? new Set();
      for (const k of keys) existing.add(k);
      map.set(s, existing);
    }
  }
  return map;
}

/**
 * @param {string} mjsName e.g. "migration.mjs"
 * @returns {string | null}
 */
function findWorkflowForCollector(workflowFiles, mjsName) {
  const base = mjsName.replace(/\.mjs$/, "");
  const candidates = workflowFiles.filter(f => f.endsWith(".yml"));
  return candidates.find(f => {
    const ymlBase = path.basename(f, ".yml");
    return ymlBase === `collect-${base}` || ymlBase === base;
  }) ?? null;
}

async function main() {
  /** @type {{collector: string, codeKeys: string[], ymlEnvKeys: string[], validateKeys: string[], dataFillKeys: string[], issues: string[]}[]} */
  const reports = [];
  let errorCount = 0;

  // collectors 디렉토리 *.mjs (test 제외, audit 자체 제외)
  const files = await readdir(COLLECTORS_DIR);
  const collectorMjs = files
    .filter(f => f.endsWith(".mjs"))
    .filter(f => !f.endsWith(".test.mjs"))
    .filter(f => !f.startsWith("_"))
    .filter(f => f !== "data-fill.mjs" && f !== "alias-loader.mjs");

  // workflow yml
  const workflowDirs = await readdir(WORKFLOWS_DIR);
  const workflows = workflowDirs.filter(f => f.endsWith(".yml")).map(f => path.join(WORKFLOWS_DIR, f));

  // data-fill envKeys 매핑
  const dataFillMap = await extractDataFillEnvKeys();

  for (const mjs of collectorMjs) {
    const codePath = path.join(COLLECTORS_DIR, mjs);
    const codeKeys = await extractCodeEnvVars(codePath);
    if (codeKeys.size === 0) continue; // 환경변수 미사용 = 감사 대상 외

    const ymlFile = findWorkflowForCollector(workflows, mjs);
    /** @type {Set<string>} */
    let ymlEnvBlock = new Set();
    /** @type {Set<string>} */
    let validateRefs = new Set();
    if (ymlFile) {
      const r = await extractYmlEnvVars(ymlFile);
      ymlEnvBlock = r.envBlock;
      validateRefs = r.validateRefs;
    }

    const dataFillKeys = dataFillMap.get(mjs) ?? new Set();

    /** @type {string[]} */
    const issues = [];
    for (const k of codeKeys) {
      if (ymlFile && !ymlEnvBlock.has(k)) {
        issues.push(`❌ yml env block 누락: ${k} (in ${path.basename(ymlFile)})`);
        errorCount++;
      }
      if (ymlFile && ymlEnvBlock.has(k) && !validateRefs.has(k)) {
        issues.push(`⚠️ yml validate step 미참조: ${k} (env 만 주입, 빈 값 검증 안 함)`);
      }
      if (dataFillMap.has(mjs) && !dataFillKeys.has(k)) {
        issues.push(`❌ data-fill envKeys 누락: ${k}`);
        errorCount++;
      }
    }

    reports.push({
      collector: mjs,
      codeKeys: [...codeKeys].sort(),
      ymlEnvKeys: [...ymlEnvBlock].sort(),
      validateKeys: [...validateRefs].sort(),
      dataFillKeys: [...dataFillKeys].sort(),
      issues,
    });
  }

  // 출력
  console.log("=== ETL env-key 3-way audit ===");
  for (const r of reports) {
    if (r.issues.length === 0) continue;
    console.log(`\n[${r.collector}]`);
    console.log(`  code     : ${r.codeKeys.join(", ")}`);
    console.log(`  yml env  : ${r.ymlEnvKeys.join(", ") || "(no workflow)"}`);
    console.log(`  yml valid: ${r.validateKeys.join(", ") || "(none)"}`);
    console.log(`  data-fill: ${r.dataFillKeys.join(", ") || "(not in data-fill)"}`);
    for (const issue of r.issues) console.log(`  ${issue}`);
  }

  const cleanCount = reports.filter(r => r.issues.length === 0).length;
  console.log(`\n=== summary: ${cleanCount}/${reports.length} clean, ${errorCount} errors ===`);

  if (errorCount > 0) {
    console.log("\n❌ audit failed. 위 ❌ 항목을 yml env block 또는 data-fill envKeys 에 추가하세요.");
    process.exit(1);
  }
  console.log("\n✅ all clean");
  process.exit(0);
}

main().catch(err => {
  console.error("audit script error:", err);
  process.exit(2);
});
