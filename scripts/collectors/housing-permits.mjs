// @ts-check
/**
 * 국토부 주택 인허가 현황 → 시군구별 공급비율 수집
 *
 * API: 국토교통부_주택인허가현황 (data.go.kr)
 *
 * 사용법:
 *   node scripts/collectors/housing-permits.mjs          (Supabase regions 테이블 업데이트)
 *   node scripts/collectors/housing-permits.mjs --dry-run (미리보기만)
 *
 * 필요 환경변수:
 *   MOLIT_KEY           — data.go.kr 인증키 (국토부 API)
 *   SUPABASE_URL        — Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_KEY — Supabase service_role 키
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, REGION_MAP, today, recordApiQuota } from "./_shared.mjs";

loadEnv();

const API_KEY = process.env.MOLIT_KEY;
if (!API_KEY) {
  logError("init", "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)");
  process.exit(1);
}

const BASE_URL = "https://apis.data.go.kr/1613000/ArchPmsService_v2/getApHsptPrmsnLst";

/**
 * @typedef {{ hshldCo?: string; hhldCo?: string; [k: string]: unknown }} PermitItem
 * @typedef {{ count: number; units: number }} PermitSummary
 */

// ── 인허가 데이터 조회 ────────────────────────────────────
/**
 * @param {string} sigunguCd
 * @param {number} year
 * @returns {Promise<PermitItem[]>}
 */
async function fetchPermits(sigunguCd, year) {
  const params = new URLSearchParams({
    serviceKey: API_KEY || "",
    pageNo: "1",
    numOfRows: "100",
    type: "json",
    sigunguCd,
    approvalYmd: `${year}0101`,
    approvalEndYmd: `${year}1231`,
  });

  const url = `${BASE_URL}?${params}`;
  const res = await fetchWithRetry(url, {}, 3);
  if (!res || !res.ok) return [];

  const json = /** @type {{ response?: { body?: { totalCount?: number; items?: { item?: PermitItem | PermitItem[] } } } }} */ (await res.json());
  const body = json?.response?.body;
  if (!body || body.totalCount === 0) return [];

  const items = body.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

// ── 시도별 시군구 코드 목록 ──────────────────────────────
// 주요 시도 코드 (법정동 코드 앞 5자리)
/** @type {Record<string, string>} */
const SIDO_CODES = {
  "서울": "11", "부산": "26", "대구": "27", "인천": "28",
  "광주": "29", "대전": "30", "울산": "31", "세종": "36",
  "경기": "41", "강원": "42", "충북": "43", "충남": "44",
  "전북": "45", "전남": "46", "경북": "47", "경남": "48", "제주": "50",
};

// ── 시도명 역매핑 ────────────────────────────────────────
/**
 * @param {string | null | undefined} fullName
 * @returns {string | null}
 */
export function resolveRegion(fullName) {
  if (!fullName) return null;
  if (REGION_MAP[fullName]) return REGION_MAP[fullName] || null;
  for (const [k, v] of Object.entries(REGION_MAP)) {
    if (fullName.includes(v) || k.includes(fullName)) return v;
  }
  return null;
}

// ── 메인 ─────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const now = new Date();
  const curYear = now.getFullYear();
  const prevYear = curYear - 1;

  log("init", `대상: ${prevYear}년 주택 인허가 현황`);

  // 1. 시도별로 인허가 데이터 조회
  /** @type {Record<string, PermitSummary>} */
  const permitsByRegion = {};
  let totalFetched = 0;
  let apiCalls = 0;

  for (const [region, sidoCd] of Object.entries(SIDO_CODES)) {
    try {
      // 시도 단위로 조회 (sigunguCd에 시도코드만 넣으면 시도 전체)
      const items = await fetchPermits(sidoCd, prevYear);
      apiCalls++;
      totalFetched += items.length;

      let totalUnits = 0;
      for (const item of items) {
        // 세대수 필드: hshldCo (세대수) 또는 hhldCo
        const units = parseInt(String(item.hshldCo || item.hhldCo || "0"), 10);
        totalUnits += units;
      }

      permitsByRegion[region] = {
        count: items.length,
        units: totalUnits,
      };

      log("fetch", `${region}: ${items.length}건, ${totalUnits.toLocaleString()}세대`);

      // API 레이트 리밋 방지
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError("fetch", `${region}: ${msg}`);
    }
  }

  log("fetch", `총 ${totalFetched}건 조회 완료`);

  // 2. 기존 regions 데이터에서 가구 수 가져오기 (supply_ratio 계산용)
  const sb = getSupabase();
  const { data: regionData, error: rErr } = await sb
    .from("regions")
    .select("region, households, population")
    .is("gu", null)
    .order("recorded_at", { ascending: false });

  if (rErr) {
    logError("db", `regions 조회 실패: ${rErr.message}`);
    process.exit(1);
  }

  // 시도별 최신 가구 수
  /** @type {Record<string, number>} */
  const householdMap = {};
  for (const r of /** @type {Array<{ region: string; households: number | null; population: number | null }>} */ (regionData)) {
    if (householdMap[r.region] === undefined) {
      householdMap[r.region] = r.households || r.population || 0; // 가구수 없으면 인구수 사용
    }
  }

  // 3. supply_ratio 계산 + 업데이트 rows
  /** @type {Array<{ region: string; gu: null; supply_ratio: number | null; recorded_at: string }>} */
  const rows = [];
  for (const [region, data] of Object.entries(permitsByRegion)) {
    const base = householdMap[region];
    /** @type {number | null} */
    let supplyRatio = null;

    if (base && base > 0 && data.units > 0) {
      supplyRatio = Math.round((data.units / base) * 100 * 10) / 10; // 소수점 1자리
    }

    rows.push({
      region,
      gu: null,
      supply_ratio: supplyRatio,
      recorded_at: `${prevYear}-12-01`,
    });
  }

  log("calc", `${rows.length}건 공급비율 계산 완료`);

  // 요약 출력
  const withRatio = rows.filter(r => r.supply_ratio != null);
  const avgRatio = withRatio.length > 0
    ? (withRatio.reduce((s, r) => s + (r.supply_ratio || 0), 0) / withRatio.length).toFixed(1)
    : "N/A";
  log("summary", `공급비율 산출: ${withRatio.length}건, 평균: ${avgRatio}%`);

  if (dryRun) {
    log("dry-run", "미리보기 모드 — 업데이트 생략");
    console.log("\n시도별 주택 인허가 현황:");
    for (const r of rows.sort((a, b) => (b.supply_ratio ?? 0) - (a.supply_ratio ?? 0))) {
      const data = permitsByRegion[r.region];
      if (!data) continue;
      console.log(`  ${r.region}: ${data.count}건, ${data.units.toLocaleString()}세대, 공급비율=${r.supply_ratio ?? "N/A"}%`);
    }
    return;
  }

  // 4. Supabase 업데이트 (기존 행의 supply_ratio만 갱신)
  let updated = 0;
  for (const r of rows) {
    if (r.supply_ratio == null) continue;
    const { error } = await sb
      .from("regions")
      .update({ supply_ratio: r.supply_ratio })
      .eq("region", r.region)
      .is("gu", null)
      .order("recorded_at", { ascending: false })
      .limit(1);

    if (error) logError("upsert", `${r.region}: ${error.message}`);
    else updated++;
  }

  await recordApiQuota("housing-permits", "MOLIT_KEY", apiCalls);
  log("done", `regions 테이블 supply_ratio ${updated}건 업데이트 완료 (${today()})`);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });
