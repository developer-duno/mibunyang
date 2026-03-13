/**
 * 행안부 전입/전출 통계 → 시군구별 순이동 수집
 *
 * API: 행정안전부_주민등록 전입전출 통계 (data.go.kr)
 *
 * 사용법:
 *   node scripts/collectors/migration.mjs          (Supabase regions 테이블 업데이트)
 *   node scripts/collectors/migration.mjs --dry-run (미리보기만)
 *
 * 필요 환경변수:
 *   MOIS_POP_KEY        — data.go.kr 인증키 (행안부 API)
 *   SUPABASE_URL        — Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_KEY — Supabase service_role 키
 */
import { loadEnv, getSupabase, log, logError, REGION_MAP, today } from "./_shared.mjs";

loadEnv();

const API_KEY = process.env.MOIS_POP_KEY;
if (!API_KEY) {
  logError("init", "MOIS_POP_KEY 환경변수 필요 (data.go.kr 인증키)");
  process.exit(1);
}

const BASE_URL = "https://apis.data.go.kr/1741000/transMovStats/getTransMovStats";

// ── 전입/전출 데이터 조회 ──────────────────────────────────
async function fetchMigration(year, month) {
  const params = new URLSearchParams({
    serviceKey: API_KEY,
    pageNo: "1",
    numOfRows: "500",
    type: "json",
    srchSeCd: "2", // 시군구
    srchYear: String(year),
    srchMonth: String(month).padStart(2, "0"),
  });

  const url = `${BASE_URL}?${params}`;
  log("fetch", `${year}년 ${month}월 전입/전출 데이터 조회...`);

  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

  const json = await res.json();
  // API 응답 구조에 맞게 파싱
  const items = json?.StatsTransMovSearch?.item ?? json?.response?.body?.items?.item;
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
  if (REGION_MAP[fullName]) return REGION_MAP[fullName];
  for (const [k, v] of Object.entries(REGION_MAP)) {
    if (fullName.includes(v) || k.includes(fullName)) return v;
  }
  return null;
}

// ── 시군구명 파싱 ────────────────────────────────────────────
function parseGu(adminNm) {
  const parts = adminNm.trim().split(/\s+/);
  if (parts.length < 2) return null;

  const region = resolveRegion(parts[0]);
  if (!region) return null;

  if (region === "세종") return { region, gu: "세종시" };

  const gu = parts[1];
  return { region, gu };
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // 최근 3개월 데이터 집계 (API 지연 감안)
  const now = new Date();
  const targetDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const year = targetDate.getFullYear();
  const months = [
    targetDate.getMonth() + 1,
    targetDate.getMonth(),
    targetDate.getMonth() - 1,
  ].filter(m => m > 0).map(m => m > 12 ? m - 12 : m);

  log("init", `대상: ${year}년 ${months.join(",")}월 전입/전출 통계`);

  // 1. 월별 데이터 조회 + 집계
  const netByKey = {}; // "region:gu" → { in: N, out: N }

  for (const month of months) {
    try {
      const items = await fetchMigration(year, month);

      for (const item of items) {
        const adminNm = item.admNm || item.adminNm || "";
        const parsed = parseGu(adminNm);
        if (!parsed) continue;

        const key = `${parsed.region}:${parsed.gu}`;
        if (!netByKey[key]) netByKey[key] = { region: parsed.region, gu: parsed.gu, moveIn: 0, moveOut: 0 };

        // 전입/전출 수 파싱 (API 필드명은 변동 가능)
        const moveIn = parseInt(String(item.movInCnt || item.moveInCnt || "0").replace(/,/g, ""), 10);
        const moveOut = parseInt(String(item.movOutCnt || item.moveOutCnt || "0").replace(/,/g, ""), 10);

        netByKey[key].moveIn += moveIn;
        netByKey[key].moveOut += moveOut;
      }

      await new Promise(r => setTimeout(r, 500)); // 레이트 리밋
    } catch (err) {
      logError("fetch", `${year}년 ${month}월: ${err.message}`);
    }
  }

  // 2. 순이동 계산
  const rows = [];
  for (const [, data] of Object.entries(netByKey)) {
    const netMigration = data.moveIn - data.moveOut;
    rows.push({
      region: data.region,
      gu: data.gu,
      net_migration: netMigration,
      recorded_at: `${year}-${String(months[0]).padStart(2, "0")}-01`,
    });
  }

  // 3. 시도 단위 집계
  const regionAgg = {};
  for (const r of rows) {
    if (!regionAgg[r.region]) regionAgg[r.region] = { moveIn: 0, moveOut: 0 };
    const data = netByKey[`${r.region}:${r.gu}`];
    regionAgg[r.region].moveIn += data.moveIn;
    regionAgg[r.region].moveOut += data.moveOut;
  }

  for (const [region, agg] of Object.entries(regionAgg)) {
    rows.push({
      region,
      gu: null,
      net_migration: agg.moveIn - agg.moveOut,
      recorded_at: `${year}-${String(months[0]).padStart(2, "0")}-01`,
    });
  }

  log("calc", `${rows.length}건 순이동 계산 완료`);

  // 요약
  const regionRows = rows.filter(r => !r.gu);
  const positive = regionRows.filter(r => r.net_migration > 0);
  const negative = regionRows.filter(r => r.net_migration < 0);
  log("summary", `시도: ${regionRows.length}건 (순유입: ${positive.length}, 순유출: ${negative.length})`);

  if (dryRun) {
    log("dry-run", "미리보기 모드 — 업데이트 생략");
    console.log("\n시도별 순이동:");
    for (const r of regionRows.sort((a, b) => b.net_migration - a.net_migration)) {
      const sign = r.net_migration > 0 ? "+" : "";
      console.log(`  ${r.region}: ${sign}${r.net_migration.toLocaleString()}명`);
    }
    console.log("\n상위 10 시군구 (순유입):");
    const guRows = rows.filter(r => r.gu);
    for (const r of guRows.sort((a, b) => b.net_migration - a.net_migration).slice(0, 10)) {
      console.log(`  ${r.region} ${r.gu}: +${r.net_migration.toLocaleString()}명`);
    }
    console.log("\n하위 10 시군구 (순유출):");
    for (const r of guRows.sort((a, b) => a.net_migration - b.net_migration).slice(0, 10)) {
      console.log(`  ${r.region} ${r.gu}: ${r.net_migration.toLocaleString()}명`);
    }
    return;
  }

  // 4. Supabase 업데이트
  const sb = getSupabase();
  let updated = 0;

  for (const r of rows) {
    // 기존 regions 행의 net_migration 컬럼 갱신
    const query = sb
      .from("regions")
      .update({ net_migration: r.net_migration })
      .eq("region", r.region)
      .order("recorded_at", { ascending: false })
      .limit(1);

    if (r.gu) query.eq("gu", r.gu);
    else query.is("gu", null);

    const { error } = await query;
    if (error) logError("upsert", `${r.region} ${r.gu ?? ""}: ${error.message}`);
    else updated++;
  }

  log("done", `regions 테이블 net_migration ${updated}건 업데이트 완료 (${today()})`);
}

main().catch(err => { logError("main", err.message); process.exit(1); });
