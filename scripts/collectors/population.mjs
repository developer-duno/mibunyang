// @ts-check
/**
 * 행안부 주민등록 인구 API → 시군구별 인구 증감률 수집
 *
 * API: 행정안전부_법정동별 주민등록 인구 및 세대현황 (data.go.kr #15108071)
 *
 * 사용법:
 *   node scripts/collectors/population.mjs          (Supabase regions 테이블 업데이트)
 *   node scripts/collectors/population.mjs --dry-run (미리보기만)
 *
 * 필요 환경변수:
 *   MOIS_POP_KEY     — data.go.kr 인증키
 *   SUPABASE_URL     — Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_KEY — Supabase service_role 키
 */
import { loadEnv, getSupabase, log, logError, createReporter, REGION_MAP, today, recordApiQuota, recordCollectorRun } from "./_shared.mjs";

loadEnv();

const API_KEY = process.env.MOIS_POP_KEY;

// 신 API: 행정안전부_법정동별 주민등록 인구 및 세대현황 (#15108071)
const BASE_URL = "https://apis.data.go.kr/1741000/stdgPpltnHhStus/selectStdgPpltnHhStus";

// 전국 17 시도 법정동코드 (10자리)
// 세션 285 raw API 응답 검증 박제 — 3 코드 정정 (영구 누락 사고):
//   3600000000 → 3611000000 (세종, 이전 빈 응답)
//   4200000000 → 5100000000 (강원, 이전 빈 응답)
//   4500000000 → 5200000000 (전북, 이전 빈 응답)
const SIDO_CODES = [
  "1100000000","2600000000","2700000000","2800000000","2900000000",
  "3000000000","3100000000","3611000000","4100000000","5100000000",
  "4300000000","4400000000","5200000000","4600000000","4700000000",
  "4800000000","5000000000",
];

// ── 인구 데이터 조회 (17 시도별 순회) ─────────────────────────
/**
 * @param {number} year
 * @param {number} month
 * @returns {Promise<any[]>}
 */
async function fetchPopulation(year, month) {
  const ym = `${year}${String(month).padStart(2, "0")}`;
  log("fetch", `${year}년 ${month}월 인구 데이터 조회 (17 시도)...`);

  const allItems = [];
  for (const stdgCd of SIDO_CODES) {
    try {
      const params = new URLSearchParams({
        serviceKey: API_KEY ?? "",
        stdgCd,
        srchFrYm: ym,
        srchToYm: ym,
        type: "json",
        numOfRows: "100",
        pageNo: "1",
        lv: "2",       // 시군구 레벨
        regSeCd: "1",   // 전체
      });

      const res = await fetch(`${BASE_URL}?${params}`, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) { log("fetch", `  ${stdgCd}: HTTP ${res.status} — skip`); continue; }

      const json = await res.json();
      const items = json?.Response?.items?.item;
      // 행안부 API: 응답 row 가 1개면 객체, 여러개면 배열 (세종 등 1행 시도 케이스)
      if (Array.isArray(items)) {
        allItems.push(...items);
      } else if (items && typeof items === "object") {
        allItems.push(items);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("fetch", `  ${stdgCd}: ${msg} — skip`);
    }
    // data.go.kr rate limit 대비 150ms 딜레이
    await new Promise(r => setTimeout(r, 150));
  }

  log("fetch", `${year}년 ${month}월: ${allItems.length}건`);
  return allItems;
}

// ── API 응답 hhCnt → households 정수 ─────────────────────────
/**
 * 행안부 stdgPpltnHhStus API 응답 `hhCnt` 필드 → 세대수 정수.
 * 0 또는 음수 / 빈 값 / NaN 시 null 폴백 (DB 컬럼 nullable).
 * @param {unknown} hhCnt
 * @returns {number | null}
 */
function parseHouseholds(hhCnt) {
  const n = parseInt(String(hhCnt ?? "0").replace(/,/g, ""), 10);
  return n > 0 ? n : null;
}

// ── 시도명 → 약칭 변환 ──────────────────────────────────────
/**
 * @param {string | null | undefined} fullName
 * @returns {string | null}
 */
function resolveRegion(fullName) {
  if (!fullName) return null;
  // 정확 매칭
  if (REGION_MAP[fullName]) return REGION_MAP[fullName];
  // 부분 매칭
  for (const [k, v] of Object.entries(REGION_MAP)) {
    if (fullName.includes(v) || k.includes(fullName)) return v;
  }
  return null;
}

// ── 시군구명 파싱 ────────────────────────────────────────────
/**
 * 행안부 API 응답 (ctpvNm + sggNm) → region 약칭 + gu 표기.
 * population-sex-age.mjs v2 답습. sggNm 그대로 박힘 (자치구 분리 유지).
 *
 * 입력 예:
 *   ("경기도", "수원시")        → { region: "경기", gu: "수원시" }        (시 합계)
 *   ("경기도", "수원시 팔달구") → { region: "경기", gu: "수원시 팔달구" } (자치구)
 *   ("서울특별시", "강남구")    → { region: "서울", gu: "강남구" }
 *   ("세종특별자치시", "")      → { region: "세종", gu: "세종시" }
 *
 * @param {string | null | undefined} ctpvNm
 * @param {string | null | undefined} sggNm
 * @returns {{region: string, gu: string} | null}
 */
function parseGu(ctpvNm, sggNm) {
  const region = resolveRegion(ctpvNm);
  if (!region) return null;
  if (region === "세종") return { region, gu: "세종시" };
  if (!sggNm) return null;
  return { region, gu: sggNm };
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  if (!API_KEY) { logError("init", "MOIS_POP_KEY 환경변수 필요 (data.go.kr 인증키)"); process.exit(1); }
  const dryRun = process.argv.includes("--dry-run");

  // 현재 연월, 전년 동월
  const now = new Date();
  // API 데이터는 보통 2개월 지연 → 2개월 전 데이터 사용
  const targetDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const curYear = targetDate.getFullYear();
  const curMonth = targetDate.getMonth() + 1;
  const prevYear = curYear - 1;

  log("init", `대상: ${curYear}년 ${curMonth}월 vs ${prevYear}년 ${curMonth}월`);

  // API 호출 카운트 (시도 17개 × 2회 = 34회)
  let apiCalls = 0;

  // 1. 올해/작년 데이터 가져오기
  const [curItems, prevItems] = await Promise.all([
    fetchPopulation(curYear, curMonth),
    fetchPopulation(prevYear, curMonth),
  ]);
  apiCalls += SIDO_CODES.length * 2; // 17 시도 × 2 (올해 + 작년)

  if (!curItems.length || !prevItems.length) {
    logError("data", "인구 데이터가 비어있습니다. API 키를 확인하세요.");
    process.exit(1);
  }

  // 2. 전년도 데이터 맵 생성 (시군구명 → 인구)
  const prevMap = new Map();
  for (const item of prevItems) {
    const parsed = parseGu(item.ctpvNm, item.sggNm);
    if (parsed) {
      const key = `${parsed.region}:${parsed.gu}`;
      const pop = parseInt(String(item.totNmprCnt || item.totPpltn || "0").replace(/,/g, ""), 10);
      if (pop > 0) prevMap.set(key, pop);
    }
  }

  // 3. 증감률 계산
  const rows = [];
  for (const item of curItems) {
    const parsed = parseGu(item.ctpvNm, item.sggNm);
    if (!parsed) continue;

    const key = `${parsed.region}:${parsed.gu}`;
    const curPop = parseInt(String(item.totNmprCnt || item.totPpltn || "0").replace(/,/g, ""), 10);
    const prevPop = prevMap.get(key);

    if (!curPop || !prevPop) continue;

    const growthRate = ((curPop - prevPop) / prevPop) * 100;

    rows.push({
      region: parsed.region,
      gu: parsed.gu,
      pop_growth: Math.round(growthRate * 10) / 10, // 소수점 1자리
      population: curPop,
      households: parseHouseholds(item.hhCnt),
      recorded_at: `${curYear}-${String(curMonth).padStart(2, "0")}-01`,
    });
  }

  // 4. 시도 단위 집계 (gu=null)
  // 행안부 API 가 같은 시도에 시 합계 ("수원시") + 자치구 ("수원시 팔달구") 둘 다 응답하므로
  // 자치구 보유 시도는 시 합계 행을 누적에서 제외 (중복 차단). 서울/세종 등 자치구가 단어 1개인
  // 시도는 그대로 누적.
  /** @type {Set<string>} */
  const hasGuLevel = new Set();
  for (const r of rows) {
    if (r.gu && r.gu.includes(" ")) hasGuLevel.add(r.region);
  }
  /** @type {Record<string, {curPop: number, prevPop: number, curHh: number}>} */
  const regionAgg = {};
  for (const r of rows) {
    if (!r.gu) continue;
    if (hasGuLevel.has(r.region) && !r.gu.includes(" ")) continue;
    if (!regionAgg[r.region]) regionAgg[r.region] = { curPop: 0, prevPop: 0, curHh: 0 };
    regionAgg[r.region].curPop += r.population;
    if (r.households) regionAgg[r.region].curHh += r.households;
    const key = `${r.region}:${r.gu}`;
    regionAgg[r.region].prevPop += prevMap.get(key) || 0;
  }

  for (const [region, agg] of Object.entries(regionAgg)) {
    if (agg.prevPop > 0) {
      rows.push({
        region,
        gu: null,  // 시도 단위 집계 (gu 없음)
        pop_growth: Math.round(((agg.curPop - agg.prevPop) / agg.prevPop) * 100 * 10) / 10,
        population: agg.curPop,
        households: agg.curHh > 0 ? agg.curHh : null,
        recorded_at: `${curYear}-${String(curMonth).padStart(2, "0")}-01`,
      });
    }
  }

  log("calc", `${rows.length}건 증감률 계산 완료`);

  // 요약 출력
  const guRows = rows.filter(r => r.gu);
  const regionRows = rows.filter(r => !r.gu);
  log("summary", `시도: ${regionRows.length}건, 시군구: ${guRows.length}건`);

  const positive = guRows.filter(r => r.pop_growth > 0);
  const negative = guRows.filter(r => r.pop_growth < 0);
  const avgGrowth = guRows.length > 0 ? (guRows.reduce((s, r) => s + r.pop_growth, 0) / guRows.length).toFixed(2) : "N/A";
  log("summary", `양수: ${positive.length}건, 음수: ${negative.length}건, 평균: ${avgGrowth}%`);

  if (dryRun) {
    log("dry-run", "미리보기 모드 — 업데이트 생략");
    console.log("\n시도별 증감률:");
    for (const r of regionRows.sort((a, b) => b.pop_growth - a.pop_growth)) {
      console.log(`  ${r.region}: ${r.pop_growth > 0 ? "+" : ""}${r.pop_growth}% (${r.population.toLocaleString()}명)`);
    }
    console.log("\n상위 10 시군구:");
    for (const r of guRows.sort((a, b) => b.pop_growth - a.pop_growth).slice(0, 10)) {
      console.log(`  ${r.region} ${r.gu}: ${r.pop_growth > 0 ? "+" : ""}${r.pop_growth}%`);
    }
    console.log("\n하위 10 시군구:");
    for (const r of guRows.sort((a, b) => a.pop_growth - b.pop_growth).slice(0, 10)) {
      console.log(`  ${r.region} ${r.gu}: ${r.pop_growth}%`);
    }
    return;
  }

  // 5. Supabase 저장 (Approach C: UPDATE 소유 컬럼만 + conditional INSERT)
  // population.mjs는 pop_growth, population, households 소유. 다른 수집기 컬럼은 보존.
  const sb = getSupabase();
  const rpt = createReporter("population");
  let saved = 0;
  for (const row of rows) {
    if (rpt.interrupted()) break;
    // population 소유 컬럼만 업데이트 (다른 수집기 컬럼 보존)
    let q = sb.from("regions")
      .update({ pop_growth: row.pop_growth, population: row.population, households: row.households })
      .eq("region", row.region)
      .eq("recorded_at", row.recorded_at);
    if (row.gu) q = q.eq("gu", row.gu);
    else q = q.is("gu", null);

    const { data: updated, error: updErr } = await q.select("id");
    if (updErr) {
      logError("regions", `UPDATE 실패 ${row.region} ${row.gu || '(시도)'}: ${updErr.message}`);
      rpt.fail(1);
      continue;
    }

    if (!updated || updated.length === 0) {
      // 행이 없으면 새로 생성 (supply_ratio 등 미소유 컬럼은 생략 → DB default null)
      const { error: insErr } = await sb.from("regions").insert([{
        region: row.region,
        gu: row.gu,
        pop_growth: row.pop_growth,
        population: row.population,
        households: row.households,
        recorded_at: row.recorded_at,
      }]);
      if (insErr) {
        logError("regions", `INSERT 실패 ${row.region} ${row.gu || '(시도)'}: ${insErr.message}`);
        rpt.fail(1);
        continue;
      }
    }
    saved++;
    rpt.success(1);
  }
  log("done", `regions 테이블 ${saved}/${rows.length}건 저장 완료 (${today()})`);
  const result = rpt.summary();

  if (!dryRun) await recordApiQuota("population", "MOIS_POP_KEY", apiCalls);
  await recordCollectorRun("population", result);
  if (result.fail > 0) process.exit(1);
}

// CLI 직접 실행 시에만 main() 호출 (테스트 환경 보호)
const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });

// 테스트용 순수 함수 export
export { resolveRegion, parseGu, parseHouseholds };
