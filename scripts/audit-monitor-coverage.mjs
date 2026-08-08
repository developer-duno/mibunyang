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

// ── 검사 2: 워크플로가 돌리는데 실행 기록을 안 남기는 수집기 (세션 504) ──
//
// 배경: `collector_runs` 에 행이 안 생기면 monitor 가 볼 표 자체가 없다. 그래서
// "워크플로는 초록불인데 실제로는 아무것도 안 한" 회차를 아무도 못 본다.
// 실제로 그런 수집기가 **8개** 있었고(environment·noise-estimate·industry-match·
// dart-builders·calc-floors·regulation-seed·geocode-missing·reverse-geocode),
// 그중 `geocode-missing`·`reverse-geocode` 는 워크플로가 `continue-on-error: true` 라
// 실패해도 초록불이어서 어느 감시에도 안 걸리는 완전 무음 구간이었다(세션 504 배선 완료).
//
// 이 검사는 **그 사고가 새 수집기로 재발하는 것**을 막는다. 지금은 0건이다 —
// 0건일 때 넣어야 앞으로 늘어나는 걸 잡는다.
//
// ⚠️ ALLOWLIST 방식(전수검사 + 명시 예외)을 쓴다. "등재하면 검사" 방식(opt-in)은
// 지금 막으려는 실패(= 새 수집기를 목록에 넣는 걸 잊음)를 그대로 재생산한다.
// _graceful-coverage.test.mjs 가 같은 이유로 같은 형태를 쓴다.

/** 기록이 불필요한 것만 (현재 없음). 추가할 땐 **왜** 필요 없는지 한 줄로 남길 것. */
export const RECORD_ALLOWLIST = new Set([]);

/**
 * 워크플로 텍스트에서 실행되는 수집기 이름을 뽑는다.
 * 두 형태를 잡는다 — 직접 실행(`node scripts/collectors/X.mjs`)과 matrix(`cmd: "X"`).
 * @param {string} text
 * @returns {string[]}
 */
export function extractRunCollectors(text) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const m of text.matchAll(/scripts\/collectors\/([a-z0-9-]+)\.mjs/g)) out.add(m[1]);
  for (const m of text.matchAll(/cmd:\s*"([a-z0-9-]+)"/g)) out.add(m[1]);
  return [...out];
}

/**
 * 실행되는데 `recordCollectorRun` 을 안 부르는 수집기를 찾는다 (순수 함수).
 * @param {Map<string, string>} sourceByCollector 수집기명 → 소스 텍스트
 * @param {Set<string>} [allowlist]
 * @returns {string[]}
 */
export function findUnrecordedCollectors(sourceByCollector, allowlist = RECORD_ALLOWLIST) {
  /** @type {string[]} */
  const miss = [];
  for (const [name, src] of sourceByCollector) {
    if (allowlist.has(`${name}.mjs`) || allowlist.has(name)) continue;
    if (!/recordCollectorRun\s*\(/.test(src)) miss.push(name);
  }
  return miss.sort();
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

  let failed = false;

  if (uncovered.length > 0) {
    console.log(`\n❌ 감시 목록에서 누락된 수집기 ${uncovered.length}개:`);
    for (const name of uncovered) console.log(`  - "${name}"`);
    console.log(`\nmonitor-collectors.yml 의 workflow_run.workflows 에 위 이름을 추가하세요.`);
    failed = true;
  } else {
    console.log("\n✅ 모든 collect 워크플로가 감시 목록에 포함됨");
  }

  // ── 검사 2: 실행되는데 기록을 안 남기는 수집기 ──
  /** @type {Map<string, string>} */
  const sourceByCollector = new Map();
  for (const f of files.filter((x) => x.endsWith(".yml"))) {
    const text = await readFile(path.join(WORKFLOWS_DIR, f), "utf-8");
    for (const name of extractRunCollectors(text)) {
      if (sourceByCollector.has(name)) continue;
      try {
        sourceByCollector.set(name, await readFile(`scripts/collectors/${name}.mjs`, "utf-8"));
      } catch {
        // 수집기 파일이 아닌 것(오탐)은 조용히 건너뛴다 — 존재하는 파일만 검사 대상.
      }
    }
  }

  const unrecorded = findUnrecordedCollectors(sourceByCollector);
  console.log(`\n워크플로가 돌리는 수집기: ${sourceByCollector.size}개`);

  if (unrecorded.length > 0) {
    console.log(`❌ 실행 기록(recordCollectorRun)을 안 남기는 수집기 ${unrecorded.length}개:`);
    for (const name of unrecorded) console.log(`  - ${name}.mjs`);
    console.log(
      "\ncollector_runs 에 행이 안 생기면 monitor 가 볼 표가 없어 '초록불인데 아무것도 안 함' 을 못 봅니다.\n" +
        "createReporter + recordCollectorRun 을 배선하거나, 정말 불필요하면 RECORD_ALLOWLIST 에 이유와 함께 넣으세요.",
    );
    failed = true;
  } else {
    console.log("✅ 전부 실행 기록을 남김");
  }

  process.exit(failed ? 1 : 0);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    console.error("audit script error:", err);
    process.exit(2);
  });
}
