// @ts-check
/**
 * MOLIT 공동주택공시가격 API → regions.housing_price SMALLINT 채움 (세션 245 W6-C)
 *
 * API: data.go.kr #15045153 (MOLIT 공동주택공시가격)
 * endpoint: 활용신청 승인 후 명세 확정 의무 (placeholder = AptHousingPriceService/getAptHousingPriceList)
 * 응답: 공동주택 단지별 공시가격 (단위/전용면적 별) → 시군구 평균 (만원/㎡) 으로 집계.
 *
 * 사용:
 *   node scripts/collectors/collect-housing-price.mjs            (regions 업데이트)
 *   node scripts/collectors/collect-housing-price.mjs --dry-run  (미리보기)
 *
 * 필요 env:
 *   MOLIT_HOUSING_PRICE_KEY  — data.go.kr 인증키 (15045153 전용, MOLIT_KEY 와 별 endpoint별 발급)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, logError, createReporter, REGION_MAP, today, recordApiQuota, fetchWithRetry } from "./_shared.mjs";

loadEnv();

const API_KEY = process.env.MOLIT_HOUSING_PRICE_KEY;

// 활용신청 승인 후 endpoint 명세 확정 의무 (placeholder).
// 답습: housing-permits.mjs L26 (1613000/ArchPmsService_v2), collect-applyhome.mjs L24 (odcloud.kr)
const BASE_URL = "https://apis.data.go.kr/1613000/AptHousingPriceService/getAptHousingPriceList";

// 17 시도 법정동코드 (population-sex-age.mjs L26 답습)
const SIDO_CODES = [
  "1100000000","2600000000","2700000000","2800000000","2900000000",
  "3000000000","3100000000","3600000000","4100000000","4200000000",
  "4300000000","4400000000","4500000000","4600000000","4700000000",
  "4800000000","5000000000",
];

/**
 * @typedef {Object} HousingPriceItem
 * @property {string} [stdgCd]       - 법정동코드
 * @property {string} [ctpvNm]       - 시도명
 * @property {string} [sggNm]        - 시군구명
 * @property {string} [aptNm]        - 단지명
 * @property {string} [pblntfPc]     - 공시가격 (원)
 * @property {string} [excluseAr]    - 전용면적 (㎡)
 * @property {string} [stdYr]        - 기준년도
 */

/**
 * @param {string | null | undefined} fullName
 * @returns {string | null}
 */
function resolveRegion(fullName) {
  if (!fullName) return null;
  if (REGION_MAP[fullName]) return REGION_MAP[fullName];
  for (const [k, v] of Object.entries(REGION_MAP)) {
    if (fullName.includes(v) || k.includes(fullName)) return v;
  }
  return null;
}

/**
 * @param {string} ctpvNm
 * @param {string} sggNm
 * @returns {{region: string, gu: string} | null}
 */
function parseGu(ctpvNm, sggNm) {
  const region = resolveRegion(ctpvNm);
  if (!region) return null;
  if (region === "세종") return { region, gu: "세종시" };
  if (!sggNm) return null;
  return { region, gu: sggNm };
}

/**
 * 단지별 공시가격 + 전용면적 → 만원/㎡ 단가.
 * @param {Record<string, unknown>} item
 * @returns {number | null}
 */
function unitPriceManwon(item) {
  const pc = parseFloat(String(item.pblntfPc ?? "0"));
  const ar = parseFloat(String(item.excluseAr ?? "0"));
  if (!pc || !ar || ar <= 0) return null;
  // pblntfPc (원) / excluseAr (㎡) / 10000 = 만원/㎡
  return pc / ar / 10000;
}

/**
 * @param {number} year
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function fetchHousingPrice(year) {
  if (!API_KEY) throw new Error("MOLIT_HOUSING_PRICE_KEY 환경변수 필요");
  log("fetch", `${year}년 공동주택공시가격 조회 (17 시도)...`);

  /** @type {Array<Record<string, unknown>>} */
  const allItems = [];
  for (const stdgCd of SIDO_CODES) {
    const params = new URLSearchParams({
      serviceKey: API_KEY,
      stdgCd,
      stdYr: String(year),
      type: "json",
      numOfRows: "1000",
      pageNo: "1",
    });
    try {
      const res = await fetchWithRetry(`${BASE_URL}?${params}`);
      const json = /** @type {any} */ (await res.json());
      const items = json?.response?.body?.items?.item ?? json?.Response?.items?.item;
      if (items && Array.isArray(items)) {
        allItems.push(.../** @type {Array<Record<string, unknown>>} */ (items));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("fetch", `  ${stdgCd}: ${msg} — skip`);
    }
    await new Promise(r => setTimeout(r, 150));
  }

  log("fetch", `${year}년: ${allItems.length}건`);
  return allItems;
}

/**
 * @param {Array<Record<string, unknown>>} items
 * @returns {Map<string, { region: string, gu: string, avgUnitPrice: number, sampleCount: number }>}
 */
function aggregateBySggu(items) {
  /** @type {Map<string, { region: string, gu: string, sum: number, count: number }>} */
  const acc = new Map();
  for (const item of items) {
    const ctpvNm = String(item.ctpvNm ?? "");
    const sggNm = String(item.sggNm ?? "");
    const parsed = parseGu(ctpvNm, sggNm);
    if (!parsed) continue;

    const unit = unitPriceManwon(item);
    if (unit === null) continue;

    const key = `${parsed.region}|${parsed.gu}`;
    const existing = acc.get(key) ?? { region: parsed.region, gu: parsed.gu, sum: 0, count: 0 };
    existing.sum += unit;
    existing.count += 1;
    acc.set(key, existing);
  }

  /** @type {Map<string, { region: string, gu: string, avgUnitPrice: number, sampleCount: number }>} */
  const result = new Map();
  for (const [key, v] of acc) {
    if (v.count < 1) continue;
    result.set(key, {
      region: v.region,
      gu: v.gu,
      avgUnitPrice: v.sum / v.count,
      sampleCount: v.count,
    });
  }
  return result;
}

async function main() {
  if (!API_KEY) { logError("init", "MOLIT_HOUSING_PRICE_KEY 환경변수 필요 (data.go.kr 15045153 인증키)"); process.exit(1); }
  const dryRun = process.argv.includes("--dry-run");

  // 공시가격 = 연 1회 산정 (매년 4월 공시). 직전 연도 사용.
  const now = new Date();
  const targetYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

  log("init", `대상: ${targetYear}년 공시가격`);

  const items = await fetchHousingPrice(targetYear);
  if (!items.length) {
    logError("data", "공동주택공시가격 데이터 비어있음. API 키 + endpoint 명세 확인.");
    process.exit(1);
  }

  const aggregated = aggregateBySggu(items);
  log("calc", `${aggregated.size}건 시군구 평균 집계 완료`);

  /** @type {Array<{ region: string, gu: string, housing_price: number, recorded_at: string, sampleCount: number }>} */
  const rows = [];
  for (const v of aggregated.values()) {
    const sm = Math.round(v.avgUnitPrice);
    // SMALLINT 범위 -32768~32767. 공시가격 만원/㎡ 단위 = 일반 100~5000 범위.
    const clamped = Math.max(0, Math.min(32767, sm));
    rows.push({
      region: v.region,
      gu: v.gu,
      housing_price: clamped,
      recorded_at: `${targetYear}-04-01`,
      sampleCount: v.sampleCount,
    });
  }

  if (dryRun) {
    log("dry-run", "미리보기 모드");
    console.log("\n시군구별 sample (최대 5):");
    for (const r of rows.slice(0, 5)) {
      console.log(`  ${r.region} ${r.gu} (${r.recorded_at}): ${r.housing_price.toLocaleString()} 만원/㎡ (sample ${r.sampleCount}건)`);
    }
    return;
  }

  const sb = getSupabase();
  const rpt = createReporter("housing-price");
  let saved = 0;
  for (const row of rows) {
    /** @type {any} */
    let q = sb.from("regions")
      .update({ housing_price: row.housing_price })
      .eq("region", row.region)
      .eq("gu", row.gu)
      .eq("recorded_at", row.recorded_at);

    const { data: updated, error: updErr } = await q.select("id");
    if (updErr) {
      logError("regions", `UPDATE 실패 ${row.region} ${row.gu}: ${updErr.message}`);
      rpt.fail(1);
      continue;
    }

    if (!updated || updated.length === 0) {
      const { error: insErr } = await sb.from("regions").insert([{
        region: row.region,
        gu: row.gu,
        housing_price: row.housing_price,
        recorded_at: row.recorded_at,
      }]);
      if (insErr) {
        logError("regions", `INSERT 실패 ${row.region} ${row.gu}: ${insErr.message}`);
        rpt.fail(1);
        continue;
      }
    }
    saved++;
    rpt.success(1);
  }
  log("done", `regions ${saved}/${rows.length}건 housing_price 채움 (${today()})`);
  const result = rpt.summary();

  if (!dryRun) await recordApiQuota("housing-price", "MOLIT_HOUSING_PRICE_KEY", SIDO_CODES.length);
  if (result.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });

export { resolveRegion, parseGu, unitPriceManwon, aggregateBySggu };
