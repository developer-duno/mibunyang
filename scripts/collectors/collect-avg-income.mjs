// @ts-check
/**
 * KOSIS 시도별 1인당 가계총처분가능소득 → regions.avg_income UPDATE
 *
 * API: KOSIS OpenAPI "1인당 가계총처분가능소득(시도)"
 *      orgId=101, tblId=INH_1C96_04, itmId=T3, objL1=ALL
 *      1회 호출로 전국1+시도17 = 18건.
 *
 * 세션107: regions.avg_income 100% NULL 해소(당시 DT_1C86, 2022년 기준).
 * 세션110: DT_1C86 → INH_1C96_04 전환. 두 테이블 모두 통계청 지역소득 계통으로
 *   산식·단위·의미 동일하나 INH_1C96_04는 2024년 p(잠정치)까지 제공. 전국 평균
 *   23,388(2022) → 27,825 천원/년(2024p)으로 +19% 최신화. 단위(천원/년) 불변.
 *   시군구 해상도는 KOSIS에 존재하지 않음 — 국세청 TASIS 스크레이핑이 필요하나
 *   별도 프로젝트 범위이므로 이번 세션에서는 시도 단위 최신화까지만 진행.
 *
 * C1 매핑: C1_NM(정식명) 파싱 후 REGION_MAP 경유로 약칭 변환.
 *   DT_1C86과 INH_1C96_04 모두 C1_NM이 "서울특별시" 등 정식명으로 동일.
 *
 * 사용법:
 *   node scripts/collectors/collect-avg-income.mjs           (Supabase regions UPDATE)
 *   node scripts/collectors/collect-avg-income.mjs --dry-run (미리보기)
 *
 * 필요 환경변수:
 *   KOSIS_MIGRATION_KEY  — KOSIS OpenAPI 키 (migration.mjs와 공유)
 *   SUPABASE_URL / SUPABASE_SERVICE_KEY
 */
import {
  loadEnv, getSupabase, log, logError,
  REGION_MAP, recordApiQuota, recordCollectorRun, fetchWithRetry,
} from "./_shared.mjs";

loadEnv();

const PHASE = "avg-income";
const API_KEY = process.env.KOSIS_MIGRATION_KEY;

const BASE_URL = "https://kosis.kr/openapi/Param/statisticsParameterData.do";
const TARGET_ITM_NM = "1인당 가계총처분가능소득";

/**
 * @typedef {Object} KosisRow
 * @property {string} [C1]
 * @property {string} [C1_NM]
 * @property {string} [C2]
 * @property {string} [C2_NM]
 * @property {string} [ITM_ID]
 * @property {string} [ITM_NM]
 * @property {string} [PRD_DE]
 * @property {string} [DT]
 */

/**
 * @typedef {Object} IncomeEntry
 * @property {string} region
 * @property {string|null} gu
 * @property {number} avg_income
 * @property {string} recorded_at
 */

// ── 단위 변환: 천원/년 → 만원/월 ───────────────────────────
// KOSIS DT는 문자열("23,388"), 콤마 제거 후 정수화. 반올림은 가장 가까운 정수.
/**
 * @param {string|number|null|undefined} dt
 * @returns {number|null}
 */
export function thousandWonYearToManWonMonth(dt) {
  if (dt == null) return null;
  const n = parseInt(String(dt).replace(/,/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  // 천원/년 ÷ 12개월 ÷ 10(천원→만원) = 만원/월
  return Math.round(n / 120);
}

// ── KOSIS 응답 행 → 시도별 avg_income 엔트리 ────────────────
// 전국(C1="00") 제외. ITM_NM="1인당 개인소득"만, 최신 PRD_DE만.
/**
 * @param {unknown} rows
 * @returns {{period: string|null, entries: IncomeEntry[]}}
 */
export function aggregateIncomeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { period: null, entries: [] };
  const typedRows = /** @type {KosisRow[]} */ (rows);

  let latestPrd = "";
  for (const r of typedRows) {
    if (r.PRD_DE && r.PRD_DE > latestPrd) latestPrd = r.PRD_DE;
  }

  /** @type {IncomeEntry[]} */
  const entries = [];
  const recordedAt = `${latestPrd}-01-01`;
  for (const r of typedRows) {
    if (r.PRD_DE !== latestPrd) continue;
    if (r.ITM_NM !== TARGET_ITM_NM) continue;
    if (r.C1 === "00") continue; // 전국 제외

    const region = r.C1_NM ? REGION_MAP[r.C1_NM] : undefined;
    if (!region) continue; // 미매핑 지역 무시

    const avgIncome = thousandWonYearToManWonMonth(r.DT);
    if (avgIncome == null) continue;

    entries.push({ region, gu: null, avg_income: avgIncome, recorded_at: recordedAt });
  }
  return { period: latestPrd, entries };
}

// ── KOSIS 호출 ──────────────────────────────────────────────
export async function fetchKosisIncome() {
  if (!API_KEY) throw new Error("KOSIS_MIGRATION_KEY 환경변수 필요");

  const params = new URLSearchParams({
    method: "getList",
    apiKey: API_KEY,
    orgId: "101",
    tblId: "INH_1C96_04",
    itmId: "T3", // 1인당 가계총처분가능소득
    objL1: "ALL",
    prdSe: "Y",
    newEstPrdCnt: "1", // 최신 1년
    format: "json",
    jsonVD: "Y",
  });
  const url = `${BASE_URL}?${params}`;
  log(PHASE, "KOSIS INH_1C96_04 1인당 가계총처분가능소득 호출...");

  let res;
  try {
    res = await fetchWithRetry(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`KOSIS ${msg}`);
  }

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`KOSIS JSON 파싱 실패: ${text.slice(0, 200)}`); }
  if (json?.err) throw new Error(`KOSIS 에러 ${json.err}: ${json.errMsg || ""}`);
  return Array.isArray(json) ? json : [];
}

// ── 메인 ────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  let apiCalls = 0;
  let failed = 0;
  let updated = 0;
  try {
    const result = await runCollect(dryRun);
    failed = result.failed;
    apiCalls = result.apiCalls;
    updated = result.updated;
  } finally {
    if (!dryRun && apiCalls > 0) {
      await recordApiQuota(PHASE, "KOSIS_MIGRATION_KEY", apiCalls);
    }
    await recordCollectorRun(PHASE, { ok: updated, fail: failed });
  }
  if (failed > 0) process.exit(1);
}

/**
 * @param {boolean} dryRun
 * @returns {Promise<{apiCalls: number, failed: number, updated: number}>}
 */
async function runCollect(dryRun) {
  const rows = await fetchKosisIncome();
  const apiCalls = 1;
  log(PHASE, `KOSIS 응답: ${rows.length}건`);

  const { period, entries } = aggregateIncomeRows(rows);
  if (!period || entries.length === 0) {
    log(PHASE, "유효 데이터 없음 — 종료");
    return { apiCalls, failed: 0, updated: 0 };
  }
  log(PHASE, `기준연도: ${period}, 유효 시도: ${entries.length}건`);

  if (dryRun) {
    console.log("\n시도별 1인당 가계총처분가능소득 (만원/월):");
    for (const e of [...entries].sort((a, b) => b.avg_income - a.avg_income)) {
      console.log(`  ${e.region}: ${e.avg_income.toLocaleString()}만원/월`);
    }
    return { apiCalls, failed: 0, updated: 0 };
  }

  // Supabase UPDATE-or-INSERT (population.mjs L237-261 답습 — 소유 컬럼 보존 + recorded_at 매칭)
  const sb = getSupabase();
  let updated = 0, failed = 0;

  for (const e of entries) {
    const { data: updRows, error: updErr } = await sb
      .from("regions")
      .update({ avg_income: e.avg_income })
      .eq("region", e.region)
      .is("gu", null)
      .eq("recorded_at", e.recorded_at)
      .select("id");
    if (updErr) {
      logError(PHASE, `UPDATE ${e.region}: ${updErr.message}`);
      failed++;
      continue;
    }

    if (!updRows || updRows.length === 0) {
      const { error: insErr } = await sb.from("regions").insert([{
        region: e.region,
        gu: null,
        avg_income: e.avg_income,
        recorded_at: e.recorded_at,
      }]);
      if (insErr) {
        logError(PHASE, `INSERT ${e.region}: ${insErr.message}`);
        failed++;
        continue;
      }
    }
    updated++;
  }

  log(PHASE, `regions.avg_income UPSERT: ${updated}건 성공 / ${failed}건 실패 (recorded_at=${entries[0]?.recorded_at})`);
  return { apiCalls, failed, updated };
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });
