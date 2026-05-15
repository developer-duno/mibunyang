// @ts-check
/**
 * 보육정보공개 cpmsapi030 (어린이집별 70 필드 상세 조회) → regions.childcare.facilities[] 7→70 필드 확장 (세션 254 W6-D2 옵션 NB C-γ''')
 *
 * 자원: info.childcare.go.kr 보육정보공개 API
 * endpoint: http://api.childcare.go.kr/mediate/rest/cpmsapi030/cpmsapi030/request
 * 요청 parameter: key (인증키 32자) + arcode (시군구코드 5자) + stcode (어린이집코드 11자)
 * 응답 형식: REST + XML, 1 stcode = 1 응답 (단일 시설)
 *
 * 70 필드 그룹:
 *   - 위치 6: la / lo / sidoname / sigunname / zipcode / craddr
 *   - 기본 8: stcode / crname / crtypename / crstatusname / crtelno / crfaxno / crhome / crrepname
 *   - 시설 6: nrtrroomcnt / nrtrroomsize / plgrdco / cctvinstlcnt / chcrtescnt / crcargbname
 *   - 정원/현원 2: crcapat / crchcnt
 *   - 일자 6: crcnfmdt / crpausebegindt / crpauseenddt / crabldt / datastdrdt / crspec
 *   - CLASS_CNT 11 (반수): 00~05 + M2/M3/M5/SP/TOT
 *   - CHILD_CNT 11 (아동수): 00~05 + M2/M3/M5/SP/TOT
 *   - EM_CNT 15 (교직원 자격별): 0Y/1Y/2Y/4Y/6Y/A1~A10/TOT
 *   - EW_CNT 8 (입소대기): 00~05 + M6/TOT
 *
 * 작업 흐름:
 *   1. regions.childcare.facilities[] 23,122곳 stcode + arcode 박제 답습 로드
 *   2. resume self skip: facility 객체 crtypename 박제 여부 = 70 필드 박제 완료 표시
 *   3. DAILY_LIMIT (process.env, 기본 1000) 만큼 cpmsapi030 호출 + 70 필드 추출
 *   4. 시군구 단위 atomic UPDATE (1 시군구 = 1 UPDATE)
 *   5. 23일 분산 cron 답습 (세션 256 F 단계)
 *
 * 사용:
 *   node scripts/collectors/childcare-detail.mjs            (regions UPDATE)
 *   node scripts/collectors/childcare-detail.mjs --dry-run  (미리보기 sample)
 *   DAILY_LIMIT=10 node scripts/collectors/childcare-detail.mjs --dry-run  (제한)
 *
 * 필요 env:
 *   CHILDCARE_BASIC_API_KEY  — info.childcare.go.kr cpmsapi030 인증키 (cpmsapi021 의 CHILDCARE_API_KEY 와 별 키)
 *   DAILY_LIMIT              — 일일 호출 한도 (기본 1000)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, logError, createReporter, fetchWithRetry, recordApiQuota, sleep } from "./_shared.mjs";
import { extractTag } from "./childcare-info.mjs";

loadEnv();

const API_KEY = process.env.CHILDCARE_BASIC_API_KEY;
const BASE_URL = "http://api.childcare.go.kr/mediate/rest/cpmsapi030/cpmsapi030/request";
const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT ?? "1000", 10);

/**
 * @typedef {Object} ChildcareDetail
 * @property {string} stcode
 * @property {string} crname
 * @property {string|null} la               - 위도
 * @property {string|null} lo               - 경도
 * @property {string|null} sidoname
 * @property {string|null} sigunname
 * @property {string|null} zipcode
 * @property {string|null} craddr
 * @property {string|null} crtypename       - 시설 유형 (국공립/민간/가정 등)
 * @property {string|null} crstatusname     - 운영 상태 (정상/폐원/휴원)
 * @property {string|null} crtelno
 * @property {string|null} crfaxno
 * @property {string|null} crhome
 * @property {string|null} crrepname        - 대표자명
 * @property {number} nrtrroomcnt           - 보육실수
 * @property {number} nrtrroomsize          - 보육실 면적
 * @property {number} plgrdco               - 놀이터 수
 * @property {number} cctvinstlcnt          - CCTV 설치 대수
 * @property {number} chcrtescnt            - 차량수
 * @property {string|null} crcargbname      - 차량종류
 * @property {number} crcapat               - 정원
 * @property {number} crchcnt               - 현원
 * @property {string|null} crcnfmdt         - 인가일
 * @property {string|null} crpausebegindt
 * @property {string|null} crpauseenddt
 * @property {string|null} crabldt          - 폐지일
 * @property {string|null} datastdrdt       - 자료기준일
 * @property {string|null} crspec           - 비고
 * @property {Record<string, number>} class_cnt   - 반수 11종
 * @property {Record<string, number>} child_cnt   - 아동수 11종
 * @property {Record<string, number>} em_cnt      - 교직원수 15종
 * @property {Record<string, number>} ew_cnt      - 입소대기 8종
 */

/**
 * @typedef {Object} ExistingFacility
 * @property {string} stcode
 * @property {string} crname
 * @property {string} [crtel]
 * @property {string} [crfax]
 * @property {string} [craddr]
 * @property {string} [crhome]
 * @property {number} [crcapat]
 * @property {string} [crtypename]  - 70 필드 박제 완료 표시 (resume skip 키)
 */

const CLASS_KEYS = ["00", "01", "02", "03", "04", "05", "M2", "M3", "M5", "SP", "TOT"];
const CHILD_KEYS = ["00", "01", "02", "03", "04", "05", "M2", "M3", "M5", "SP", "TOT"];
const EM_KEYS = ["0Y", "1Y", "2Y", "4Y", "6Y", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "TOT"];
const EW_KEYS = ["00", "01", "02", "03", "04", "05", "M6", "TOT"];

/**
 * cpmsapi030 응답 XML 파싱 → 70 필드 추출.
 * @param {string} xml
 * @returns {ChildcareDetail | null}
 */
export function parseChildcareDetailXml(xml) {
  // cpmsapi030 응답 = 단일 item 블록 (시설 1건)
  const itemMatch = /<item>([\s\S]*?)<\/item>/.exec(xml);
  if (!itemMatch) return null;
  const block = itemMatch[1];

  const stcode = extractTag(block, "stcode");
  const crname = extractTag(block, "crname");
  if (!stcode || !crname) return null;

  /** @type {Record<string, number>} */
  const class_cnt = {};
  for (const k of CLASS_KEYS) {
    class_cnt[k] = parseInt(extractTag(block, `CLASS_CNT_${k}`) ?? "0", 10) || 0;
  }
  /** @type {Record<string, number>} */
  const child_cnt = {};
  for (const k of CHILD_KEYS) {
    child_cnt[k] = parseInt(extractTag(block, `CHILD_CNT_${k}`) ?? "0", 10) || 0;
  }
  /** @type {Record<string, number>} */
  const em_cnt = {};
  for (const k of EM_KEYS) {
    em_cnt[k] = parseInt(extractTag(block, `EM_CNT_${k}`) ?? "0", 10) || 0;
  }
  /** @type {Record<string, number>} */
  const ew_cnt = {};
  for (const k of EW_KEYS) {
    ew_cnt[k] = parseInt(extractTag(block, `EW_CNT_${k}`) ?? "0", 10) || 0;
  }

  return {
    stcode,
    crname,
    la: extractTag(block, "la"),
    lo: extractTag(block, "lo"),
    sidoname: extractTag(block, "sidoname"),
    sigunname: extractTag(block, "sigunname"),
    zipcode: extractTag(block, "zipcode"),
    craddr: extractTag(block, "craddr"),
    crtypename: extractTag(block, "crtypename"),
    crstatusname: extractTag(block, "crstatusname"),
    crtelno: extractTag(block, "crtelno"),
    crfaxno: extractTag(block, "crfaxno"),
    crhome: extractTag(block, "crhome"),
    crrepname: extractTag(block, "crrepname"),
    nrtrroomcnt: parseInt(extractTag(block, "nrtrroomcnt") ?? "0", 10) || 0,
    nrtrroomsize: parseInt(extractTag(block, "nrtrroomsize") ?? "0", 10) || 0,
    plgrdco: parseInt(extractTag(block, "plgrdco") ?? "0", 10) || 0,
    cctvinstlcnt: parseInt(extractTag(block, "cctvinstlcnt") ?? "0", 10) || 0,
    chcrtescnt: parseInt(extractTag(block, "chcrtescnt") ?? "0", 10) || 0,
    crcargbname: extractTag(block, "crcargbname"),
    crcapat: parseInt(extractTag(block, "crcapat") ?? "0", 10) || 0,
    crchcnt: parseInt(extractTag(block, "crchcnt") ?? "0", 10) || 0,
    crcnfmdt: extractTag(block, "crcnfmdt"),
    crpausebegindt: extractTag(block, "crpausebegindt"),
    crpauseenddt: extractTag(block, "crpauseenddt"),
    crabldt: extractTag(block, "crabldt"),
    datastdrdt: extractTag(block, "datastdrdt"),
    crspec: extractTag(block, "crspec"),
    class_cnt,
    child_cnt,
    em_cnt,
    ew_cnt,
  };
}

/**
 * cpmsapi030 호출 (arcode + stcode 동시 필수).
 * @param {string} arcode
 * @param {string} stcode
 * @returns {Promise<ChildcareDetail | null>}
 */
async function fetchChildcareDetail(arcode, stcode) {
  if (!API_KEY) throw new Error("CHILDCARE_BASIC_API_KEY 환경변수 필요");
  const url = `${BASE_URL}?key=${encodeURIComponent(API_KEY)}&arcode=${arcode}&stcode=${stcode}`;
  const res = await fetchWithRetry(url);
  const xml = await res.text();
  return parseChildcareDetailXml(xml);
}

/**
 * 기존 7 필드 facility + cpmsapi030 70 필드 detail 통합.
 * stcode/crname 일치. 70 필드 박제 = crtypename 존재로 표시.
 * @param {ExistingFacility} facility
 * @param {ChildcareDetail} detail
 * @returns {ExistingFacility & ChildcareDetail}
 */
export function mergeDetailIntoFacility(facility, detail) {
  return {
    // 기존 7 필드 유지 (cpmsapi021 답습)
    crtel: facility.crtel ?? "",
    crfax: facility.crfax ?? "",
    // cpmsapi030 70 필드 (위치 6 + 기본 8 + 시설 6 + 정원/현원 2 + 일자 6 + 4 배열)
    ...detail,
  };
}

async function main() {
  if (!API_KEY) {
    logError("init", "CHILDCARE_BASIC_API_KEY 환경변수 필요");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  log("init", `DAILY_LIMIT=${DAILY_LIMIT}${dryRun ? " --dry-run" : ""}`);

  const sb = getSupabase();

  // regions.childcare 답습 자산 로드 (606 시군구 × N facilities)
  const { data: regions, error: regErr } = await sb
    .from("regions")
    .select("id, region, gu, childcare")
    .not("childcare", "is", null);
  if (regErr) throw new Error(`regions 조회 실패: ${regErr.message}`);

  log("init", `regions NOT NULL childcare: ${regions.length}건`);

  // 시군구 단위 처리 (atomic UPDATE)
  let processed = 0;       // cpmsapi030 호출 횟수
  let skippedFacilities = 0;  // resume self skip
  let updatedRegions = 0;
  const rpt = createReporter("childcare-detail");

  outer: for (const r of regions) {
    const facilities = /** @type {ExistingFacility[]} */ (r.childcare?.facilities ?? []);
    if (facilities.length === 0) continue;

    // arcode 답습: childcare-info.mjs aggregate 시점 박제 안 됨 → GU_LAWD_MAP 역참조
    // 단, regions.region + gu 자체로 직접 매핑 가능 (childcare-info.mjs L137~143 답습)
    // 본 collector 는 arcode 별도 필드 필요 → 시군구 facility 첫 stcode 11자에서 arcode 5자 추출 (stcode prefix = arcode)
    const firstStcode = facilities[0]?.stcode;
    if (!firstStcode || firstStcode.length < 5) {
      logError("region", `${r.region} ${r.gu}: stcode prefix 부재`);
      continue;
    }
    const arcode = firstStcode.slice(0, 5);

    /** @type {Array<ExistingFacility & Partial<ChildcareDetail>>} */
    const updatedFacilities = [];
    let regionChanged = false;

    for (const fac of facilities) {
      // resume self skip: 70 필드 박제 표시 = crtypename 존재
      if (fac.crtypename) {
        updatedFacilities.push(fac);
        skippedFacilities++;
        continue;
      }

      // DAILY_LIMIT 도달 시 종료
      if (processed >= DAILY_LIMIT) {
        log("limit", `DAILY_LIMIT ${DAILY_LIMIT} 도달 — 남은 시군구 ${regions.length - updatedRegions}건 다음 cron 분산`);
        updatedFacilities.push(fac);  // 미박제 그대로 유지
        // 남은 facilities 도 그대로 박제 (atomic UPDATE 보장)
        const idx = facilities.indexOf(fac);
        for (let i = idx + 1; i < facilities.length; i++) updatedFacilities.push(facilities[i]);
        break outer;
      }

      try {
        const detail = await fetchChildcareDetail(arcode, fac.stcode);
        processed++;
        await sleep(300);  // rate limit (population-sex-age L144 답습)

        if (!detail) {
          // 응답 부재 = stcode 폐지 또는 응답 빈 값. 기존 7 필드 유지
          logError("fetch", `${r.region} ${r.gu} ${fac.stcode}: 응답 부재 — skip`);
          updatedFacilities.push(fac);
          continue;
        }

        updatedFacilities.push(mergeDetailIntoFacility(fac, detail));
        regionChanged = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logError("fetch", `${r.region} ${r.gu} ${fac.stcode}: ${msg}`);
        updatedFacilities.push(fac);  // 실패 시 기존 유지
      }
    }

    // dry-run = UPDATE 0
    if (dryRun) {
      if (regionChanged) {
        const sample = updatedFacilities.find(f => f.crtypename);
        log("dry-run", `${r.region} ${r.gu}: ${facilities.length}건 중 변경 1+ — sample crtypename=${sample?.crtypename}, cctv=${sample?.cctvinstlcnt}, la=${sample?.la}`);
        updatedRegions++;
      }
      continue;
    }

    // 시군구 atomic UPDATE
    if (regionChanged) {
      const newChildcare = {
        ...r.childcare,
        facilities: updatedFacilities,
      };
      const { error: updErr } = await sb
        .from("regions")
        .update({ childcare: newChildcare })
        .eq("id", r.id);
      if (updErr) {
        logError("update", `${r.region} ${r.gu}: ${updErr.message}`);
        rpt.fail(1);
        continue;
      }
      updatedRegions++;
      rpt.success(1);
      log("update", `${r.region} ${r.gu}: ${facilities.length}건 (${processed}/${DAILY_LIMIT})`);
    }
  }

  log("done", `cpmsapi030 호출 ${processed}회 / resume skip ${skippedFacilities}건 / regions UPDATE ${updatedRegions}건`);

  if (!dryRun) await recordApiQuota("childcare-detail", "CHILDCARE_BASIC_API_KEY", processed);
  const result = rpt.summary();
  if (result.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });
