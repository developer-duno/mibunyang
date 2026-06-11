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
import { loadEnv, getSupabase, log, logError, createReporter, fetchWithRetry, recordApiQuota, recordCollectorRun, sleep } from "./_shared.mjs";
import { extractTag } from "./childcare-info.mjs";

loadEnv();

const API_KEY = process.env.CHILDCARE_BASIC_API_KEY;
const BASE_URL = "http://api.childcare.go.kr/mediate/rest/cpmsapi030/cpmsapi030/request";
const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT ?? "1000", 10);
// 한 시군구에서 연속 네트워크 실패가 이 횟수에 도달하면 그 시군구를 건너뛴다.
// GH 러너(해외 IP) 가 api.childcare.go.kr(평문 HTTP) 에 막히면 같은 arcode 전 facility 가
// 호출당 ~30s×3 재시도로 매달려 60분 timeout 으로 잘린다(세션 398 raw 로그: 세종 fetch failed 연쇄).
// 시도 자체가 진행으로 안 잡혀 DAILY_LIMIT 종료조건도 발동 못 했다 → 조기 중단으로 출혈 차단.
const NET_FAIL_CIRCUIT = parseInt(process.env.NET_FAIL_CIRCUIT ?? "3", 10);
// 연속으로 이 수만큼 시군구가 통째로 네트워크 차단(circuit trip + 성공 0)되면 전역 종료.
// 해외 IP 전면 차단(KOSIS 6/9 사고) 시 947 시군구를 각 3회씩 두드려 timeout 되는 것을 차단.
const GLOBAL_DEAD_CIRCUIT = parseInt(process.env.GLOBAL_DEAD_CIRCUIT ?? "5", 10);

/**
 * cpmsapi030 응답 XML 의 결과코드가 "오늘 더 호출 불가"(쿼터 초과 INFO-300 / 키 만료 INFO-400)
 * 인지 검사. 해당 시 throw — 호출부가 "응답 부재 skip"(시설 개별 사정)과 구분해 전역 종료한다.
 * INFO-200(검색결과 없음)·기타 코드는 통과시켜 기존 null 흐름(해당 시설만 skip)을 유지.
 *
 * 사고 답습(세션 400): 가드 부재 시 INFO-300 응답에 <item> 이 없어 parseChildcareDetailXml 이
 * null 반환 → "응답 부재 skip" + processed++ 로 묻혀 1000건 쿼터 초과를 success 로 기록(데이터
 * 0건인데 모니터 정상 표시). childcare-info.mjs assertNoErrorCode 답습 + detail 전역종료 특성 반영.
 * @param {string} xml
 * @throws {QuotaExceededError} INFO-300/INFO-400 시
 */
export function assertNoQuotaError(xml) {
  const m = /\b(INFO-(?:300|400))\b/.exec(xml);
  if (m) throw new QuotaExceededError(m[1]);
}

/** 일 요청 초과(INFO-300) 또는 키 만료(INFO-400) — 오늘 더 호출 불가, 전역 종료 신호. */
export class QuotaExceededError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(`cpmsapi030 ${code} (일 요청 초과/키 만료) — 오늘 더 호출 불가`);
    this.name = "QuotaExceededError";
    this.code = code;
  }
}

/**
 * fetch 실패 메시지가 네트워크 레벨 실패(연결 불가/타임아웃/재시도 소진)인지 판정.
 * HTTP 4xx/5xx(서버가 응답은 한 경우)와 구분 — 후자는 시설별 개별 사정이라 circuit 대상 아님.
 * @param {string} msg
 * @returns {boolean}
 */
export function isNetworkError(msg) {
  return (
    /fetch failed/i.test(msg) ||
    /재시도 소진/.test(msg) ||
    /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(msg) ||
    /\b(timeout|aborted)\b/i.test(msg)
  );
}

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
    crrepname: extractTag(block, "CRREPNAME"),  // 운영 응답 = 대문자 태그 (extractTag 대소문자 구분)
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
  assertNoQuotaError(xml);  // INFO-300/400 = 전역 종료 신호 (응답 부재 skip 과 구분)
  return parseChildcareDetailXml(xml);
}

/**
 * 기존 7 필드 facility + cpmsapi030 70 필드 detail 통합.
 * stcode/crname 일치. 70 필드 박제 = crtypename 존재로 표시.
 * @param {ExistingFacility} facility
 * @param {ChildcareDetail} detail
 * @returns {ChildcareDetail & { crtel: string, crfax: string }}
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
  let processed = 0;       // cpmsapi030 성공 호출 횟수 (쿼터 기록용)
  let attempted = 0;       // cpmsapi030 시도 횟수 (성공+실패) — DAILY_LIMIT 종료조건 기준
  let skippedFacilities = 0;  // resume self skip
  let updatedRegions = 0;
  let limitReached = false;   // DAILY_LIMIT 도달 — 현재 시군구 UPDATE 후 전체 종료
  let quotaExhausted = false;  // INFO-300/400 (일 요청 초과/키 만료) — 즉시 전역 종료, 다음 cron 재시도
  let consecutiveDeadRegions = 0;  // 성공 0건으로 circuit 끊긴 시군구 연속 횟수 (전역 차단 감지)
  const rpt = createReporter("childcare-detail");

  for (const r of regions) {
    if (rpt.interrupted()) break;
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

    /** @type {Array<ExistingFacility | (ChildcareDetail & { crtel: string, crfax: string })>} */
    const updatedFacilities = [];
    let regionChanged = false;
    let consecutiveNetFails = 0;  // 이 시군구 연속 네트워크 실패 (circuit breaker)
    let regionCircuitTripped = false;  // 이 시군구가 네트워크 circuit 으로 끊겼나

    for (const fac of facilities) {
      // resume self skip: 70 필드 박제 표시 = crtypename 존재
      if (fac.crtypename) {
        updatedFacilities.push(fac);
        skippedFacilities++;
        continue;
      }

      // DAILY_LIMIT 도달 시 현재 시군구 facility 루프 종료
      // (break = facility 루프만 탈출 → 아래 atomic UPDATE 실행 → 시군구 루프 끝에서 전체 종료)
      // 시도(attempted) 기준 — 실패 호출도 진행으로 쳐야 네트워크 차단 시에도 종료조건이 발동한다.
      if (attempted >= DAILY_LIMIT) {
        log("limit", `DAILY_LIMIT ${DAILY_LIMIT} 도달 — 남은 시군구 ${regions.length - updatedRegions}건 다음 cron 분산`);
        updatedFacilities.push(fac);  // 미박제 그대로 유지
        // 남은 facilities 도 그대로 박제 (atomic UPDATE 보장)
        const idx = facilities.indexOf(fac);
        for (let i = idx + 1; i < facilities.length; i++) updatedFacilities.push(facilities[i]);
        limitReached = true;
        break;
      }

      try {
        const detail = await fetchChildcareDetail(arcode, fac.stcode);
        processed++;
        attempted++;
        consecutiveNetFails = 0;  // 성공 = circuit 리셋
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
        // INFO-300/400 (일 요청 초과/키 만료) = 오늘 더 호출 불가 → 즉시 전역 종료.
        // "응답 부재 skip"(시설 개별 사정)과 달리 success 로 묻지 않고 미박제 그대로 다음 cron 재시도.
        if (e instanceof QuotaExceededError) {
          logError("quota", `${r.region} ${r.gu}: ${e.message} — 전역 종료 (다음 cron 재시도)`);
          updatedFacilities.push(fac);  // 미박제 그대로 유지
          const idx = facilities.indexOf(fac);
          for (let i = idx + 1; i < facilities.length; i++) updatedFacilities.push(facilities[i]);
          quotaExhausted = true;
          break;
        }
        const msg = e instanceof Error ? e.message : String(e);
        attempted++;  // 실패도 시도로 집계 — DAILY_LIMIT 종료조건이 네트워크 차단 시에도 발동하게
        logError("fetch", `${r.region} ${r.gu} ${fac.stcode}: ${msg}`);
        updatedFacilities.push(fac);  // 실패 시 기존 유지

        // 네트워크 레벨 실패(해외 IP 차단 등)는 같은 arcode 전체에 번지므로 연속 N회면 시군구 skip.
        // HTTP 4xx/5xx(시설별 개별 사정)는 circuit 대상 아님 — facility 단위로 계속 진행.
        if (isNetworkError(msg)) {
          consecutiveNetFails++;
          if (consecutiveNetFails >= NET_FAIL_CIRCUIT) {
            logError("circuit", `${r.region} ${r.gu}: 연속 네트워크 실패 ${consecutiveNetFails}회 — 시군구 skip (해외 IP 차단 의심)`);
            regionCircuitTripped = true;
            // 남은 facilities 미박제 그대로 유지 (atomic UPDATE 보존, 다음 cron 재시도)
            const idx = facilities.indexOf(fac);
            for (let i = idx + 1; i < facilities.length; i++) updatedFacilities.push(facilities[i]);
            break;
          }
        } else {
          consecutiveNetFails = 0;  // 비네트워크 에러 = circuit 리셋
        }
      }
    }

    // dry-run = UPDATE 0
    if (dryRun) {
      if (regionChanged) {
        const sample = /** @type {any} */ (updatedFacilities.find(f => f.crtypename));
        log("dry-run", `${r.region} ${r.gu}: ${facilities.length}건 중 변경 1+ — sample crtypename=${sample?.crtypename}, cctv=${sample?.cctvinstlcnt}, la=${sample?.la}`);
        updatedRegions++;
      }
    } else if (regionChanged) {
      // 시군구 atomic UPDATE
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
      } else {
        updatedRegions++;
        rpt.success(1);
        log("update", `${r.region} ${r.gu}: ${facilities.length}건 (${processed}/${DAILY_LIMIT})`);
      }
    }

    // 전역 dead-region circuit: circuit 으로 끊긴 시군구가 성공 0건이면 dead 로 집계,
    // 성공이 1건이라도 있으면 리셋(네트워크 살아있음). 연속 dead 가 임계 도달 = 전면 차단 → 전역 종료.
    if (regionCircuitTripped && !regionChanged) {
      consecutiveDeadRegions++;
      if (consecutiveDeadRegions >= GLOBAL_DEAD_CIRCUIT) {
        logError("circuit", `연속 ${consecutiveDeadRegions}개 시군구 전면 네트워크 차단 — 전역 종료 (api.childcare.go.kr 해외 IP 차단 의심, 다음 cron 재시도)`);
        break;
      }
    } else if (regionChanged) {
      consecutiveDeadRegions = 0;  // 성공한 시군구 = 네트워크 정상, 전역 circuit 리셋
    }

    // DAILY_LIMIT 도달 또는 쿼터 초과(INFO-300/400) = 전체 종료
    if (limitReached || quotaExhausted) break;
  }

  log("done", `cpmsapi030 시도 ${attempted}회 (성공 ${processed}) / resume skip ${skippedFacilities}건 / regions UPDATE ${updatedRegions}건${quotaExhausted ? " / 쿼터 초과 조기 종료" : ""}`);

  if (!dryRun) await recordApiQuota("childcare-detail", "CHILDCARE_BASIC_API_KEY", processed);
  const result = rpt.summary();
  await recordCollectorRun("childcare-detail", result);
  if (result.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });
