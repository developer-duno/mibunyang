// @ts-check
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
import { loadEnv, getSupabase, log, logError, createReporter, selectAll, upsertBatch, recordApiQuota, recordCollectorRun, today } from "./_shared.mjs";

loadEnv();

const PHASE = "applyhome";
const API_KEY = process.env.MOLIT_KEY;
let apiCalls = 0;

const BASE_URL = "https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1/getRemndrLttotPblancCmpet";

/**
 * @typedef {{ HOUSE_MANAGE_NO?: string; SUPLY_HSHLDCO?: string | number; REQ_CNT?: string | number; [k: string]: unknown }} ApplyHomeRow
 * @typedef {{ rate: number | null; supply: number; applicants: number; raw_rows: ApplyHomeRow[] }} AggResult
 */

// ── API 페이지네이션 (odcloud: page/perPage) ─────────────────
/** @returns {Promise<ApplyHomeRow[]>} */
async function fetchAllPages() {
  /** @type {ApplyHomeRow[]} */
  const allRows = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      page: String(page),
      perPage: "1000",
      serviceKey: API_KEY || "",
    });

    const url = `${BASE_URL}?${params}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    apiCalls++;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = /** @type {{ data?: ApplyHomeRow[]; totalCount?: number }} */ (await res.json());
    const data = json.data || [];
    allRows.push(...data);

    log(PHASE, `  page ${page}: ${data.length}건 (누적 ${allRows.length}/${json.totalCount})`);

    if (allRows.length >= (json.totalCount || 0) || data.length < 1000) break;
    page++;
  }

  return allRows;
}

// ── 아파트별 가중평균 경쟁률 집계 ────────────────────────────
/**
 * @param {ApplyHomeRow[]} rows
 * @returns {Record<string, AggResult>}
 */
export function aggregateByApartment(rows) {
  // HOUSE_MANAGE_NO별 그룹핑
  /** @type {Record<string, ApplyHomeRow[]>} */
  const groups = {};
  for (const row of rows) {
    const no = row.HOUSE_MANAGE_NO;
    if (!no) continue;
    if (!groups[no]) groups[no] = [];
    groups[no].push(row);
  }

  /** @type {Record<string, AggResult>} */
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

    result[no] = { rate, supply: totalSupply, applicants: totalApplicants, raw_rows: items };
  }

  return result;
}

/**
 * 매칭된 단지만 events 배열로 변환 (순수 함수, DB 호출 없음 — 단위 테스트용)
 * @param {Record<string, AggResult>} aggregated
 * @param {Array<{ id: string }>} apartments
 * @param {string} recordedAt
 */
export function buildEventsFromAggregated(aggregated, apartments, recordedAt) {
  const aptSet = new Set(apartments.map(a => a.id));
  /** @type {Array<{ apartment_id: string; house_manage_no: string; supply: number; applicants: number; rate: number | null; recorded_at: string; raw_response: ApplyHomeRow[] }>} */
  const events = [];
  for (const [no, agg] of Object.entries(aggregated)) {
    const aptId = `ah-${no}`;
    if (!aptSet.has(aptId)) continue;
    events.push({
      apartment_id: aptId,
      house_manage_no: no,
      supply: agg.supply,
      applicants: agg.applicants,
      rate: agg.rate,
      recorded_at: recordedAt,
      raw_response: agg.raw_rows,
    });
  }
  return events;
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  if (!API_KEY) {
    logError(PHASE, "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const rpt = createReporter(PHASE);

  try {
  // 1. 청약홈 API 전체 조회
  log(PHASE, "청약홈 잔여세대 경쟁률 조회 시작...");
  const rows = await fetchAllPages();
  log(PHASE, `API 총 ${rows.length}건`);

  // 2. 아파트별 집계
  const aggregated = aggregateByApartment(rows);
  const aptNos = Object.keys(aggregated);
  log(PHASE, `고유 아파트: ${aptNos.length}건`);

  // 2.5. 청약홈 API 응답 형식 변경 조기 감지 (5% 경고 + exit(1) 알림)
  // ⚠️ 위치 = aggregate 직후 + apartments.update 루프 진입 전.
  //    이 시점에는 어떤 DB 쓰기도 발생 안 함 → exit(1) 시 데이터 무결.
  const totalAggregated = aptNos.length;
  const zeroSupplyCount = Object.values(aggregated)
    .filter(a => a.supply === 0).length;
  const zeroRatio = totalAggregated > 0 ? zeroSupplyCount / totalAggregated : 0;
  if (zeroRatio > 0.05) {
    logError(PHASE, `⚠️ supply=0 비율 ${(zeroRatio * 100).toFixed(1)}% (${zeroSupplyCount}/${totalAggregated}) — 청약홈 API 필드명 변경 가능성. odcloud 응답 1건 샘플 확인 필요.`);
    process.exit(1);
  }

  // 3. 우리 아파트 ID와 매칭 (ah-{HOUSE_MANAGE_NO})
  const apartments = /** @type {Array<{ id: string }>} */ (await selectAll(
    (s) => s.from("apartments").select("id"),
    sb
  ));

  const aptSet = new Set(apartments.map(a => a.id));
  let matched = 0;
  /** @type {Array<{ apartment_id: string; house_manage_no: string; supply: number; applicants: number; rate: number | null; recorded_at: string; raw_response: ApplyHomeRow[] }>} */
  const events = [];   // 시계열 적재용 — apartments.update 성공 시에만 누적

  for (const [no, agg] of Object.entries(aggregated)) {
    if (rpt.interrupted()) break;
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

    if (updErr) { logError(PHASE, `  ${aptId} UPDATE 실패: ${updErr.message}`); rpt.fail(1); continue; }
    rpt.success(1);

    // 시계열 events 누적 (apartments.update 성공 분기 안)
    events.push({
      apartment_id: aptId,
      house_manage_no: no,
      supply: agg.supply,
      applicants: agg.applicants,
      rate: agg.rate,
      recorded_at: today(), // KST 고정
      raw_response: agg.raw_rows,
    });
  }

  // 4. 시계열 일괄 upsert (dry-run 모드 아닐 때만)
  if (!dryRun && events.length > 0) {
    const inserted = await upsertBatch(
      "applyhome_events",
      events,
      "apartment_id,house_manage_no",
      500,
      sb,
    );
    const failed = events.length - inserted;
    if (failed > 0) rpt.fail(failed);
    // 추가 PHASE 로그 불필요: upsertBatch 내부가 이미
    // "applyhome_events: ${inserted}/${rows.length}건 upsert" 출력
  }

  log(PHASE, `매칭: ${matched}/${aptNos.length}건`);
  const result = rpt.summary();
  log(PHASE, "\n=== 완료 ===");
  await recordCollectorRun(PHASE, result);
  if (result.fail > 0) process.exit(1);
  } finally {
    if (!dryRun && apiCalls > 0) {
      await recordApiQuota(PHASE, "MOLIT_KEY", apiCalls);
    }
  }
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });
