// @ts-check
/**
 * cleanup-unsold-by-ids.mjs — id 명단으로 지정한 단지의 미분양 4칸(unsold·unsold_rate·
 * unsold_source·unsold_as_of)을 NULL 로 비우는 도구 (세션576, 검사관 지적 반영판).
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
 * ## 안전장치 (검사관 3건 반영 — `.claude/rules/collectors/data-changing-run-approval.md` "전이표로 승인")
 *   1. `--ids-file` 로 조회한 행을 콘솔에 전이표(현재값 → NULL)로 먼저 보여준다.
 *   2. dry-run 은 **타임스탬프가 박힌** 사본(`<ids-file 이름>.before.<YYYYMMDD-HHmmss>.json`)과
 *      역계획(`…restore.<ts>.json` — id 별 옛 4칸 값, 사람이 되돌릴 때 참조)을 함께 남긴다.
 *      같은 명단으로 여러 번 dry-run 을 돌려도 이전 사본을 덮어쓰지 않는다.
 *   3. `--apply` 는 **반드시 `--from=<dry-run 이 만든 사본.json>`** 을 요구한다(없으면 exit 1).
 *      사본에 적힌 4칸 값과 **지금 DB 값이 완전히 같은 행만** UPDATE 하고, 다르면
 *      "현재값 달라짐: <칸> DB=<x> 사본=<y>" 로 skip 한다 — dry-run 시점과 반영 시점 사이에
 *      다른 수집기·정리 스크립트가 그 행을 건드렸으면 조용히 덮어쓰지 않는다
 *      (`backfill-unsold-source.mjs` 의 expect 대조와 같은 원리).
 *   4. `--apply` 일 때만 행마다 UPDATE 하고, **돌아온 행으로만** 성공을 센다(보낸 수로 세지
 *      않는다 — `feedback_count_results_not_sent.md`).
 *   5. 반영 직후 같은 ids 를 다시 읽어 4칸이 전부 NULL 인 행 수를 찍는다(기대 = 반영된 ids 수).
 *   6. ids 가 1,000 을 넘으면 즉시 exit 1(Supabase 단일 `.in()` 은 조회 상한이 있어 뒤가
 *      조용히 잘린다 — `.claude/rules/collectors/unordered-pagination-loses-rows.md`). `.in()`
 *      결과 행 수가 ids 수보다 적으면 "명단에 없음" 으로 세되 요약 **첫 줄**에 경고를 낸다
 *      (조용히 skip 표로만 묻히지 않게).
 *
 * ## 사용법
 *   node scripts/cleanup-unsold-by-ids.mjs --ids-file=<id목록.json>                        (dry-run — 사본·역계획 생성)
 *   node scripts/cleanup-unsold-by-ids.mjs --ids-file=<id목록.json> --apply --from=<사본.json>
 *   node scripts/cleanup-unsold-by-ids.mjs --ids-file=<id목록.json> --apply --from=<사본.json> --why="검사관 지적 오염값"
 *
 * ⚠️ 파이프(`| tail`)를 붙이지 말 것 — SIGPIPE 로 중간에 죽는다
 *    (`.claude/rules/collectors/pipe-kills-collector.md`).
 */
import { loadEnv, getSupabase, log, logError, createSemaphore } from "./collectors/_shared.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

loadEnv();

const PHASE = "cleanup-unsold-by-ids";
const ROOT = process.cwd();
const CLEAR_FIELDS = /** @type {const} */ (["unsold", "unsold_rate", "unsold_source", "unsold_as_of"]);
const MAX_IDS = 1000;

/**
 * @typedef {{ id: string; name: string | null; presale_type: string | null; unsold: number | null; unsold_rate: number | null; unsold_source: string | null; unsold_as_of: string | null }} AptRow
 * @typedef {{ id: string; name: string | null; unsold: number | null; unsold_rate: number | null; unsold_source: string | null; unsold_as_of: string | null }} SnapshotRow
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

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function valuesEqual(a, b) {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return a === b;
}

/**
 * `--from` 사본(dry-run 이 만든 clearRows 스냅샷)과 지금 DB 값을 대조해, 사본 시점과
 * 여전히 같은 행만 반영 대상으로 남긴다. DB 접근 없는 순수 함수(검사관 지적 1).
 *
 * @param {SnapshotRow[]} snapshotRows `--from` 사본의 clearRows(그때의 4칸 값)
 * @param {AptRow[]} dbRows 지금 DB 에서 다시 조회한 같은 id 들의 행
 * @returns {{
 *   toApply: SnapshotRow[];
 *   staleSkipped: Array<{ id: string; name: string | null; reason: string }>;
 * }}
 */
export function checkCurrentValues(snapshotRows, dbRows) {
  /** @type {Map<string, AptRow>} */
  const byId = new Map(dbRows.map((r) => [r.id, r]));
  /** @type {SnapshotRow[]} */
  const toApply = [];
  /** @type {Array<{ id: string; name: string | null; reason: string }>} */
  const staleSkipped = [];

  for (const snap of snapshotRows) {
    const db = byId.get(snap.id);
    if (!db) {
      staleSkipped.push({ id: snap.id, name: snap.name, reason: "현재값 달라짐: 행 없음(그 사이 삭제되었거나 조회 안 됨)" });
      continue;
    }
    let mismatch = /** @type {string | null} */ (null);
    for (const f of CLEAR_FIELDS) {
      if (!valuesEqual(db[f], snap[f])) {
        mismatch = `현재값 달라짐: ${f} DB=${JSON.stringify(db[f])} 사본=${JSON.stringify(snap[f])}`;
        break;
      }
    }
    if (mismatch) {
      staleSkipped.push({ id: snap.id, name: snap.name, reason: mismatch });
      continue;
    }
    toApply.push(snap);
  }

  return { toApply, staleSkipped };
}

/**
 * 사본 파일 경로에 타임스탬프를 박는다(검사관 지적 2 — 같은 명단으로 여러 번 dry-run 해도
 * 이전 사본을 덮어쓰지 않는다). `YYYYMMDD-HHmmss`.
 * @param {Date} now
 * @returns {string}
 */
export function formatTimestamp(now) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export async function main() {
  const apply = process.argv.includes("--apply");
  const idsFileArg = process.argv.find((a) => a.startsWith("--ids-file="));
  const whyArg = process.argv.find((a) => a.startsWith("--why="));
  const fromArg = process.argv.find((a) => a.startsWith("--from="));
  if (!idsFileArg) {
    logError(PHASE, "--ids-file=<id목록.json> 필요");
    process.exit(1);
    return;
  }
  const idsFilePath = idsFileArg.slice("--ids-file=".length);
  const why = whyArg ? whyArg.slice("--why=".length) : null;

  // 검사관 지적 1 — --apply 는 반드시 --from(사본)을 요구한다.
  if (apply && !fromArg) {
    logError(PHASE, "--apply 는 --from=<dry-run 이 만든 사본.json> 없이 실행할 수 없음");
    process.exit(1);
    return;
  }

  log(PHASE, apply ? "=== 실제 반영 모드 (--apply) ===" : "DRY-RUN — DB 변경 0 (반영하려면 --apply --from=<사본>)");
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

  // 검사관 지적 3 — 1,000 초과는 Supabase .in() 이 조용히 자를 수 있으므로 즉시 거부.
  if (ids.length > MAX_IDS) {
    logError(PHASE, `1,000 초과 — 나눠서 (${ids.length}건)`);
    process.exit(1);
    return;
  }

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

  // 검사관 지적 3 — .in() 결과 행 수가 ids 수보다 적으면 요약 첫 줄에 경고.
  if (rows.length < ids.length) {
    log(PHASE, `⚠️ 경고: --ids-file 명단 ${ids.length}건 중 DB 조회 결과 ${rows.length}건만 돌아옴(나머지는 "명단에 없음"으로 처리)`);
  }

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

  if (!apply) {
    // 검사관 지적 2 — 타임스탬프 사본 + 역계획을 함께 저장한다.
    const ts = formatTimestamp(new Date());
    const beforePath = `${idsFilePath}.before.${ts}.json`;
    const restorePath = `${idsFilePath}.restore.${ts}.json`;
    writeFileSync(beforePath, JSON.stringify({
      generatedAt: new Date().toISOString(), idsFile: idsFilePath, why,
      clearRows, skipRows,
    }, null, 2), "utf8");
    // 역계획 — id 별 옛 4칸 값(사람이 되돌릴 때 그대로 UPDATE 에 쓸 수 있는 형태).
    const restorePlan = clearRows.map((r) => ({
      id: r.id, name: r.name,
      restore: { unsold: r.unsold, unsold_rate: r.unsold_rate, unsold_source: r.unsold_source, unsold_as_of: r.unsold_as_of },
    }));
    writeFileSync(restorePath, JSON.stringify({
      generatedAt: new Date().toISOString(), idsFile: idsFilePath, note: "되돌릴 때 이 restore 값을 그대로 UPDATE 하면 된다",
      plan: restorePlan,
    }, null, 2), "utf8");
    log(PHASE, `\n[BEFORE] 사본 저장: ${beforePath}`);
    log(PHASE, `[RESTORE] 역계획 저장: ${restorePath}`);
    log(PHASE, `\n=== DRY-RUN 종료 — 반영 대상 ${clearRows.length}건. 실행하려면 --apply --from=${beforePath} ===`);
    return { clearCount: clearRows.length, skipCount: skipRows.length, beforePath, restorePath };
  }

  // --apply — --from 사본을 읽어 지금 DB 값과 대조(검사관 지적 1).
  const fromPath = /** @type {string} */ (fromArg).slice("--from=".length);
  /** @type {{ clearRows?: SnapshotRow[] }} */
  let snapshotFile;
  try {
    snapshotFile = JSON.parse(readFileSync(resolve(ROOT, fromPath), "utf8"));
  } catch (e) {
    logError(PHASE, `--from 사본 읽기 실패: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
    return;
  }
  const snapshotRows = snapshotFile.clearRows ?? [];
  if (!Array.isArray(snapshotRows) || snapshotRows.length === 0) {
    logError(PHASE, `--from 사본에 clearRows 가 없음: ${fromPath}`);
    process.exit(1);
    return;
  }

  const { toApply, staleSkipped } = checkCurrentValues(snapshotRows, rows);
  if (staleSkipped.length > 0) {
    log(PHASE, `\n=== 현재값 달라짐(사본 시점 이후 변경됨) — 건너뜀 ${staleSkipped.length}건 ===`);
    for (const s of staleSkipped.slice(0, 20)) log(PHASE, `  [skip] ${s.name ?? s.id}(${s.id}): ${s.reason}`);
    if (staleSkipped.length > 20) log(PHASE, `  … 외 ${staleSkipped.length - 20}건`);
  }

  const limit = createSemaphore(10);
  /** @type {string[]} */
  const okIds = [];
  let fail = 0;
  await Promise.all(toApply.map((r) => limit(async () => {
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

  log(PHASE, `\n=== 반영 완료: 성공 ${okIds.length} / 실패 ${fail} / 현재값 달라짐(건너뜀) ${staleSkipped.length} ===`);

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

  return { clearCount: clearRows.length, skipCount: skipRows.length, ok: okIds.length, fail, staleSkipped: staleSkipped.length };
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((/** @type {unknown} */ err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
