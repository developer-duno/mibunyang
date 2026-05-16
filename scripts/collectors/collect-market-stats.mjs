// @ts-check
/**
 * KOSIS 민간아파트 분양가격동향 5개 지표 수집기
 *
 * 출처: 주택도시보증공사(orgId=414) — KOSIS API
 *   1. DT_41401N_006 — ㎡당 분양가격지수 (2014=100, 월간)
 *   2. DT_41401N_005 — ㎡당 평균 분양가격 (천원/㎡, 월간)
 *   3. DT_41401N_007 — 신규 분양세대수 (세대, 월간)
 *   4. DT_41401N_008 — 평균 초기분양률 (%, 분기)
 *   5. DT_41401N_009 — 분양가 중 대지비 비율 (%, 월간)
 *
 * 사용법:
 *   node scripts/collectors/collect-market-stats.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-market-stats.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, createReporter, sleep, REGION_MAP, upsertBatch, recordApiQuota, recordCollectorRun } from "./_shared.mjs";

loadEnv();

const PHASE = "market-stats";
const KOSIS_KEY = process.env.KOSIS_KEY;

/**
 * @typedef {Object} Indicator
 * @property {string} col
 * @property {string} tblId
 * @property {"M"|"Q"} prdSe
 * @property {number} objLevels
 * @property {(s: string, r?: number) => number} parse
 * @property {number} minExpected
 * @property {string} label
 */

/**
 * @typedef {Object} KosisRow
 * @property {string} [C1]
 * @property {string} [C1_NM]
 * @property {string} [C2]
 * @property {string} [C2_NM]
 * @property {string} [ITM_NM]
 * @property {string} [PRD_DE]
 * @property {string} [DT]
 */

/**
 * @typedef {Object} HistoryRow
 * @property {string} region
 * @property {string} gu
 * @property {string} base_month
 * @property {number} [price_index]
 * @property {number} [avg_price_sqm]
 * @property {number} [new_supply]
 * @property {number} [initial_sale_rate]
 * @property {number} [land_cost_ratio]
 */

// 지표별 설정
/** @type {Indicator[]} */
const INDICATORS = [
  { col: "price_index",       tblId: "DT_41401N_006", prdSe: "M", objLevels: 2, parse: parseFloat, minExpected: 10, label: "분양가격지수" },
  { col: "avg_price_sqm",     tblId: "DT_41401N_005", prdSe: "M", objLevels: 2, parse: parseInt,   minExpected: 10, label: "평균분양가격" },
  { col: "new_supply",        tblId: "DT_41401N_007", prdSe: "M", objLevels: 1, parse: parseInt,   minExpected: 10, label: "신규분양세대수" },
  { col: "initial_sale_rate", tblId: "DT_41401N_008", prdSe: "Q", objLevels: 1, parse: parseFloat, minExpected: 5,  label: "초기분양률" },
  { col: "land_cost_ratio",   tblId: "DT_41401N_009", prdSe: "M", objLevels: 1, parse: parseInt,   minExpected: 10, label: "대지비비율" },
];

// ── KOSIS API 호출 (node:https — TLS 호환) ───────────────────
/**
 * @param {Indicator} indicator
 * @param {string} startPrdDe
 * @param {string} endPrdDe
 * @returns {Promise<unknown>}
 */
async function fetchKosisTable(indicator, startPrdDe, endPrdDe) {
  const https = await import("node:https");
  const tls = await import("node:tls");

  /** @type {Record<string, string>} */
  const paramObj = {
    method: "getList",
    apiKey: KOSIS_KEY || "",
    orgId: "414",
    tblId: indicator.tblId,
    itmId: "ALL",
    objL1: "ALL",
    prdSe: indicator.prdSe,
    startPrdDe,
    endPrdDe,
    format: "json",
    jsonVD: "Y",
  };
  if (indicator.objLevels >= 2) paramObj.objL2 = "ALL";
  const params = new URLSearchParams(paramObj);

  const url = `https://kosis.kr/openapi/Param/statisticsParameterData.do?${params}`;
  const agent = new https.Agent({
    secureOptions: /** @type {{ SSL_OP_LEGACY_SERVER_CONNECT: number }} */ (/** @type {unknown} */ (tls)).SSL_OP_LEGACY_SERVER_CONNECT,
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.2",
  });

  return new Promise((resolve, reject) => {
    const req = https.request(url, { headers: { "User-Agent": "Mozilla/5.0" }, agent }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`KOSIS HTTP ${res.statusCode}`));
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error("KOSIS JSON 파싱 실패")); }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("KOSIS 타임아웃")); });
    req.end();
  });
}

/**
 * KOSIS 행에서 지역별 최신값 추출
 * @param {KosisRow[]} rows
 * @param {Indicator} indicator
 * @returns {Record<string, {value: number, period: string}>}
 */
export function extractLatestByRegion(rows, indicator) {
  /** @type {Record<string, {value: number, period: string}>} */
  const latestByRegion = {};
  for (const row of rows) {
    if (row.C2_NM && row.C2_NM !== "전체") continue;
    const region = row.C1_NM ? REGION_MAP[row.C1_NM] : undefined;
    if (!region) continue;
    const value = indicator.parse(row.DT || "", 10);
    if (isNaN(value)) continue;
    const period = row.PRD_DE || "";
    if (!latestByRegion[region] || period > latestByRegion[region].period) {
      latestByRegion[region] = { value, period };
    }
  }
  return latestByRegion;
}

/**
 * KOSIS 행 → 모든 기간/지역 평탄 배열 (시계열 보존)
 * 반환: [{ region, gu, base_month, value }, ...]
 *
 * extractLatestByRegion 와 달리 모든 PRD_DE 보존 → market_stats_history upsert 용도.
 * PRD_DE 정규식: 월간 /^\d{6}$/ (예: "202603") + 분기 /^\d{5}$/ (예: "20261", prdSe=Q 응답)
 * 세션134 collect-unsold-kosis.parseKosisRowsAllMonths 패턴 미러링.
 */
/**
 * @param {KosisRow[]} rows
 * @param {Indicator} indicator
 * @returns {{region: string, gu: string, base_month: string, value: number}[]}
 */
export function parseAllPeriodsByRegion(rows, indicator) {
  /** @type {{region: string, gu: string, base_month: string, value: number}[]} */
  const out = [];
  const monthRe = /^\d{6}$/;
  const quarterRe = /^\d{5}$/;
  for (const row of rows) {
    const prd = row.PRD_DE || "";
    if (!monthRe.test(prd) && !quarterRe.test(prd)) continue;
    if (row.C2_NM && row.C2_NM !== "전체") continue;
    const region = row.C1_NM ? REGION_MAP[row.C1_NM] : undefined;
    if (!region) continue;
    const value = indicator.parse(row.DT || "", 10);
    if (isNaN(value)) continue;
    out.push({ region, gu: "", base_month: prd, value });
  }
  return out;
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  if (!KOSIS_KEY) throw new Error("KOSIS_KEY not configured");
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const rpt = createReporter(PHASE);

  // 기간 설정
  const now = new Date();
  const endMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const startMonth = `${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, "0")}`;
  // 분기용: 최근 8분기 (데이터 1~2분기 지연 감안)
  const curQ = Math.ceil((now.getMonth() + 1) / 3);
  const endQ = `${now.getFullYear()}${curQ}`;
  const startQ = `${now.getFullYear() - 2}${curQ}`;

  // 기존 regions 행 조회 (UPDATE 대상)
  const { data: regions, error: rErr } = await sb
    .from("regions")
    .select("id, region, gu")
    .is("gu", null); // 시도 레벨만 (VIEW latest_regions CTE 조건)

  if (rErr) { logError(PHASE, `regions 조회 실패: ${rErr.message}`); return; }
  log(PHASE, `regions 시도 행: ${regions.length}건`);

  // 지표별 수집
  /** @type {Record<string, HistoryRow>} */
  const historyMap = {}; // key = "region::base_month" → wide row (5지표 merge)
  for (const ind of INDICATORS) {
    const start = ind.prdSe === "Q" ? startQ : startMonth;
    const end = ind.prdSe === "Q" ? endQ : endMonth;

    log(PHASE, `\n[${ind.label}] ${ind.tblId} (${ind.prdSe}) ${start}~${end}`);

    /** @type {unknown} */
    let data;
    try {
      data = await fetchKosisTable(ind, start, end);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(PHASE, `  ${ind.label} API 실패: ${msg}`);
      rpt.fail(1);
      continue;
    }

    const dataObj = /** @type {{ err?: string, errMsg?: string }} */ (data);
    if (dataObj && typeof dataObj === "object" && "err" in dataObj && dataObj.err) {
      logError(PHASE, `  ${ind.label} KOSIS 에러: ${dataObj.errMsg || dataObj.err}`);
      rpt.fail(1);
      continue;
    }

    /** @type {KosisRow[]} */
    const rows = Array.isArray(data) ? data : [];
    if (rows.length < ind.minExpected) {
      logError(PHASE, `  ${ind.label}: ${rows.length}건 < 최소 ${ind.minExpected}건 — itmId/prdSe 확인 필요`);
    }

    const latestByRegion = extractLatestByRegion(rows, ind);

    const regionCount = Object.keys(latestByRegion).length;
    log(PHASE, `  ${ind.label}: ${rows.length}건 응답, ${regionCount}개 시도 매핑`);

    // ── market_stats_history 시계열 누적 (병존, regions UPDATE 와 동일 응답 재파싱) ──
    for (const row of parseAllPeriodsByRegion(rows, ind)) {
      const key = `${row.region}::${row.base_month}`;
      if (!historyMap[key]) historyMap[key] = { region: row.region, gu: "", base_month: row.base_month };
      /** @type {Record<string, unknown>} */ (historyMap[key])[ind.col] = row.value;
    }

    // regions 테이블 UPDATE
    let updated = 0;
    for (const reg of regions) {
      const entry = latestByRegion[reg.region];
      if (!entry) continue;

      if (dryRun) {
        log(PHASE, `  [DRY-RUN] ${reg.region}: ${ind.col} = ${entry.value} (${entry.period})`);
        updated++;
        continue;
      }

      const { error } = await sb.from("regions")
        .update({ [ind.col]: entry.value })
        .eq("id", reg.id);

      if (error) {
        logError(PHASE, `  ${reg.region} ${ind.col} UPDATE 실패: ${error.message}`);
      } else {
        updated++;
      }
    }

    log(PHASE, `  ${ind.label}: ${updated}건 갱신`);
    rpt.success(updated);

    // KOSIS 부하 방지
    await sleep(1000);
  }

  // ── market_stats_history upsert (5지표 병합 wide row) ──
  const historyRows = Object.values(historyMap);
  if (historyRows.length > 0) {
    if (dryRun) {
      log(PHASE, `[DRY-RUN] market_stats_history: ${historyRows.length}건 예상`);
    } else {
      const inserted = await upsertBatch("market_stats_history", historyRows, "region,gu,base_month", 500, sb);
      log(PHASE, `market_stats_history 저장: ${inserted}건`);
    }
  }

  // KOSIS 호출 쿼터 기록 (지표별 1회)
  if (!dryRun) await recordApiQuota(PHASE, "KOSIS_KEY", INDICATORS.length);

  const result = rpt.summary();
  log(PHASE, "=== 완료 ===");
  await recordCollectorRun(PHASE, result);
  if (result.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });
