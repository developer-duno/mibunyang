// @ts-check
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
 *   node scripts/collectors/collect-maintenance.mjs --limit=1000 (대상 N개만 — API 일일 한도 분산)
 *   node scripts/collectors/collect-maintenance.mjs --budget-min=100 (벽시계 예산 분 — 기본 100, 0=무제한)
 *
 * 필요 환경변수:
 *   MOLIT_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, logError, sleep, createReporter, recordApiQuota, recordCollectorRun, selectAll } from "./_shared.mjs";
import {
  SIDO_CODE, API_DETAIL_BASE, REQUEST_DELAY,
  molitApiCall, fetchSidoAptList, findBestMatch,
} from "./_molit-api.mjs";

/**
 * @typedef {{ id: string; name: string; region: string | null; gu: string | null; units: number | null;
 *   avg_maintenance_cost: number | null;
 *   maint_heat: number | null; maint_hotwater: number | null;
 *   maint_gas: number | null; maint_elec: number | null; maint_water: number | null
 * }} MaintAptTarget
 * @typedef {{ heat: number|null; hotwater: number|null; gas: number|null; elec: number|null; water: number|null }} MaintCostBreakdown
 */

loadEnv();

const PHASE = "maintenance";
const API_KEY = process.env.MOLIT_KEY;
if (!API_KEY) {
  logError(PHASE, "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)");
  process.exit(1);
}

const COST_BASE = "https://apis.data.go.kr/1613000/AptIndvdlzManageCostServiceV2";

// 관리비 주요 5개 항목 — 항목별 raw 값을 object 로 반환하여 main() 에서 5 컬럼 동시 UPDATE + 합산 avg_maintenance_cost 보존
const COST_ENDPOINTS = [
  { label: "난방비", endpoint: "getHsmpHeatCostInfoV2", field: "heatP" },
  { label: "급탕비", endpoint: "getHsmpHotWaterCostInfoV2", field: "waterHotP" },
  { label: "가스료", endpoint: "getHsmpGasRentalFeeInfoV2", field: "gasP" },
  { label: "전기료", endpoint: "getHsmpElectricityCostInfoV2", field: "electP" },
  { label: "수도료", endpoint: "getHsmpWaterCostInfoV2", field: "waterCoolP" },
];

/** @type {Record<string, "heat"|"hotwater"|"gas"|"elec"|"water">} */
const FIELDS_MAP = {
  heatP: "heat", waterHotP: "hotwater", gasP: "gas", electP: "elec", waterCoolP: "water",
};

// ── 총 세대수 조회 (AptBasisInfoServiceV4) ──────────────────────
/**
 * @param {string} kaptCode
 * @returns {Promise<number | null>}
 */
export async function fetchTotalHouseholds(kaptCode) {
  try {
    const json = await molitApiCall(PHASE, API_DETAIL_BASE, "getAphusBassInfoV4", { kaptCode }, API_KEY || "");
    const body = /** @type {{ response?: { body?: { item?: Record<string, unknown>; items?: { item?: Record<string, unknown> } } } }} */ (json);
    const item = body?.response?.body?.item ?? body?.response?.body?.items?.item;
    const cnt = parseInt(String(item?.kaptdaCnt ?? ""), 10);
    return isNaN(cnt) || cnt <= 0 ? null : cnt;
  } catch { return null; }
}

// ── 관리비 조회 (5개 항목 raw object 반환) ─────────────────────
/**
 * @param {string} kaptCode
 * @param {string} searchDate
 * @returns {Promise<MaintCostBreakdown | null>}
 */
export async function fetchMaintenanceCost(kaptCode, searchDate) {
  /** @type {MaintCostBreakdown} */
  const result = { heat: null, hotwater: null, gas: null, elec: null, water: null };
  let anyValid = false;

  for (const { endpoint, field } of COST_ENDPOINTS) {
    const key = FIELDS_MAP[field];
    try {
      const params = new URLSearchParams({
        serviceKey: API_KEY || "",
        pageNo: "1",
        numOfRows: "1",
        type: "json",
        kaptCode,
        searchDate,
      });
      const url = `${COST_BASE}/${endpoint}?${params}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;

      const json = /** @type {{ response?: { body?: { item?: Record<string, unknown> } } }} */ (await res.json());
      const item = json?.response?.body?.item;
      if (!item) continue;

      const value = parseInt(String(item[field] ?? ""), 10);
      if (!isNaN(value) && value >= 0) {
        result[key] = value; // 원 단위 raw — main()에서 세대당 만원 변환
        anyValid = true;
      }
    } catch {
      // 개별 항목 실패 시 건너뜀
    }
    await sleep(200); // API 간 소량 지연
  }

  return anyValid ? result : null;
}

// ── wall-clock budget ────────────────────────────────────────
// job timeout-minutes(120) 미만으로 자체 종료해 graceful break 가 SIGKILL(grace 0) 레이스를 이기게 함.
// 외부 MOLIT API 지연 시 단지당 hang(최대 ~80s)이 누적돼 런이 부풀어도 partial 데이터 + collector_runs
// 행을 남기고 종료 → updated_at 오름차순 + --limit resume 설계로 다음 회차에 남은 단지가 채워짐 (세션 447).
const DEFAULT_BUDGET_MIN = 100; // 120분 job timeout 대비 20분 여유

/**
 * @param {number} startedAt  main() 시작 시각 (Date.now())
 * @param {number} budgetMin  예산 (분)
 * @param {number} [nowMs]    현재 시각 (테스트 주입용)
 * @returns {boolean}
 */
export function budgetExceeded(startedAt, budgetMin, nowMs = Date.now()) {
  if (budgetMin <= 0) return false; // 0 이하 = 비활성(무제한)
  return (nowMs - startedAt) >= budgetMin * 60_000;
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const rpt = createReporter(PHASE);
  let apiCalls = 0;

  const startedAt = Date.now();
  const budgetArg = process.argv.find((a) => a.startsWith("--budget-min="));
  const budgetMin = budgetArg ? parseInt(budgetArg.replace("--budget-min=", ""), 10) : DEFAULT_BUDGET_MIN;
  let budgetHit = false;

  // 조회 월 (2개월 전 — 관리비 데이터 지연 반영)
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const searchDate = `${target.getFullYear()}${String(target.getMonth() + 1).padStart(2, "0")}`;
  log(PHASE, `조회 월: ${searchDate}`);

  // 1. 대상 아파트 조회 (selectAll: 1000행 제한 자동 페이지네이션)
  // maint_* 5컬럼 중 하나라도 NULL이면 대상 (avg_maintenance_cost만 있고 항목별은 빈 단지 포함)
  // updated_at 오래된 순 — --limit 사용 시 cron 회차마다 다른 단지가 채워지도록
  let targets = /** @type {MaintAptTarget[]} */ (await selectAll((s) => {
    let q = s.from("apartments").select("id, name, region, gu, units, avg_maintenance_cost, maint_heat, maint_hotwater, maint_gas, maint_elec, maint_water");
    if (!force) q = q.or("maint_heat.is.null,maint_hotwater.is.null,maint_gas.is.null,maint_elec.is.null,maint_water.is.null");
    return q.order("updated_at", { ascending: true, nullsFirst: true });
  }, sb));

  // --limit=N: 한 회차 대상 수 제한 (API 일일 한도 분산). 단지당 ~6회 호출.
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.replace("--limit=", ""), 10) : 0;
  if (limit > 0 && targets.length > limit) {
    log(PHASE, `대상 ${targets.length}건 중 --limit=${limit} 적용`);
    targets = targets.slice(0, limit);
  }
  log(PHASE, `대상: ${targets.length}건`);
  if (!targets.length) { log(PHASE, "대상 없음, 종료"); return; }

  // 2. 지역별 그룹핑
  /** @type {Record<string, MaintAptTarget[]>} */
  const regionGroups = {};
  for (const t of targets) {
    const r = t.region || "기타";
    if (!regionGroups[r]) regionGroups[r] = [];
    regionGroups[r].push(t);
  }

  // 3. 지역별 단지목록 → kaptCode 매칭 → 관리비 조회
  for (const [region, regionTargets] of Object.entries(regionGroups)) {
    if (rpt.interrupted()) break;
    if (budgetExceeded(startedAt, budgetMin)) { budgetHit = true; break; }
    const sidoCode = SIDO_CODE[region];
    if (!sidoCode) { log(PHASE, `${region}: 시도코드 없음, 건너뜀`); rpt.skip(regionTargets.length); continue; }

    log(PHASE, `\n${region} (${sidoCode}): ${regionTargets.length}건`);

    let aptList;
    try {
      aptList = await fetchSidoAptList(PHASE, sidoCode, API_KEY || "");
      apiCalls++;
      await sleep(REQUEST_DELAY);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `  목록 조회 실패: ${msg}`);
      rpt.fail(regionTargets.length);
      continue;
    }

    if (!aptList.length) { log(PHASE, `  API 목록 0건`); rpt.skip(regionTargets.length); continue; }
    log(PHASE, `  API 목록: ${aptList.length}건`);

    for (const target of regionTargets) {
      if (rpt.interrupted()) break;
      if (budgetExceeded(startedAt, budgetMin)) { budgetHit = true; break; }
      const match = findBestMatch(target.name, target.gu, aptList, {
        guField: "address", guBonus: 0.15, attachScore: false,
      });
      if (!match?.kaptCode) { rpt.skip(1); continue; }

      try {
        await sleep(REQUEST_DELAY);

        // 총 세대수 조회 (관리비 / 세대수 = 세대당 관리비)
        const totalHouseholds = await fetchTotalHouseholds(match.kaptCode);
        apiCalls++; // fetchTotalHouseholds
        await sleep(REQUEST_DELAY);

        const costs = await fetchMaintenanceCost(match.kaptCode, searchDate);
        apiCalls += COST_ENDPOINTS.length; // 5개 항목 각각 API 호출

        if (costs == null) { rpt.skip(1); continue; }
        if (!totalHouseholds) { rpt.skip(1); continue; }

        // 세대당 관리비 (만원) = 항목별 raw(원) / 총 세대수 / 10000
        const ITEM_CAP = 100;  // 각 항목 만원/세대/월 상한
        const MAINT_CAP = 500; // 합산 만원/세대/월 상한
        const households = totalHouseholds; // 클로저 narrow 보장 (TS18047 시뮬 patch)

        /** @param {number|null} raw @returns {number|null} */
        function toItemPerUnit(raw) {
          if (raw == null || raw <= 0) return null;
          return Math.min(Math.round(raw / households / 10000), ITEM_CAP);
        }

        const heat     = toItemPerUnit(costs.heat);
        const hotwater = toItemPerUnit(costs.hotwater);
        const gas      = toItemPerUnit(costs.gas);
        const elec     = toItemPerUnit(costs.elec);
        const water    = toItemPerUnit(costs.water);

        const sumItems = (heat ?? 0) + (hotwater ?? 0) + (gas ?? 0) + (elec ?? 0) + (water ?? 0);
        if (sumItems <= 0) { rpt.skip(1); continue; }
        if (sumItems > MAINT_CAP) log(PHASE, `  [WARN] ${target.name}: 합산 ${sumItems}만원 > 상한(${MAINT_CAP}만원) — 클램핑됨`);
        const perUnit = Math.min(sumItems, MAINT_CAP);

        if (dryRun) {
          log(PHASE, `  [DRY-RUN] ${target.name}: ${perUnit}만원/세대 (heat=${heat ?? "-"} hot=${hotwater ?? "-"} gas=${gas ?? "-"} elec=${elec ?? "-"} water=${water ?? "-"}, ${households}세대)`);
          rpt.success(1);
          continue;
        }

        const { error: updErr } = await sb.from("apartments").update({
          avg_maintenance_cost: perUnit,
          maint_heat: heat,
          maint_hotwater: hotwater,
          maint_gas: gas,
          maint_elec: elec,
          maint_water: water,
          updated_at: new Date().toISOString(),
        }).eq("id", target.id);

        if (updErr) { logError(PHASE, `  ${target.name} UPDATE 실패: ${updErr.message}`); rpt.fail(1); }
        else rpt.success(1);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(PHASE, `  ${target.name}: ${msg}`);
        rpt.fail(1);
      }
    }
    if (budgetHit) break; // 내부 loop 가 예산 초과로 끊겼으면 region loop 도 종료
  }

  if (budgetHit) {
    log(PHASE, `\n[budget] ${budgetMin}분 예산 초과 — graceful 종료 (남은 단지는 다음 회차 resume, 세션 447)`);
  }

  const result = rpt.summary();
  log(PHASE, `API 호출: ${apiCalls}회`);

  if (!dryRun) await recordApiQuota("collect-maintenance", "MOLIT_KEY", apiCalls);

  log(PHASE, "\n=== 완료 ===");
  await recordCollectorRun(PHASE, result);
  if (result.fail > 0) process.exit(1);
}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });
