/**
 * KOSIS 시군구별 이동자수 → 시군구/시도별 순이동 수집
 *
 * API: KOSIS OpenAPI 통계청 "시군구별 이동자수" (DT_1B26001_A01)
 *      orgId=101, itmId=T25(순이동), objL1=ALL → 1회 호출로 전국 272건
 *      (전국1 + 시도17 + 시군구254)
 *
 * 세션103: 행안부 transMovStats 전환. 기존 API는 4개 활용신청 전부 net_migration 부적합.
 *          transMovStats 자체가 행안부에 존재하지 않음(세션85 "502 서버장애"는 오진).
 *
 * C1 코드 규칙:
 *   - 2자리(시도): 11서울, 26부산, 27대구, 28인천, 29광주, 30대전, 31울산, 36세종,
 *                 41경기, 51강원, 43충북, 44충남, 52전북, 46전남, 47경북, 48경남, 50제주
 *   - 5자리(시군구): 앞 2자리 = 시도 C1 → 동명이구 자동 해결
 *
 * 사용법:
 *   node scripts/collectors/migration.mjs          (Supabase regions UPDATE)
 *   node scripts/collectors/migration.mjs --dry-run (미리보기)
 *
 * 필요 환경변수:
 *   KOSIS_MIGRATION_KEY  — KOSIS OpenAPI 키
 *   SUPABASE_URL / SUPABASE_SERVICE_KEY
 */
import {
  loadEnv, getSupabase, log, logError,
  REGION_LAWD_PREFIX, recordApiQuota,
} from "./_shared.mjs";

loadEnv();

const PHASE = "migration";
const API_KEY = process.env.KOSIS_MIGRATION_KEY;
if (!API_KEY) {
  logError(PHASE, "KOSIS_MIGRATION_KEY 환경변수 필요");
  process.exit(1);
}

const BASE_URL = "https://kosis.kr/openapi/Param/statisticsParameterData.do";

// ── C1 2자리 → 약칭 역변환 맵 (REGION_LAWD_PREFIX 역방향) ─────
// 강원 42→51, 전북 45→52 특별자치도 개편 이후 KOSIS는 신 코드 사용.
// 레거시 코드도 함께 수용(자체 방어).
export const C1_TO_REGION = (() => {
  const map = {};
  for (const [region, prefix] of Object.entries(REGION_LAWD_PREFIX)) {
    map[prefix] = region;
  }
  // 강원/전북 특별자치도 개편 — KOSIS는 51/52, 레거시는 42/45
  map["51"] = "강원";
  map["52"] = "전북";
  map["42"] = "강원"; // 방어
  map["45"] = "전북"; // 방어
  return map;
})();

// ── KOSIS 공백 이슈 정규화 ─────────────────────────────────
// 부산/대구 등 "중  구" 공백 2칸 → "중구"
export function normalizeC1Name(name) {
  if (!name) return name;
  return name.replace(/\s+/g, "");
}

// ── C1 코드 → { region, gu } 매핑 ─────────────────────────
export function mapC1(c1Code, c1Name) {
  const code = String(c1Code);
  const name = normalizeC1Name(c1Name);
  if (code === "00") return null; // 전국 제외

  if (code.length === 2) {
    const region = C1_TO_REGION[code];
    return region ? { region, gu: null } : null;
  }
  if (code.length === 5) {
    const prefix = code.slice(0, 2);
    const region = C1_TO_REGION[prefix];
    if (!region) return null;
    // 세종은 시군구 없음
    if (region === "세종") return { region, gu: "세종시" };
    return { region, gu: name };
  }
  return null;
}

// ── KOSIS 응답 행 → 집계 ────────────────────────────────────
// 최신 PRD_DE (월)만 사용, ITM_NM === "순이동" 만
export function aggregateKosisRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { period: null, entries: [] };

  // 최신 PRD_DE 찾기
  let latestPrd = "";
  for (const r of rows) {
    if (r.PRD_DE > latestPrd) latestPrd = r.PRD_DE;
  }

  const entries = [];
  for (const r of rows) {
    if (r.PRD_DE !== latestPrd) continue;
    if (r.ITM_NM !== "순이동") continue;

    const mapped = mapC1(r.C1, r.C1_NM);
    if (!mapped) continue;

    const netMigration = parseInt(String(r.DT || "0").replace(/,/g, ""), 10);
    if (Number.isNaN(netMigration)) continue;

    entries.push({
      region: mapped.region,
      gu: mapped.gu,
      net_migration: netMigration,
    });
  }
  return { period: latestPrd, entries };
}

// ── KOSIS 호출 ──────────────────────────────────────────────
async function fetchKosis() {
  const params = new URLSearchParams({
    method: "getList",
    apiKey: API_KEY,
    orgId: "101",
    tblId: "DT_1B26001_A01",
    itmId: "T10 T20 T25",
    objL1: "ALL",
    prdSe: "M",
    newEstPrdCnt: "1", // 최신 1개월
    format: "json",
    jsonVD: "Y",
  });
  const url = `${BASE_URL}?${params}`;
  log(PHASE, "KOSIS DT_1B26001_A01 호출...");

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`KOSIS HTTP ${res.status}`);

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`KOSIS JSON 파싱 실패: ${text.slice(0, 200)}`); }
  if (json?.err) throw new Error(`KOSIS 에러 ${json.err}: ${json.errMsg || ""}`);
  return Array.isArray(json) ? json : [];
}

// ── 메인 ────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  // 세션103: KOSIS 호출 자체가 쿼터 1콜 소비이므로 throw 경로에서도 기록 보장
  let apiCalls = 0;
  let failed = 0;
  try {
    const result = await runCollect(dryRun);
    failed = result.failed;
    apiCalls = result.apiCalls;
  } finally {
    if (!dryRun && apiCalls > 0) {
      await recordApiQuota(PHASE, "KOSIS_MIGRATION_KEY", apiCalls);
    }
  }
  if (failed > 0) process.exit(1);
}

async function runCollect(dryRun) {
  const rows = await fetchKosis();
  const apiCalls = 1;
  log(PHASE, `KOSIS 응답: ${rows.length}건`);

  const { period, entries } = aggregateKosisRows(rows);
  if (!period || entries.length === 0) {
    log(PHASE, "유효 데이터 없음 — 종료");
    return { apiCalls, failed: 0 };
  }
  log(PHASE, `기준월: ${period}, 유효 entry: ${entries.length}건`);

  // 요약
  const regionRows = entries.filter(e => !e.gu);
  const guRows = entries.filter(e => e.gu);
  const positive = regionRows.filter(e => e.net_migration > 0);
  const negative = regionRows.filter(e => e.net_migration < 0);
  log(PHASE, `시도: ${regionRows.length}건 (유입 ${positive.length}, 유출 ${negative.length}) / 시군구: ${guRows.length}건`);

  if (dryRun) {
    console.log("\n시도별 순이동:");
    for (const r of [...regionRows].sort((a, b) => b.net_migration - a.net_migration)) {
      const sign = r.net_migration >= 0 ? "+" : "";
      console.log(`  ${r.region}: ${sign}${r.net_migration.toLocaleString()}명`);
    }
    console.log("\n상위 10 시군구 (순유입):");
    for (const r of [...guRows].sort((a, b) => b.net_migration - a.net_migration).slice(0, 10)) {
      console.log(`  ${r.region} ${r.gu}: +${r.net_migration.toLocaleString()}명`);
    }
    console.log("\n하위 10 시군구 (순유출):");
    for (const r of [...guRows].sort((a, b) => a.net_migration - b.net_migration).slice(0, 10)) {
      console.log(`  ${r.region} ${r.gu}: ${r.net_migration.toLocaleString()}명`);
    }
    return { apiCalls, failed: 0 };
  }

  // Supabase UPDATE
  // NOTE: PostgREST `.update().eq()` 는 ORDER BY/LIMIT 을 UPDATE 문에 반영하지 않음.
  // regions 는 region+gu 당 여러 recorded_at 스냅샷이 동일 최신값으로 동기화되는 구조로 운영.
  // "최신 1건만" 의도의 `.order().limit(1)` 은 미작동이므로 제거(세션103 collector-contract 지적).
  const sb = getSupabase();
  let updated = 0, failed = 0;

  for (const e of entries) {
    const query = sb
      .from("regions")
      .update({ net_migration: e.net_migration })
      .eq("region", e.region);

    if (e.gu) query.eq("gu", e.gu);
    else query.is("gu", null);

    const { error } = await query;
    if (error) {
      logError(PHASE, `${e.region} ${e.gu ?? ""}: ${error.message}`);
      failed++;
    } else {
      updated++;
    }
  }

  log(PHASE, `regions.net_migration UPDATE: ${updated}건 성공 / ${failed}건 실패`);

  return { apiCalls, failed };
}

const isCLI = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isCLI) main().catch(err => { logError(PHASE, err.message); process.exit(1); });
