// @ts-check
/**
 * KOSIS 전세가격지수 수집기 (BACKLOG KOSIS #2, 세션 270)
 *
 * KOSIS 국가통계포털 DT_30404_B013 (유형별 전세가격지수, 한국부동산원 orgId=408)
 * 통계표에서 시군구별 월간 전세가격지수를 수집하여
 * market_stats_history.jeonse_price_index 에 시계열 upsert.
 *
 * - 2차원 통계표 — objL1(C1=주택유형) + objL2(C2=지역) 둘 다 ALL 필수.
 * - C1_NM === '아파트' 행만 사용 (종합/연립다세대/단독주택 버림).
 * - prdSe = 'M' (월간). 응답 PRD_DE 6자리(YYYYMM) 고정.
 * - C2 코드 = 부동산원 권역 트리. 코드 앞 2자리 = 시도 prefix
 *   (법정동코드·KOSIS_SIDO·KAB_SIDO_PREFIX 와 다른 체계 — KAB_REGION_PREFIX 상수).
 * - 권역 트리에서 시군구행만 추출: 집계행(전국/수도권/지방)·시도행·권역행
 *   (강북권역 등)·세부행정구(만안/분당 등 8자리)는 전부 버림.
 * - 시군구 판별은 regions.gu 이름 대조 — main() 이 regionGuMap 빌드해 전달.
 * - 동명 시군구("중" 등) 는 C2 코드 prefix 로 시도 선확정 후 구분.
 *
 * 주의: market_stats_history.price_index 는 분양가지수(HUG, collect-market-stats),
 *       sale_price_index 는 매매 실거래가격지수(collect-sale-price-index)
 *       — 본 수집기는 jeonse_price_index 만 건드림.
 *
 * 사용법:
 *   node scripts/collectors/collect-jeonse-price-index.mjs              (Supabase upsert)
 *   node scripts/collectors/collect-jeonse-price-index.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, upsertBatch, recordApiQuota, recordCollectorRun } from "./_shared.mjs";

/** @typedef {{ C1_NM: string; C2: string; C2_NM: string; ITM_NM?: string; PRD_DE: string; DT: string }} KabRow */
/** @typedef {{ region: string; gu: string; base_month: string; jeonse_price_index: number }} MatchedRow */
/** @typedef {{ matched: MatchedRow[]; unmatched: string[]; skipped: number }} ParseResult */

loadEnv();

const PHASE = "kosis-jeonse-price-index";
const KOSIS_KEY = process.env.KOSIS_KEY;

/**
 * KOSIS DT_30404_B013 의 C2(지역) 코드 prefix → regions.region.
 * 한국부동산원 권역 트리 — 법정동코드·KOSIS_SIDO·KAB_SIDO_PREFIX 와 별개 체계, 재사용 금지.
 * 값 출처: DT_30404_B013 raw API 아파트 234행 실측 (2026-05-18).
 * 집계 prefix(a0/a1/a2/a4/a6/d1/d2)는 키에 없음 → 자동 skip.
 */
const KAB_REGION_PREFIX = {
  a7: "서울", a8: "경기", a9: "인천",
  b1: "부산", b2: "대구", b3: "광주", b4: "대전", b5: "울산", b6: "세종",
  c1: "강원", c2: "충북", c3: "충남", c4: "전북", c5: "전남", c6: "경북", c7: "경남", c8: "제주",
};

/**
 * KOSIS DT_30404_B013 행 → market_stats_history upsert 용 MatchedRow 배열.
 * - C1_NM 이 '아파트' 아닌 행 → 무시 (주택유형 필터)
 * - C2 prefix 2자리가 KAB_REGION_PREFIX 에 없으면 → skipped 증가 (집계행 탈락)
 * - region 확정 후 그 시도 gu Set 에서 C2_NM + 접미사 매칭 실패 → unmatched
 *   (시도행/권역행/세부행정구 탈락)
 * - 같은 시군구 여러 월 → 전부 보존 (시계열)
 * @param {KabRow[]} rows
 * @param {Map<string, Set<string>>} regionGuMap  region → 그 시도의 regions.gu 집합
 * @returns {ParseResult}
 */
export function parseKabRows(rows, regionGuMap) {
  /** @type {MatchedRow[]} */
  const matched = [];
  /** @type {Set<string>} */
  const unmatchedSet = new Set();
  let skipped = 0;

  for (const row of rows) {
    // 주택유형 필터 — objL1=ALL 호출이라 종합/연립다세대/단독주택 행이 섞임
    if (row.C1_NM !== "아파트") continue;

    // 방어: ITM 이 '전세가격' 외 (변동률 등) 섞이면 skip
    if (row.ITM_NM && row.ITM_NM !== "전세가격") continue;

    const period = String(row.PRD_DE ?? "");
    // 월간 응답 — PRD_DE 6자리(YYYYMM) 고정
    if (!/^\d{6}$/.test(period)) continue;

    const value = parseFloat(row.DT);
    if (!isFinite(value) || value <= 0) continue;

    const code = String(row.C2 ?? "");
    const region = /** @type {Record<string, string>} */ (KAB_REGION_PREFIX)[code.slice(0, 2)];
    if (!region) {
      skipped++;
      continue;
    }

    // 시도행 제외 — C2 코드가 prefix 키 자체(a7/b6/c8 등)면 시도 단위 집계행.
    // 세종/제주는 시도명+접미사("세종시"/"제주시")가 regions.gu 에 존재해
    // 시도행이 시군구로 오매칭 → 중복 키 발생. 세부행정구(c801 등)만 시군구.
    if (Object.prototype.hasOwnProperty.call(KAB_REGION_PREFIX, code)) {
      skipped++;
      if (row.C2_NM) unmatchedSet.add(row.C2_NM);
      continue;
    }

    // region 의 regions.gu 집합에서 C2_NM + 접미사 매칭 → 정식 gu 명 확정
    const guSet = regionGuMap.get(region);
    let gu = null;
    if (guSet) {
      for (const suffix of ["구", "시", "군", ""]) {
        if (guSet.has(row.C2_NM + suffix)) {
          gu = row.C2_NM + suffix;
          break;
        }
      }
    }

    if (!gu) {
      // 시도행/권역행/세부행정구 — 의도된 버림
      skipped++;
      if (row.C2_NM) unmatchedSet.add(row.C2_NM);
      continue;
    }

    matched.push({ region, gu, base_month: period, jeonse_price_index: value });
  }

  return { matched, unmatched: [...unmatchedSet], skipped };
}

/** @returns {string} 현재 기준 YYYYMM */
function ymOf(/** @type {Date} */ d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 세션 394: try/catch/finally 하드닝 — KOSIS 러너 차단(6/9~) 중 실패가
// collector_runs 에 0행으로 남는 사각 정정 (PR #83 sync-naver 패턴 답습).
export async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  let ok = 0;
  let skip = 0;
  let errorMessage = /** @type {string | undefined} */ (undefined);
  try {
    if (!KOSIS_KEY) throw new Error("KOSIS_KEY not configured");

    const sb = getSupabase();

    // KOSIS API 호출 (DT_30404_B013 월간, 2차원 → objL1 + objL2)
    const now = new Date();
    const endPrd = ymOf(now);
    const start = new Date(now.getFullYear(), now.getMonth() - 24, 1);
    const startPrd = ymOf(start);

    log(PHASE, `KOSIS 전세가격지수 조회: ${startPrd} ~ ${endPrd}`);

    const params = new URLSearchParams({
      method: "getList",
      apiKey: KOSIS_KEY,
      orgId: "408",
      tblId: "DT_30404_B013",
      itmId: "ALL",
      objL1: "ALL",
      objL2: "ALL",
      prdSe: "M",
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

    // regions 조회 → Map<region, Set<gu>> 빌드 (시군구 판별용)
    const { data: regions, error: rErr } = await sb
      .from("regions")
      .select("region, gu")
      .not("gu", "is", null);

    if (rErr) {
      logError(PHASE, `regions 조회 실패: ${rErr.message}`);
      return;
    }

    /** @type {Array<{ region: string; gu: string | null }>} */
    const regionsTyped = /** @type {any} */ (regions ?? []);
    /** @type {Map<string, Set<string>>} */
    const regionGuMap = new Map();
    for (const reg of regionsTyped) {
      if (!reg.gu) continue;
      const gu = reg.gu.trim();
      if (!gu) continue;
      if (!regionGuMap.has(reg.region)) regionGuMap.set(reg.region, new Set());
      (regionGuMap.get(reg.region) ?? new Set()).add(gu);
    }

    const { matched, unmatched, skipped } = parseKabRows(rows, regionGuMap);
    const uniqueGu = new Set(matched.map((m) => `${m.region}::${m.gu}`)).size;
    log(PHASE, `시군구 매칭: ${uniqueGu}개 (총 ${matched.length}행) / skip ${skipped}건`);
    if (unmatched.length > 0) {
      logError(PHASE, `시군구 미판정 ${unmatched.length}개: ${unmatched.join(", ")}`);
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
    ok = uniqueGu;
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
