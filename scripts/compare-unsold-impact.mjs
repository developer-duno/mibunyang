// @ts-check
/**
 * compare-unsold-impact.mjs — KOSIS 배분 계획(`collect-unsold-kosis.mjs --impact-out=`) 두 시점을
 * id 로 맞대 무엇이 왜 달라졌는지 보여주는 도구 (세션576).
 *
 * ## 왜 필요한가
 * `collect-unsold-kosis.mjs --dry-run --impact-out=<파일>` 는 그 순간의 계획 스냅샷 하나를 남긴다.
 * 코드를 고친 뒤(예: 임대형 판정 규칙 추가) 그 변경이 실제로 어떤 행을 바꾸는지 보려면 "전"과
 * "후" 두 스냅샷을 나란히 대조해야 하는데, 3,000행 넘는 plan 을 사람이 눈으로 비교할 수 없다.
 * (`.claude/rules/collectors/data-changing-run-approval.md` "전이표로 승인" 원칙의 비교판.)
 *
 * ## 무엇을 보여주나
 * 1. `actionCounts` 전후 표(같은 action 이 몇 곳에서 몇 곳으로 늘거나 줄었나)
 * 2. action 전이 집계 — `from→to: n` (예: write→skip_lease: 91)
 * 3. action 이 바뀐 행 명단(id·name·from·to·currentUnsold·currentSource)
 * 4. action 은 같은데 `newEstimate` 이 바뀐 행 수(↑/↓)와 명단
 * 5. `breaker`(0-쓰기 차단기) 전후
 *
 * 한쪽에만 있는 id 는 "before 없음"/"after 없음" 으로 별도로 센다(전이 집계에 섞지 않는다 —
 * 신규/삭제 단지는 "판정이 바뀐 것"이 아니다).
 *
 * ## 사용법
 *   node scripts/compare-unsold-impact.mjs <before.json> <after.json>
 *   node scripts/compare-unsold-impact.mjs <before.json> <after.json> --out=<결과.json>
 */
import { readFileSync, writeFileSync } from "node:fs";

/**
 * @typedef {{
 *   id: string; name: string; region: string | null; gu: string | null;
 *   action: string; kosisKey: string | null;
 *   guUnsold: number | null; totalUnitsInGu: number | null;
 *   newEstimate: number | null; newRate: number | null;
 *   currentUnsold: number | null; currentRate: number | null;
 *   currentSource: string | null; applyhomeExpired: boolean;
 * }} PlanRow
 * @typedef {{ generatedAt: string; actionCounts: Record<string, number>; breaker: Record<string, unknown>; plan: PlanRow[] }} ImpactFile
 */

/**
 * @param {number | null} a
 * @param {number | null} b
 * @returns {boolean}
 */
function numChanged(a, b) {
  if (a == null && b == null) return false;
  if (a == null || b == null) return true;
  return a !== b;
}

/**
 * 두 impact 파일을 id 로 맞대 무엇이 달라졌는지 계산한다. 파일 I/O 없는 순수 함수.
 *
 * @param {ImpactFile} before
 * @param {ImpactFile} after
 * @returns {{
 *   actionCountsBefore: Record<string, number>;
 *   actionCountsAfter: Record<string, number>;
 *   actionCountsDelta: Record<string, number>;
 *   transitions: Record<string, number>;
 *   transitionRows: Array<{ id: string; name: string; from: string; to: string; currentUnsold: number | null; currentSource: string | null }>;
 *   estimateChanged: { up: number; down: number; rows: Array<{ id: string; name: string; action: string; fromEstimate: number | null; toEstimate: number | null }> };
 *   onlyBefore: number;
 *   onlyAfter: number;
 *   breakerBefore: Record<string, unknown>;
 *   breakerAfter: Record<string, unknown>;
 * }}
 */
export function compareImpact(before, after) {
  const bMap = new Map(before.plan.map((p) => [p.id, p]));
  const aMap = new Map(after.plan.map((p) => [p.id, p]));

  /** @type {Record<string, number>} */
  const transitions = {};
  /** @type {Array<{ id: string; name: string; from: string; to: string; currentUnsold: number | null; currentSource: string | null }>} */
  const transitionRows = [];
  /** @type {Array<{ id: string; name: string; action: string; fromEstimate: number | null; toEstimate: number | null }>} */
  const estimateRows = [];
  let up = 0;
  let down = 0;
  let onlyBefore = 0;

  for (const [id, b] of bMap) {
    const a = aMap.get(id);
    if (!a) {
      onlyBefore++;
      continue;
    }
    if (b.action !== a.action) {
      const key = `${b.action}→${a.action}`;
      transitions[key] = (transitions[key] ?? 0) + 1;
      transitionRows.push({ id, name: a.name, from: b.action, to: a.action, currentUnsold: a.currentUnsold, currentSource: a.currentSource });
      continue;
    }
    // action 이 같을 때만 추정값 변화를 본다(action 이 바뀌면 위 전이 집계로 이미 표현된다).
    if (numChanged(b.newEstimate, a.newEstimate)) {
      const fromE = b.newEstimate;
      const toE = a.newEstimate;
      if (fromE == null) up++; // 빈칸 → 값
      else if (toE == null) down++; // 값 → 빈칸
      else if (toE > fromE) up++;
      else down++;
      estimateRows.push({ id, name: a.name, action: a.action, fromEstimate: fromE, toEstimate: toE });
    }
  }

  let onlyAfter = 0;
  for (const id of aMap.keys()) if (!bMap.has(id)) onlyAfter++;

  return {
    actionCountsBefore: before.actionCounts,
    actionCountsAfter: after.actionCounts,
    actionCountsDelta: diffActionCounts(before.actionCounts, after.actionCounts),
    transitions,
    transitionRows,
    estimateChanged: { up, down, rows: estimateRows },
    onlyBefore,
    onlyAfter,
    breakerBefore: before.breaker,
    breakerAfter: after.breaker,
  };
}

/**
 * @param {Record<string, number>} before
 * @param {Record<string, number>} after
 * @returns {Record<string, number>}
 */
function diffActionCounts(before, after) {
  /** @type {Record<string, number>} */
  const delta = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) delta[k] = (after[k] ?? 0) - (before[k] ?? 0);
  return delta;
}

/**
 * @param {ReturnType<typeof compareImpact>} result
 */
function printReport(result) {
  console.log("=== actionCounts 전후 ===");
  const keys = new Set([...Object.keys(result.actionCountsBefore), ...Object.keys(result.actionCountsAfter)]);
  for (const k of [...keys].sort()) {
    const b = result.actionCountsBefore[k] ?? 0;
    const a = result.actionCountsAfter[k] ?? 0;
    const d = result.actionCountsDelta[k] ?? 0;
    const sign = d > 0 ? `+${d}` : `${d}`;
    console.log(`  ${k}: ${b} → ${a} (${sign})`);
  }

  console.log("\n=== action 전이 집계 ===");
  const transKeys = Object.keys(result.transitions).sort((x, y) => result.transitions[y] - result.transitions[x]);
  if (transKeys.length === 0) console.log("  (전이 없음)");
  for (const k of transKeys) console.log(`  ${k}: ${result.transitions[k]}`);

  console.log(`\n=== action 바뀐 행 명단 (총 ${result.transitionRows.length}건, 최대 20건 표시) ===`);
  for (const r of result.transitionRows.slice(0, 20)) {
    console.log(`  ${r.name}(${r.id}): ${r.from}→${r.to} currentUnsold=${r.currentUnsold ?? "null"} currentSource=${r.currentSource ?? "null"}`);
  }
  if (result.transitionRows.length > 20) console.log(`  … 외 ${result.transitionRows.length - 20}건`);

  console.log(`\n=== action 같고 추정값 바뀐 행: ${result.estimateChanged.up + result.estimateChanged.down}건 (↑${result.estimateChanged.up} ↓${result.estimateChanged.down}) ===`);
  for (const r of result.estimateChanged.rows.slice(0, 20)) {
    console.log(`  ${r.name}(${r.id}) [${r.action}]: ${r.fromEstimate ?? "null"} → ${r.toEstimate ?? "null"}`);
  }
  if (result.estimateChanged.rows.length > 20) console.log(`  … 외 ${result.estimateChanged.rows.length - 20}건`);

  console.log(`\n=== 한쪽에만 있는 id === before 없음(after 신규): ${result.onlyAfter} · after 없음(before 에만 있던): ${result.onlyBefore}`);

  console.log("\n=== breaker 전후 ===");
  console.log(`  before: ${JSON.stringify(result.breakerBefore)}`);
  console.log(`  after:  ${JSON.stringify(result.breakerAfter)}`);
}

export async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  if (args.length < 2) {
    console.error("사용법: node scripts/compare-unsold-impact.mjs <before.json> <after.json> [--out=<경로>]");
    process.exit(1);
    return;
  }
  const [beforePath, afterPath] = args;

  /** @type {ImpactFile} */
  let before;
  /** @type {ImpactFile} */
  let after;
  try {
    before = JSON.parse(readFileSync(beforePath, "utf8"));
    after = JSON.parse(readFileSync(afterPath, "utf8"));
  } catch (e) {
    console.error(`파일 읽기 실패: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
    return;
  }

  const result = compareImpact(before, after);
  printReport(result);

  if (outArg) {
    const outPath = outArg.slice("--out=".length);
    writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2), "utf8");
    console.log(`\n[OUT] 결과 저장: ${outPath}`);
  }

  return result;
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((/** @type {unknown} */ err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
