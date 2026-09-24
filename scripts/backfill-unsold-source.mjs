// @ts-check
/**
 * backfill-unsold-source.mjs — unsold_source 일괄 정정 계획 파일 반영 (세션568)
 *
 * `apartments.unsold_source` 칸 신설 전에 이미 값이 박힌 862곳(KOSIS 가 쓴 값에 출처 표시가
 * 없음)과, 보존/보류 중이던 143곳(사장님 추가 결정: 135곳은 최신 KOSIS 추정치로 교체, 8곳은
 * 매물 유래 오염값이라 비움)을 **한 계획 파일**로 반영한다. 계획 파일은 메인이
 * `unsold_fix_plan.json` 으로 미리 만들어 두고, 이 스크립트는 그 계획의 각 행이 지금 DB 상태와
 * 여전히 맞는지(expect) 대조한 뒤에만 반영한다(set) — 계획을 세운 시점과 반영 시점 사이에 다른
 * 수집기·정리 스크립트가 그 행을 건드렸으면 조용히 덮어쓰지 않고 건너뛴다.
 *
 * ## 계획 파일 구조
 * ```json
 * { "counts": {...}, "keepApplyhome": [...],
 *   "plan": [{ "id": "...", "name": "...", "op": "mark_kosis|replace_kosis|clear_listing_hold",
 *              "expect": { "unsold": ..., "unsold_rate"?: ..., "unsold_source": ... },
 *              "set": {...} }] }
 * ```
 *
 * ## 판정 (순수 함수 checkPlanRow)
 * DB 에 그 id 행이 있고, `expect` 의 **모든 키**가 DB 값과 같을 때만 `ok: true`.
 *   - `expect` 의 키가 없으면(예: clear_listing_hold 의 unsold_rate) 그 필드는 비교하지 않는다.
 *   - null 은 null 과만 같다(엄격 비교).
 *   - 숫자는 `Number()` 로 비교(문자열 "8"과 숫자 8이 같게).
 *   - 불일치 사유: "행 없음" / "<필드>: DB=<x> expect=<y>"(여러 필드면 첫 불일치만 대표로).
 *
 * ## 세션569 — unsold_as_of(청약홈 값의 공고일) 도 expect·set 할 수 있다
 * 청약홈 값 만료 기준 C6 로 `apartments.unsold_as_of` 가 생겼다. 계획 행의 `expect` 에
 * `unsold_as_of`(보통 null — seed 가 이미 채웠으면 덮지 않게)를 넣을 수 있도록 조회 칸에 더했다.
 * `set` 은 원래 칸 제한이 없다. ⚠️ 이 칸은 마이그 20260924000500 적용 뒤에만 조회된다.
 *
 * ## 사용법
 *   node scripts/backfill-unsold-source.mjs --plan=<계획.json>                (dry-run, 기본)
 *   node scripts/backfill-unsold-source.mjs --plan=<계획.json> --apply        (실제 반영)
 *   node scripts/backfill-unsold-source.mjs --plan=<계획.json> --out=<결과.json>
 *
 * ⚠️ 파이프(`| tail`)를 붙이지 말 것 — SIGPIPE 로 중간에 죽는다
 *    (`.claude/rules/collectors/pipe-kills-collector.md`).
 */
import { loadEnv, getSupabase, log, logError, selectAll, createSemaphore } from "./collectors/_shared.mjs";
import { readFileSync, writeFileSync } from "node:fs";

loadEnv();

const PHASE = "backfill-unsold-source";

/**
 * @typedef {{ id: string; name?: string; op: string; expect: Record<string, unknown>; set: Record<string, unknown> }} PlanRow
 * @typedef {{ id: string; unsold: number | null; unsold_rate: number | null; unsold_source: string | null; unsold_as_of?: string | null }} DbRow
 */

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function valuesEqual(a, b) {
  if (a == null || b == null) return a == null && b == null; // null 은 null 과만 같다
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return a === b;
}

/**
 * 계획 한 행이 지금 DB 상태와 여전히 맞는지 판정한다. DB 접근 없는 순수 함수.
 *
 * @param {PlanRow} row
 * @param {DbRow | undefined} dbRow
 * @returns {{ ok: boolean; reason: string | null }}
 */
export function checkPlanRow(row, dbRow) {
  if (!dbRow) return { ok: false, reason: "행 없음" };
  for (const [key, expected] of Object.entries(row.expect ?? {})) {
    const actual = /** @type {Record<string, unknown>} */ (dbRow)[key];
    if (!valuesEqual(actual, expected)) {
      return { ok: false, reason: `${key}: DB=${JSON.stringify(actual)} expect=${JSON.stringify(expected)}` };
    }
  }
  return { ok: true, reason: null };
}

export async function main() {
  const apply = process.argv.includes("--apply");
  const planArg = process.argv.find((a) => a.startsWith("--plan="));
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  if (!planArg) {
    logError(PHASE, "--plan=<계획.json> 필요");
    process.exit(1);
    return;
  }
  const planPath = planArg.slice("--plan=".length);

  log(PHASE, apply ? "=== 실제 반영 모드 (--apply) ===" : "=== 미리보기 (dry-run) — 반영하려면 --apply ===");

  /** @type {{ counts?: Record<string, number>; keepApplyhome?: string[]; plan: PlanRow[] }} */
  let planFile;
  try {
    planFile = JSON.parse(readFileSync(planPath, "utf8"));
  } catch (e) {
    logError(PHASE, `계획 파일 읽기 실패: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
    return;
  }
  const rows = planFile.plan ?? [];

  const sb = getSupabase();
  const dbRowsRaw = await selectAll(
    (s) => s.from("apartments").select("id, unsold, unsold_rate, unsold_source, unsold_as_of"),
    sb,
    "id",
  );
  const dbRows = /** @type {DbRow[]} */ (dbRowsRaw);
  /** @type {Map<string, DbRow>} */
  const byId = new Map();
  for (const r of dbRows) byId.set(r.id, r);

  /** @type {Record<string, { pass: number; failByReason: Record<string, number> }>} */
  const summary = {};
  /** @type {Array<{ id: string; name?: string; op: string; reason: string }>} */
  const mismatches = [];
  /** @type {PlanRow[]} */
  const toApply = [];

  for (const row of rows) {
    if (!summary[row.op]) summary[row.op] = { pass: 0, failByReason: {} };
    const { ok, reason } = checkPlanRow(row, byId.get(row.id));
    if (ok) {
      summary[row.op].pass++;
      toApply.push(row);
    } else {
      const bucket = (reason ?? "unknown").split(":")[0]; // 사유별 집계는 필드명 기준으로 묶는다
      summary[row.op].failByReason[bucket] = (summary[row.op].failByReason[bucket] ?? 0) + 1;
      mismatches.push({ id: row.id, name: row.name, op: row.op, reason: reason ?? "unknown" });
    }
  }

  for (const [op, s] of Object.entries(summary)) {
    const failTotal = Object.values(s.failByReason).reduce((a, b) => a + b, 0);
    const failDetail = Object.entries(s.failByReason).map(([k, n]) => `${k}=${n}`).join(", ");
    log(PHASE, `[${op}] 통과 ${s.pass} · 불일치 ${failTotal}${failDetail ? ` (${failDetail})` : ""}`);
  }
  if (mismatches.length > 0) {
    log(PHASE, `불일치 명단 (최대 20건 표시):`);
    for (const m of mismatches.slice(0, 20)) {
      log(PHASE, `  [${m.op}] ${m.name ?? m.id}(${m.id}): ${m.reason}`);
    }
    if (mismatches.length > 20) log(PHASE, `  … 외 ${mismatches.length - 20}건`);
  }

  if (!apply) {
    log(PHASE, `\n=== 미리보기 종료 — 반영 대상 ${toApply.length}건. 실행하려면 --apply ===`);
    if (outArg) {
      const outPath = outArg.slice("--out=".length);
      writeFileSync(outPath, JSON.stringify({
        generatedAt: new Date().toISOString(), apply: false,
        applied: [], skipped: mismatches,
      }, null, 2), "utf8");
      log(PHASE, `[OUT] 결과 저장: ${outPath}`);
    }
    return { toApply: toApply.length, mismatches: mismatches.length, summary };
  }

  const limit = createSemaphore(10);
  /** @type {string[]} */
  const appliedIds = [];
  /** @type {Array<{ id: string; name?: string; op: string; reason: string }>} */
  const raceLost = [];
  let fail = 0;
  await Promise.all(toApply.map((row) => limit(async () => {
    // L3 — expect 의 각 키를 WHERE 절(.eq()/.is(null))에 그대로 붙여 경합 창을 닫는다.
    // 이 조회~적용 사이에 다른 프로세스가 값을 바꿨으면 UPDATE 가 0행을 매칭해 조용히
    // 아무것도 안 바꾼다 — dry-run 시점의 expect 만 믿고 덮어쓰지 않는다.
    /** @type {any} */
    let q = sb.from("apartments").update(row.set).eq("id", row.id);
    for (const [key, expected] of Object.entries(row.expect ?? {})) {
      q = expected == null ? q.is(key, null) : q.eq(key, expected);
    }
    const { data, error } = await q.select("id");
    if (error) { logError(PHASE, `${row.id}: ${error.message}`); fail++; return; }
    // 성공 수는 돌아온 행으로 센다(보낸 수 아님) — 짝 규칙(feedback_count_results_not_sent).
    // 돌아온 행 0 = WHERE 절(expect)이 지금 DB 와 더는 안 맞는다는 뜻 — 경합에서 진 것으로 센다.
    if (data && data.length > 0) appliedIds.push(row.id);
    else raceLost.push({ id: row.id, name: row.name, op: row.op, reason: "적용 시점 경합(expect 불일치)" });
  })));

  if (raceLost.length > 0) {
    log(PHASE, `경합에서 진 행(적용 시점에 이미 값이 바뀜, 건너뜀): ${raceLost.length}건`);
    for (const r of raceLost.slice(0, 10)) log(PHASE, `  [${r.op}] ${r.name ?? r.id}(${r.id})`);
  }

  log(PHASE, `\n=== 반영 완료: 성공 ${appliedIds.length} · 실패 ${fail} · 경합에서 짐 ${raceLost.length} · 불일치(건너뜀) ${mismatches.length} ===`);

  if (outArg) {
    const outPath = outArg.slice("--out=".length);
    writeFileSync(outPath, JSON.stringify({
      generatedAt: new Date().toISOString(), apply: true,
      applied: appliedIds, skipped: [...mismatches, ...raceLost],
    }, null, 2), "utf8");
    log(PHASE, `[OUT] 결과 저장: ${outPath}`);
  }

  return { toApply: toApply.length, mismatches: mismatches.length, applied: appliedIds.length, fail, raceLost: raceLost.length, summary };
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((/** @type {unknown} */ err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
