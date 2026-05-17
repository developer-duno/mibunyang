// @ts-check
/**
 * 수집기 감시 스크립트 (수집기 실패 텔레그램 알림 시스템).
 *
 * 4가지 이상을 점검해 발견 시 텔레그램으로 알린다:
 *   ① 실패/취소  — GitHub Actions run conclusion
 *   ② 데이터 0건 — collector_runs 의 ok/skip 모두 0
 *   ③ 미발화      — 마지막 run 이 35일+ 전 (월간 cron 1주기 초과)
 *   ④ NULL 급증   — regions 핵심 컬럼 + apartments 19 카테고리 NULL 비율 점검
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
import { computeAudit, fetchAllFromView } from "./collectors/data-audit.mjs";
import { sendTelegram, formatIssue, toKst } from "./notify-telegram.mjs";

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
 * ④ apartments 19 카테고리 중 NULL 점검 대상 — 카테고리별 기대 최저 rate(%).
 * 현재 rate 가 이 값 아래로 떨어지면 수집기 고장 의심. 의도적 저율 카테고리
 * (benefits 수기입력 / maintenance·builders·future·energy 부분수집 / naver 로컬전용 /
 * regions VIEW측 미수집컬럼)는 점검 안 함 — 정상인데 매일 오탐 방지.
 * 값 출처: data-audit --json 실측(2026-05-17) - 안전 마진 15~20%p.
 */
const AUDIT_CATEGORY_BASELINE = {
  core: 70,
  price: 75,
  building: 50,
  risk: 90,
  infra: 70,
  transport: 45,
  schools: 90,
  trade_stats: 75,
  environment: 65,
  competition: 45,
  air: 90,
  safety: 60,
};

/**
 * @typedef {object} Issue
 * @property {"fail"|"empty"|"stale"|"nulls"} kind
 * @property {string} collector
 * @property {string} detail 한 줄 요약 (콘솔 로그·하위호환용)
 * @property {string} [url]
 * @property {string[]} [lines] 본문에 펼칠 상세 줄 (점검 함수가 만든 사람 말 문장)
 * @property {string} [at] 이슈 발생 ISO 시각 (formatIssue 가 KST 로 변환)
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
      detail: `워크플로 실행이 ${run.conclusion} 상태로 끝났습니다.`,
      url: run.html_url,
      at: run.created_at,
    });
  }
  return issues;
}

/**
 * ② collector_runs 행에서 데이터 0건 수집을 찾는다.
 * status 가 success 인데 ok·skip 모두 0 이면 "성공처럼 보이지만 빈손".
 * @param {Array<{ collector?: string, status?: string, ok_count?: number|null, skip_count?: number|null, fail_count?: number|null, finished_at?: string|null }>} rows
 * @param {Record<string, { okCount: number, finishedAt: string }>} [prevByCollector]
 *   수집기별 직전 정상 실행(ok>0). 있으면 "지난번엔 N건" 비교 문장을 만든다.
 * @returns {Issue[]}
 */
export function checkEmptyRuns(rows, prevByCollector = {}) {
  /** @type {Issue[]} */
  const issues = [];
  for (const row of rows) {
    if (row.status !== "success") continue;
    const ok = row.ok_count ?? 0;
    const skip = row.skip_count ?? 0;
    if (ok === 0 && skip === 0) {
      const name = row.collector ?? "(이름 없음)";
      const fail = row.fail_count ?? 0;
      /** @type {string[]} */
      const lines = [
        `이번 실행은 success 로 끝났지만 처리 건수가 0건입니다 (성공 ${ok} · 건너뜀 ${skip} · 실패 ${fail}).`,
      ];
      const prev = prevByCollector[name];
      if (prev) {
        const when = toKst(prev.finishedAt);
        lines.push(
          `지난 정상 실행${when ? `(${when})` : ""}에서는 ${prev.okCount}건을 처리했는데, 이번엔 0건입니다.`,
        );
      }
      issues.push({
        kind: "empty",
        collector: name,
        detail: `success 인데 처리 0건 (ok ${ok} · skip ${skip} · fail ${fail})`,
        lines,
        at: row.finished_at ?? undefined,
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
        detail: `마지막 실행이 ${Math.floor(ageDays)}일 전입니다 (${STALE_DAYS}일 초과 — 월간 cron 1주기를 넘김).`,
        at: wf.lastRunAt,
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

/** ④ 필드별 상세 줄에 담을 최대 필드 수 (채움률 낮은 순). */
const NULL_DETAIL_FIELD_LIMIT = 6;

/**
 * ④ data-audit 카테고리 통계에서 NULL 급증을 찾는다.
 * baseline 에 등재된 카테고리만 점검하고, rate 가 기대 최저값 아래면 이상.
 * fields 가 주어지면 그 카테고리의 필드별 채움률을 상세 줄로 펼친다.
 * @param {Record<string, { collector: string, filled: number, total: number, rate: number }>} categories
 * @param {Record<string, number>} baseline 카테고리별 기대 최저 rate(%)
 * @param {Record<string, { category: string, field: string, filled: number, missing: number }>} [fields]
 *   data-audit computeAudit().fields — 필드별 채움/누락 수
 * @returns {Issue[]}
 */
export function checkCategoryNullSurge(categories, baseline, fields = {}) {
  /** @type {Issue[]} */
  const issues = [];
  for (const [cat, minRate] of Object.entries(baseline)) {
    const stat = categories[cat];
    if (!stat || stat.total === 0) continue;
    if (stat.rate >= minRate) continue;

    // 이 카테고리에 속한 필드별 채움률 — 낮은 순 정렬
    const catFields = Object.values(fields)
      .filter((f) => f.category === cat)
      .map((f) => {
        const fieldTotal = f.filled + f.missing;
        const fieldRate = fieldTotal > 0 ? Math.round((f.filled / fieldTotal) * 1000) / 10 : 0;
        return { field: f.field, filled: f.filled, total: fieldTotal, rate: fieldRate };
      })
      .sort((a, b) => a.rate - b.rate);

    /** @type {string[]} */
    const lines = [];
    if (catFields.length > 0) {
      lines.push(`이 카테고리는 ${catFields.length}개 필드를 담습니다. 채움률이 낮은 필드:`);
      for (const f of catFields.slice(0, NULL_DETAIL_FIELD_LIMIT)) {
        lines.push(`  · ${f.field} ${f.rate}% (${f.filled}/${f.total})`);
      }
    }

    issues.push({
      kind: "nulls",
      collector: `${cat} 카테고리 (${stat.collector})`,
      detail: `전체 채움률 ${stat.rate}% (${stat.filled}/${stat.total}) — 기대 최저 ${minRate}% 미달`,
      lines,
    });
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
 * collector_runs 에서 수집기별 최근 1행과 직전 정상 실행(ok>0)을 가져온다.
 * 같은 300행 안에서 둘 다 뽑으므로 추가 쿼리는 없다.
 * @returns {Promise<{ latest: any[], prevOk: Record<string, { okCount: number, finishedAt: string }> }>}
 */
async function fetchLatestCollectorRuns() {
  const sb = getSupabase();
  const { data } = await sb
    .from("collector_runs")
    .select("collector,status,ok_count,skip_count,fail_count,finished_at")
    .order("finished_at", { ascending: false })
    .limit(300);
  const rows = data ?? [];
  /** @type {Map<string, any>} */
  const latest = new Map();
  /** @type {Record<string, { okCount: number, finishedAt: string }>} */
  const prevOk = {};
  for (const row of rows) {
    if (!latest.has(row.collector)) {
      latest.set(row.collector, row);
      continue; // 최신 행은 비교 대상이 아니라 점검 대상
    }
    // 최신 행 이후의 행 중 ok>0 인 첫 행 = 직전 정상 실행
    if (!prevOk[row.collector] && (row.ok_count ?? 0) > 0) {
      prevOk[row.collector] = { okCount: row.ok_count, finishedAt: row.finished_at };
    }
  }
  return { latest: [...latest.values()], prevOk };
}

// ── 메인 ────────────────────────────────────────────────────

async function main() {
  const modeArg = process.argv.find((a) => a.startsWith("--mode="));
  const mode = modeArg ? modeArg.slice("--mode=".length) : "daily";

  /** @type {Issue[]} */
  let issues = [];

  if (mode === "test") {
    // 전송 경로 검증용 — 점검 없이 테스트 메시지 1건만 보낸다.
    const result = await sendTelegram(
      "✅ <b>수집기 감시 알림</b>\n알림 시스템이 정상 설치되었습니다. 이 메시지가 보이면 텔레그램 연동 완료.",
    );
    console.log(result.sent ? "[monitor] 테스트 메시지 전송 성공" : `[monitor] 전송 실패: ${result.reason}`);
    if (!result.sent) process.exit(1);
    return;
  }

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
    const { latest, prevOk } = await fetchLatestCollectorRuns();
    issues = issues.concat(checkEmptyRuns(latest, prevOk));
  } else {
    // daily 스윕 — 전체 점검 (①②③④)
    const runs = await fetchRecentRuns(50);
    issues = issues.concat(checkFailedRuns(runs));
    const { latest, prevOk } = await fetchLatestCollectorRuns();
    issues = issues.concat(checkEmptyRuns(latest, prevOk));

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

    // ④ NULL 급증 — regions 핵심 컬럼 + apartments 19 카테고리
    issues = issues.concat(checkNullSurge(await fetchRegionColumnStats()));
    const audit = computeAudit(await fetchAllFromView(getSupabase(), null));
    issues = issues.concat(
      checkCategoryNullSurge(audit.categories, AUDIT_CATEGORY_BASELINE, audit.fields),
    );
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
