/**
 * 청약홈 경쟁률 수집기
 *
 * API: 한국부동산원 청약홈 잔여세대 경쟁률 조회
 *   (api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1/getRemndrLttotPblancCmpet)
 *
 * 사용법:
 *   node scripts/collectors/collect-applyhome.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-applyhome.mjs --dry-run    (미리보기만)
 *
 * 필요 환경변수:
 *   MOLIT_KEY (data.go.kr 통합 키 — odcloud.kr 호환)
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, logError, createReporter } from "./_shared.mjs";

loadEnv();

const PHASE = "applyhome";
const API_KEY = process.env.MOLIT_KEY;
if (!API_KEY) {
  logError(PHASE, "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)");
  process.exit(1);
}

const BASE_URL = "https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1/getRemndrLttotPblancCmpet";

// ── API 페이지네이션 (odcloud: page/perPage) ─────────────────
async function fetchAllPages() {
  const allRows = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      page: String(page),
      perPage: "1000",
      serviceKey: API_KEY,
    });

    const url = `${BASE_URL}?${params}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const data = json.data || [];
    allRows.push(...data);

    log(PHASE, `  page ${page}: ${data.length}건 (누적 ${allRows.length}/${json.totalCount})`);

    if (allRows.length >= json.totalCount || data.length < 1000) break;
    page++;
  }

  return allRows;
}

// ── 아파트별 가중평균 경쟁률 집계 ────────────────────────────
function aggregateByApartment(rows) {
  // HOUSE_MANAGE_NO별 그룹핑
  const groups = {};
  for (const row of rows) {
    const no = row.HOUSE_MANAGE_NO;
    if (!no) continue;
    if (!groups[no]) groups[no] = [];
    groups[no].push(row);
  }

  const result = {};
  for (const [no, items] of Object.entries(groups)) {
    let totalSupply = 0;
    let totalApplicants = 0;

    for (const item of items) {
      const supply = Number(item.SUPLY_HSHLDCO) || 0;
      const applicants = Number(item.REQ_CNT) || 0;  // REQ_CNT는 문자열!

      totalSupply += supply;
      totalApplicants += applicants;
    }

    // 가중평균: 총 신청수 / 총 공급수
    const rate = totalSupply > 0
      ? Math.round((totalApplicants / totalSupply) * 100) / 100
      : null;

    result[no] = { rate, supply: totalSupply, applicants: totalApplicants };
  }

  return result;
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const rpt = createReporter(PHASE);

  // 1. 청약홈 API 전체 조회
  log(PHASE, "청약홈 잔여세대 경쟁률 조회 시작...");
  const rows = await fetchAllPages();
  log(PHASE, `API 총 ${rows.length}건`);

  // 2. 아파트별 집계
  const aggregated = aggregateByApartment(rows);
  const aptNos = Object.keys(aggregated);
  log(PHASE, `고유 아파트: ${aptNos.length}건`);

  // 3. 우리 아파트 ID와 매칭 (ah-{HOUSE_MANAGE_NO})
  const { data: apartments, error } = await sb
    .from("apartments")
    .select("id");

  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);

  const aptSet = new Set(apartments.map(a => a.id));
  let matched = 0;

  for (const [no, agg] of Object.entries(aggregated)) {
    const aptId = `ah-${no}`;
    if (!aptSet.has(aptId)) continue;
    matched++;

    if (dryRun) {
      const rateStr = agg.rate != null
        ? (agg.rate < 0 ? `미달(${(Math.abs(agg.rate) * 100).toFixed(0)}%)` : `${agg.rate}:1`)
        : "null";
      log(PHASE, `  [DRY-RUN] ${aptId}: ${rateStr} (공급:${agg.supply} 신청:${agg.applicants})`);
      rpt.success(1);
      continue;
    }

    const { error: updErr } = await sb.from("apartments").update({
      competition_rate: agg.rate,
      competition_supply: agg.supply,
      competition_applicants: agg.applicants,
      updated_at: new Date().toISOString(),
    }).eq("id", aptId);

    if (updErr) { logError(PHASE, `  ${aptId} UPDATE 실패: ${updErr.message}`); rpt.fail(1); }
    else rpt.success(1);
  }

  log(PHASE, `매칭: ${matched}/${aptNos.length}건`);
  rpt.summary();
  log(PHASE, "\n=== 완료 ===");
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
