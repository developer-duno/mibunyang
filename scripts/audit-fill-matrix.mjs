// @ts-check
/**
 * fill-missing-data.yml matrix script 가 외부 cron 가진 collector 와 겹치는지 감사.
 *
 * 세션 291/306/307 사고 — 외부 cron 박힌 collector 가 fill matrix 안 박힘 = sub-step
 * cancelled 누적. 5/24, 5/23, 5/22, 5/17, 5/10 5건 연속 cancelled/failure.
 * 신규 collector 등록 시 fill matrix 동시 등록 차단.
 *
 * 검사:
 *   1. .github/workflows/collect-*.yml 중 cron schedule 박힘 파일 추출
 *   2. fill-missing-data.yml matrix script 의 cmd 목록 추출 (audit-env-keys.extractMatrixJobs 답습)
 *   3. 교집합 박힘 시 exit 1
 *
 * exit code: 0=clean, 1=교집합 검출, 2=parse error
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { extractMatrixJobs } from "./audit-env-keys.mjs";

const FILL_YML = ".github/workflows/fill-missing-data.yml";
const WORKFLOWS_DIR = ".github/workflows";

/**
 * 순수 함수 — matrix script 와 cron owner 의 정확 이름 교집합 추출.
 * @param {Set<string>} matrixScripts
 * @param {Set<string>} cronOwners
 * @returns {string[]} 정렬된 위반 목록
 */
export function findViolations(matrixScripts, cronOwners) {
  const result = [];
  for (const name of matrixScripts) {
    if (cronOwners.has(name)) result.push(name);
  }
  return result.sort();
}

async function main() {
  const files = await readdir(WORKFLOWS_DIR);
  /** @type {Set<string>} */
  const cronOwners = new Set();
  for (const f of files) {
    if (!f.startsWith("collect-") || !f.endsWith(".yml")) continue;
    const text = await readFile(path.join(WORKFLOWS_DIR, f), "utf-8");
    if (/^\s*-\s*cron:/m.test(text)) {
      cronOwners.add(f.replace(/^collect-/, "").replace(/\.yml$/, ""));
    }
  }

  const jobs = await extractMatrixJobs(FILL_YML);
  /** @type {Set<string>} */
  const matrixScripts = new Set(jobs.keys());
  const violations = findViolations(matrixScripts, cronOwners);

  if (violations.length > 0) {
    console.log(`❌ fill matrix 안 외부 cron 가진 collector ${violations.length}건:`);
    for (const v of violations) {
      console.log(`  - ${v} (collect-${v}.yml 자체 cron 박힘 → fill matrix 동시 등록 시 sub-step cancelled 누적)`);
    }
    console.log(``);
    console.log(`정정: fill-missing-data.yml matrix 에서 위 collector 제거.`);
    console.log(`답습: .claude/rules/workflows/timeout-rootcause-policy.md §"세션 307 안티 패턴 11 일꾼 정정"`);
    process.exit(1);
  }

  console.log(`✅ fill matrix ${matrixScripts.size}건 (${[...matrixScripts].sort().join(", ")}) 모두 외부 cron 0 (안티 패턴 차단)`);
  process.exit(0);
}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, "/").split("/").pop() ?? ""
);
if (isCLI) {
  main().catch(err => {
    console.error("audit error:", err);
    process.exit(2);
  });
}
