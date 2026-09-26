// @ts-check
/**
 * cleanup-unsold-history-by-ids.mjs — id 명단으로 지정한 단지의 미분양 이력(`unsold_history`) 행을
 * 지우는 도구 (세션578).
 *
 * ## 왜 필요한가
 * 미분양 값을 비우거나 hold 로 보내도 `unsold_history` 는 남아, 상세 시세 탭 `UnsoldChart`(2행이면 그린다)가
 * 옛 추이를 그대로 보여 준다(세션577 검사관 C — 음성아이파크 318→280 2행이 첫 대상).
 * `.claude/rules/collectors/purge-to-recollect-timing.md` §3 "그 값의 이력을 그리는 자리도 본다".
 * 판정 로직은 없다 — 사람이 확정한 id 명단(`--ids-file`) 그대로.
 *
 * ## 안전장치 (`cleanup-unsold-by-ids.mjs` 와 같은 수준 — `.claude/rules/collectors/data-changing-run-approval.md`)
 *   1. dry-run 이 기본. 행 목록 표(id·apartment_id·base_month·unsold_count·post_completion_unsold)를 먼저 보여 주고
 *      `<ids-file>.history.before.<YYYYMMDD-HHmmss>.json`(행 전체 — 되돌릴 때는 그대로 INSERT)을 남긴다.
 *      같은 명단으로 여러 번 돌려도 사본을 덮어쓰지 않는다.
 *   2. `--apply` 는 반드시 `--from=<그 사본>` 을 요구한다. 사본의 행과 지금 DB 행을 `id` 로 맞대
 *      (apartment_id·base_month·unsold_count 가 같아야) 다르거나 없어진 행은 skip 한다. delete 는 사본에 있는
 *      `id` 로만 한다 — 사본 뒤에 새로 생긴 행은 지우지 않는다(경고로 알린다).
 *   3. 성공은 **돌아온 행**으로만 센다. 반영 직후 명단 단지의 이력을 다시 읽어 남은 행 0 을 확인하고,
 *      아니면 exit 1.
 *   4. ids 가 1,000 을 넘으면 즉시 exit 1(`.in()` 상한). 이력은 단지당 여러 행이라 id 묶음마다
 *      고유키(`id`) 커서로 읽는다(`unordered-pagination-loses-rows.md`).
 *
 * ## 사용법
 *   node scripts/cleanup-unsold-history-by-ids.mjs --ids-file=<id목록.json>                                   (dry-run)
 *   node scripts/cleanup-unsold-history-by-ids.mjs --ids-file=<id목록.json> --apply --from=<사본.json> --why="…"
 *
 * ⚠️ 파이프(`| tail`)를 붙이지 말 것 — SIGPIPE 로 중간에 죽는다
 *    (`.claude/rules/collectors/pipe-kills-collector.md`). 로그는 `> 파일 2>&1` 로 받는다.
 */
import { loadEnv, getSupabase, log, logError, selectAll } from "./collectors/_shared.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PHASE = "cleanup-unsold-history-by-ids";
const MAX_IDS = 1000;
const CHUNK = 200;
/** 사본 행과 DB 행이 "같은 행"이려면 같아야 하는 칸 */
const MATCH_KEYS = /** @type {const} */ (["apartment_id", "base_month", "unsold_count"]);

/**
 * @typedef {{ id: number; apartment_id: string; base_month: string; unsold_count: number | null; post_completion_unsold: number | null } & Record<string, any>} HistRow
 */

/**
 * `YYYYMMDD-HHmmss`
 * @param {Date} now
 * @returns {string}
 */
export function formatTimestamp(now) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * 사본 행과 지금 DB 행을 `id` 로 대조 — 같은 행만 삭제 대상으로 남긴다. 순수 함수.
 * @param {HistRow[]} snapRows
 * @param {HistRow[]} dbRows
 * @param {Set<string>} idSet `--ids-file` 명단(사본 행의 단지가 명단 밖이면 skip)
 * @returns {{ toDelete: HistRow[]; skipped: Array<{ id: number; reason: string }>; extra: HistRow[] }}
 */
export function checkHistorySet(snapRows, dbRows, idSet) {
  /** @type {Map<number, HistRow>} */
  const byId = new Map(dbRows.map((r) => [r.id, r]));
  const snapIds = new Set(snapRows.map((r) => r.id));
  /** @type {HistRow[]} */
  const toDelete = [];
  /** @type {Array<{ id: number; reason: string }>} */
  const skipped = [];
  for (const s of snapRows) {
    if (!idSet.has(s.apartment_id)) {
      skipped.push({ id: s.id, reason: `명단 밖 단지: ${s.apartment_id}` });
      continue;
    }
    const d = byId.get(s.id);
    if (!d) {
      skipped.push({ id: s.id, reason: "행 없음(사본 뒤 삭제됨)" });
      continue;
    }
    const diff = MATCH_KEYS.find((f) => (d[f] ?? null) !== (s[f] ?? null));
    if (diff) {
      skipped.push({ id: s.id, reason: `현재값 달라짐: ${diff} DB=${JSON.stringify(d[diff])} 사본=${JSON.stringify(s[diff])}` });
      continue;
    }
    toDelete.push(s);
  }
  const extra = dbRows.filter((r) => !snapIds.has(r.id));
  return { toDelete, skipped, extra };
}

/**
 * @param {string[]} argv
 * @param {string} name
 */
function argValue(argv, name) {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
}

/**
 * 명단 단지들의 이력 전체 — id 묶음마다 고유키 커서.
 * @param {any} sb
 * @param {string[]} ids
 * @returns {Promise<HistRow[]>}
 */
async function loadHistory(sb, ids) {
  /** @type {HistRow[]} */
  const all = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const rows = /** @type {HistRow[]} */ (await selectAll(
      (s) => s.from("unsold_history").select("*").in("apartment_id", chunk),
      sb,
      "id",
    ));
    all.push(...rows);
  }
  return all;
}

/**
 * 도구 본체 — 의존성 주입형. process.exit 를 부르지 않고 code 를 돌려준다.
 * @param {{
 *   argv: string[];
 *   sb: any;
 *   now?: Date;
 *   cwd?: string;
 *   readFile?: (p: string) => string;
 *   writeFile?: (p: string, s: string) => void;
 *   exists?: (p: string) => boolean;
 * }} deps
 * @returns {Promise<{ code: number; [k: string]: unknown }>}
 */
export async function run(deps) {
  const { argv, sb } = deps;
  const now = deps.now ?? new Date();
  const cwd = deps.cwd ?? process.cwd();
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const writeFile = deps.writeFile ?? ((p, s) => writeFileSync(p, s, "utf8"));
  const exists = deps.exists ?? ((p) => existsSync(p));

  const apply = argv.includes("--apply");
  const idsArg = argValue(argv, "ids-file");
  const fromArg = argValue(argv, "from");
  const why = argValue(argv, "why");

  if (!idsArg) {
    logError(PHASE, "--ids-file=<id목록.json> 필요");
    return { code: 1 };
  }
  if (apply && !fromArg) {
    logError(PHASE, "--apply 는 --from=<dry-run 이 만든 사본.json> 없이 실행할 수 없음");
    return { code: 1 };
  }
  const idsAbs = resolve(cwd, idsArg);
  if (!exists(idsAbs)) {
    logError(PHASE, `--ids-file 없음: ${idsAbs}`);
    return { code: 1 };
  }
  /** @type {string[]} */
  let ids;
  try {
    const j = /** @type {any} */ (JSON.parse(readFile(idsAbs)));
    const arr = Array.isArray(j) ? j : j?.ids;
    if (!Array.isArray(arr)) throw new Error(`--ids-file 형식 오류(문자열 배열 또는 {ids:[...]}): ${idsAbs}`);
    ids = [...new Set(arr.map((x) => (typeof x === "string" ? x : String(x?.id ?? ""))).filter(Boolean))];
  } catch (e) {
    logError(PHASE, e instanceof Error ? e.message : String(e));
    return { code: 1 };
  }
  if (ids.length > MAX_IDS) {
    logError(PHASE, `1,000 초과 — 나눠서 (${ids.length}건)`);
    return { code: 1 };
  }
  log(PHASE, apply ? "=== 실제 반영 모드 (--apply) ===" : "DRY-RUN — DB 변경 0 (반영하려면 --apply --from=<사본>)");
  if (why) log(PHASE, `사유: ${why}`);
  log(PHASE, `--ids-file 명단: ${ids.length}건`);

  const rows = await loadHistory(sb, ids);

  if (!apply) {
    log(PHASE, `\n=== 지울 이력 ${rows.length}행 ===`);
    for (const r of rows) {
      log(PHASE, `  id=${r.id} · ${r.apartment_id} · base_month=${r.base_month} · unsold_count=${r.unsold_count ?? "null"} · post_completion_unsold=${r.post_completion_unsold ?? "null"}`);
    }
    const noHist = ids.filter((id) => !rows.some((r) => r.apartment_id === id));
    if (noHist.length) log(PHASE, `  이력 없는 단지 ${noHist.length}곳: ${noHist.slice(0, 20).join(", ")}${noHist.length > 20 ? " …" : ""}`);
    const ts = formatTimestamp(now);
    const beforePath = `${idsAbs}.history.before.${ts}.json`;
    if (exists(beforePath)) {
      logError(PHASE, `사본이 이미 있음(덮어쓰지 않는다): ${beforePath} — 1초 뒤 다시 돌릴 것`);
      return { code: 1 };
    }
    writeFile(beforePath, JSON.stringify({
      generatedAt: now.toISOString(), idsFile: idsArg, why,
      note: "되돌릴 때: rows 를 그대로 unsold_history 에 INSERT 한다(id 포함).",
      rows,
    }, null, 2));
    log(PHASE, `\n[BEFORE] 사본 저장: ${beforePath}`);
    log(PHASE, `=== DRY-RUN 종료 — 반영 대상 ${rows.length}행. 실행하려면 --apply --from=${beforePath} ===`);
    return { code: 0, rows: rows.length, beforePath };
  }

  /** @type {any} */
  let snap;
  try {
    snap = JSON.parse(readFile(resolve(cwd, /** @type {string} */ (fromArg))));
  } catch (e) {
    logError(PHASE, `--from 사본 읽기 실패: ${e instanceof Error ? e.message : String(e)}`);
    return { code: 1 };
  }
  /** @type {HistRow[]} */
  const snapRows = Array.isArray(snap?.rows) ? snap.rows : [];
  if (snapRows.length === 0) {
    logError(PHASE, `--from 사본에 rows 가 없음: ${fromArg}`);
    return { code: 1 };
  }

  const { toDelete, skipped, extra } = checkHistorySet(snapRows, rows, new Set(ids));
  if (skipped.length) {
    log(PHASE, `\n=== 사본과 달라 건너뜀 ${skipped.length}행 ===`);
    for (const s of skipped) log(PHASE, `  [skip] id=${s.id}: ${s.reason}`);
  }
  if (extra.length) {
    log(PHASE, `⚠️ 사본 뒤 새로 생긴 이력 ${extra.length}행 — 지우지 않는다(다시 dry-run 할 것): ${extra.map((r) => r.id).join(", ")}`);
  }

  let ok = 0;
  let fail = 0;
  const delIds = toDelete.map((r) => r.id);
  for (let i = 0; i < delIds.length; i += CHUNK) {
    const chunk = delIds.slice(i, i + CHUNK);
    const { data, error } = await sb.from("unsold_history").delete().in("id", chunk).select("id");
    if (error) {
      logError(PHASE, `삭제 실패(${chunk.length}행 묶음): ${error.message}`);
      fail += chunk.length;
      continue;
    }
    const n = (data ?? []).length; // 돌아온 행으로만 센다
    ok += n;
    fail += chunk.length - n;
  }
  log(PHASE, `\n=== 반영 완료: 삭제 ${ok} / 실패 ${fail} / 건너뜀 ${skipped.length} ===`);

  const left = await loadHistory(sb, ids);
  log(PHASE, `[검증] 명단 단지의 남은 이력: ${left.length}행 (기대 0)`);
  const code = left.length === 0 && fail === 0 ? 0 : 1;
  if (code !== 0) logError(PHASE, "남은 이력이 있거나 실패가 있음 — 위 skip·실패 줄을 확인할 것");
  return { code, ok, fail, skipped: skipped.length, extra: extra.length, left: left.length };
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  loadEnv();
  run({ argv: process.argv.slice(2), sb: getSupabase() })
    .then((r) => { process.exitCode = r.code; })
    .catch((/** @type {unknown} */ err) => {
      logError(PHASE, err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
