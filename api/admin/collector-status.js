// @ts-check
/**
 * GET /api/admin/collector-status
 * 수집기 모니터링 — 관리자 화면용. 세 가지를 한 응답에 모은다:
 *   1. collector_runs 최근 실행 결과 (수집기별 최근 1회)
 *   2. api_quota_log 최근 호출 (수집기별 최근 N건)
 *   3. 데이터 테이블의 마지막 갱신 시각
 */
import { getSupabase } from "../_lib/supabase.js";
import { withHandler } from "../_lib/handler.js";

/**
 * @typedef {{
 *   status: string,
 *   okCount: number | null, failCount: number | null, skipCount: number | null,
 *   elapsedSec: number | null, errorMessage: string | null,
 *   startedAt: string | null, finishedAt: string | null
 * }} LastRun
 */
/**
 * @typedef {{
 *   logDate: string | null, apiName: string | null,
 *   callCount: number | null, recordedAt: string | null
 * }} QuotaEntry
 */
/**
 * @typedef {{ collector: string, lastRun: LastRun | null, recentQuota: QuotaEntry[] }} CollectorStatus
 */

/** collector_runs 최근 N행. 수집기 47개 일 1회 기준 충분. */
const RUN_FETCH_LIMIT = 300;
/** api_quota_log 최근 N행. */
const QUOTA_FETCH_LIMIT = 300;
/** 수집기당 노출할 최근 API 호출 건수. */
const MAX_QUOTA_PER_COLLECTOR = 5;
/** updated_at 컬럼 + 트리거를 가진 데이터 테이블. */
const UPDATED_AT_TABLES = ["apartments", "infra", "schools", "transport", "builders", "trade_stats"];

/**
 * 테이블의 최신 타임스탬프 1행 조회. 0행이면 null.
 * @param {any} sb
 * @param {string} table
 * @param {string} col
 * @returns {Promise<string | null>}
 */
async function maxTimestamp(sb, table, col) {
  const { data, error } = await sb
    .from(table)
    .select(col)
    .not(col, "is", null)
    .order(col, { ascending: false })
    .limit(1);
  if (error) throw new Error(`${table}.${col}: ${error.message}`);
  return data?.[0]?.[col] ?? null;
}

/**
 * @param {Record<string, any>} row
 * @returns {LastRun}
 */
function toLastRun(row) {
  return {
    status: row.status,
    okCount: row.ok_count ?? null,
    failCount: row.fail_count ?? null,
    skipCount: row.skip_count ?? null,
    elapsedSec: row.elapsed_sec ?? null,
    errorMessage: row.error_message ?? null,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
  };
}

/**
 * @param {Record<string, any>} row
 * @returns {QuotaEntry}
 */
function toQuotaEntry(row) {
  return {
    logDate: row.log_date ?? null,
    apiName: row.api_name ?? null,
    callCount: row.call_count ?? null,
    recordedAt: row.recorded_at ?? null,
  };
}

export default withHandler({
  method: "GET",
  admin: true,
  rateLimit: "admin",
  handler: async (req, res) => {
    try {
      const sb = getSupabase();

      // runs 1 + quota 1 + freshness 7 = 9 쿼리 병렬. 한 쿼리 실패가 전체를 죽이지 않게.
      const settled = await Promise.allSettled([
        sb.from("collector_runs")
          .select("collector,status,ok_count,fail_count,skip_count,elapsed_sec,error_message,started_at,finished_at")
          .order("finished_at", { ascending: false })
          .limit(RUN_FETCH_LIMIT),
        sb.from("api_quota_log")
          .select("collector,api_name,call_count,log_date,recorded_at")
          .order("recorded_at", { ascending: false })
          .limit(QUOTA_FETCH_LIMIT),
        ...UPDATED_AT_TABLES.map((t) => maxTimestamp(sb, t, "updated_at")),
        maxTimestamp(sb, "regions", "recorded_at"),
      ]);

      /** @type {string[]} */
      const errors = [];

      // 수집기별 최근 1행 — finished_at DESC 라 첫 등장이 최근 실행
      /** @type {Map<string, LastRun>} */
      const lastRunByCollector = new Map();
      const runsResult = settled[0];
      if (runsResult.status === "fulfilled" && !(/** @type {any} */ (runsResult.value).error)) {
        const runRows = /** @type {Record<string, any>[]} */ (/** @type {any} */ (runsResult.value).data ?? []);
        for (const row of runRows) {
          if (!lastRunByCollector.has(row.collector)) {
            lastRunByCollector.set(row.collector, toLastRun(row));
          }
        }
      } else {
        errors.push("collector_runs");
      }

      /** @type {Map<string, QuotaEntry[]>} */
      const quotaByCollector = new Map();
      const quotaResult = settled[1];
      if (quotaResult.status === "fulfilled" && !(/** @type {any} */ (quotaResult.value).error)) {
        const quotaRows = /** @type {Record<string, any>[]} */ (/** @type {any} */ (quotaResult.value).data ?? []);
        for (const row of quotaRows) {
          const list = quotaByCollector.get(row.collector) ?? [];
          if (list.length < MAX_QUOTA_PER_COLLECTOR) {
            list.push(toQuotaEntry(row));
            quotaByCollector.set(row.collector, list);
          }
        }
      } else {
        errors.push("api_quota_log");
      }

      const collectorNames = new Set([...lastRunByCollector.keys(), ...quotaByCollector.keys()]);
      /** @type {CollectorStatus[]} */
      const collectors = [...collectorNames].sort().map((collector) => ({
        collector,
        lastRun: lastRunByCollector.get(collector) ?? null,
        recentQuota: quotaByCollector.get(collector) ?? [],
      }));

      /** @type {Record<string, string | null>} */
      const dataFreshness = {};
      const freshnessTables = [...UPDATED_AT_TABLES, "regions"];
      for (let i = 0; i < freshnessTables.length; i++) {
        const table = freshnessTables[i];
        const result = settled[2 + i];
        if (result.status === "fulfilled") {
          dataFreshness[table] = /** @type {string | null} */ (result.value);
        } else {
          dataFreshness[table] = null;
          errors.push(`dataFreshness.${table}`);
        }
      }

      res.json({
        ok: true,
        fetchedAt: new Date().toISOString(),
        partial: errors.length > 0,
        errors,
        collectors,
        dataFreshness,
      });
    } catch (err) {
      console.error("[admin/collector-status] error:", err instanceof Error ? err.message : err);
      res.status(500).json({ ok: false, error: "모니터링 데이터 조회에 실패했습니다" });
    }
  },
});
