// @ts-check
/**
 * 행안부 성/연령별 주민등록 인구 API → regions.sex_age JSONB 채움 (세션 242 W6-A)
 *
 * API: data.go.kr #15108074 (법정동별 행정동 통반단위 성/연령별 주민등록 인구수)
 * endpoint: apis.data.go.kr/1741000/stdgSexdAgePpltn/selectStdgSexdAgePpltn
 * 응답 필드 22 연령대 (만0~9세 ~ 만100세이상, 남/여 각 11그룹) + 메타.
 *
 * 사용:
 *   node scripts/collectors/population-sex-age.mjs            (regions 업데이트)
 *   node scripts/collectors/population-sex-age.mjs --dry-run  (미리보기)
 *
 * 필요 env:
 *   MOIS_SEX_AGE_KEY     — data.go.kr 인증키 (15108074 전용, MOIS_POP_KEY 와 별)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, logError, createReporter, REGION_MAP, today, recordApiQuota, recordCollectorRun, fetchWithRetry } from "./_shared.mjs";

loadEnv();

const API_KEY = process.env.MOIS_SEX_AGE_KEY;
const BASE_URL = "https://apis.data.go.kr/1741000/stdgSexdAgePpltn/selectStdgSexdAgePpltn";

// 17 시도 법정동코드 (population.mjs L26 답습)
const SIDO_CODES = [
  "1100000000","2600000000","2700000000","2800000000","2900000000",
  "3000000000","3100000000","3600000000","4100000000","4200000000",
  "4300000000","4400000000","4500000000","4600000000","4700000000",
  "4800000000","5000000000",
];

// 22 연령대 필드 (sample 응답 박제: male0~male100 + feml0~feml100, 10세 단위)
/** @type {readonly number[]} */
const AGE_BUCKETS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/**
 * @typedef {Object} SexAgeItem
 * @property {string} stdgCd
 * @property {string} ctpvNm
 * @property {string} sggNm
 * @property {string} statsYm
 * @property {string} totNmprCnt
 * @property {string} maleNmprCnt
 * @property {string} femlNmprCnt
 */

/**
 * @typedef {Object} SexAgeBucket
 * @property {Record<string, number>} male  - {age0: N, age10: N, ..., age100: N}
 * @property {Record<string, number>} feml  - 동일
 * @property {number} totalMale
 * @property {number} totalFeml
 * @property {number} total
 * @property {string} statsYm
 */

/**
 * @param {Record<string, unknown>} item
 * @returns {SexAgeBucket}
 */
function parseSexAge(item) {
  /** @type {Record<string, number>} */
  const male = {};
  /** @type {Record<string, number>} */
  const feml = {};
  for (const age of AGE_BUCKETS) {
    const mKey = `male${age}AgeNmprCnt`;
    const fKey = `feml${age}AgeNmprCnt`;
    male[`age${age}`] = parseInt(String(item[mKey] ?? "0"), 10) || 0;
    feml[`age${age}`] = parseInt(String(item[fKey] ?? "0"), 10) || 0;
  }
  return {
    male,
    feml,
    totalMale: parseInt(String(item.maleNmprCnt ?? "0"), 10) || 0,
    totalFeml: parseInt(String(item.femlNmprCnt ?? "0"), 10) || 0,
    total: parseInt(String(item.totNmprCnt ?? "0"), 10) || 0,
    statsYm: String(item.statsYm ?? ""),
  };
}

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
 * @param {number} year
 * @param {number} month
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function fetchSexAge(year, month) {
  if (!API_KEY) throw new Error("MOIS_SEX_AGE_KEY 환경변수 필요");
  const ym = `${year}${String(month).padStart(2, "0")}`;
  log("fetch", `${year}년 ${month}월 성/연령 인구 조회 (17 시도)...`);

  /** @type {Array<Record<string, unknown>>} */
  const allItems = [];
  for (const stdgCd of SIDO_CODES) {
    const params = new URLSearchParams({
      serviceKey: API_KEY,
      stdgCd,
      srchFrYm: ym,
      srchToYm: ym,
      type: "json",
      numOfRows: "100",
      pageNo: "1",
      lv: "2",       // 시군구 단위
      regSeCd: "1",   // 전체
    });
    try {
      const res = await fetchWithRetry(`${BASE_URL}?${params}`);
      const json = /** @type {any} */ (await res.json());
      const items = json?.Response?.items?.item;
      if (items && Array.isArray(items)) {
        allItems.push(.../** @type {Array<Record<string, unknown>>} */ (items));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("fetch", `  ${stdgCd}: ${msg} — skip`);
    }
    await new Promise(r => setTimeout(r, 150));
  }

  log("fetch", `${year}년 ${month}월: ${allItems.length}건`);
  return allItems;
}

async function main() {
  if (!API_KEY) { logError("init", "MOIS_SEX_AGE_KEY 환경변수 필요 (data.go.kr 15108074 인증키)"); process.exit(1); }
  const dryRun = process.argv.includes("--dry-run");

  // API 데이터 2개월 지연 답습 (population.mjs L122)
  const now = new Date();
  const targetDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const curYear = targetDate.getFullYear();
  const curMonth = targetDate.getMonth() + 1;

  log("init", `대상: ${curYear}년 ${curMonth}월`);

  const items = await fetchSexAge(curYear, curMonth);
  if (!items.length) {
    logError("data", "성/연령 데이터 비어있음. API 키 확인 자리.");
    process.exit(1);
  }

  /** @type {Array<{ region: string, gu: string, sex_age: SexAgeBucket, recorded_at: string }>} */
  const rows = [];
  for (const item of items) {
    const ctpvNm = String(item.ctpvNm ?? "");
    const sggNm = String(item.sggNm ?? "");
    const parsed = parseGu(ctpvNm, sggNm);
    if (!parsed) continue;

    const bucket = parseSexAge(item);
    if (bucket.total <= 0) continue;

    rows.push({
      region: parsed.region,
      gu: parsed.gu,
      sex_age: bucket,
      recorded_at: `${curYear}-${String(curMonth).padStart(2, "0")}-01`,
    });
  }

  log("calc", `${rows.length}건 sex_age 파싱 완료`);

  if (dryRun) {
    log("dry-run", "미리보기 모드");
    console.log("\n시도별 sample (최대 5):");
    for (const r of rows.slice(0, 5)) {
      console.log(`  ${r.region} ${r.gu} (${r.sex_age.statsYm}): 총 ${r.sex_age.total.toLocaleString()}명, M ${r.sex_age.totalMale.toLocaleString()}, F ${r.sex_age.totalFeml.toLocaleString()}`);
    }
    return;
  }

  const sb = getSupabase();
  const rpt = createReporter("population-sex-age");
  let saved = 0;
  for (const row of rows) {
    let q = sb.from("regions")
      .update({ sex_age: row.sex_age })
      .eq("region", row.region)
      .eq("gu", row.gu)
      .eq("recorded_at", row.recorded_at);

    const { data: updated, error: updErr } = await q.select("id");
    if (updErr) {
      logError("regions", `UPDATE 빨강 ${row.region} ${row.gu}: ${updErr.message}`);
      rpt.fail(1);
      continue;
    }

    if (!updated || updated.length === 0) {
      // 행 없음 = INSERT (sex_age 만 박제, 다른 컬럼 default null)
      const { error: insErr } = await sb.from("regions").insert([{
        region: row.region,
        gu: row.gu,
        sex_age: row.sex_age,
        recorded_at: row.recorded_at,
      }]);
      if (insErr) {
        logError("regions", `INSERT 빨강 ${row.region} ${row.gu}: ${insErr.message}`);
        rpt.fail(1);
        continue;
      }
    }
    saved++;
    rpt.success(1);
  }
  log("done", `regions ${saved}/${rows.length}건 sex_age 채움 (${today()})`);
  const result = rpt.summary();

  if (!dryRun) await recordApiQuota("population-sex-age", "MOIS_SEX_AGE_KEY", SIDO_CODES.length);
  await recordCollectorRun("population-sex-age", result);
  if (result.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });

export { resolveRegion, parseGu, parseSexAge, AGE_BUCKETS };
