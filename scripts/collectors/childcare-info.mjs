// @ts-check
/**
 * 보육정보공개 cpmsapi021 (전국 어린이집 정보 조회) → regions.childcare JSONB (세션 252 W6-D 옵션 ε)
 *
 * 자원: info.childcare.go.kr 보육정보공개 API
 * data.go.kr 15101155 (한국사회보장정보원_전국 어린이집 정보 조회)
 * endpoint: http://api.childcare.go.kr/mediate/rest/cpmsapi021/cpmsapi021/request
 * 응답 필드 7 (XML): stcode/crname/crtel/crfax/craddr/crhome/crcapat
 *   - stcode: 어린이집 코드 (11자)
 *   - crname: 어린이집명
 *   - crtel: 전화 (기술문서 박제 = crtelno 환각, 실제 응답 = crtel)
 *   - crfax: 팩스 (기술문서 박제 = crfaxno 환각, 실제 응답 = crfax)
 *   - craddr: 주소
 *   - crhome: 홈페이지 URL
 *   - crcapat: 정원 (number)
 * 요청 parameter: key (인증키 string 32) + arcode (시군구코드 string 5)
 * 응답 형식: REST + XML (JSON 미제공) — 페이징 없음, 시군구 1건당 N items 단일 응답
 *
 * 의미 단위: 시군구 집계 (count + total_capacity + facilities raw 리스트).
 * 단지별 도보권 인프라 = infra.childcare/childcare_dist (Kakao POI) 보존 (의미 다름).
 * 별 세션 분할: W6-D2 옵션 δ (cpmsapi030 60+ 필드 단지 매칭).
 *
 * 사용:
 *   node scripts/collectors/childcare-info.mjs            (regions 업데이트)
 *   node scripts/collectors/childcare-info.mjs --dry-run  (미리보기 sample 5건)
 *
 * 필요 env:
 *   CHILDCARE_API_KEY    — info.childcare.go.kr cpmsapi021 인증키
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, logError, createReporter, fetchWithRetry, GU_LAWD_MAP, today, recordApiQuota, sleep } from "./_shared.mjs";

loadEnv();

const API_KEY = process.env.CHILDCARE_API_KEY;
const BASE_URL = "http://api.childcare.go.kr/mediate/rest/cpmsapi021/cpmsapi021/request";

/**
 * @typedef {Object} ChildcareItem
 * @property {string} stcode   - 어린이집 코드 (11자)
 * @property {string} crname   - 어린이집명
 * @property {string} crtel    - 전화
 * @property {string} crfax    - 팩스
 * @property {string} craddr   - 주소
 * @property {string} crhome   - 홈페이지 URL
 * @property {number} crcapat  - 정원
 */

/**
 * @typedef {Object} ChildcareAggregate
 * @property {number} count            - 어린이집 개수
 * @property {number} total_capacity   - 총 정원 합계
 * @property {ChildcareItem[]} facilities  - 7필드 raw 리스트
 * @property {string} fetched_at       - 수집 시각 (YYYY-MM-DD)
 */

/**
 * XML 응답에서 item 블록 N개 추출 (정규식 파싱, xml2js 의존성 회피).
 * 응답 형식: <response><item><stcode>...</stcode>...</item><item>...</item></response>
 * @param {string} xml
 * @returns {ChildcareItem[]}
 */
export function parseChildcareXml(xml) {
  /** @type {ChildcareItem[]} */
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const stcode = extractTag(block, "stcode");
    const crname = extractTag(block, "crname");
    if (!stcode || !crname) continue;  // 필수 2필드 부재 시 skip
    items.push({
      stcode,
      crname,
      crtel: extractTag(block, "crtel") ?? "",
      crfax: extractTag(block, "crfax") ?? "",
      craddr: extractTag(block, "craddr") ?? "",
      crhome: extractTag(block, "crhome") ?? "",
      crcapat: parseInt(extractTag(block, "crcapat") ?? "0", 10) || 0,
    });
  }
  return items;
}

/**
 * XML 단순 태그 본문 추출. <tag>value</tag> + <tag /> 빈 태그 동시 처리.
 * @param {string} block
 * @param {string} tag
 * @returns {string | null}
 */
export function extractTag(block, tag) {
  // 자기닫는 빈 태그 (<tag />) 우선 검사
  if (new RegExp(`<${tag}\\s*/>`).test(block)) return "";
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
  return m ? m[1].trim() : null;
}

/**
 * 시군구코드 (arcode 5자) 별 API 호출.
 * @param {string} arcode  - 5자 시군구코드
 * @returns {Promise<ChildcareItem[]>}
 */
async function fetchChildcare(arcode) {
  if (!API_KEY) throw new Error("CHILDCARE_API_KEY 환경변수 필요");
  const url = `${BASE_URL}?key=${encodeURIComponent(API_KEY)}&arcode=${arcode}`;
  const res = await fetchWithRetry(url);
  const xml = await res.text();
  return parseChildcareXml(xml);
}

/**
 * 어린이집 리스트 → 시군구 집계.
 * @param {ChildcareItem[]} items
 * @param {string} fetchedAt
 * @returns {ChildcareAggregate}
 */
export function aggregateChildcare(items, fetchedAt) {
  let total_capacity = 0;
  for (const it of items) total_capacity += it.crcapat;
  return {
    count: items.length,
    total_capacity,
    facilities: items,
    fetched_at: fetchedAt,
  };
}

/**
 * GU_LAWD_MAP 전체 순회 → {region, gu, arcode} 리스트.
 * @returns {Array<{region: string, gu: string, arcode: string}>}
 */
export function listAllSgg() {
  /** @type {Array<{region: string, gu: string, arcode: string}>} */
  const list = [];
  for (const [region, guMap] of Object.entries(GU_LAWD_MAP)) {
    for (const [gu, arcode] of Object.entries(guMap)) {
      list.push({ region, gu, arcode });
    }
  }
  return list;
}

async function main() {
  if (!API_KEY) {
    logError("init", "CHILDCARE_API_KEY 환경변수 필요 (info.childcare.go.kr cpmsapi021 인증키)");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  const fetchedAt = today();

  const sggList = listAllSgg();
  log("init", `대상: ${sggList.length}개 시군구 (arcode 단위)`);

  /** @type {Array<{region: string, gu: string, agg: ChildcareAggregate}>} */
  const rows = [];
  let apiCalls = 0;
  for (const { region, gu, arcode } of sggList) {
    try {
      const items = await fetchChildcare(arcode);
      apiCalls++;
      if (items.length === 0) {
        log("fetch", `  ${region} ${gu} (${arcode}): 0건 — skip`);
        continue;
      }
      const agg = aggregateChildcare(items, fetchedAt);
      rows.push({ region, gu, agg });
      log("fetch", `  ${region} ${gu} (${arcode}): ${items.length}건 / 정원 ${agg.total_capacity.toLocaleString()}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logError("fetch", `  ${region} ${gu} (${arcode}): ${msg}`);
    }
    await sleep(150);  // rate limit 답습 (population-sex-age L144)
  }

  log("calc", `${rows.length}/${sggList.length}개 시군구 집계 완료 (API 호출 ${apiCalls}회)`);

  if (dryRun) {
    log("dry-run", "미리보기 모드");
    console.log("\n시군구별 sample (최대 5):");
    for (const r of rows.slice(0, 5)) {
      console.log(`  ${r.region} ${r.gu}: ${r.agg.count}건 / 정원 ${r.agg.total_capacity.toLocaleString()}`);
      if (r.agg.facilities[0]) {
        const f = r.agg.facilities[0];
        console.log(`    └ sample: ${f.crname} (${f.stcode}) ${f.crtel} / 정원 ${f.crcapat} / ${f.craddr}`);
      }
    }
    return;
  }

  const sb = getSupabase();
  const rpt = createReporter("childcare-info");
  let saved = 0;
  for (const row of rows) {
    const { data: updated, error: updErr } = await sb.from("regions")
      .update({ childcare: row.agg })
      .eq("region", row.region)
      .eq("gu", row.gu)
      .select("id");

    if (updErr) {
      logError("regions", `UPDATE 빨강 ${row.region} ${row.gu}: ${updErr.message}`);
      rpt.fail(1);
      continue;
    }

    if (!updated || updated.length === 0) {
      // 행 없음 = INSERT (childcare 만 박제, 다른 컬럼 default null)
      const { error: insErr } = await sb.from("regions").insert([{
        region: row.region,
        gu: row.gu,
        childcare: row.agg,
        recorded_at: fetchedAt,
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
  log("done", `regions ${saved}/${rows.length}건 childcare 채움 (${fetchedAt})`);
  const result = rpt.summary();

  if (!dryRun) await recordApiQuota("childcare-info", "CHILDCARE_API_KEY", apiCalls);
  if (result.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });
