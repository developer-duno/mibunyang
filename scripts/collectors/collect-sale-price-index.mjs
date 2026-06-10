// @ts-check
/**
 * KOSIS 매매가격지수 수집기 (BACKLOG KOSIS #1, 세션 269)
 *
 * KOSIS 국가통계포털 DT_KAB_11672_S5 (아파트 매매 실거래가격지수_시군구_분기별,
 * 한국부동산원 orgId=408) 통계표에서 시군구별 분기 매매가격지수(기준 2017.4Q=100)를
 * 수집하여 market_stats_history.sale_price_index 에 시계열 upsert.
 *
 * - prdSe = 'Q' (분기). 응답 PRD_DE 는 5자리(YYYYQ) 또는 6자리(YYYYMM).
 * - 1차원 통계표 — objL1 만 사용. objL2 주면 KOSIS 에러 21.
 * - C1 코드 체계: SSNNN 5자리. 앞 2자리 = 부동산원 자체 시도 순번
 *   (법정동코드·KOSIS_SIDO 와 다른 체계 — KAB_SIDO_PREFIX 상수).
 * - 수도권+광역시 8개 시도(117 시군구)만 제공. 집계행(전국/시도) 없음.
 * - 동명 시군구("중구" 등) 는 C1 앞 2자리로 구분.
 *
 * 주의: market_stats_history.price_index 는 분양가지수(HUG, collect-market-stats)
 *       — 본 수집기는 sale_price_index 만 건드림.
 *
 * 사용법:
 *   node scripts/collectors/collect-sale-price-index.mjs              (Supabase upsert)
 *   node scripts/collectors/collect-sale-price-index.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, upsertBatch, recordApiQuota, recordCollectorRun } from "./_shared.mjs";

/** @typedef {{ C1: string; C1_NM: string; ITM_NM?: string; PRD_DE: string; DT: string }} KabRow */
/** @typedef {{ region: string; gu: string; base_month: string; sale_price_index: number }} MatchedRow */
/** @typedef {{ matched: MatchedRow[]; unmatched: string[]; skipped: number }} ParseResult */

loadEnv();

const PHASE = "kosis-sale-price-index";
const KOSIS_KEY = process.env.KOSIS_KEY;

/**
 * KOSIS DT_KAB_11672_S5 의 C1 코드 앞 2자리 → regions.region.
 * 부동산원 자체 시도 순번 — 법정동코드·KOSIS_SIDO 와 다른 체계, 재사용 금지.
 * 값 출처: DT_KAB_11672_S5 raw API 117 시군구 실측 (2026-05-18).
 * 이 통계표는 수도권+광역시 8개 시도만 제공.
 */
const KAB_SIDO_PREFIX = {
  "10": "서울", "20": "부산", "30": "대구", "40": "인천",
  "50": "광주", "60": "대전", "70": "울산", "80": "경기",
};

/**
 * KOSIS DT_KAB_11672_S5 행 → market_stats_history upsert 용 MatchedRow 배열.
 * - C1 길이 5 아닌 행 → 무시
 * - C1 앞 2자리가 KAB_SIDO_PREFIX 에 없으면 → skipped 증가
 * - 같은 시군구 여러 분기 → 전부 보존 (시계열)
 * @param {KabRow[]} rows
 * @returns {ParseResult}
 */
export function parseKabRows(rows) {
  /** @type {MatchedRow[]} */
  const matched = [];
  /** @type {Set<string>} */
  const unmatchedSet = new Set();
  let skipped = 0;

  for (const row of rows) {
    // 방어: itmId 미지정 호출이라 '지수' 외 ITM 이 섞이면 skip
    if (row.ITM_NM && row.ITM_NM !== "지수") continue;

    const code = String(row.C1 ?? "");
    if (code.length !== 5) continue;

    const period = String(row.PRD_DE ?? "");
    // 분기 응답: 5자리(YYYYQ) 또는 6자리(YYYYMM) 허용 — collect-market-stats 답습
    if (!/^\d{5,6}$/.test(period)) continue;

    const value = parseFloat(row.DT);
    if (!isFinite(value) || value <= 0) continue;

    const region = /** @type {Record<string, string>} */ (KAB_SIDO_PREFIX)[code.slice(0, 2)];
    if (!region) {
      skipped++;
      if (row.C1_NM) unmatchedSet.add(row.C1_NM);
      continue;
    }

    matched.push({ region, gu: row.C1_NM, base_month: period, sale_price_index: value });
  }

  return { matched, unmatched: [...unmatchedSet], skipped };
}

// 세션 395: try/catch/finally 하드닝 — KOSIS 실패가 collector_runs 에 0행으로
// 남는 사각 정정 (PR #97 collect-regional-economy 패턴 답습).
export async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  let ok = 0;
  let skip = 0;
  let errorMessage = /** @type {string | undefined} */ (undefined);
  try {
    if (!KOSIS_KEY) throw new Error("KOSIS_KEY not configured");

    const sb = getSupabase();

    // KOSIS API 호출 (DT_KAB_11672_S5 분기, 1차원 → objL1 만)
    const now = new Date();
    const curQ = Math.ceil((now.getMonth() + 1) / 3);
    const endPrd = `${now.getFullYear()}${curQ}`;
    const startPrd = `${now.getFullYear() - 2}${curQ}`;

    log(PHASE, `KOSIS 매매가격지수 조회: ${startPrd} ~ ${endPrd}`);

    const params = new URLSearchParams({
      method: "getList",
      apiKey: KOSIS_KEY,
      orgId: "408",
      tblId: "DT_KAB_11672_S5",
      itmId: "ALL",
      objL1: "ALL",
      prdSe: "Q",
      startPrdDe: startPrd,
      endPrdDe: endPrd,
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

    const { matched, unmatched, skipped } = parseKabRows(rows);
    log(PHASE, `시군구 매칭: ${matched.length}개 / skip ${skipped}개`);
    if (unmatched.length > 0) {
      logError(PHASE, `시도 미판정 시군구 ${unmatched.length}개: ${unmatched.join(", ")}`);
    }

    if (matched.length === 0) {
      log(PHASE, "매칭 0건 — 종료 (KOSIS 응답 형식 변경 의심)");
      return;
    }

    if (dryRun) {
      log(PHASE, `[DRY-RUN] market_stats_history upsert: ${matched.length}건 예상`);
      log(PHASE, `[DRY-RUN] 샘플: ${JSON.stringify(matched.slice(0, 3))}`);
    } else {
      const inserted = await upsertBatch("market_stats_history", matched, "region,gu,base_month", 500, sb);
      log(PHASE, `market_stats_history upsert: ${inserted}건`);
    }

    if (!dryRun) await recordApiQuota(PHASE, "KOSIS_KEY", 1);
    ok = matched.length;
    skip = skipped;

    log(PHASE, "\n=== 완료 ===");
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await recordCollectorRun(PHASE, errorMessage
      ? { ok, skip, status: "failure", errorMessage }
      : { ok, skip });
  }
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((/** @type {unknown} */ err) => {
  logError(PHASE, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
