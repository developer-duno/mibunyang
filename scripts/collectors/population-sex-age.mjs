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
import { loadEnv, getSupabase, log, logError, createReporter, REGION_MAP, today, recordApiQuota, recordCollectorRun, fetchWithRetry, normalizeGu } from "./_shared.mjs";

loadEnv();

const API_KEY = process.env.MOIS_SEX_AGE_KEY;
const BASE_URL = "https://apis.data.go.kr/1741000/stdgSexdAgePpltn/selectStdgSexdAgePpltn";

// 17 시도 법정동코드 (population.mjs L26 답습)
// 세션 286 동시 fix — SIDO_CODES 환각 3건 정정 (세종/강원/전북)
//   3600000000 → 3611000000 (세종, 이전 빈 응답)
//   4200000000 → 5100000000 (강원, 이전 빈 응답)
//   4500000000 → 5200000000 (전북, 이전 빈 응답)
const SIDO_CODES = [
  "1100000000","2600000000","2700000000","2800000000","2900000000",
  "3000000000","3100000000","3611000000","4100000000","5100000000",
  "4300000000","4400000000","5200000000","4600000000","4700000000",
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
 * @returns {{region: string, gu: string, folded: boolean} | null}
 */
function parseGu(ctpvNm, sggNm) {
  const region = resolveRegion(ctpvNm);
  if (!region) return null;
  if (region === "세종") return { region, gu: "세종시", folded: false };
  if (!sggNm) return null;
  // 세션522: 자매 `population.mjs` 는 세션510부터 여기서 표기를 통일하는데 이 파일만 빠져 있었다.
  // 이 수집기는 UPDATE 가 0행이면 **INSERT 로 행을 만든다**(아래 main 참조) — 표기를 안 접으면
  // 행안부가 "장안구"처럼 시 이름 없이 주는 순간 canonical 행 옆에 별도 행이 생기고,
  // 그 행에는 sex_age 만 담겨 화면에서는 어느 쪽도 온전해 보이지 않는다.
  //
  // `folded` = 원문 표기가 통일 과정에서 **바뀌었는가**. 아래 dedup 이 쓴다(세션523).
  const gu = normalizeGu(region, sggNm) ?? sggNm;
  return { region, gu, folded: gu !== sggNm };
}

/**
 * 행안부 응답 → `regions` 쓰기용 행 목록. **한 키에 여럿이 모이면 시 단위 원문을 남긴다.**
 *
 * ⚠️ 표기 통일은 서로 다른 원문을 **한 키로 모으는** 경우가 있다 (세션523 실측 — 화성시).
 * 행안부는 화성시를 시 단위("화성시")와 신설 4구(효행·동탄·만세·병점)로 **둘 다** 주는데,
 * 별칭표는 그 구들을 "화성시" 로 접는다 — 손님 화면의 화성 단지 67곳이 전부 시 단위 표기라
 * 구 단위 행은 어차피 아무도 못 읽기 때문이다. 접힌 결과를 그대로 아래 UPDATE 루프에 넘기면
 * 같은 행을 다섯 번 덮어써 **시 전체 인구구성이 구 하나의 값으로 바뀐다** — 채운 것처럼
 * 보이지만 거짓이다. 그래서 겹치면 접히지 않은 원문(= 시 단위)을 남긴다.
 *
 * "장안구" → "수원시 장안구" 같은 정상 보정은 같은 키로 모이는 짝이 없어 이 규칙에 안 걸린다
 * (그 지역은 행안부가 구 단위로만 주므로 겹칠 원문이 없다).
 *
 * @param {Array<Record<string, unknown>>} items 행안부 원본 행
 * @param {string} recordedAt `YYYY-MM-01`
 */
export function pickCanonicalRows(items, recordedAt) {
  /** @type {Map<string, { region: string, gu: string, sex_age: SexAgeBucket, recorded_at: string, folded: boolean }>} */
  const byKey = new Map();
  let collapsed = 0;
  /** @type {Set<string>} */
  const foldedOnly = new Set();

  for (const item of items) {
    const parsed = parseGu(String(item.ctpvNm ?? ""), String(item.sggNm ?? ""));
    if (!parsed) continue;

    const bucket = parseSexAge(item);
    if (bucket.total <= 0) continue;

    const key = `${parsed.region}|${parsed.gu}`;
    const prev = byKey.get(key);
    if (prev) {
      collapsed++;
      // 접히지 않은 원문(= 시 단위)이 접힌 것보다 우선한다. **같은 등급끼리는 기존 동작(나중 것이
      // 이김)을 그대로 둔다** — 세종처럼 원래부터 여러 원문이 한 이름으로 모이던 자리의 결과를
      // 이 수정이 조용히 바꾸지 않게 하기 위해서다.
      if (!prev.folded && parsed.folded) continue;                          // 시 단위를 구 값으로 덮지 않는다
      if (prev.folded && parsed.folded) { foldedOnly.add(key); continue; }  // 둘 다 접힘 — 먼저 온 것 유지
    }
    byKey.set(key, {
      region: parsed.region,
      gu: parsed.gu,
      sex_age: bucket,
      recorded_at: recordedAt,
      folded: parsed.folded,
    });
  }

  return { rows: [...byKey.values()], collapsed, foldedOnly: [...foldedOnly] };
}

/**
 * 행안부 API items.item 정규화 — 다행이면 배열, 1행이면 단일 객체(양형).
 * 배열일 때만 처리하면 1행 응답(시군구 1개인 시도 등)을 통째로 버린다.
 * parsegu-normalization.md §3 답습.
 * @param {any} json
 * @returns {Array<Record<string, unknown>>}
 */
export function normalizeItems(json) {
  const items = json?.Response?.items?.item;
  if (Array.isArray(items)) return /** @type {Array<Record<string, unknown>>} */ (items);
  if (items && typeof items === "object") return [/** @type {Record<string, unknown>} */ (items)];
  return [];
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
      allItems.push(...normalizeItems(json));
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

  const recordedAt = `${curYear}-${String(curMonth).padStart(2, "0")}-01`;
  const { rows, collapsed, foldedOnly } = pickCanonicalRows(items, recordedAt);
  if (collapsed > 0) {
    log("calc", `표기 통일로 한 키에 겹친 원문 ${collapsed}건 정리 — 시 단위 원문 우선`);
  }
  for (const key of foldedOnly) {
    // 시 단위 원문 없이 접힌 것만 여럿 = 어느 구 값을 써도 그 지역 전체를 대표하지 못한다.
    // 지금은 실제로 안 일어나지만(행안부가 시 단위도 준다), 원본이 바뀌면 조용히 틀릴 자리라 남긴다.
    logError("calc", `${key} — 시 단위 원문 없이 접힌 원문만 여럿. 값이 그 지역 전체를 대표하지 못할 수 있다`);
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
    if (rpt.interrupted()) break;
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
