// @ts-check
/**
 * 네이버 로컬 파이프라인(run-naver-local.bat) 완주 기록 CLI (세션570).
 *
 * 왜 필요한가: bat 은 6단계를 차례로 부르는데, 각 단계 수집기는 자기 행만 남기고
 * **"6단계를 다 끝냈다"는 기록은 어디에도 없었다.** 그래서 9/10·9/17·9/24 세 주 연속
 * 4~6단계를 못 끝냈는데(PC 재시작 = 예약 작업 결과 267014) 어느 감시도 울리지 않았다.
 * 이 스크립트가 bat 의 처음·끝·치명 실패 자리에서 불려 `collector_runs` 에
 * `naver-pipeline` 1행을 남기고, 감시 ⑤(stale 4일)가 그 행의 신선도를 본다.
 *
 * 하위명령
 *   start   시작 시각을 `.naver-pipeline-start.json`(저장소 루트, .gitignore)에 적는다.
 *           bat 의 `%date%` 는 로캘 의존이라 파싱하지 않는다 — 시각은 여기서 잰다.
 *   done    --collector=naver-pipeline --ok=<성공 단계 수> --skip=<경고 단계 수> [--warn=이름,이름]
 *           status "success" 1행. 경고가 있으면 error_message = "WARN_STEPS: 이름,이름".
 *   failed  --step=<N> --name=<단계명>
 *           status "failure" · ok = N-1(끝낸 단계 수) · fail 1 · error_message = "STEP_FAILED: N/6 이름".
 *
 * ⚠️ 무슨 일이 있어도 exit 0 — 기록 실패가 파이프라인을 죽이면 안 된다(`recordCollectorRun` 도 예외를 삼킨다).
 * ⚠️ `--dry-run` 이면 collector_runs 에 쓰지 않는다(기존 규칙, `_shared.mjs` recordCollectorRun).
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, recordCollectorRun } from "./collectors/_shared.mjs";

/** collector_runs 기록명 — 감시 ⑤ EXTERNAL_API_COLLECTORS 의 키와 정확히 같아야 한다(라벨 드리프트 가드가 이 PHASE 를 읽는다). */
const PHASE = "naver-pipeline";
export const PIPELINE_COLLECTOR = PHASE;
export const PIPELINE_TOTAL_STEPS = 6;
export const STAMP_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".naver-pipeline-start.json");

/**
 * @typedef {object} ParsedArgs
 * @property {"start"|"done"|"failed"|null} cmd 알 수 없는 하위명령이면 null
 * @property {string} collector
 * @property {number} ok
 * @property {number} skip
 * @property {string[]} warn
 * @property {number|null} step
 * @property {string} name
 * @property {boolean} dryRun
 */

/**
 * 정수 인자 — 숫자가 아니거나 음수면 기본값.
 * @param {string|undefined} v
 * @param {number} fallback
 */
function toCount(v, fallback) {
  if (v == null || !/^\d+$/.test(v.trim())) return fallback;
  return Number(v.trim());
}

/**
 * @param {string[]} argv process.argv.slice(2) 형태
 * @returns {ParsedArgs}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const opts = {};
  let cmd = null;
  let dryRun = false;
  for (const a of argv) {
    if (a === "--dry-run") { dryRun = true; continue; }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq === -1) opts[a.slice(2)] = "";
      else opts[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    if (cmd == null) cmd = a;
  }
  const known = cmd === "start" || cmd === "done" || cmd === "failed" ? cmd : null;
  const warn = (opts.warn ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const stepRaw = toCount(opts.step, -1);
  return {
    cmd: known,
    collector: (opts.collector ?? "").trim() || PIPELINE_COLLECTOR,
    ok: toCount(opts.ok, 0),
    skip: toCount(opts.skip, warn.length),
    warn,
    step: stepRaw >= 1 ? stepRaw : null,
    name: (opts.name ?? "").trim(),
    dryRun,
  };
}

/**
 * 시작 기록 파일을 읽는다. 없거나 깨졌으면 null(경과 시간을 모를 뿐 기록은 한다).
 * @param {string} stampPath
 * @returns {string|null} 시작 시각 ISO
 */
export function readStamp(stampPath) {
  try {
    if (!existsSync(stampPath)) return null;
    const j = JSON.parse(readFileSync(stampPath, "utf8"));
    const t = typeof j?.startedAt === "string" ? j.startedAt : null;
    return t && !Number.isNaN(new Date(t).getTime()) ? t : null;
  } catch {
    return null;
  }
}

/**
 * collector_runs 에 넣을 결과(recordCollectorRun 두 번째 인자)를 만든다. 순수 함수.
 * @param {ParsedArgs} args cmd 가 done/failed 여야 한다
 * @param {string|null} startedAt
 * @param {Date} now
 * @returns {{ collector: string, result: { status: string, ok: number, fail: number, skip: number, elapsed: number|null, startedAt: string|null, errorMessage: string|null } }}
 */
export function buildRunResult(args, startedAt, now) {
  const elapsed = startedAt ? Math.max(0, Math.round((now.getTime() - new Date(startedAt).getTime()) / 1000)) : null;
  if (args.cmd === "failed") {
    const step = args.step;
    return {
      collector: PHASE,
      result: {
        status: "failure",
        ok: step != null ? step - 1 : 0,
        fail: 1,
        skip: 0,
        elapsed,
        startedAt,
        errorMessage: `STEP_FAILED: ${step ?? "?"}/${PIPELINE_TOTAL_STEPS} ${args.name || "(이름 없음)"}`,
      },
    };
  }
  return {
    collector: PHASE,
    result: {
      status: "success",
      ok: args.ok,
      fail: 0,
      skip: args.skip,
      elapsed,
      startedAt,
      errorMessage: args.warn.length > 0 ? `WARN_STEPS: ${args.warn.join(",")}` : null,
    },
  };
}

/**
 * 하위명령 1회 실행. 시험은 stampPath·now·sb 를 주입한다.
 * @param {ParsedArgs} args
 * @param {{ stampPath?: string, now?: Date, sb?: any }} [deps]
 * @returns {Promise<{ action: string, payload?: ReturnType<typeof buildRunResult> }>}
 */
export async function runCommand(args, deps = {}) {
  const stampPath = deps.stampPath ?? STAMP_PATH;
  const now = deps.now ?? new Date();
  if (args.cmd === "start") {
    writeFileSync(stampPath, JSON.stringify({ startedAt: now.toISOString() }) + "\n", "utf8");
    console.log(`[pipeline] start 기록 ${now.toISOString()}`);
    return { action: "start" };
  }
  if ((args.cmd === "done" || args.cmd === "failed") && args.collector !== PHASE) {
    // 이 스크립트가 남기는 기록명은 PHASE 하나뿐이다 — 다른 이름을 받아 쓰면 감시가 못 찾는 행이 생긴다.
    console.log(`[pipeline] --collector=${args.collector} 는 받지 않는다(기록명은 ${PHASE} 고정) — 기록 안 함`);
    return { action: "bad-collector" };
  }
  if (args.cmd === "done" || args.cmd === "failed") {
    const payload = buildRunResult(args, readStamp(stampPath), now);
    if (args.dryRun) {
      console.log(`[pipeline] dry-run — collector_runs 기록 안 함: ${JSON.stringify(payload)}`);
      return { action: "dry-run", payload };
    }
    // elapsed 를 모르면(시작 기록 없음) undefined 로 넘긴다 — recordCollectorRun 이 elapsed_sec 을 null 로 적는다.
    await recordCollectorRun(PHASE, { ...payload.result, elapsed: payload.result.elapsed ?? undefined }, deps.sb ?? null);
    try { rmSync(stampPath, { force: true }); } catch { /* 지우지 못해도 다음 start 가 덮는다 */ }
    return { action: args.cmd, payload };
  }
  console.log("[pipeline] 사용법: record-pipeline-run.mjs start | done --ok=N --skip=N [--warn=a,b] | failed --step=N --name=이름 [--dry-run]");
  return { action: "usage" };
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  // 어떤 경우에도 exit 0 — 기록 실패가 파이프라인(bat)을 죽이면 안 된다.
  (async () => {
    try {
      loadEnv();
      await runCommand(parseArgs(process.argv.slice(2)));
    } catch (err) {
      console.log(`[pipeline] 기록 오류(파이프라인은 계속): ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exitCode = 0;
  })();
}
