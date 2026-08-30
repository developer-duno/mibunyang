// @ts-check
/**
 * 시군구별 전세가율 산출 — regions.jeonse_rate 채움
 *
 * trade-stats.mjs 의 apartments 단위 jeonse_rate 산식을 시군구(region, gu) 단위로 집계.
 * trades 테이블 (12개월) → group by statsKey → median(jeonse) / median(sale) × 100 (%).
 *
 * 사용법:
 *   node scripts/collectors/trade-stats-regions.mjs          (regions.jeonse_rate UPDATE)
 *   node scripts/collectors/trade-stats-regions.mjs --dry-run (미리보기)
 *
 * 필요 환경변수:
 *   SUPABASE_URL         — Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_KEY  — Supabase service_role 키
 *
 * 의존:
 *   - trades 테이블 (collect-trades.mjs 가 채움)
 *   - regions 테이블 (시군구 758행 박힘)
 */
import {
  loadEnv,
  getMibuyangSupabase,
  log,
  logError,
  recordCollectorRun,
  setupGracefulShutdown,
} from "./_shared.mjs";
import { statsKey, median, monthsAgo } from "./trade-stats.mjs";

loadEnv();

const PHASE = "trade-stats-regions";
const SAMPLE_GATE = 3; // jeonse + sale 각각 최소 3건

// ── trades 12개월 페이징 조회 (trade-stats.mjs fetchAll 고유키 커서 답습) ──────
/**
 * ⚠️ **정렬 없는 OFFSET 페이징은 trades(79만행)에서 행을 잃는다**(세션513·514 실측 —
 * `unordered-pagination-loses-rows.md`). 옛 구현은 `.range()` 만 써 무정렬이었다 — 같은
 * 오프셋으로 같은 쿼리를 두 번 던지면 교집합이 0 이라, 저장된 시군구 집계가 원본의 8% 수준으로
 * 과소집계됐다. **고유키(`id`) 커서**로 훑어 유실을 막는다. 형제 파일 `trade-stats.mjs` 의
 * `fetchAll` 과 같은 패턴(select 에 id 포함 → order(id asc) → gt 커서).
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} cutoffYM
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function fetchAllTrades(sb, cutoffYM) {
  /** @type {Array<Record<string, any>>} */
  const rows = [];
  const PAGE = 1000;
  /** @type {any} */
  let cursor = null;
  while (true) {
    let q = sb
      .from("trades")
      .select("id,region,gu,price,trade_type,deal_month")
      .gte("deal_month", cutoffYM)
      .is("cancel_date", null)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor != null) q = q.gt("id", cursor);
    const { data, error } = await q;
    if (error) throw new Error(`trades 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    cursor = data[data.length - 1].id;
    if (cursor == null) break; // 키가 비면 커서를 못 만든다 — 무한 루프 대신 멈춘다
  }
  return rows;
}

// ── 시군구별 jeonse_rate 산출 ─────────────────────────────────
/**
 * @param {Array<Record<string, any>>} trades
 * @returns {Map<string, number>} statsKey → jeonse_rate (%)
 */
export function computeRegionJeonseRate(trades) {
  /** @type {Map<string, { sale: number[]; jeonse: number[] }>} */
  const groups = new Map();
  for (const t of trades) {
    if (t.price == null) continue;
    const key = statsKey(t.region, t.gu);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { sale: [], jeonse: [] });
    const g = groups.get(key);
    if (!g) continue;
    if (t.trade_type === "sale" || t.trade_type === "매매" || !t.trade_type) {
      g.sale.push(t.price);
    } else if (t.trade_type === "jeonse" || t.trade_type === "전세") {
      g.jeonse.push(t.price);
    }
  }

  /** @type {Map<string, number>} */
  const rates = new Map();
  for (const [key, { sale, jeonse }] of groups) {
    if (sale.length < SAMPLE_GATE || jeonse.length < SAMPLE_GATE) continue;
    const saleMedian = median(sale);
    const jeonseMedian = median(jeonse);
    if (!saleMedian || saleMedian <= 0 || jeonseMedian == null) continue;
    // 단위 = % (만원 아님) — trade-stats.mjs:319 답습
    const rate = Math.round((jeonseMedian / saleMedian) * 1000) / 10;
    rates.set(key, rate);
  }
  return rates;
}

// ── 시군구별 최신 recorded_at row 1건만 추리기 ────────────────
/**
 * @param {Array<{ id: number; region: string; gu: string | null; recorded_at: string }>} regions
 * @returns {Map<string, { id: number; recorded_at: string }>}
 */
export function pickLatestPerKey(regions) {
  /** @type {Map<string, { id: number; recorded_at: string }>} */
  const latest = new Map();
  for (const r of regions) {
    const key = statsKey(r.region, r.gu);
    if (!key) continue;
    const prev = latest.get(key);
    if (!prev || r.recorded_at > prev.recorded_at) {
      latest.set(key, { id: r.id, recorded_at: r.recorded_at });
    }
  }
  return latest;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const isInterrupted = setupGracefulShutdown(PHASE);

  const sb = getMibuyangSupabase();
  const cutoff12mYM = monthsAgo(12).replace(/-/g, "").slice(0, 6);

  log(PHASE, `trades 12개월 조회 (cutoff=${cutoff12mYM})...`);
  const trades = await fetchAllTrades(sb, cutoff12mYM);
  log(PHASE, `trades ${trades.length}건 로드`);

  if (isInterrupted()) {
    log(PHASE, "중단 — trades 로드 후");
    await recordCollectorRun(PHASE, { ok: 0, skip: 0, status: "partial" });
    return;
  }

  const rateMap = computeRegionJeonseRate(trades);
  log(PHASE, `시군구별 jeonse_rate 산출: ${rateMap.size}건 (표본 게이트 jeonse≥${SAMPLE_GATE} + sale≥${SAMPLE_GATE})`);

  // regions 전수 조회 → 시군구별 최신 recorded_at row 1건 추리기
  /** @type {any} */
  const regionsRes = await sb
    .from("regions")
    .select("id, region, gu, recorded_at")
    .order("recorded_at", { ascending: false });
  if (regionsRes.error) {
    logError(PHASE, `regions 조회 실패: ${regionsRes.error.message}`);
    await recordCollectorRun(PHASE, { ok: 0, fail: 1 });
    process.exit(1);
  }
  const regions = /** @type {Array<{ id: number; region: string; gu: string | null; recorded_at: string }>} */ (regionsRes.data ?? []);
  const latestMap = pickLatestPerKey(regions);
  log(PHASE, `regions 시군구 키 ${latestMap.size}건 (전체 row ${regions.length})`);

  // UPDATE 대상 추리기
  /** @type {Array<{ id: number; jeonse_rate: number; key: string }>} */
  const updates = [];
  let unmatched = 0;
  for (const [key, { id }] of latestMap) {
    const rate = rateMap.get(key);
    if (rate == null) {
      unmatched++;
      continue;
    }
    updates.push({ id, jeonse_rate: rate, key });
  }

  log(PHASE, `UPDATE 대상 ${updates.length}건 / unmatched ${unmatched}건 (표본 부족 또는 거래 0)`);

  if (dryRun) {
    log(PHASE, `[DRY-RUN] sample: ${JSON.stringify(updates.slice(0, 5).map(u => ({ key: u.key, rate: u.jeonse_rate })))}`);
    await recordCollectorRun(PHASE, { ok: updates.length, skip: unmatched });
    return;
  }

  // row-by-row UPDATE (id PK)
  let okCount = 0;
  let failCount = 0;
  for (const u of updates) {
    if (isInterrupted()) {
      log(PHASE, `중단 — UPDATE ${okCount}/${updates.length} 진행 중`);
      break;
    }
    const { error } = await sb.from("regions").update({ jeonse_rate: u.jeonse_rate }).eq("id", u.id);
    if (error) {
      logError(PHASE, `UPDATE 실패 id=${u.id} key=${u.key}: ${error.message}`);
      failCount++;
    } else {
      okCount++;
    }
  }

  log(PHASE, `UPDATE 완료 ok=${okCount} fail=${failCount}`);
  await recordCollectorRun(PHASE, {
    ok: okCount,
    fail: failCount,
    skip: unmatched,
    status: isInterrupted() ? "partial" : (failCount > 0 ? "failure" : "success"),
  });
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
