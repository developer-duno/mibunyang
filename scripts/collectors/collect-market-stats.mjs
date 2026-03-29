/**
 * KOSIS 민간아파트 분양가격동향 5개 지표 수집기
 *
 * 출처: 주택도시보증공사(orgId=414) — KOSIS API
 *   1. DT_41401N_006 — ㎡당 분양가격지수 (2014=100, 월간)
 *   2. DT_41401N_005 — ㎡당 평균 분양가격 (천원/㎡, 월간)
 *   3. DT_41401N_007 — 신규 분양세대수 (세대, 월간)
 *   4. DT_41401N_008 — 평균 초기분양률 (%, 분기)
 *   5. DT_41401N_009 — 분양가 중 대지비 비율 (%, 월간)
 *
 * 사용법:
 *   node scripts/collectors/collect-market-stats.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-market-stats.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, createReporter, sleep } from "./_shared.mjs";

loadEnv();

const PHASE = "market-stats";
const KOSIS_KEY = process.env.KOSIS_KEY;

// 지표별 설정
const INDICATORS = [
  { col: "price_index",       tblId: "DT_41401N_006", prdSe: "M", objLevels: 2, parse: parseFloat, minExpected: 10, label: "분양가격지수" },
  { col: "avg_price_sqm",     tblId: "DT_41401N_005", prdSe: "M", objLevels: 2, parse: parseInt,   minExpected: 10, label: "평균분양가격" },
  { col: "new_supply",        tblId: "DT_41401N_007", prdSe: "M", objLevels: 1, parse: parseInt,   minExpected: 10, label: "신규분양세대수" },
  { col: "initial_sale_rate", tblId: "DT_41401N_008", prdSe: "Q", objLevels: 1, parse: parseFloat, minExpected: 5,  label: "초기분양률" },
  { col: "land_cost_ratio",   tblId: "DT_41401N_009", prdSe: "M", objLevels: 1, parse: parseInt,   minExpected: 10, label: "대지비비율" },
];

// KOSIS C1_NM → DB region 매핑 (HUG 테이블은 약칭 사용)
const REGION_MAP = {
  "서울": "서울", "부산": "부산", "대구": "대구", "인천": "인천",
  "광주": "광주", "대전": "대전", "울산": "울산", "세종": "세종",
  "경기": "경기", "강원": "강원", "충북": "충북", "충남": "충남",
  "전북": "전북", "전남": "전남", "경북": "경북", "경남": "경남", "제주": "제주",
  // 정식명 호환
  "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구",
  "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
  "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기",
  "강원특별자치도": "강원", "강원도": "강원",
  "충청북도": "충북", "충청남도": "충남",
  "전라북도": "전북", "전북특별자치도": "전북", "전라남도": "전남",
  "경상북도": "경북", "경상남도": "경남",
  "제주특별자치도": "제주", "제주도": "제주",
};

// ── KOSIS API 호출 (node:https — TLS 호환) ───────────────────
async function fetchKosisTable(indicator, startPrdDe, endPrdDe) {
  const https = await import("node:https");
  const tls = await import("node:tls");

  const params = new URLSearchParams({
    method: "getList",
    apiKey: KOSIS_KEY,
    orgId: "414",
    tblId: indicator.tblId,
    itmId: "ALL",
    objL1: "ALL",
    ...(indicator.objLevels >= 2 ? { objL2: "ALL" } : {}),
    prdSe: indicator.prdSe,
    startPrdDe,
    endPrdDe,
    format: "json",
    jsonVD: "Y",
  });

  const url = `https://kosis.kr/openapi/Param/statisticsParameterData.do?${params}`;
  const agent = new https.Agent({
    secureOptions: tls.SSL_OP_LEGACY_SERVER_CONNECT,
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.2",
  });

  return new Promise((resolve, reject) => {
    const req = https.request(url, { headers: { "User-Agent": "Mozilla/5.0" }, agent }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`KOSIS HTTP ${res.statusCode}`));
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error("KOSIS JSON 파싱 실패")); }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("KOSIS 타임아웃")); });
    req.end();
  });
}

/** KOSIS 행에서 지역별 최신값 추출 */
export function extractLatestByRegion(rows, indicator) {
  const latestByRegion = {};
  for (const row of rows) {
    if (row.C2_NM && row.C2_NM !== "전체") continue;
    const region = REGION_MAP[row.C1_NM];
    if (!region) continue;
    const value = indicator.parse(row.DT, 10);
    if (isNaN(value)) continue;
    const period = row.PRD_DE;
    if (!latestByRegion[region] || period > latestByRegion[region].period) {
      latestByRegion[region] = { value, period };
    }
  }
  return latestByRegion;
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  if (!KOSIS_KEY) throw new Error("KOSIS_KEY not configured");
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const rpt = createReporter(PHASE);

  // 기간 설정
  const now = new Date();
  const endMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const startMonth = `${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, "0")}`;
  // 분기용: 최근 8분기 (데이터 1~2분기 지연 감안)
  const curQ = Math.ceil((now.getMonth() + 1) / 3);
  const endQ = `${now.getFullYear()}${curQ}`;
  const startQ = `${now.getFullYear() - 2}${curQ}`;

  // 기존 regions 행 조회 (UPDATE 대상)
  const { data: regions, error: rErr } = await sb
    .from("regions")
    .select("id, region, gu")
    .is("gu", null); // 시도 레벨만 (VIEW latest_regions CTE 조건)

  if (rErr) { logError(PHASE, `regions 조회 실패: ${rErr.message}`); return; }
  log(PHASE, `regions 시도 행: ${regions.length}건`);

  // 지표별 수집
  for (const ind of INDICATORS) {
    const start = ind.prdSe === "Q" ? startQ : startMonth;
    const end = ind.prdSe === "Q" ? endQ : endMonth;

    log(PHASE, `\n[${ind.label}] ${ind.tblId} (${ind.prdSe}) ${start}~${end}`);

    let data;
    try {
      data = await fetchKosisTable(ind, start, end);
    } catch (e) {
      logError(PHASE, `  ${ind.label} API 실패: ${e.message}`);
      rpt.fail(1);
      continue;
    }

    if (data.err) {
      logError(PHASE, `  ${ind.label} KOSIS 에러: ${data.errMsg || data.err}`);
      rpt.fail(1);
      continue;
    }

    const rows = Array.isArray(data) ? data : [];
    if (rows.length < ind.minExpected) {
      logError(PHASE, `  ${ind.label}: ${rows.length}건 < 최소 ${ind.minExpected}건 — itmId/prdSe 확인 필요`);
    }

    const latestByRegion = extractLatestByRegion(rows, ind);

    const regionCount = Object.keys(latestByRegion).length;
    log(PHASE, `  ${ind.label}: ${rows.length}건 응답, ${regionCount}개 시도 매핑`);

    // regions 테이블 UPDATE
    let updated = 0;
    for (const reg of regions) {
      const entry = latestByRegion[reg.region];
      if (!entry) continue;

      if (dryRun) {
        log(PHASE, `  [DRY-RUN] ${reg.region}: ${ind.col} = ${entry.value} (${entry.period})`);
        updated++;
        continue;
      }

      const { error } = await sb.from("regions")
        .update({ [ind.col]: entry.value })
        .eq("id", reg.id);

      if (error) {
        logError(PHASE, `  ${reg.region} ${ind.col} UPDATE 실패: ${error.message}`);
      } else {
        updated++;
      }
    }

    log(PHASE, `  ${ind.label}: ${updated}건 갱신`);
    rpt.success(updated);

    // KOSIS 부하 방지
    await sleep(1000);
  }

  const result = rpt.summary();
  log(PHASE, "=== 완료 ===");
  if (result.fail > 0) process.exit(1);
}

const isCLI = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isCLI) main().catch(err => { logError(PHASE, err.message); process.exit(1); });
