// @ts-check
/**
 * KOSIS 주택보급률 수집기 (W1, 세션 237)
 *
 * KOSIS 국가통계포털 DT_MLTM_2100 ((新)주택보급률) 통계표에서
 * 시도별 연간 주택보급률(%, 다가구 구분거처 반영) 을 수집하여
 * regions.housing_supply_level (gu IS NULL 17행) 업데이트.
 *
 * - ITM_NM = '보급률(다가구 구분거처 반영)' (세션 236 환각 정정: '보급률' = DT=0 폐기 series)
 * - PRD_SE = 'A' (연간만, 월간 미제공)
 * - 시도 17개 (C1_NM = "전국"/"수도권"/"지방" 등 집계 행 제외)
 * - housing-permits.mjs:200-209 UPDATE 패턴 답습 (gu IS NULL + order by recorded_at desc + limit 1)
 *
 * 사용법:
 *   node scripts/collectors/collect-housing-supply-ratio.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-housing-supply-ratio.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, REGION_MAP, fetchWithRetry, recordApiQuota } from "./_shared.mjs";

/** @typedef {{ C1_NM: string; ITM_NM: string; PRD_DE: string; DT: string; UNIT_NM?: string }} KosisRow */
/** @typedef {Record<string, number>} SupplyLevelByRegion */

loadEnv();

const PHASE = "kosis-housing-supply-ratio";
const KOSIS_KEY = process.env.KOSIS_KEY;
const ITM_NM_FILTER = "보급률(다가구 구분거처 반영)";

/**
 * KOSIS 응답 행 → 시도별 보급률 (최신 연도)
 * @param {KosisRow[]} rows
 * @returns {SupplyLevelByRegion}
 */
export function parseKosisRows(rows) {
  /** @type {SupplyLevelByRegion} */
  const supplyByRegion = {};
  /** @type {Record<string, string>} */
  const latestYear = {};

  for (const row of rows) {
    if (row.ITM_NM !== ITM_NM_FILTER) continue;
    const region = /** @type {Record<string, string>} */ (REGION_MAP)[row.C1_NM];
    if (!region) continue;

    const year = row.PRD_DE;
    const value = parseFloat(row.DT);
    if (!isFinite(value) || value <= 0 || value > 200) continue;

    if (!latestYear[region] || year > latestYear[region]) {
      latestYear[region] = year;
      supplyByRegion[region] = value;
    }
  }

  return supplyByRegion;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");
  if (!KOSIS_KEY) throw new Error("KOSIS_KEY not configured");

  const sb = getSupabase();

  // KOSIS API 호출 (DT_MLTM_2100 연간 전체)
  const now = new Date();
  const endYear = String(now.getFullYear());
  const startYear = String(now.getFullYear() - 3);

  log(PHASE, `KOSIS 주택보급률 조회: ${startYear} ~ ${endYear}`);

  const params = new URLSearchParams({
    method: "getList",
    apiKey: KOSIS_KEY,
    orgId: "116",
    tblId: "DT_MLTM_2100",
    itmId: "ALL",
    objL1: "ALL",
    prdSe: "A",
    startPrdDe: startYear,
    endPrdDe: endYear,
    format: "json",
    jsonVD: "Y",
  });

  const apiUrl = `https://kosis.kr/openapi/Param/statisticsParameterData.do?${params}`;
  let data;
  try {
    const res = await fetchWithRetry(apiUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    try {
      data = await res.json();
    } catch {
      throw new Error("JSON 파싱 실패");
    }
  } catch (err) {
    throw new Error(`KOSIS ${err instanceof Error ? err.message : String(err)}`);
  }
  if (data.err) throw new Error(`KOSIS 에러: ${data.errMsg || data.err}`);

  const rows = Array.isArray(data) ? data : [];
  log(PHASE, `KOSIS 응답: ${rows.length}건`);

  if (rows.length === 0) {
    log(PHASE, "데이터 없음 — 종료");
    return;
  }

  const supplyByRegion = parseKosisRows(rows);
  const summary = Object.entries(supplyByRegion).map(([r, v]) => `${r}=${v.toFixed(1)}%`).join(", ");
  log(PHASE, `시도별 주택보급률: ${summary}`);

  if (Object.keys(supplyByRegion).length === 0) {
    log(PHASE, `ITM_NM='${ITM_NM_FILTER}' 매칭 0건 — 종료 (KOSIS 응답 형식 변경 의심)`);
    return;
  }

  // regions UPDATE (gu IS NULL 17행, housing-permits 답습 패턴)
  const { data: regions, error: rErr } = await sb
    .from("regions")
    .select("id, region, gu, housing_supply_level")
    .is("gu", null);

  if (rErr) {
    logError(PHASE, `regions 조회 실패: ${rErr.message}`);
    return;
  }

  /** @type {Array<{ id: string; region: string; gu: string | null; housing_supply_level: number | null }>} */
  const regionsTyped = /** @type {any} */ (regions ?? []);

  let updated = 0;
  for (const reg of regionsTyped) {
    const value = supplyByRegion[reg.region];
    if (value == null) continue;
    if (reg.housing_supply_level != null && Math.abs(reg.housing_supply_level - value) < 0.05) continue;

    if (dryRun) {
      log(PHASE, `  [DRY-RUN] regions ${reg.region}: ${reg.housing_supply_level ?? "NULL"} → ${value.toFixed(1)}%`);
      updated++;
      continue;
    }

    const { error } = await sb.from("regions").update({
      housing_supply_level: value,
    }).eq("id", reg.id);

    if (error) logError(PHASE, `  regions ${reg.id} UPDATE 실패: ${error.message}`);
    else updated++;
  }

  log(PHASE, `regions 갱신: ${updated}건 / ${regionsTyped.length}건 대상`);

  if (!dryRun) await recordApiQuota(PHASE, "KOSIS_KEY", 1);

  log(PHASE, "\n=== 완료 ===");
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((/** @type {unknown} */ err) => {
  logError(PHASE, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
