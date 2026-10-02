// @ts-check
/**
 * 묶음 열쇠 칸(`apartments.complex_key`)을 채운다 — "한 단지 = 한 장" 가) 단계
 * (설계서 docs/superpowers/specs/2026-10-01-one-complex-one-card.md §4-7 (6))
 *
 * ## 무엇을 하나
 * 전 행을 읽어 `_same-complex.mjs` `assignComplexKeys` 로 열쇠를 계산하고, **지금 칸과 다른 행만** 고친다.
 * 칸은 VIEW(SQL)가 읽으려는 사본이다 — 규칙은 `_same-complex.mjs` 한 곳에만 있다.
 *
 * ## 왜 매일 도나
 * 블록 표기는 "같은 뼈대 이름 안에 서로 다른 블록 무리가 둘 이상일 때만" 열쇠에 들어간다. 새 블록 공고가
 * 하나 들어오면 **이미 있던 형제 행의 열쇠도 바뀐다.** 그래서 행을 넣는 수집기가 그 행만 채우는 방식으로는
 * 안 되고, 전 행을 다시 계산하는 이 배치가 매일 굽기(daily-deploy) 앞에서 돈다.
 *
 * ## 안전장치 (전부 "쓰지 않고 실패로 끝난다" — 쓰기 실행이면 collector_runs 에 failure 1행. 감시 ⑬ 이 실패 기록을 보고,
 *    일부 행만 실패한 날(10% 미만)·기록 없이 죽은 날은 감시 ⑭(빈 칸·마지막 성공 36시간)가 잡는다)
 * - 받은 행 수 ≠ 표의 행 수(부분 조회로 계산하면 묶음 맥락이 통째로 틀어진다) → `KEY_COUNT_MISMATCH`
 * - 한 묶음에 임대·분양이나 시도가 섞임(예외 명단을 잘못 적은 경우) → `KEY_MIXED`
 * - 매일 자동 실행(`--apply`): 이미 열쇠가 있던 행이 `CHANGE_BREAKER_MAX_ROWS` 행 넘게 또는
 *   `CHANGE_BREAKER_RATIO` 넘게 바뀜, 또는 빈칸을 채우는 행이 이미 열쇠가 있던 행보다 많음(첫 채우기·칸이 비워진 날)
 *   → `KEY_BREAKER`. 한도를 넘는 반영은 사람이 승인한 계획 파일로만 한다.
 * - 사람이 승인한 반영(`--apply-from=<계획 파일>` — 첫 채우기·규칙을 바꾼 날): 다시 계산한 계획이 승인한 계획
 *   파일과 **id·이전 값·새 값까지 전부 같을 때만** 쓴다 → 다르면 `KEY_PLAN_MISMATCH`.
 *   (개수만 맞추는 승인은 내용이 달라져도 통과한다 — 그래서 개수 인자는 두지 않았다.)
 * - 쓸 때도 **이전 값이 그대로인 행만** 고친다(그 사이 남이 바꾼 행은 0행이 돌아와 실패로 센다).
 * - 미리보기가 기본이다. `--apply` 또는 `--apply-from` 이 있어야 쓴다.
 *
 * ## 사용법
 *   node scripts/collectors/assign-complex-keys.mjs                              # 미리보기
 *   node scripts/collectors/assign-complex-keys.mjs --out=<절대경로.json>          # 미리보기 + 계획 파일(전이표 재료 — 줄마다 이름·시도·구)
 *   node scripts/collectors/assign-complex-keys.mjs --apply-from=<절대경로.json>   # 승인한 계획 파일과 같을 때만 반영
 *   node scripts/collectors/assign-complex-keys.mjs --apply                      # 바뀐 행만 UPDATE(매일 굽기 앞 단계)
 * `--out` 은 미리보기에서만 준다 — `--apply-from` 과도(같은 경로면 승인 파일을 지금 계획으로 덮어쓴 뒤 그것과 맞대게 된다)
 * `--apply` 와도 같이 줄 수 없다. `--out` 경로에 파일이 이미 있으면 DB 를 보기 전에 던진다(승인했을 수 있는 파일을 덮지 않는다 — 새 이름으로).
 * 위 셋 말고 다른 인자는 받지 않는다(`--dry-run` 포함 — 주면 던진다. 미리보기는 인자 없이).
 * 쓰다가 일부 행이 실패하면 기록의 머리말은 `KEY_WRITE`. 중단 신호를 받으면 partial 기록(수동 취소 등 — 다음 실행이 이어서 채운다).
 * 단계 시간 한도에 걸리면 기록 없이 죽을 수 있다(레포 규칙 `collector-timeout-rootcause-analysis.md`: 한도 도달 = 유예 0).
 *
 * ⚠️ 선행: `supabase/migrations/20261002000000_apartments_complex_key.sql` 적용.
 */
import { loadEnv, log, logError, getSupabase, selectAll, recordCollectorRun, createReporter, sleep } from "./_shared.mjs";
import { assignComplexKeys, parseComplexExceptions, missingExceptionIds, findMixedBundles } from "./_same-complex.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

loadEnv();

const PHASE = "assign-complex-keys";
const __dirname = dirname(fileURLToPath(import.meta.url));
const EXCEPTIONS_PATH = join(resolve(__dirname, "..", ".."), "docs", "audits", "same-complex-exceptions.json");

/** 이미 열쇠가 있던 행 중 이 비율 넘게 바뀌면 쓰지 않는다(표가 작을 때의 한도). */
export const CHANGE_BREAKER_RATIO = 0.1;
/**
 * 이미 열쇠가 있던 행이 이 수 넘게 바뀌면 쓰지 않는다(평소 한도). 2026-06~09 흉내에서 새 행 때문에 기존 행 열쇠가
 * 바뀐 수는 하루 최대 14 였다(세션588 검사관 C `probe-c-breaker-sim.log`) — 그 두 배쯤으로 잡았다.
 */
export const CHANGE_BREAKER_MAX_ROWS = 30;
/** 공유 DB 에 한꺼번에 쏘지 않는다 — compute-scores 와 같은 값(세션527). */
export const UPDATE_CONCURRENCY = 5;
export const UPDATE_BATCH_DELAY_MS = 100;
/** 아침 브리핑이 읽는 경고 마커(`scripts/monitor-briefing.mjs` WARN_STEPS_MARKER) — 성공했지만 사람이 볼 것이 있을 때. */
export const WARN_MARKER_MISSING_EXCEPTION_IDS = "WARN_STEPS: exception-ids-missing";

/**
 * 지금 칸과 계산한 열쇠를 맞대 고칠 행을 뽑는다. DB 접근 없는 순수 함수.
 * @param {ReadonlyArray<{ id: string, complex_key?: string | null }>} rows
 * @param {ReadonlyMap<string, string>} keys `assignComplexKeys` 결과
 * @returns {{ updates: Array<{ id: string, prev: string | null, next: string }>, filled: number, changed: number, unchanged: number, hadKey: number }}
 *   filled = 빈칸 → 값 · changed = 값 → 다른 값 · hadKey = 이미 열쇠가 있던 행 수(차단기 분모)
 */
export function planKeyUpdates(rows, keys) {
  /** @type {Array<{ id: string, prev: string | null, next: string }>} */
  const updates = [];
  let filled = 0, changed = 0, unchanged = 0, hadKey = 0;
  for (const r of rows) {
    const next = keys.get(r.id);
    if (next == null || next === "") throw new Error(`열쇠가 계산되지 않은 행: ${r.id}`);
    const prev = r.complex_key ?? null;
    if (prev != null) hadKey++;
    if (prev === next) { unchanged++; continue; }
    if (prev == null) filled++;
    else changed++;
    updates.push({ id: r.id, prev, next });
  }
  return { updates, filled, changed, unchanged, hadKey };
}

/**
 * 차단기 판정(매일 자동 실행용). DB 접근 없는 순수 함수.
 * 바뀌는 행이 `CHANGE_BREAKER_MAX_ROWS` 를 넘거나 비율이 `CHANGE_BREAKER_RATIO` 를 넘으면 막는다.
 * 빈칸을 채우는 행(새 행)은 그 두 한도에 세지 않지만, **채우는 행이 이미 열쇠가 있던 행보다 많으면** 막는다 —
 * 첫 채우기이거나 칸이 비워진 상태라 승인한 계획 파일(`--apply-from`)로만 반영한다(세션589 검사관 A #4).
 * @param {{ changed: number, hadKey: number, filled: number }} counts
 * @returns {{ tripped: boolean, ratio: number, reason: string | null }}
 */
export function evaluateChangeBreaker({ changed, hadKey, filled }) {
  const ratio = hadKey > 0 ? changed / hadKey : 0;
  const overRows = changed > CHANGE_BREAKER_MAX_ROWS;
  const overRatio = ratio > CHANGE_BREAKER_RATIO;
  const overFill = filled > hadKey;
  const tripped = overRows || overRatio || overFill;
  /** @type {string[]} */
  const reasons = [];
  if (overRows || overRatio) {
    reasons.push(`열쇠가 바뀌는 행 ${changed}/${hadKey} = ${(ratio * 100).toFixed(1)}% — 한도(${CHANGE_BREAKER_MAX_ROWS}행 또는 ${CHANGE_BREAKER_RATIO * 100}%) 초과`);
  }
  if (overFill) {
    reasons.push(`빈칸을 채우는 행 ${filled} 이 이미 열쇠가 있던 행 ${hadKey} 보다 많음 — 첫 채우기이거나 칸이 비워진 상태(승인한 계획 파일로만 반영)`);
  }
  return {
    tripped,
    ratio,
    reason: tripped ? reasons.join(" · ") : null,
  };
}

/**
 * 다시 계산한 계획이 사람이 승인한 계획 파일과 **내용까지** 같은가(id·이전 값·새 값). DB 접근 없는 순수 함수.
 * 개수만 맞추면 그 사이 다른 행이 바뀐 반영을 통과시킨다 — 그래서 집합으로 맞댄다.
 * @param {ReadonlyArray<{ id: string, prev: string | null, next: string }>} current 지금 다시 계산한 계획
 * @param {unknown} approved 계획 파일(`--out`)의 `updates`
 * @returns {{ same: boolean, onlyCurrent: string[], onlyApproved: string[] }} 어긋난 줄은 `["id","이전","새"]` JSON 꼴
 */
export function comparePlanToApproved(current, approved) {
  if (!Array.isArray(approved)) throw new Error("승인한 계획 파일에 updates 배열이 없습니다");
  // JSON 배열로 줄을 만든다 — 구분자를 이어 붙이면 값에 그 글자가 든 다른 짝이 같은 줄이 되고, null 과 "" 도 섞인다.
  const line = (/** @type {{ id?: unknown, prev?: unknown, next?: unknown }} */ u) => JSON.stringify([u?.id ?? null, u?.prev ?? null, u?.next ?? null]);
  const cur = new Set(current.map(line));
  const app = new Set(approved.map(line));
  const onlyCurrent = [...cur].filter((x) => !app.has(x)).sort();
  const onlyApproved = [...app].filter((x) => !cur.has(x)).sort();
  return { same: onlyCurrent.length === 0 && onlyApproved.length === 0, onlyCurrent, onlyApproved };
}

/**
 * 실행 인자를 읽는다. 꼴이 틀리거나 같이 쓸 수 없는 조합이면 throw(DB 를 보기 전에 멈춘다).
 * @param {readonly string[]} argv
 * @returns {{ apply: boolean, applyFrom: string | null, out: string | null }} apply = 쓰기 실행인가(`--apply` 또는 `--apply-from`)
 */
export function parseArgs(argv) {
  // 아는 인자만 받는다(허용 목록). 모르는 인자를 흘려보내면 사고가 난다 — 예: `--dry-run` 을 붙이면
  // `recordCollectorRun` 이 기록을 건너뛰어(_shared.mjs), 실제로 쓰고도 collector_runs 에 아무것도 안 남는다.
  let applyFlag = false;
  /** @type {string | null} */
  let applyFrom = null;
  /** @type {string | null} */
  let out = null;
  /** @type {string[]} */
  const unknown = [];
  for (const a of argv.slice(2)) {
    if (a === "--apply") {
      applyFlag = true;
    } else if (a.startsWith("--apply-from")) {
      const m = /^--apply-from=(.+)$/.exec(a);
      if (!m) throw new Error(`--apply-from 에는 계획 파일 경로가 필요합니다: ${a}`);
      if (applyFrom != null) throw new Error("--apply-from 이 두 번 나왔습니다 — 승인한 계획 파일은 하나만 줍니다");
      applyFrom = m[1];
    } else if (a.startsWith("--out")) {
      const m = /^--out=(.+)$/.exec(a);
      if (!m) throw new Error(`--out 에는 저장할 파일 경로가 필요합니다: ${a}`);
      if (out != null) throw new Error("--out 이 두 번 나왔습니다");
      out = m[1];
    } else {
      unknown.push(a);
    }
  }
  if (unknown.length > 0) {
    throw new Error(`모르는 인자: ${unknown.join(" ")} — 쓸 수 있는 것은 --apply · --apply-from=<승인한 계획 파일> · --out=<파일> 뿐입니다(인자 없이 돌리면 미리보기. 한도를 넘는 반영은 --apply-from 으로만)`);
  }
  if (applyFrom != null && out != null) {
    throw new Error("--apply-from 과 --out 은 같이 줄 수 없습니다 — 승인한 계획 파일을 지금 계획으로 덮어쓴 뒤 그것과 맞대게 됩니다");
  }
  if (applyFlag && out != null) {
    throw new Error("--apply 와 --out 은 같이 줄 수 없습니다 — 계획 파일은 미리보기에서만 만듭니다");
  }
  return { apply: applyFlag || applyFrom != null, applyFrom, out };
}

/**
 * 쓰기 실행의 실패를 기록하고 종료 코드를 1 로 둔다. 미리보기(쓰기 아님)는 기록하지 않는다 —
 * 미리보기 기록이 남으면 감시가 그것을 실제 실행으로 읽는다.
 * @param {boolean} apply
 * @param {string} marker `KEY_…` 머리말
 * @param {string} why
 * @param {number} rowCount
 */
async function failRun(apply, marker, why, rowCount) {
  logError(PHASE, `${why} — 아무것도 쓰지 않았습니다`);
  if (apply) await recordCollectorRun(PHASE, { status: "failure", ok: 0, fail: 0, skip: rowCount, errorMessage: `${marker} ${why}` });
  process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv);
  const { apply, applyFrom } = args;
  const exceptions = parseComplexExceptions(JSON.parse(readFileSync(EXCEPTIONS_PATH, "utf8")));
  // 승인한 계획 파일은 DB 를 보기 전에 읽는다 — 없거나 깨졌으면 여기서 던져 main().catch 가 실패로 기록한다.
  /** @type {unknown} */
  let approvedUpdates = null;
  if (applyFrom != null) {
    approvedUpdates = /** @type {{ updates?: unknown }} */ (JSON.parse(readFileSync(applyFrom, "utf8")))?.updates;
    if (!Array.isArray(approvedUpdates)) throw new Error(`승인한 계획 파일에 updates 배열이 없습니다: ${applyFrom}`);
  }
  // 계획 파일은 새 이름으로만 만든다 — 있는 파일이면 DB 를 보기 전에 멈춘다(쓸 때도 flag wx).
  if (args.out != null && existsSync(args.out)) {
    throw new Error(`--out 파일이 이미 있습니다: ${args.out} — 승인했을 수 있는 계획 파일을 덮어쓰지 않는다 — 새 이름으로 다시 주세요`);
  }

  const sb = getSupabase();
  const rows = await selectAll(
    (s) => s.from("apartments").select("id,name,region,gu,lat,lng,presale_type,complex_key"),
    sb,
    "id",
  );
  const { count, error: countError } = await sb.from("apartments").select("id", { count: "exact", head: true });
  if (countError || count == null || count !== rows.length) {
    const why = `받은 행 ${rows.length} ≠ 표의 행 수 ${count ?? "알 수 없음"}${countError ? ` (${countError.message})` : ""} — 부분 조회로는 계산하지 않습니다`;
    await failRun(apply, "KEY_COUNT_MISMATCH", why, rows.length);
    return;
  }

  const keys = assignComplexKeys(rows, exceptions);
  const mixed = findMixedBundles(rows, keys);
  if (mixed.length > 0) {
    const why = `한 묶음에 임대·분양 또는 시도가 섞였습니다(예외 명단 확인) ${mixed.length}묶음 — 예: ${mixed.slice(0, 3).map((m) => `${m.why} [${m.ids.join(",")}]`).join(" / ")}`;
    await failRun(apply, "KEY_MIXED", why, rows.length);
    return;
  }
  const plan = planKeyUpdates(rows, keys);
  const bundles = new Set(keys.values()).size;
  const missing = missingExceptionIds(exceptions, new Set(rows.map((r) => r.id)));
  log(PHASE, `단지 ${rows.length}행 → 묶음 ${bundles}개 | 빈칸→값 ${plan.filled} · 값→다른 값 ${plan.changed} · 그대로 ${plan.unchanged}`);
  if (missing.length > 0) log(PHASE, `예외 명단의 id 중 표에 없는 것 ${missing.length}건: ${missing.join(", ")}`);

  if (args.out != null) {
    // 줄마다 이름·시도·구를 덧붙인다 — 검사관은 DB 를 못 보므로 묶음 명단을 이 파일만으로 읽어야 한다(대조는 id·이전·새 값 세 칸만).
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const readable = plan.updates.map((u) => {
      const r = rowById.get(u.id);
      return { ...u, name: r?.name ?? null, region: r?.region ?? null, gu: r?.gu ?? null };
    });
    writeFileSync(args.out, JSON.stringify({ takenAt: new Date().toISOString(), rows: rows.length, bundles, filled: plan.filled, changed: plan.changed, unchanged: plan.unchanged, missingExceptionIds: missing, updates: readable }, null, 1) + "\n", { flag: "wx" });
    log(PHASE, `계획 파일 저장: ${args.out}`);
  }

  const breaker = evaluateChangeBreaker(plan);
  const nameById = new Map(rows.map((r) => [r.id, r.name]));
  for (const u of plan.updates.filter((x) => x.prev != null).slice(0, 40)) {
    log(PHASE, `  바뀜 ${u.id} | ${nameById.get(u.id) ?? ""} | ${u.prev} → ${u.next}`);
  }

  if (!apply) {
    if (breaker.tripped) log(PHASE, `⚠ 매일 자동 실행이면 차단기에 걸립니다(${breaker.reason}) — 명단을 확인하고 승인받은 뒤 --apply-from=<이 계획 파일> 로 반영`);
    log(PHASE, "미리보기 종료 — 아무것도 쓰지 않았습니다");
    return;
  }
  if (applyFrom != null) {
    // 사람이 승인한 반영 — 승인한 계획 파일과 내용이 전부 같을 때만 쓴다(같으면 차단기는 보지 않는다. 그 계획이 곧 승인이다).
    const cmp = comparePlanToApproved(plan.updates, approvedUpdates);
    if (!cmp.same) {
      const why = `승인한 계획 파일과 지금 계획이 다릅니다 — 지금만 있는 줄 ${cmp.onlyCurrent.length} · 파일에만 있는 줄 ${cmp.onlyApproved.length}. 미리보기를 다시 떠서 승인받으세요`;
      for (const l of [...cmp.onlyCurrent.slice(0, 10), ...cmp.onlyApproved.slice(0, 10)]) log(PHASE, `  어긋남 ${l}`);
      await failRun(apply, "KEY_PLAN_MISMATCH", why, rows.length);
      return;
    }
    log(PHASE, `승인한 계획 파일과 일치(${plan.updates.length}행) — 반영합니다`);
  } else if (breaker.tripped) {
    await failRun(apply, "KEY_BREAKER", `차단기 발동: ${breaker.reason}`, rows.length);
    return;
  }

  const rpt = createReporter(PHASE);
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < plan.updates.length; i += UPDATE_CONCURRENCY) {
    if (rpt.interrupted()) {
      log(PHASE, `중단 신호 — ${ok}행까지 반영하고 멈춥니다`);
      break;
    }
    if (i > 0) await sleep(UPDATE_BATCH_DELAY_MS);
    const results = await Promise.all(
      plan.updates.slice(i, i + UPDATE_CONCURRENCY).map((u) => {
        // 이전 값이 그대로인 행만 고친다 — 조회 뒤 남이 바꾼 행은 0행이 돌아와 아래에서 실패로 센다.
        const q = sb.from("apartments").update({ complex_key: u.next }).eq("id", u.id);
        return (u.prev == null ? q.is("complex_key", null) : q.eq("complex_key", u.prev)).select("id");
      }),
    );
    // 보낸 수가 아니라 돌아온 결과에서 센다 — 행이 사라졌거나 그 사이 바뀌어 0행이 돌아와도 실패로 센다.
    for (const r of results) {
      const res = /** @type {{ data?: unknown[] | null, error?: { message?: string } | null }} */ (r);
      if (res.error || !res.data || res.data.length === 0) {
        if (!fail) logError(PHASE, `업데이트 실패 예시: ${res.error?.message ?? "0행 반환(행이 없거나 그 사이 값이 바뀜)"}`);
        fail++;
      } else ok++;
    }
  }
  rpt.success(ok);
  if (fail) rpt.fail(fail);
  rpt.skip(plan.unchanged);
  // 쓰다가 실패한 행이 있으면 머리말 KEY_WRITE 로 남긴다. 실패 없이 끝났는데 예외 명단이 가리키는 행이 사라졌으면
  // 성공이어도 아침 브리핑에 뜨게 경고 마커를 남긴다(로그만으로는 아무도 못 본다).
  const writeNote = fail ? `KEY_WRITE ${fail}행 실패(0행 반환 포함)` : missing.length > 0 ? WARN_MARKER_MISSING_EXCEPTION_IDS : null;
  await recordCollectorRun(PHASE, { ...rpt.summary(), errorMessage: writeNote });
  log(PHASE, `완료 — 반영 ${ok}행${fail ? ` / 실패 ${fail}행` : ""}`);
  if (fail) process.exitCode = 1;
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) {
  main().catch(async (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    logError(PHASE, msg);
    // 쓰기 실행(--apply 또는 --apply-from)이 예외로 죽으면 실패로 기록한다. 인자 자체가 틀려 parseArgs 가 던진 경우도
    // 쓰려던 실행이면 남긴다(글자로 판정 — parseArgs 를 다시 부르면 또 던진다).
    // process.exit 를 부르지 않는다 — Windows 에서 fetch 뒤 exit 는 libuv 단언으로 127 이 된다(세션579).
    const wantedWrite = process.argv.some((a) => a === "--apply" || a.startsWith("--apply-from"));
    if (wantedWrite) await recordCollectorRun(PHASE, { status: "failure", ok: 0, fail: 1, skip: 0, errorMessage: `KEY_ERROR ${msg}` });
    process.exitCode = 1;
  });
}
