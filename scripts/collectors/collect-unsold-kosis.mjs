// @ts-check
/**
 * KOSIS 시군구별 미분양 세대수 수집기
 *
 * KOSIS 국가통계포털 DT_MLTM_2082 테이블에서 (세션 222 통계표 이전: DT_1YL202001E → DT_MLTM_2082)
 * 시군구별 월별 미분양 세대수를 수집하여
 * regions.regional_unsold + apartments.unsold/unsold_rate 업데이트
 *
 * 사용법:
 *   node scripts/collectors/collect-unsold-kosis.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-unsold-kosis.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, REGION_MAP, fetchWithRetry, upsertBatch, recordApiQuota, recordCollectorRun, setupGracefulShutdown } from "./_shared.mjs";

/** @typedef {{ C1_NM: string; C2_NM: string; PRD_DE: string; DT: string }} KosisRow */
/** @typedef {Record<string, Record<string, Record<string, number>>>} UnsoldByRegionGuMonth */
/** @typedef {Record<string, Record<string, number>>} UnsoldByRegionGu */
/** @typedef {Record<string, number>} RegionTotals */

loadEnv();

const PHASE = "kosis-unsold";
const KOSIS_KEY = process.env.KOSIS_KEY;

/**
 * KOSIS 응답 행 → 시군구별 월별 미분양 맵 (전 월 유지)
 * 구조: { "서울::강남구": { "202601": 42, "202602": 38, "202603": 35 } }
 *
 * parseKosisRows 와 달리 모든 월 데이터를 보존 → unsold_history 시계열 upsert 용도.
 * 기존 parseKosisRows 는 "최신 월 단일값" 으로 regions/apartments 갱신에 사용 (병존).
 * PRD_DE 정규식 가드: KOSIS 응답이 YYYYMM 외 포맷(분기/반기 등) 반환 시 방어.
 *
 * @param {KosisRow[]} rows
 * @returns {UnsoldByRegionGuMonth}
 */
export function parseKosisRowsAllMonths(rows) {
  /** @type {UnsoldByRegionGuMonth} */
  const unsoldByRegionGuMonth = {};
  for (const row of rows) {
    if (!/^\d{6}$/.test(row.PRD_DE)) continue;
    const region = /** @type {Record<string, string>} */ (REGION_MAP)[row.C1_NM];
    if (!region) continue;
    const gu = row.C2_NM === "계" ? "_total" : row.C2_NM;
    const period = row.PRD_DE;
    const value = parseInt(row.DT, 10);
    if (isNaN(value)) continue;

    if (!unsoldByRegionGuMonth[region]) unsoldByRegionGuMonth[region] = {};
    if (!unsoldByRegionGuMonth[region][gu]) unsoldByRegionGuMonth[region][gu] = {};
    unsoldByRegionGuMonth[region][gu][period] = value;
  }
  return unsoldByRegionGuMonth;
}

/**
 * KOSIS 응답 행 → 시군구별 미분양 집계 (최신 월만)
 * @param {KosisRow[]} rows
 * @returns {UnsoldByRegionGu}
 */
export function parseKosisRows(rows) {
  /** @type {UnsoldByRegionGu} */
  const unsoldByRegionGu = {};
  /** @type {Record<string, string>} */
  const latestPeriod = {};

  for (const row of rows) {
    const region = /** @type {Record<string, string>} */ (REGION_MAP)[row.C1_NM];
    if (!region) continue;

    const gu = row.C2_NM === "계" ? "_total" : row.C2_NM;
    const period = row.PRD_DE;
    const value = parseInt(row.DT, 10);
    if (isNaN(value)) continue;

    const key = `${region}::${gu}`;
    if (!latestPeriod[key] || period > latestPeriod[key]) {
      latestPeriod[key] = period;
      if (!unsoldByRegionGu[region]) unsoldByRegionGu[region] = {};
      unsoldByRegionGu[region][gu] = value;
    }
  }

  return unsoldByRegionGu;
}

/**
 * 시군구 미분양 맵 → 시도별 합계
 * @param {UnsoldByRegionGu} unsoldByRegionGu
 * @returns {RegionTotals}
 */
export function aggregateRegionTotals(unsoldByRegionGu) {
  /** @type {RegionTotals} */
  const regionTotals = {};
  for (const [region, guMap] of Object.entries(unsoldByRegionGu)) {
    if (guMap["소계"] != null) {
      regionTotals[region] = guMap["소계"];
    } else if (guMap["_total"] != null) {
      regionTotals[region] = guMap["_total"];
    } else {
      regionTotals[region] = Object.values(guMap).reduce((s, v) => s + v, 0);
    }
  }
  return regionTotals;
}

/**
 * 비례배분 미분양 추정
 * @param {number | null | undefined} guUnsold
 * @param {number | null | undefined} aptUnits
 * @param {number | null | undefined} totalUnitsInGu
 * @returns {{ estimated: number; unsoldRate: number } | null}
 */
export function calcProportionalUnsold(guUnsold, aptUnits, totalUnitsInGu) {
  if (!guUnsold || guUnsold <= 0 || !aptUnits || aptUnits <= 0 || !totalUnitsInGu || totalUnitsInGu <= 0) return null;
  const estimated = Math.round(guUnsold * (aptUnits / totalUnitsInGu));
  if (estimated <= 0) return null;
  const unsoldRate = Math.round(estimated / aptUnits * 1000) / 10;
  if (unsoldRate > 100) return null; // 비정상 값 방지
  return { estimated, unsoldRate };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");
  if (!KOSIS_KEY) throw new Error("KOSIS_KEY not configured");

  const isInterrupted = setupGracefulShutdown(PHASE);  // 세션 321: graceful shutdown
  const sb = getSupabase();

  // 월간 데이터 조회 (DT_MLTM_2082 시군구별 미분양, 1~2개월 지연)
  const now = new Date();
  const endMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const startMonth = `${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, "0")}`;

  log(PHASE, `KOSIS 미분양 조회: ${startMonth} ~ ${endMonth}`);

  // KOSIS API 호출
  const params = new URLSearchParams({
    method: "getList",
    apiKey: KOSIS_KEY,
    orgId: "116",
    tblId: "DT_MLTM_2082",
    itmId: "ALL",
    objL1: "ALL",
    objL2: "ALL",
    prdSe: "M",
    startPrdDe: startMonth,
    endPrdDe: endMonth,
    format: "json",
    jsonVD: "Y",
  });

  // 세션118: raw https.request → fetchWithRetry (429/500/503 + ECONNRESET 지수 백오프 3회).
  // AbortSignal.timeout(30s)은 fetchWithRetry 내부에 포함. 에러 prefix `KOSIS ...` 유지.
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

  const unsoldByRegionGu = parseKosisRows(rows);
  const regionTotals = aggregateRegionTotals(unsoldByRegionGu);

  log(PHASE, `시도별 미분양: ${Object.entries(regionTotals).map(([r, v]) => `${r}=${v}`).join(", ")}`);

  // 1. regions 테이블 업데이트
  const { data: regions, error: rErr } = await sb
    .from("regions")
    .select("id, region, gu, regional_unsold");

  let regUpdated = 0;
  if (rErr) {
    logError(PHASE, `regions 조회 실패: ${rErr.message}`);
  } else {
    for (const reg of /** @type {Array<{ id: string; region: string; gu: string | null; regional_unsold: number | null }>} */ (regions)) {
      if (isInterrupted()) break;  // 세션 321: graceful shutdown
      const guMap = unsoldByRegionGu[reg.region];
      if (!guMap) continue;

      // 시군구 매칭 (gu가 있으면 시군구별, 없으면 시도별)
      /** @type {number | null} */
      let unsoldValue = null;
      if (reg.gu && guMap[reg.gu] != null) {
        unsoldValue = guMap[reg.gu];
      } else if (regionTotals[reg.region] != null) {
        unsoldValue = regionTotals[reg.region];
      }

      if (unsoldValue == null || unsoldValue === reg.regional_unsold) continue;

      if (dryRun) {
        log(PHASE, `  [DRY-RUN] regions ${reg.region} ${reg.gu || ""}: ${reg.regional_unsold} → ${unsoldValue}`);
        regUpdated++;
        continue;
      }

      const { error } = await sb.from("regions").update({
        regional_unsold: unsoldValue,
      }).eq("id", reg.id);

      if (error) logError(PHASE, `  regions ${reg.id} UPDATE 실패: ${error.message}`);
      else regUpdated++;
    }
    log(PHASE, `regions 갱신: ${regUpdated}건`);
  }

  // 2. apartments unsold 추정 (KOSIS 비례배분)
  const { data: apartments, error: aErr } = await sb
    .from("apartments")
    .select("id, name, region, gu, units, unsold, unsold_rate, naver_sell_count");

  if (aErr) {
    logError(PHASE, `apartments 조회 실패: ${aErr.message}`);
    return;
  }

  /** @typedef {{ id: string; name: string; region: string | null; gu: string | null; units: number | null; unsold: number | null; unsold_rate: number | null; naver_sell_count: number | null }} AptRow */
  const apartmentsTyped = /** @type {AptRow[]} */ (apartments);

  // 시군구별 총 분양세대수 계산
  /** @type {Record<string, number>} */
  const unitsByGu = {};
  for (const apt of apartmentsTyped) {
    if (!apt.region || !apt.gu || !apt.units) continue;
    const key = `${apt.region}::${apt.gu}`;
    unitsByGu[key] = (unitsByGu[key] || 0) + apt.units;
  }

  let aptUpdated = 0;
  for (const apt of apartmentsTyped) {
    // 이미 확인된 값이 있으면 건너뜀 (우선순위: 청약홈 > 네이버 > KOSIS)
    if (apt.unsold != null && apt.unsold > 0) continue;
    if (apt.naver_sell_count != null && apt.naver_sell_count > 0) continue;
    if (!apt.region || !apt.gu || !apt.units || apt.units <= 1) continue;

    // 시군구별 미분양 총량 조회
    const guMap = unsoldByRegionGu[apt.region];
    const guUnsold = guMap?.[apt.gu] ?? regionTotals[apt.region] ?? null;
    if (guUnsold == null || guUnsold <= 0) continue;

    // 비례배분
    const guKey = `${apt.region}::${apt.gu}`;
    const totalUnitsInGu = unitsByGu[guKey] || apt.units;
    const result = calcProportionalUnsold(guUnsold, apt.units, totalUnitsInGu);
    if (!result) continue;

    const { estimated, unsoldRate } = result;

    if (dryRun) {
      log(PHASE, `  [DRY-RUN] ${apt.name} (${apt.region} ${apt.gu}): unsold=${estimated}, rate=${unsoldRate}%`);
      aptUpdated++;
      continue;
    }

    const { error } = await sb.from("apartments").update({
      unsold: estimated,
      unsold_rate: unsoldRate,
      updated_at: new Date().toISOString(),
    }).eq("id", apt.id);

    if (error) logError(PHASE, `  ${apt.name} UPDATE 실패: ${error.message}`);
    else aptUpdated++;
  }

  log(PHASE, `apartments 미분양 추정 갱신: ${aptUpdated}건`);

  // 3. unsold_history 시계열 upsert (세션134, 방향 A)
  // KOSIS 단일 API 호출 응답(3개월 범위)을 재파싱하여 월별 시계열 저장.
  // API 재호출 아님 → 쿼터 증가 0.
  const allMonthsMap = parseKosisRowsAllMonths(rows);
  /** @type {Array<{ apartment_id: string; base_month: string; unsold_count: number; post_completion_unsold: number | null; change: number | null; recorded_at: string }>} */
  const historyRows = [];
  const todayDate = new Date().toISOString().slice(0, 10);
  for (const apt of apartmentsTyped) {
    if (!apt.region || !apt.gu || !apt.units || apt.units <= 1) continue;
    const monthMap = allMonthsMap[apt.region]?.[apt.gu];
    if (!monthMap) continue;
    const guKey = `${apt.region}::${apt.gu}`;
    const totalUnitsInGu = unitsByGu[guKey] || apt.units;
    for (const [period, guUnsold] of Object.entries(monthMap)) {
      const result = calcProportionalUnsold(guUnsold, apt.units, totalUnitsInGu);
      if (!result) continue;
      historyRows.push({
        apartment_id: apt.id,
        base_month: period,
        unsold_count: result.estimated,
        post_completion_unsold: null,
        change: null,
        recorded_at: todayDate,
      });
    }
  }

  if (dryRun) {
    log(PHASE, `[DRY-RUN] unsold_history: ${historyRows.length}건 예상`);
  } else if (historyRows.length > 0) {
    const inserted = await upsertBatch("unsold_history", historyRows, "apartment_id,base_month", 500, sb);
    log(PHASE, `unsold_history 저장: ${inserted}건`);
  } else {
    log(PHASE, "unsold_history 저장: 0건 (대상 없음)");
  }

  // 4. API 쿼터 기록 (KOSIS 단일 호출)
  if (!dryRun) await recordApiQuota(PHASE, "KOSIS_KEY", 1);
  await recordCollectorRun(PHASE, { ok: regUpdated + aptUpdated });

  log(PHASE, "\n=== 완료 ===");
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((/** @type {unknown} */ err) => {
  logError(PHASE, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
