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
import yaml from "js-yaml";

const COLLECTORS_DIR = "scripts/collectors";
const WORKFLOWS_DIR = ".github/workflows";
const DATA_FILL = "scripts/collectors/data-fill.mjs";

const MATRIX_ORCHESTRATORS = [
  ".github/workflows/fill-missing-data.yml",
];

const SECRET_PATTERN = /^[A-Z][A-Z0-9_]*_(KEY|TOKEN|URL|SECRET)$/;

// validate step 의 빈 값 체크 패턴 — 두 형식 모두 지원:
//   A. -z "$VAR"               (env 참조)
//   B. -z "${{ secrets.VAR }}" (Actions 표현식 직접, collect-air-quality/police/schools)
// 새 RegExp 매번 생성 (lastIndex 재사용 사고 회피)
const validatePattern = () => /-z\s+"?\$(?:\{\{\s*secrets\.)?([A-Z][A-Z0-9_]*)\}?/g;

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

  // validate step shell 의 빈 값 체크 추출 (-z "$X" + -z "${{ secrets.X }}" 양형)
  const validateRe = validatePattern();
  while ((m = validateRe.exec(text)) !== null) {
    if (!SECRET_PATTERN.test(m[1])) continue;
    validateRefs.add(m[1]);
  }

  return { envBlock, validateRefs };
}

/**
 * matrix orchestrator yml 답습 → matrix script 항목별 env 매핑
 * js-yaml 답습 (정규식 fragile 회피, YAML 1.2 spec 준수)
 * @param {string} file
 * @returns {Promise<Map<string, {envBlock: Set<string>, validateRefs: Set<string>}>>}
 */
export async function extractMatrixJobs(file) {
  const text = await readFile(file, "utf-8");
  /** @type {Map<string, {envBlock: Set<string>, validateRefs: Set<string>}>} */
  const result = new Map();

  /** @type {any} */
  const doc = yaml.load(text, { schema: yaml.FAILSAFE_SCHEMA });
  if (!doc || typeof doc !== "object" || !doc.jobs) return result;

  for (const jobName of Object.keys(doc.jobs)) {
    const job = doc.jobs[jobName];
    const scripts = job?.strategy?.matrix?.script;
    if (!Array.isArray(scripts) || scripts.length === 0) continue;

    /** @type {string[]} */
    const scriptNames = scripts
      .map((/** @type {any} */ s) => s?.cmd)
      .filter((/** @type {any} */ v) => typeof v === "string");
    if (scriptNames.length === 0) continue;

    /** @type {Set<string>} */
    const envBlock = new Set();
    if (job.env && typeof job.env === "object") {
      for (const key of Object.keys(job.env)) {
        if (SECRET_PATTERN.test(key)) envBlock.add(key);
      }
    }

    /** @type {Set<string>} */
    const validateRefs = new Set();
    const steps = Array.isArray(job.steps) ? job.steps : [];
    for (const step of steps) {
      const runText = typeof step?.run === "string" ? step.run : "";
      const validateRe = validatePattern();
      let vm;
      while ((vm = RegExp.prototype.exec.call(validateRe, runText)) !== null) {
        if (SECRET_PATTERN.test(vm[1])) validateRefs.add(vm[1]);
      }
    }

    for (const name of scriptNames) {
      result.set(name, { envBlock, validateRefs });
    }
  }

  return result;
}

/**
 * collector → 그 collector 가 등장하는 모든 (yml, step) 의 env 매핑 (역방향).
 *
 * 사고 박제: 세션 328 — collect-naver-listings-incremental.yml 의 schools step 에
 * NEIS_KEY/SCHOOLINFO_KEY 누락. 1:1 매칭(findWorkflowForCollector)은 yml명≠collector명
 * (collect-transport.yml ↔ transport-tago.mjs) 시 null → 검증 스킵 → clean 오집계.
 * 모든 yml 의 step.run 을 스캔해 collector 호출을 역방향으로 수집한다.
 *
 * env 상속: step > job > workflow. matrix job 은 extractMatrixJobs 담당 → skip.
 *
 * @param {string} file
 * @returns {Promise<Map<string, Array<{yml: string, step: string, envBlock: Set<string>, validateRefs: Set<string>}>>>}
 */
export async function extractStepCollectorEnv(file) {
  const text = await readFile(file, "utf-8");
  /** @type {Map<string, Array<{yml: string, step: string, envBlock: Set<string>, validateRefs: Set<string>}>>} */
  const result = new Map();

  /** @type {any} */
  const doc = yaml.load(text, { schema: yaml.FAILSAFE_SCHEMA });
  if (!doc || typeof doc !== "object" || !doc.jobs) return result;

  const ymlName = path.basename(file);

  /** @param {any} envObj @returns {Set<string>} */
  const secretKeys = (envObj) => {
    /** @type {Set<string>} */
    const s = new Set();
    if (envObj && typeof envObj === "object") {
      for (const k of Object.keys(envObj)) {
        if (SECRET_PATTERN.test(k)) s.add(k);
      }
    }
    return s;
  };

  const workflowEnv = secretKeys(doc.env);

  for (const jobName of Object.keys(doc.jobs)) {
    const job = doc.jobs[jobName];
    // matrix job 은 extractMatrixJobs 담당 (이중평가 방지)
    if (job?.strategy?.matrix?.script) continue;

    /** @type {Set<string>} */
    const jobEnv = new Set([...workflowEnv, ...secretKeys(job?.env)]);

    const steps = Array.isArray(job?.steps) ? job.steps : [];

    // validateRefs: job 의 모든 step.run 의 -z "$X" 누적 (validate step 은 보통 별도 step)
    /** @type {Set<string>} */
    const validateRefs = new Set();
    for (const step of steps) {
      const runText = typeof step?.run === "string" ? step.run : "";
      const validateRe = validatePattern();
      let vm;
      while ((vm = RegExp.prototype.exec.call(validateRe, runText)) !== null) {
        if (SECRET_PATTERN.test(vm[1])) validateRefs.add(vm[1]);
      }
    }

    for (const step of steps) {
      const runText = typeof step?.run === "string" ? step.run : "";
      const stepEnv = secretKeys(step?.env);
      /** @type {Set<string>} */
      const effectiveEnv = stepEnv.size > 0 ? new Set([...jobEnv, ...stepEnv]) : jobEnv;
      const stepName = typeof step?.name === "string" ? step.name : "(unnamed)";

      const collectorRe = /node\s+scripts\/collectors\/([a-z0-9-]+)\.mjs/g;
      let cm;
      while ((cm = RegExp.prototype.exec.call(collectorRe, runText)) !== null) {
        const mjs = `${cm[1]}.mjs`;
        const arr = result.get(mjs) ?? [];
        arr.push({ yml: ymlName, step: stepName, envBlock: effectiveEnv, validateRefs });
        result.set(mjs, arr);
      }
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
 * @param {string[]} workflowFiles
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

  // collector → 등장하는 모든 (yml, step) env 역방향 매핑 (세션 328 사고 대응)
  // 1:1 매칭(yml명=collector명)이 못 잡는 이름 불일치/multi-collector yml 사각지대 차단
  /** @type {Map<string, Array<{yml: string, step: string, envBlock: Set<string>, validateRefs: Set<string>}>>} */
  const stepMap = new Map();
  for (const yml of workflows) {
    /** @type {Map<string, Array<{yml: string, step: string, envBlock: Set<string>, validateRefs: Set<string>}>>} */
    let perYml;
    try {
      perYml = await extractStepCollectorEnv(yml);
    } catch (err) {
      console.warn(`⚠️ step 답습 실패: ${yml} — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const [mjs, rows] of perYml) {
      const arr = stepMap.get(mjs) ?? [];
      arr.push(...rows);
      stepMap.set(mjs, arr);
    }
  }

  for (const mjs of collectorMjs) {
    const codePath = path.join(COLLECTORS_DIR, mjs);
    const codeKeys = await extractCodeEnvVars(codePath);
    if (codeKeys.size === 0) continue; // 환경변수 미사용 = 감사 대상 외

    const dataFillKeys = dataFillMap.get(mjs) ?? new Set();
    const stepRows = stepMap.get(mjs) ?? [];

    /** @type {string[]} */
    const issues = [];
    /** @type {Set<string>} */
    const allYmlEnv = new Set();
    /** @type {Set<string>} */
    const allValidate = new Set();

    if (stepRows.length > 0) {
      // step 경로: 등장하는 모든 (yml, step) 각각 검증
      for (const row of stepRows) {
        for (const k of row.envBlock) allYmlEnv.add(k);
        for (const k of row.validateRefs) allValidate.add(k);
        for (const k of codeKeys) {
          if (!row.envBlock.has(k)) {
            issues.push(`❌ yml env block 누락: ${k} (in ${row.yml}, step="${row.step}")`);
            errorCount++;
          } else if (!row.validateRefs.has(k)) {
            issues.push(`⚠️ yml validate step 미참조: ${k} (in ${row.yml}, step="${row.step}")`);
          }
        }
      }
    } else {
      // step 등장 0건 → 기존 1:1 매칭 fallback (그래도 없으면 로컬 전용)
      const ymlFile = findWorkflowForCollector(workflows, mjs);
      if (ymlFile) {
        const r = await extractYmlEnvVars(ymlFile);
        for (const k of r.envBlock) allYmlEnv.add(k);
        for (const k of r.validateRefs) allValidate.add(k);
        for (const k of codeKeys) {
          if (!r.envBlock.has(k)) {
            issues.push(`❌ yml env block 누락: ${k} (in ${path.basename(ymlFile)})`);
            errorCount++;
          } else if (!r.validateRefs.has(k)) {
            issues.push(`⚠️ yml validate step 미참조: ${k} (env 만 주입, 빈 값 검증 안 함)`);
          }
        }
      } else {
        issues.push(`ℹ️ workflow 호출 0건 (로컬 전용 — audit 대상 외)`);
      }
    }

    // data-fill envKeys 누락 (mjs 단위, step/fallback 무관)
    for (const k of codeKeys) {
      if (dataFillMap.has(mjs) && !dataFillKeys.has(k)) {
        issues.push(`❌ data-fill envKeys 누락: ${k}`);
        errorCount++;
      }
    }

    reports.push({
      collector: mjs,
      codeKeys: [...codeKeys].sort(),
      ymlEnvKeys: [...allYmlEnv].sort(),
      validateKeys: [...allValidate].sort(),
      dataFillKeys: [...dataFillKeys].sort(),
      issues,
    });
  }

  // ── matrix orchestrator 추가 audit (세션 294 사고 대응) ─────
  /** @type {{collector: string, orchestrator: string, codeKeys: string[], ymlEnvKeys: string[], validateKeys: string[], issues: string[]}[]} */
  const matrixReports = [];

  for (const orchYml of MATRIX_ORCHESTRATORS) {
    /** @type {Map<string, {envBlock: Set<string>, validateRefs: Set<string>}>} */
    let matrixJobs;
    try {
      matrixJobs = await extractMatrixJobs(orchYml);
    } catch (err) {
      console.warn(`⚠️ matrix orchestrator 답습 실패: ${orchYml} — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (const [name, { envBlock, validateRefs }] of matrixJobs) {
      const mjs = `${name}.mjs`;
      if (!collectorMjs.includes(mjs)) {
        console.warn(`⚠️ matrix script "${name}" 의 ${mjs} 본문 부재 (${path.basename(orchYml)})`);
        continue;
      }

      const codePath = path.join(COLLECTORS_DIR, mjs);
      const codeKeys = await extractCodeEnvVars(codePath);
      if (codeKeys.size === 0) continue;

      /** @type {string[]} */
      const issues = [];
      for (const k of codeKeys) {
        if (!envBlock.has(k)) {
          issues.push(`❌ matrix yml env block 누락: ${k} (in ${path.basename(orchYml)}, script=${name})`);
          errorCount++;
        }
        if (envBlock.has(k) && !validateRefs.has(k)) {
          issues.push(`⚠️ matrix yml validate step 미참조: ${k} (script=${name})`);
        }
      }

      matrixReports.push({
        collector: mjs,
        orchestrator: path.basename(orchYml),
        codeKeys: [...codeKeys].sort(),
        ymlEnvKeys: [...envBlock].sort(),
        validateKeys: [...validateRefs].sort(),
        issues,
      });
    }
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

  // matrix orchestrator audit 출력
  for (const r of matrixReports) {
    if (r.issues.length === 0) continue;
    console.log(`\n[${r.collector} (matrix in ${r.orchestrator})]`);
    console.log(`  code     : ${r.codeKeys.join(", ")}`);
    console.log(`  yml env  : ${r.ymlEnvKeys.join(", ") || "(empty)"}`);
    console.log(`  yml valid: ${r.validateKeys.join(", ") || "(none)"}`);
    for (const issue of r.issues) console.log(`  ${issue}`);
  }

  const cleanCount = reports.filter(r => r.issues.length === 0).length
    + matrixReports.filter(r => r.issues.length === 0).length;
  const totalCount = reports.length + matrixReports.length;
  console.log(`\n=== summary: ${cleanCount}/${totalCount} clean, ${errorCount} errors ===`);

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
