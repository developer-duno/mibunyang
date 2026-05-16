// @ts-check
/**
 * 수집기 감시 커버리지 감사.
 *
 * monitor-collectors.yml 의 workflow_run.workflows 목록이 모든 collect-*.yml 을
 * 커버하는지 검사한다. workflow_run 은 와일드카드를 지원하지 않아 이름을 손으로
 * 나열해야 하므로 — 새 수집기 추가 시 감시 목록 누락을 CI 가 차단한다.
 *
 * 검사:
 *   1. .github/workflows/collect-*.yml 의 name 필드 전부 추출
 *   2. monitor-collectors.yml 의 workflow_run.workflows 목록 추출
 *   3. collect 워크플로인데 감시 목록에 없으면 → exit 1
 *
 * exit code: 0=clean, 1=누락, 2=parse error
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const WORKFLOWS_DIR = ".github/workflows";
const MONITOR_YML = ".github/workflows/monitor-collectors.yml";

/**
 * yml 텍스트에서 최상위 `name:` 필드 값을 뽑는다. 따옴표가 있으면 벗긴다.
 * @param {string} text
 * @returns {string | null}
 */
export function extractWorkflowName(text) {
  const m = text.match(/^name:\s*(.+?)\s*$/m);
  if (!m) return null;
  return m[1].replace(/^["'](.*)["']$/, "$1");
}

/**
 * monitor-collectors.yml 텍스트에서 workflow_run.workflows 목록을 뽑는다.
 * `workflows:` 다음의 `- "..."` 줄들을 types: 가 나오기 전까지 수집.
 * @param {string} text
 * @returns {string[]}
 */
export function extractMonitoredWorkflows(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  let inside = false;
  for (const line of lines) {
    if (/^\s*workflows:\s*$/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    const item = line.match(/^\s*-\s*(.+?)\s*$/);
    if (item) {
      result.push(item[1].replace(/^["'](.*)["']$/, "$1"));
      continue;
    }
    // `- ` 항목이 아닌 `key:` 줄이 나오면 목록 끝 (types: 등). 빈 줄은 통과.
    if (/^\s*\S+:/.test(line)) break;
  }
  return result;
}

/**
 * collect 워크플로 이름 중 감시 목록에 빠진 것을 찾는다 (순수 함수).
 * @param {string[]} collectNames 모든 collect-*.yml 의 name
 * @param {string[]} monitoredNames monitor-collectors.yml 이 감시하는 name
 * @returns {string[]} 감시 목록에서 누락된 이름
 */
export function findUncoveredWorkflows(collectNames, monitoredNames) {
  const monitored = new Set(monitoredNames);
  return collectNames.filter((name) => !monitored.has(name));
}

async function main() {
  const files = await readdir(WORKFLOWS_DIR);
  const collectFiles = files.filter((f) => f.startsWith("collect-") && f.endsWith(".yml"));

  /** @type {string[]} */
  const collectNames = [];
  for (const f of collectFiles) {
    const text = await readFile(path.join(WORKFLOWS_DIR, f), "utf-8");
    const name = extractWorkflowName(text);
    if (name) collectNames.push(name);
    else console.warn(`⚠️  ${f}: name 필드 없음`);
  }

  const monitorText = await readFile(MONITOR_YML, "utf-8");
  const monitoredNames = extractMonitoredWorkflows(monitorText);

  const uncovered = findUncoveredWorkflows(collectNames, monitoredNames);

  console.log(`collect 워크플로: ${collectNames.length}개`);
  console.log(`감시 목록: ${monitoredNames.length}개`);

  if (uncovered.length > 0) {
    console.log(`\n❌ 감시 목록에서 누락된 수집기 ${uncovered.length}개:`);
    for (const name of uncovered) console.log(`  - "${name}"`);
    console.log(`\nmonitor-collectors.yml 의 workflow_run.workflows 에 위 이름을 추가하세요.`);
    process.exit(1);
  }

  console.log("\n✅ 모든 collect 워크플로가 감시 목록에 포함됨");
  process.exit(0);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    console.error("audit script error:", err);
    process.exit(2);
  });
}
