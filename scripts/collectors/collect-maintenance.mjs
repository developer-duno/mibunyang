/**
 * 국토부 공동주택 관리비 수집기
 *
 * API: AptIndvdlzManageCostServiceV2 (data.go.kr)
 *   주요 5개 항목(난방/급탕/가스/전기/수도)의 세대당 관리비 합산
 *
 * 사용법:
 *   node scripts/collectors/collect-maintenance.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-maintenance.mjs --dry-run    (미리보기만)
 *   node scripts/collectors/collect-maintenance.mjs --force      (이미 데이터 있는 것도 재수집)
 *
 * 필요 환경변수:
 *   MOLIT_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, logError, sleep, createReporter } from "./_shared.mjs";
import {
  SIDO_CODE, API_DETAIL_BASE, REQUEST_DELAY,
  molitApiCall, fetchSidoAptList, findBestMatch,
} from "./_molit-api.mjs";

loadEnv();

const PHASE = "maintenance";
const API_KEY = process.env.MOLIT_KEY;
if (!API_KEY) {
  logError(PHASE, "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)");
  process.exit(1);
}

const COST_BASE = "https://apis.data.go.kr/1613000/AptIndvdlzManageCostServiceV2";

// 관리비 주요 5개 항목 — 개별비(P)를 합산하여 세대당 관리비 산출
const COST_ENDPOINTS = [
  { label: "난방비", endpoint: "getHsmpHeatCostInfoV2", field: "heatP" },
  { label: "급탕비", endpoint: "getHsmpHotWaterCostInfoV2", field: "waterHotP" },
  { label: "가스료", endpoint: "getHsmpGasRentalFeeInfoV2", field: "gasP" },
  { label: "전기료", endpoint: "getHsmpElectricityCostInfoV2", field: "electP" },
  { label: "수도료", endpoint: "getHsmpWaterCostInfoV2", field: "waterCoolP" },
];

// ── 총 세대수 조회 (AptBasisInfoServiceV4) ──────────────────────
async function fetchTotalHouseholds(kaptCode) {
  try {
    const json = await molitApiCall(PHASE, API_DETAIL_BASE, "getAphusBassInfoV4", { kaptCode }, API_KEY);
    const item = json?.response?.body?.item ?? json?.response?.body?.items?.item;
    const cnt = parseInt(item?.kaptdaCnt, 10);
    return isNaN(cnt) || cnt <= 0 ? null : cnt;
  } catch { return null; }
}

// ── 관리비 조회 (5개 항목 합산) ────────────────────────────────
async function fetchMaintenanceCost(kaptCode, searchDate) {
  let totalCost = 0;
  let validCount = 0;

  for (const { label, endpoint, field } of COST_ENDPOINTS) {
    try {
      const params = new URLSearchParams({
        serviceKey: API_KEY,
        pageNo: "1",
        numOfRows: "1",
        type: "json",
        kaptCode,
        searchDate,
      });
      const url = `${COST_BASE}/${endpoint}?${params}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;

      const json = await res.json();
      const item = json?.response?.body?.item;
      if (!item) continue;

      const value = parseInt(item[field], 10);
      if (!isNaN(value) && value >= 0) {
        totalCost += value;
        validCount++;
      }
    } catch {
      // 개별 항목 실패 시 건너뜀
    }
    await sleep(200); // API 간 소량 지연
  }

  return validCount > 0 ? totalCost : null;
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const rpt = createReporter(PHASE);

  // 조회 월 (2개월 전 — 관리비 데이터 지연 반영)
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const searchDate = `${target.getFullYear()}${String(target.getMonth() + 1).padStart(2, "0")}`;
  log(PHASE, `조회 월: ${searchDate}`);

  // 1. 대상 아파트 조회
  let query = sb.from("apartments").select("id, name, region, gu, units, avg_maintenance_cost");
  if (!force) query = query.is("avg_maintenance_cost", null);

  const { data: targets, error } = await query;
  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);
  log(PHASE, `대상: ${targets.length}건`);
  if (!targets.length) { log(PHASE, "대상 없음, 종료"); return; }

  // 2. 지역별 그룹핑
  const regionGroups = {};
  for (const t of targets) {
    const r = t.region || "기타";
    if (!regionGroups[r]) regionGroups[r] = [];
    regionGroups[r].push(t);
  }

  // 3. 지역별 단지목록 → kaptCode 매칭 → 관리비 조회
  for (const [region, regionTargets] of Object.entries(regionGroups)) {
    const sidoCode = SIDO_CODE[region];
    if (!sidoCode) { log(PHASE, `${region}: 시도코드 없음, 건너뜀`); rpt.skip(regionTargets.length); continue; }

    log(PHASE, `\n${region} (${sidoCode}): ${regionTargets.length}건`);

    let aptList;
    try {
      aptList = await fetchSidoAptList(PHASE, sidoCode, API_KEY);
      await sleep(REQUEST_DELAY);
    } catch (err) {
      logError(PHASE, `  목록 조회 실패: ${err.message}`);
      rpt.fail(regionTargets.length);
      continue;
    }

    if (!aptList.length) { log(PHASE, `  API 목록 0건`); rpt.skip(regionTargets.length); continue; }
    log(PHASE, `  API 목록: ${aptList.length}건`);

    for (const target of regionTargets) {
      const match = findBestMatch(target.name, target.gu, aptList, {
        guField: "kaptName", guBonus: 0.1, attachScore: false,
      });
      if (!match?.kaptCode) { rpt.skip(1); continue; }

      try {
        await sleep(REQUEST_DELAY);

        // 총 세대수 조회 (관리비 / 세대수 = 세대당 관리비)
        const totalHouseholds = await fetchTotalHouseholds(match.kaptCode);
        await sleep(REQUEST_DELAY);

        const totalCost = await fetchMaintenanceCost(match.kaptCode, searchDate);

        if (totalCost == null || totalCost <= 0) { rpt.skip(1); continue; }
        if (!totalHouseholds) { rpt.skip(1); continue; }

        // 세대당 관리비 = 전체 관리비 / 총 세대수
        const perUnit = Math.round(totalCost / totalHouseholds);

        if (dryRun) {
          log(PHASE, `  [DRY-RUN] ${target.name}: ${perUnit.toLocaleString("ko-KR")}원/세대 (총 ${totalCost.toLocaleString("ko-KR")}원 ÷ ${totalHouseholds}세대)`);
          rpt.success(1);
          continue;
        }

        const { error: updErr } = await sb.from("apartments").update({
          avg_maintenance_cost: perUnit,
          updated_at: new Date().toISOString(),
        }).eq("id", target.id);

        if (updErr) { logError(PHASE, `  ${target.name} UPDATE 실패: ${updErr.message}`); rpt.fail(1); }
        else rpt.success(1);
      } catch (err) {
        logError(PHASE, `  ${target.name}: ${err.message}`);
        rpt.fail(1);
      }
    }
  }

  rpt.summary();
  log(PHASE, "\n=== 완료 ===");
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
