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
import { loadEnv, getSupabase, upsertBatch, log, logError, createReporter, REGION_MAP, VALID_REGIONS, today } from "./_shared.mjs";

loadEnv();

const API_KEY = process.env.MOIS_POP_KEY;
if (!API_KEY) {
  logError("init", "MOIS_POP_KEY 환경변수 필요 (data.go.kr 인증키)");
  process.exit(1);
}

const BASE_URL = "https://apis.data.go.kr/1741000/juminsu/getJuminsuList";

// ── 인구 데이터 조회 ────────────────────────────────────────
async function fetchPopulation(year, month) {
  const params = new URLSearchParams({
    serviceKey: API_KEY,
    pageNo: "1",
    numOfRows: "500",
    type: "json",
    regSeCd: "2", // 시군구
    srchFrmnYear: String(year),
    srchFrmnMonth: String(month).padStart(2, "0"),
    srchToYear: String(year),
    srchToMonth: String(month).padStart(2, "0"),
  });

  const url = `${BASE_URL}?${params}`;
  log("fetch", `${year}년 ${month}월 인구 데이터 조회...`);

  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

  const json = await res.json();
  const items = json?.StatsJuminsuSearch?.item;
  if (!items || !Array.isArray(items)) {
    log("fetch", `${year}년 ${month}월: 데이터 없음`);
    return [];
  }

  log("fetch", `${year}년 ${month}월: ${items.length}건`);
  return items;
}

// ── 시도명 → 약칭 변환 ──────────────────────────────────────
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
function parseGu(adminNm) {
  // "서울특별시 강남구" → { region: "서울", gu: "강남구" }
  // "경기도 수원시 팔달구" → { region: "경기", gu: "수원시" }
  const parts = adminNm.trim().split(/\s+/);
  if (parts.length < 2) return null;

  const region = resolveRegion(parts[0]);
  if (!region) return null;

  // 세종은 gu 없음
  if (region === "세종") return { region, gu: "세종시" };

  const gu = parts[1]; // "강남구", "수원시" 등
  return { region, gu };
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // 현재 연월, 전년 동월
  const now = new Date();
  // API 데이터는 보통 2개월 지연 → 2개월 전 데이터 사용
  const targetDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const curYear = targetDate.getFullYear();
  const curMonth = targetDate.getMonth() + 1;
  const prevYear = curYear - 1;

  log("init", `대상: ${curYear}년 ${curMonth}월 vs ${prevYear}년 ${curMonth}월`);

  // 1. 올해/작년 데이터 가져오기
  const [curItems, prevItems] = await Promise.all([
    fetchPopulation(curYear, curMonth),
    fetchPopulation(prevYear, curMonth),
  ]);

  if (!curItems.length || !prevItems.length) {
    logError("data", "인구 데이터가 비어있습니다. API 키를 확인하세요.");
    process.exit(1);
  }

  // 2. 전년도 데이터 맵 생성 (시군구명 → 인구)
  const prevMap = new Map();
  for (const item of prevItems) {
    const parsed = parseGu(item.admNm || item.adminNm || "");
    if (parsed) {
      const key = `${parsed.region}:${parsed.gu}`;
      const pop = parseInt(String(item.totPpltn || item.population || "0").replace(/,/g, ""), 10);
      if (pop > 0) prevMap.set(key, pop);
    }
  }

  // 3. 증감률 계산
  const rows = [];
  for (const item of curItems) {
    const parsed = parseGu(item.admNm || item.adminNm || "");
    if (!parsed) continue;

    const key = `${parsed.region}:${parsed.gu}`;
    const curPop = parseInt(String(item.totPpltn || item.population || "0").replace(/,/g, ""), 10);
    const prevPop = prevMap.get(key);

    if (!curPop || !prevPop) continue;

    const growthRate = ((curPop - prevPop) / prevPop) * 100;

    rows.push({
      region: parsed.region,
      gu: parsed.gu,
      pop_growth: Math.round(growthRate * 10) / 10, // 소수점 1자리
      supply_ratio: null, // 공급량은 별도 수집
      population: curPop,
      recorded_at: `${curYear}-${String(curMonth).padStart(2, "0")}-01`,
    });
  }

  // 4. 시도 단위 집계 (gu=null)
  const regionAgg = {};
  for (const r of rows) {
    if (!regionAgg[r.region]) regionAgg[r.region] = { curPop: 0, prevPop: 0 };
    regionAgg[r.region].curPop += r.population;
    const key = `${r.region}:${r.gu}`;
    regionAgg[r.region].prevPop += prevMap.get(key) || 0;
  }

  for (const [region, agg] of Object.entries(regionAgg)) {
    if (agg.prevPop > 0) {
      rows.push({
        region,
        gu: null,
        pop_growth: Math.round(((agg.curPop - agg.prevPop) / agg.prevPop) * 100 * 10) / 10,
        supply_ratio: null,
        population: agg.curPop,
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

  // 5. Supabase upsert
  const rpt = createReporter("population");
  const inserted = await upsertBatch("regions", rows, "region,gu,recorded_at");
  rpt.success(inserted);
  rpt.fail(rows.length - inserted);
  log("done", `regions 테이블 ${inserted}건 upsert 완료 (${today()})`);
  rpt.summary();
}

main().catch(err => { logError("main", err.message); process.exit(1); });
