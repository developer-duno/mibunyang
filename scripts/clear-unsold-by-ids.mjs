// @ts-check
/**
 * clear-unsold-by-ids.mjs — id 명단으로 지정한 단지의 미분양 4칸(unsold·unsold_rate·
 * unsold_source·unsold_as_of)을 NULL 로 비우는 도구 (세션576).
 *
 * ## 왜 필요한가
 * `cleanup-listing-based-unsold.mjs`(세션559)는 "미분양이 총세대수보다 큰 행" 이라는 **판정
 * 조건**으로 대상을 자동으로 고른다. 이 도구는 그 반대로, 사람이 이미 어떤 이유로든 확정한
 * **id 명단**을 받아 그대로 비운다(예: 검사관·수동 검토로 특정 오염값을 확인한 경우).
 * 판정 로직이 없으므로 `--ids-file` 로 넘긴 id 만 대상이 된다.
 *
 * ## 사람 보류(hold) 행은 건드리지 않는다 (`.claude/rules/collectors/data-changing-run-approval.md`)
 * `unsold_source = 'hold'` 는 사람이 "자료 없음"을 확정한 행이고, DB 제약
 * (`apartments_unsold_hold_null_check`)이 이미 4칸 중 값 칸을 NULL 로 강제하고 있다. 이 도구가
 * `unsold_source` 까지 NULL 로 비우면 hold 표시 자체가 사라져 다음 KOSIS 회차가 그 행을
 * 다시 채운다(hold 해제는 `backfill-unsold-source.mjs` 의 `release_hold_*` op 로만 한다) —
 * 그래서 hold 행은 명단에 있어도 **skip** 으로 센다.
 *
 * ## 안전장치
 *   1. `--ids-file` 로 조회한 행을 콘솔에 전이표(현재값 → NULL)로 먼저 보여준다.
 *   2. `<ids-file 이름>.before.json` 에 지금 값의 사본을 저장한다(되돌릴 근거).
 *   3. `--apply` 없이는 DB 를 전혀 건드리지 않는다(dry-run 이 기본).
 *   4. `--apply` 일 때만 행마다 UPDATE 하고, **돌아온 행으로만** 성공을 센다(보낸 수로 세지
 *      않는다 — `feedback_count_results_not_sent.md`).
 *   5. 반영 직후 같은 ids 를 다시 읽어 4칸이 전부 NULL 인 행 수를 찍는다(기대 = 반영된 ids 수).
 *
 * ## 사용법
 *   node scripts/clear-unsold-by-ids.mjs --ids-file=<id목록.json>                (dry-run, 기본)
 *   node scripts/clear-unsold-by-ids.mjs --ids-file=<id목록.json> --apply
 *   node scripts/clear-unsold-by-ids.mjs --ids-file=<id목록.json> --apply --why="검사관 지적 오염값"
 *
 * ⚠️ 파이프(`| tail`)를 붙이지 말 것 — SIGPIPE 로 중간에 죽는다
 *    (`.claude/rules/collectors/pipe-kills-collector.md`).
 */
import { loadEnv, getSupabase, log, logError, createSemaphore } from "./collectors/_shared.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

loadEnv();

const PHASE = "clear-unsold-by-ids";
const ROOT = process.cwd();
const CLEAR_FIELDS = /** @type {const} */ (["unsold", "unsold_rate", "unsold_source", "unsold_as_of"]);

/**
 * @typedef {{ id: string; name: string | null; presale_type: string | null; unsold: number | null; unsold_rate: number | null; unsold_source: string | null; unsold_as_of: string | null }} AptRow
 */

/**
 * `--ids-file` 로 넘긴 JSON 에서 id 목록을 읽는다. 배열이거나 `{ids:[...]}` 둘 다 받는다.
 * DB·파일쓰기 없는 순수 함수(경로 해석만).
 * @param {string} p
 * @returns {string[]}
 */
export function readIdsFile(p) {
  const abs = resolve(ROOT, p);
  if (!existsSync(abs)) throw new Error(`--ids-file 없음: ${abs}`);
  const j = /** @type {any} */ (JSON.parse(readFileSync(abs, "utf8")));
  const arr = Array.isArray(j) ? j : j?.ids;
  if (!Array.isArray(arr)) throw new Error(`--ids-file 형식 오류(배열 또는 {ids:[...]}): ${abs}`);
  return arr.map((x) => (typeof x === "string" ? x : String(x?.id ?? ""))).filter(Boolean);
}

/**
 * id 명단과 DB 행으로 "무엇을 비울지" 계획을 만든다. DB 접근 없는 순수 함수.
 *   - ids 에 없는 id → skip("명단에 없음")
 *   - `unsold_source === "hold"` → skip("사람 보류(hold) — 건드리지 않음")
 *   - 4칸이 이미 전부 NULL → skip("이미 비어 있음")
 *   - 그 외 → clear(현재값 기록)
 *
 * @param {AptRow[]} rows DB 에서 조회한 행(ids 로 필터된 것)
 * @param {string[]} ids `--ids-file` 명단
 * @returns {{
 *   clearRows: Array<AptRow & { reason?: undefined }>;
 *   skipRows: Array<{ id: string; name: string | null; reason: string }>;
 * }}
 */
export function buildClearPlan(rows, ids) {
  /** @type {Map<string, AptRow>} */
  const byId = new Map(rows.map((r) => [r.id, r]));
  /** @type {Array<AptRow>} */
  const clearRows = [];
  /** @type {Array<{ id: string; name: string | null; reason: string }>} */
  const skipRows = [];

  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      skipRows.push({ id, name: null, reason: "명단에 없음(DB 에 그 id 행이 없거나 조회 결과에 포함되지 않음)" });
      continue;
    }
    if (row.unsold_source === "hold") {
      skipRows.push({ id, name: row.name, reason: "사람 보류(hold) — 건드리지 않음" });
      continue;
    }
    const allNull = CLEAR_FIELDS.every((f) => row[f] == null);
    if (allNull) {
      skipRows.push({ id, name: row.name, reason: "이미 비어 있음" });
      continue;
    }
    clearRows.push(row);
  }

  return { clearRows, skipRows };
}

export async function main() {
  const apply = process.argv.includes("--apply");
  const idsFileArg = process.argv.find((a) => a.startsWith("--ids-file="));
  const whyArg = process.argv.find((a) => a.startsWith("--why="));
  if (!idsFileArg) {
    logError(PHASE, "--ids-file=<id목록.json> 필요");
    process.exit(1);
    return;
  }
  const idsFilePath = idsFileArg.slice("--ids-file=".length);
  const why = whyArg ? whyArg.slice("--why=".length) : null;

  log(PHASE, apply ? "=== 실제 반영 모드 (--apply) ===" : "DRY-RUN — DB 변경 0 (반영하려면 --apply)");
  if (why) log(PHASE, `사유: ${why}`);

  let ids;
  try {
    ids = readIdsFile(idsFilePath);
  } catch (e) {
    logError(PHASE, e instanceof Error ? e.message : String(e));
    process.exit(1);
    return;
  }
  log(PHASE, `--ids-file 명단: ${ids.length}건`);

  const sb = getSupabase();
  const { data, error } = await sb
    .from("apartments")
    .select("id, name, presale_type, unsold, unsold_rate, unsold_source, unsold_as_of")
    .in("id", ids);
  if (error) {
    logError(PHASE, `apartments 조회 실패: ${error.message}`);
    process.exit(1);
    return;
  }
  const rows = /** @type {AptRow[]} */ (data ?? []);

  const { clearRows, skipRows } = buildClearPlan(rows, ids);

  log(PHASE, `\n=== 전이표(현재값 → NULL) — 비울 행 ${clearRows.length}건 ===`);
  for (const r of clearRows) {
    log(PHASE, `  ${r.name ?? r.id}(${r.id}) [${r.presale_type ?? "-"}]: unsold=${r.unsold ?? "null"}→null · unsold_rate=${r.unsold_rate ?? "null"}→null · unsold_source=${r.unsold_source ?? "null"}→null · unsold_as_of=${r.unsold_as_of ?? "null"}→null`);
  }
  log(PHASE, `\n=== skip(${skipRows.length}건) ===`);
  /** @type {Record<string, number>} */
  const skipByReason = {};
  for (const s of skipRows) skipByReason[s.reason] = (skipByReason[s.reason] ?? 0) + 1;
  for (const [reason, n] of Object.entries(skipByReason)) log(PHASE, `  ${reason}: ${n}건`);
  for (const s of skipRows.slice(0, 20)) log(PHASE, `  [skip] ${s.name ?? s.id}(${s.id}): ${s.reason}`);
  if (skipRows.length > 20) log(PHASE, `  … 외 ${skipRows.length - 20}건`);

  // 되돌릴 사본 — apply 여부와 무관하게 항상 저장한다(계획을 남겨야 반영 전 검토 가능).
  const beforePath = `${idsFilePath}.before.json`;
  writeFileSync(beforePath, JSON.stringify({
    generatedAt: new Date().toISOString(), idsFile: idsFilePath, why,
    clearRows, skipRows,
  }, null, 2), "utf8");
  log(PHASE, `\n[BEFORE] 되돌릴 사본 저장: ${beforePath}`);

  if (!apply) {
    log(PHASE, `\n=== DRY-RUN 종료 — 반영 대상 ${clearRows.length}건. 실행하려면 --apply ===`);
    return { clearCount: clearRows.length, skipCount: skipRows.length };
  }

  const limit = createSemaphore(10);
  /** @type {string[]} */
  const okIds = [];
  let fail = 0;
  await Promise.all(clearRows.map((r) => limit(async () => {
    const { data: updated, error: updErr } = await sb
      .from("apartments")
      .update({ unsold: null, unsold_rate: null, unsold_source: null, unsold_as_of: null })
      .eq("id", r.id)
      .select("id");
    if (updErr) {
      logError(PHASE, `${r.id}: ${updErr.message}`);
      fail++;
      return;
    }
    // 성공은 돌아온 행으로만 센다(보낸 수 아님) — feedback_count_results_not_sent 짝 규칙.
    if (updated && updated.length > 0) okIds.push(r.id);
    else fail++;
  })));

  log(PHASE, `\n=== 반영 완료: 성공 ${okIds.length} / 실패 ${fail} ===`);

  // 반영 직후 재조회 — 4칸이 전부 NULL 인 행 수(기대 = okIds.length).
  if (okIds.length > 0) {
    const { data: verifyData, error: verifyErr } = await sb
      .from("apartments")
      .select("id, unsold, unsold_rate, unsold_source, unsold_as_of")
      .in("id", okIds);
    if (verifyErr) {
      logError(PHASE, `반영 후 검증 조회 실패: ${verifyErr.message}`);
    } else {
      const verifyRows = /** @type {AptRow[]} */ (verifyData ?? []);
      const allNullCount = verifyRows.filter((r) => CLEAR_FIELDS.every((f) => r[f] == null)).length;
      log(PHASE, `[검증] 4칸 전부 NULL 인 행: ${allNullCount} / ${okIds.length}(기대)`);
      if (allNullCount !== okIds.length) {
        logError(PHASE, `검증 불일치 — 일부 행이 NULL 이 아님(경합 또는 트리거 개입 가능)`);
      }
    }
  }

  return { clearCount: clearRows.length, skipCount: skipRows.length, ok: okIds.length, fail };
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((/** @type {unknown} */ err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
