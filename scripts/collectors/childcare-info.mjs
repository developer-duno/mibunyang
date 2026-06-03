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
 * 결과코드 (명세서): ERROR-100 필수항목 누락 / ERROR-200 서버에러 / INFO-100 인증키 무효 /
 *   INFO-200 검색결과 없음 / INFO-300 일 요청 초과 / INFO-400 키 만료.
 *   INFO-200 은 정상 0건 skip, 나머지는 throw (월간 cron 데드존 차단 — secret-naming-audit.md).
 *
 * 계정 2단계: 개발계정 키 = 시군구당 50행 제한. 운영계정 키 = 전수 응답.
 *   세션 252~274 "50 limit 사고" = 개발계정 키 사용 탓 (API 결함 아님, 세션 255 진단).
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
import { loadEnv, getSupabase, log, logError, createReporter, fetchWithRetry, GU_LAWD_MAP, today, recordApiQuota, recordCollectorRun, sleep } from "./_shared.mjs";

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
 * 응답 XML 에서 결과코드 검사. INFO-200(검색결과 없음)은 정상 0건이므로 통과,
 * 그 외 에러코드는 throw 한다.
 * 명세서에 결과코드 응답 XML 구조 예시가 없어 태그명을 특정하지 않고
 * 응답 본문 전체에서 코드 문자열을 탐지한다 (운영키 raw 실측으로 정밀화 가능).
 * @param {string} xml
 * @returns {void}
 */
export function assertNoErrorCode(xml) {
  const codeRe = /\b((?:ERROR|INFO)-\d{3})\b/;
  const m = codeRe.exec(xml);
  if (!m) return;                 // 결과코드 없음 = 정상 item 응답
  if (m[1] === "INFO-200") return; // 검색결과 없음 = 정상 0건
  throw new Error(`API 결과코드 ${m[1]}`);
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
  assertNoErrorCode(xml);
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
 * 신규 집계(cpmsapi021 7필드)에 기존 최신행 facility 의 좌표·상세 필드(cpmsapi030 70필드)를
 * stcode 기준으로 보존 merge. childcare-detail 이 ~23일 누적 보강한 la/lo + crtypename 등을
 * 월간/수동 info 가 7필드로 통째 덮어 전멸시키던 톱니(좌표 0% → nearby 매칭 100/2001 붕괴) 차단.
 * - count / total_capacity / fetched_at: 신규 집계값 사용 (현재 시점 정확).
 * - facilities[]: stcode 일치 시 기존 추가 필드(la/lo/crtypename/cctvinstlcnt 등)는 보존,
 *   7필드(crname/crtel/crfax/craddr/crhome/crcapat)는 신규값으로 갱신.
 * - 신규 시설(기존에 없던 stcode): 7필드만 들어가고 다음 childcare-detail cron 에서 70필드 채워짐.
 * @param {ChildcareAggregate} newAgg  - aggregateChildcare 결과
 * @param {ChildcareAggregate | null | undefined} prevChildcare - 기존 최신행 childcare JSONB
 * @returns {ChildcareAggregate}
 */
export function mergePreserveCoords(newAgg, prevChildcare) {
  /** @type {Map<string, ChildcareItem>} */
  const prevByStcode = new Map();
  for (const f of prevChildcare?.facilities ?? []) {
    if (f?.stcode) prevByStcode.set(f.stcode, f);
  }
  const facilities = newAgg.facilities.map((nf) => {
    const prev = prevByStcode.get(nf.stcode);
    if (!prev) return nf; // 신규 시설 — 7필드만
    // 기존 추가 필드(좌표/70필드) 먼저 깔고, 신규 7필드로 덮어 갱신값 반영
    return /** @type {ChildcareItem} */ ({ ...prev, ...nf });
  });
  return { ...newAgg, facilities };
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

/**
 * regions 시계열 다중행 중 (region, gu) 별 최신 recorded_at 행 1건만 추리기.
 * regions 는 UNIQUE(region, COALESCE(gu,''), recorded_at) 시계열 → 같은 (region, gu) 가 여러 행.
 * PostgREST PATCH 는 order/limit 을 무시하므로 (childcare-info 가 모든 행 덮어쓰던 버그 원인),
 * id PK 로 1행만 좁히기 위해 메모리에서 최신행 id 를 추린다.
 * trade-stats-regions.mjs pickLatestPerKey 와 동일 패턴 (import 시 무관 collector 의 top-level
 * loadEnv 사이드이펙트 결합을 피하려 독립 구현). childcare 는 gu 가 항상 존재해 인라인 키로 자족.
 * @param {Array<{id: number, region: string, gu: string | null, recorded_at: string}>} regions
 * @returns {Map<string, {id: number, recorded_at: string}>}  key = `${region}|${gu}`
 */
export function pickLatestPerKey(regions) {
  /** @type {Map<string, {id: number, recorded_at: string}>} */
  const latest = new Map();
  for (const r of regions) {
    if (!r.region || !r.gu) continue;  // childcare 는 시군구(gu) 단위만 — 시도행(gu null) 제외
    const key = `${r.region}|${r.gu}`;
    const prev = latest.get(key);
    if (!prev || r.recorded_at > prev.recorded_at) {
      latest.set(key, { id: r.id, recorded_at: r.recorded_at });
    }
  }
  return latest;
}

async function main() {
  if (!API_KEY) {
    logError("init", "CHILDCARE_API_KEY 환경변수 필요 (info.childcare.go.kr cpmsapi021 인증키)");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  const fetchedAt = today();

  // dry-run 은 sample 5개만 호출 (운영키 일일 한도 1,000 보호 — 검증+운영 같은 날 가능)
  const sggList = dryRun ? listAllSgg().slice(0, 5) : listAllSgg();
  log("init", `대상: ${sggList.length}개 시군구 (arcode 단위)${dryRun ? " — dry-run sample" : ""}`);

  /** @type {Array<{region: string, gu: string, agg: ChildcareAggregate}>} */
  const rows = [];
  let apiCalls = 0;
  const rpt = createReporter("childcare-info");
  for (const { region, gu, arcode } of sggList) {
    if (rpt.interrupted()) break;
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
      rpt.fail(1);
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
    rpt.summary();
    return;
  }

  const sb = getSupabase();

  // regions 시계열 전수 조회 → (region, gu) 별 최신행 id 맵 구축.
  // PostgREST PATCH 가 order/limit 을 무시해 .eq(region).eq(gu) 가 모든 과거 스냅샷을 덮어쓰던
  // 버그(쓰기량 2.5배 → statement timeout → 트랜잭션 abort) 차단 — id PK 로 최신행 1개만 갱신.
  const { data: allRegions, error: regErr } = await sb.from("regions")
    .select("id, region, gu, recorded_at, childcare")
    .order("recorded_at", { ascending: false });
  if (regErr) throw new Error(`regions 조회 실패: ${regErr.message}`);
  const latestMap = pickLatestPerKey(allRegions ?? []);
  // 최신행 id → 기존 childcare 본문 (merge 시 좌표 보존용).
  /** @type {Map<number, ChildcareAggregate | null>} */
  const prevById = new Map();
  for (const r of allRegions ?? []) prevById.set(r.id, r.childcare ?? null);

  let saved = 0;
  for (const row of rows) {
    if (rpt.interrupted()) break;
    const latest = latestMap.get(`${row.region}|${row.gu}`);

    if (latest) {
      // 최신행 1개만 UPDATE (id PK). 기존 좌표·70필드 보존 merge (톱니 차단).
      const merged = mergePreserveCoords(row.agg, prevById.get(latest.id));
      const { error: updErr } = await sb.from("regions")
        .update({ childcare: merged })
        .eq("id", latest.id);
      if (updErr) {
        logError("regions", `UPDATE 빨강 ${row.region} ${row.gu}: ${updErr.message}`);
        rpt.fail(1);
        continue;
      }
    } else {
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
  await recordCollectorRun("childcare-info", result);
  if (result.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });
