// @ts-check
/**
 * 수집기 감시 스크립트 (수집기 실패 텔레그램 알림 시스템).
 *
 * 4가지 이상을 점검해 발견 시 텔레그램으로 알린다:
 *   ① 실패/취소  — GitHub Actions run conclusion
 *   ② 데이터 0건 — collector_runs 의 ok/skip 모두 0
 *   ③ 미발화      — 마지막 run 이 35일+ 전 (월간 cron 1주기 초과)
 *   ④ NULL 급증   — regions 핵심 컬럼 NULL 비율 > 임계값
 *
 * 모드:
 *   --mode=run    workflow_run 트리거 — 방금 끝난 run 1개만 (①②)
 *   --mode=daily  cron — 전체 스윕 (①②③④)
 *
 * 필요 환경변수:
 *   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID — 알림 채널 (없으면 점검만, 전송 스킵)
 *   GITHUB_TOKEN                          — GitHub REST 인증 (Actions 기본 제공)
 *   GITHUB_REPOSITORY                     — "owner/repo" (Actions 기본 제공)
 *   SUPABASE_URL / SUPABASE_SERVICE_KEY   — collector_runs / regions 조회
 */
import { loadEnv, getSupabase } from "./collectors/_shared.mjs";
import { sendTelegram, formatIssue } from "./notify-telegram.mjs";

loadEnv();

/** 미발화 판정 임계 — 마지막 run 이 이 일수보다 오래되면 이상 (월간 cron 1주기+여유). */
const STALE_DAYS = 35;
/** NULL 급증 판정 임계 — 핵심 컬럼 NULL 비율이 이 값을 넘으면 이상. */
const NULL_RATE_THRESHOLD = 0.4;
/** 이상 run 으로 보는 conclusion. */
const BAD_CONCLUSIONS = ["failure", "cancelled", "timed_out"];
/** ④ NULL 점검 대상 — regions 핵심 컬럼. */
const REGION_KEY_COLUMNS = ["net_migration", "crime_grade"];

/**
 * @typedef {{ kind: "fail"|"empty"|"stale"|"nulls", collector: string, detail: string, url?: string }} Issue
 */

// ── 순수 점검 함수 (fake 데이터로 테스트 가능) ──────────────

/**
 * ① GitHub Actions run 목록에서 실패/취소를 찾는다.
 * @param {Array<{ name?: string, conclusion?: string|null, status?: string, html_url?: string, created_at?: string }>} runs
 * @returns {Issue[]}
 */
export function checkFailedRuns(runs) {
  /** @type {Issue[]} */
  const issues = [];
  for (const run of runs) {
    if (run.status !== "completed") continue;
    if (!run.conclusion || !BAD_CONCLUSIONS.includes(run.conclusion)) continue;
    issues.push({
      kind: "fail",
      collector: run.name ?? "(이름 없음)",
      detail: `${run.conclusion}${run.created_at ? ` · ${run.created_at} 시작` : ""}`,
      url: run.html_url,
    });
  }
  return issues;
}

/**
 * ② collector_runs 행에서 데이터 0건 수집을 찾는다.
 * status 가 success 인데 ok·skip 모두 0 이면 "성공처럼 보이지만 빈손".
 * @param {Array<{ collector?: string, status?: string, ok_count?: number|null, skip_count?: number|null, finished_at?: string|null }>} rows
 * @returns {Issue[]}
 */
export function checkEmptyRuns(rows) {
  /** @type {Issue[]} */
  const issues = [];
  for (const row of rows) {
    if (row.status !== "success") continue;
    const ok = row.ok_count ?? 0;
    const skip = row.skip_count ?? 0;
    if (ok === 0 && skip === 0) {
      issues.push({
        kind: "empty",
        collector: row.collector ?? "(이름 없음)",
        detail: `success 인데 처리 0건 (ok 0 · skip 0)${row.finished_at ? ` · ${row.finished_at}` : ""}`,
      });
    }
  }
  return issues;
}

/**
 * ③ 워크플로별 마지막 run 시각에서 미발화를 찾는다.
 * @param {Array<{ name: string, lastRunAt: string|null }>} workflows
 * @param {Date} now 기준 시각 (테스트 주입용)
 * @returns {Issue[]}
 */
export function checkStaleWorkflows(workflows, now = new Date()) {
  /** @type {Issue[]} */
  const issues = [];
  for (const wf of workflows) {
    if (!wf.lastRunAt) {
      issues.push({ kind: "stale", collector: wf.name, detail: "실행 기록이 한 번도 없음" });
      continue;
    }
    const ageDays = (now.getTime() - new Date(wf.lastRunAt).getTime()) / 86400000;
    if (ageDays > STALE_DAYS) {
      issues.push({
        kind: "stale",
        collector: wf.name,
        detail: `마지막 실행 ${Math.floor(ageDays)}일 전 (${STALE_DAYS}일 초과)`,
      });
    }
  }
  return issues;
}

/**
 * ④ 컬럼별 (total, filled) 카운트에서 NULL 급증을 찾는다.
 * @param {Array<{ column: string, total: number, filled: number }>} columnStats
 * @returns {Issue[]}
 */
export function checkNullSurge(columnStats) {
  /** @type {Issue[]} */
  const issues = [];
  for (const stat of columnStats) {
    if (stat.total === 0) continue;
    const nullRate = (stat.total - stat.filled) / stat.total;
    if (nullRate > NULL_RATE_THRESHOLD) {
      issues.push({
        kind: "nulls",
        collector: `regions.${stat.column}`,
        detail: `NULL ${(nullRate * 100).toFixed(0)}% (${stat.total - stat.filled}/${stat.total}) — 임계 ${(NULL_RATE_THRESHOLD * 100).toFixed(0)}% 초과`,
      });
    }
  }
  return issues;
}

// ── I/O 래퍼 (실제 API·DB 호출) ─────────────────────────────

/**
 * GitHub REST 로 최근 워크플로 run 목록을 가져온다.
 * @param {number} perPage
 * @returns {Promise<any[]>}
 */
async function fetchRecentRuns(perPage = 50) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return [];
  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/runs?per_page=${perPage}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!res.ok) return [];
  const json = /** @type {{ workflow_runs?: any[] }} */ (await res.json());
  return json.workflow_runs ?? [];
}

/**
 * regions 핵심 컬럼별 (total, filled) 을 조회한다.
 * @returns {Promise<Array<{ column: string, total: number, filled: number }>>}
 */
async function fetchRegionColumnStats() {
  const sb = getSupabase();
  const { count: total } = await sb.from("regions").select("*", { count: "exact", head: true });
  /** @type {Array<{ column: string, total: number, filled: number }>} */
  const stats = [];
  for (const col of REGION_KEY_COLUMNS) {
    const { count: filled } = await sb
      .from("regions")
      .select(col, { count: "exact", head: true })
      .not(col, "is", null);
    stats.push({ column: col, total: total ?? 0, filled: filled ?? 0 });
  }
  return stats;
}

/**
 * collector_runs 에서 수집기별 최근 1행을 가져온다.
 * @returns {Promise<any[]>}
 */
async function fetchLatestCollectorRuns() {
  const sb = getSupabase();
  const { data } = await sb
    .from("collector_runs")
    .select("collector,status,ok_count,skip_count,finished_at")
    .order("finished_at", { ascending: false })
    .limit(300);
  const rows = data ?? [];
  /** @type {Map<string, any>} */
  const latest = new Map();
  for (const row of rows) {
    if (!latest.has(row.collector)) latest.set(row.collector, row);
  }
  return [...latest.values()];
}

// ── 메인 ────────────────────────────────────────────────────

async function main() {
  const modeArg = process.argv.find((a) => a.startsWith("--mode="));
  const mode = modeArg ? modeArg.slice("--mode=".length) : "daily";

  /** @type {Issue[]} */
  let issues = [];

  if (mode === "run") {
    // workflow_run 트리거 — 방금 끝난 run 1개만 점검 (①②)
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (eventPath) {
      const { readFile } = await import("node:fs/promises");
      const event = JSON.parse(await readFile(eventPath, "utf8"));
      const wr = event.workflow_run;
      if (wr && wr.name !== "Monitor Collectors") {
        issues = issues.concat(checkFailedRuns([wr]));
      }
    }
    // run 모드도 collector_runs 최근분으로 0건 점검 (방금 끝난 수집기 반영)
    issues = issues.concat(checkEmptyRuns(await fetchLatestCollectorRuns()));
  } else {
    // daily 스윕 — 전체 점검 (①②③④)
    const runs = await fetchRecentRuns(50);
    issues = issues.concat(checkFailedRuns(runs));
    issues = issues.concat(checkEmptyRuns(await fetchLatestCollectorRuns()));

    // ③ 미발화 — 워크플로별 마지막 run 시각
    /** @type {Map<string, string>} */
    const lastRunByWf = new Map();
    for (const run of runs) {
      if (run.name && !lastRunByWf.has(run.name)) {
        lastRunByWf.set(run.name, run.created_at);
      }
    }
    const wfList = [...lastRunByWf.entries()].map(([name, lastRunAt]) => ({ name, lastRunAt }));
    issues = issues.concat(checkStaleWorkflows(wfList));

    // ④ NULL 급증
    issues = issues.concat(checkNullSurge(await fetchRegionColumnStats()));
  }

  if (issues.length === 0) {
    console.log(`[monitor] 이상 없음 (mode=${mode})`);
    return;
  }

  console.log(`[monitor] 이상 ${issues.length}건 발견 (mode=${mode})`);
  for (const issue of issues) {
    const text = formatIssue(issue);
    console.log(text);
    const result = await sendTelegram(text);
    if (!result.sent) console.log(`  [전송 스킵] ${result.reason}`);
  }
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    console.error("[monitor] 오류:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
