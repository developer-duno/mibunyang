// @ts-check
/**
 * 국토부 공동주택 관리비 수집기
 *
 * API: AptIndvdlzManageCostServiceV3 (data.go.kr)
 *   주요 5개 항목(난방/급탕/가스/전기/수도)의 세대당 관리비 합산
 *
 * 사용법:
 *   node scripts/collectors/collect-maintenance.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-maintenance.mjs --dry-run    (미리보기만)
 *   node scripts/collectors/collect-maintenance.mjs --force      (이미 데이터 있는 것도 재수집)
 *   node scripts/collectors/collect-maintenance.mjs --limit=1000 (짝이 붙은 단지 N개만 — API 일일 한도 분산)
 *   node scripts/collectors/collect-maintenance.mjs --budget-min=100 (벽시계 예산 분 — 기본 100, 0=무제한)
 *
 * 필요 환경변수:
 *   MOLIT_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, logError, sleep, createReporter, recordApiQuota, recordCollectorRun, selectAll } from "./_shared.mjs";
import {
  SIDO_CODE, API_DETAIL_BASE, REQUEST_DELAY,
  molitApiCall, fetchSidoAptList, KaptResultError, createKaptFailureGate, kaptTransientRetryCount,
} from "./_molit-api.mjs";
import { pickKaptMatch, usedateConsistent, isMovedIn, nearSiblingKaptWindow, siblingKaptWindowText, SIBLING_KAPT_LEAD_MIN } from "./_match-gates.mjs";

/**
 * @typedef {{ id: string; name: string; region: string | null; gu: string | null; units: number | null;
 *   updated_at: string | null; completion: string | null; bjd_code: string | null;
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

// V2 → V3: data.go.kr 공지(2026-08-27, NOTICE_0000000004986) — 옛 V2 URL 은 90일 유지 후 중지.
// V3 는 새 카탈로그 활용신청이 필요했고(미신청 시 403 SERVICE_KEY_IS_NOT_REGISTERED) 신청·승인 후
// 라이브 실측 완료: getHsmpHeatCostInfoV3 kaptCode=A10021295 → resultCode 00, 응답 필드 V2 와 동일.
const COST_BASE = "https://apis.data.go.kr/1613000/AptIndvdlzManageCostServiceV3";

// 관리비 주요 5개 항목 — 항목별 raw 값을 object 로 반환하여 main() 에서 5 컬럼 동시 UPDATE + 합산 avg_maintenance_cost 보존
const COST_ENDPOINTS = [
  { label: "난방비", endpoint: "getHsmpHeatCostInfoV3", field: "heatP" },
  { label: "급탕비", endpoint: "getHsmpHotWaterCostInfoV3", field: "waterHotP" },
  { label: "가스료", endpoint: "getHsmpGasRentalFeeInfoV3", field: "gasP" },
  { label: "전기료", endpoint: "getHsmpElectricityCostInfoV3", field: "electP" },
  { label: "수도료", endpoint: "getHsmpWaterCostInfoV3", field: "waterCoolP" },
];

/** @type {Record<string, "heat"|"hotwater"|"gas"|"elec"|"water">} */
const FIELDS_MAP = {
  heatP: "heat", waterHotP: "hotwater", gasP: "gas", electP: "elec", waterCoolP: "water",
};

// ── 기본정보 조회 (AptBasisInfoServiceV5 — 세대수 + 사용승인일) ─────────
/**
 * 세대수(`kaptdaCnt`)와 사용승인일(`kaptUsedate`, K4 검사용 — 세션589). 응답이 비면(03 자료 없음 포함) null.
 * 호출 실패는 **삼키지 않고 던진다** — K-apt 결과 코드(`KaptResultError`, 04 등)도, 결과 코드가 아닌 실패
 * (재시도 소진·시간 초과·HTML 화면·JSON 깨짐)도. 옛 판본은 후자를 null(= 건너뜀)로 돌려 장애 회차가
 * 성공으로 기록됐다(검사 A5) — 이제 `main` 이 실패로 세고 연속 5건이면 회차를 멈춘다(`createKaptFailureGate`).
 * @param {string} kaptCode
 * @returns {Promise<{ households: number | null; usedate: string | null } | null>}
 */
export async function fetchBassInfo(kaptCode) {
  // 8s/1retry 로 좁힘(cost endpoint 톤 일치) — 공유 상수 30s×3 은 hang 누적의 진앙(세션 451).
  // _molit-api 전역 상수는 molit-units·molit-building-info 공유라 maintenance-local opts 로만 좁힌다.
  const json = await molitApiCall(PHASE, API_DETAIL_BASE, "getAphusBassInfoV5", { kaptCode }, API_KEY || "", { timeoutMs: 8000, maxRetries: 1 });
  const body = /** @type {{ response?: { body?: { item?: Record<string, unknown>; items?: { item?: Record<string, unknown> } } } }} */ (json);
  const item = body?.response?.body?.item ?? body?.response?.body?.items?.item;
  if (!item) return null;
  const cnt = parseInt(String(item.kaptdaCnt ?? ""), 10);
  const usedate = item.kaptUsedate != null && String(item.kaptUsedate).trim() ? String(item.kaptUsedate).trim() : null;
  return { households: isNaN(cnt) || cnt <= 0 ? null : cnt, usedate };
}

// ── 관리비 조회 (5개 항목 raw object 반환) ─────────────────────
/**
 * 세션589: 직접 `fetch` → `molitApiCall` 경유. K-apt 간격(1.5초)과 **결과 코드 검사**를 탄다 —
 * 옛 코드는 `!res.ok`·`!item`·`catch{}` 를 전부 `continue` 로 넘겨 04(속도 제한 벌칙)가 "자료 없음"으로
 * 사라졌다(조사반 G — 2u 회차와 겹친 날 관리비가 통째로 비었다). `KaptResultError` 는 던지고,
 * 그 밖의 호출 실패(HTTP·시간 초과)는 그 항목만 null — 단 **다섯 항목이 전부** 그렇게 실패하면 마지막 오류를
 * 던진다(검사 A5: 게이트웨이 장애가 "관리비 없음 = 건너뜀"으로 사라져 장애 회차가 성공으로 남았다).
 * @param {string} kaptCode
 * @param {string} searchDate
 * @returns {Promise<MaintCostBreakdown | null>}
 */
export async function fetchMaintenanceCost(kaptCode, searchDate) {
  /** @type {MaintCostBreakdown} */
  const result = { heat: null, hotwater: null, gas: null, elec: null, water: null };
  let anyValid = false;
  /** @type {unknown} */
  let lastError = null;
  let failedItems = 0;

  for (const { endpoint, field } of COST_ENDPOINTS) {
    const key = FIELDS_MAP[field];
    try {
      const json = /** @type {{ response?: { body?: { item?: Record<string, unknown> } } }} */ (
        await molitApiCall(PHASE, COST_BASE, endpoint, { pageNo: "1", numOfRows: "1", kaptCode, searchDate }, API_KEY || "", { timeoutMs: 8000, maxRetries: 1 })
      );
      const item = json?.response?.body?.item;
      if (item) {
        const value = parseInt(String(item[field] ?? ""), 10);
        if (!isNaN(value) && value >= 0) {
          result[key] = value; // 원 단위 raw — main()에서 세대당 만원 변환
          anyValid = true;
        }
      }
    } catch (err) {
      if (err instanceof KaptResultError) throw err; // 04 등 — 회차를 멈춘다(R2)
      // 그 밖의 개별 항목 실패는 그 항목만 null — 다섯 개 전부면 아래에서 던진다
      lastError = err;
      failedItems++;
    }
    await sleep(200); // API 간 소량 지연
  }

  if (failedItems === COST_ENDPOINTS.length) throw lastError;
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

/**
 * `updated_at` 오래된 순 정렬 (NULL 먼저) — 옛 `.order("updated_at", { ascending: true,
 * nullsFirst: true })` 을 클라이언트로 옮긴 것.
 *
 * 왜 옮겼나: `selectAll` 커서 페이징은 **정렬 키 == 커서 키**여야 한다. 조회에
 * `.order("updated_at")` 이 남으면 그게 1순위 정렬이 되어 `id > cursor` 필터가 다음
 * 페이지가 아닌 엉뚱한 행을 잘라낸다(행 유실). 정렬 의미(--limit 회차 분산)는 그대로 둔다.
 * 동률은 `id` 오름차순으로 갈라 회차마다 같은 순서가 나오게 한다.
 *
 * ⚠️ **시각으로 비교한다(세션546 M5).** 옛 판본은 문자열 사전순이었는데, 그건 모든 행이
 * 같은 오프셋(`+00:00`/`Z`)으로 직렬화될 때만 시간순과 같다. 실측은 균일하지만 **코드가 그걸
 * 단언하지 않았다** — `"2026-04-01T09:00:00+09:00"`(= 00:00Z)가 `"2026-04-01T00:00:00Z"` 보다
 * 뒤로 밀려 "가장 오래된 단지부터" 라는 `--limit` 회차 분산의 전제가 조용히 깨진다.
 * 파싱 실패(NaN)는 NULL 과 같이 **가장 앞**(= 한 번도 안 채워진 것으로 취급) — 값이 이상한
 * 행을 뒤로 미뤄 영영 안 채우는 것보다 낫다.
 * @template {{ id: string, updated_at?: string | null }} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function sortByUpdatedAtAsc(rows) {
  /** @param {string | null | undefined} v */
  const at = (v) => {
    if (v == null || v === "") return -Infinity; // NULL = nullsFirst
    const t = Date.parse(v);
    return Number.isNaN(t) ? -Infinity : t; // 파싱 실패도 앞으로
  };
  return [...rows].sort((a, b) => {
    const au = at(a.updated_at);
    const bu = at(b.updated_at);
    if (au !== bu) return au < bu ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ── 메인 ─────────────────────────────────────────────────────
/**
 * `opts.now` — 조회 월·입주 여부 판정 시각(시험 주입용, 기본 지금).
 * `opts.clock` — 2u 창 판정에 쓰는 "지금"(단지마다 다시 부른다 · 시험 주입용). 없으면 `opts.now` 고정, 그것도 없으면 실제 시각.
 * @param {{ now?: Date; clock?: () => Date }} [opts]
 */
export async function main(opts = {}) {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const rpt = createReporter(PHASE);
  let apiCalls = 0;
  /** 회차 시작 때의 일시 재시도 누적 호출 수 — 끝에서 차이를 쿼터 기록에 더한다(재검사 🟡2) */
  const retryBase = kaptTransientRetryCount();

  const startedAt = Date.now();
  const budgetArg = process.argv.find((a) => a.startsWith("--budget-min="));
  const budgetMin = budgetArg ? parseInt(budgetArg.replace("--budget-min=", ""), 10) : DEFAULT_BUDGET_MIN;
  let budgetHit = false;
  /** @type {string | null} 회차 중단 사유 — K-apt 결과 코드·연속 실패(세션589 R2·보완 B3·B4). error_message 로 남는다 */
  let abortMessage = null;
  /** @type {string | null} 2u 창 때문에 멈춘 사유(SIBLING_KAPT_WINDOW …) — 보완 B1 */
  let windowStop = null;

  // 조회 월 (2개월 전 — 관리비 데이터 지연 반영)
  const now = opts.now ?? new Date();
  /** 2u 창 판정용 지금 시각 — 단지마다 다시 읽는다(시험은 opts.clock 으로 흐르는 시각을 넣는다) */
  const clock = opts.clock ?? (opts.now ? () => /** @type {Date} */ (opts.now) : () => new Date());
  const target = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const searchDate = `${target.getFullYear()}${String(target.getMonth() + 1).padStart(2, "0")}`;
  log(PHASE, `조회 월: ${searchDate}`);

  // 1. 대상 아파트 조회 (selectAll: 고유키(id) 커서 페이지네이션)
  // maint_* 5컬럼 중 하나라도 NULL이면 대상 (avg_maintenance_cost만 있고 항목별은 빈 단지 포함)
  // ⚠️ 정렬은 **조회가 아니라 여기서** 한다. 커서 페이징은 정렬 키와 커서 키가 같아야 하는데
  //    `.order("updated_at")` 이 남으면 그게 1순위가 되어 `id > cursor` 가 엉뚱한 행을 잘라낸다.
  //    "updated_at 오래된 순" 은 --limit 회차 분산용 의미라 전량을 받아온 뒤 그대로 재현한다.
  let targets = /** @type {MaintAptTarget[]} */ (await selectAll((s) => {
    let q = s.from("apartments").select("id, name, region, gu, units, updated_at, completion, bjd_code, avg_maintenance_cost, maint_heat, maint_hotwater, maint_gas, maint_elec, maint_water");
    if (!force) q = q.or("maint_heat.is.null,maint_hotwater.is.null,maint_gas.is.null,maint_elec.is.null,maint_water.is.null");
    return q;
  }, sb, "id"));
  targets = sortByUpdatedAtAsc(targets);

  // V6(세션589, 사장님 결정) — 입주 전 단지에는 관리비를 쓰지 않는다. 완공월을 모르는 단지도 K-apt
  // 매칭을 안 하므로(K5) 대상에서 뺀다 — --limit 자리를 호출 안 할 단지에 쓰지 않게 slice **전에** 거른다.
  const beforeMoveIn = targets.length;
  targets = targets.filter((t) => isMovedIn(t.completion, now));
  if (beforeMoveIn !== targets.length) {
    log(PHASE, `입주 전·완공월 모름 ${beforeMoveIn - targets.length}건 제외 (V6·K5) → ${targets.length}건`);
  }

  // --limit=N: 한 회차에 **짝이 붙은** 단지 N곳까지 (API 일일 한도 분산). 단지당 ~6회 호출.
  // 세션589 보완 B8(검사 A7): 옛 판본은 목록을 받기 전에 앞에서 N곳을 잘라, 입주 후인데 짝이 안 붙는 단지
  // (호출 0회)가 자리를 차지했다 — updated_at 이 안 바뀌어 매 회차 앞자리에 남는다. 이제 짝을 먼저 고르고
  // 짝이 붙은 단지만 센다. 호출 수 상한(N곳 × 6콜 + 시도 목록)은 그대로다.
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.replace("--limit=", ""), 10) : 0;
  log(PHASE, `대상: ${targets.length}건${limit > 0 ? ` (짝이 붙은 단지 ${limit}곳까지 — --limit)` : ""}`);
  if (!targets.length) { log(PHASE, "대상 없음, 종료"); return; }

  const gate = createKaptFailureGate();
  /** 이번 회차 몫 — 2u 창 때문에 시작도 못 하면 이만큼 skip 으로 남긴다 */
  const share = limit > 0 ? Math.min(limit, targets.length) : targets.length;
  /** @param {number} left */
  const windowMessage = (left) => `SIBLING_KAPT_WINDOW 2u K-apt 창(KST ${siblingKaptWindowText()}) 또는 시작 ${SIBLING_KAPT_LEAD_MIN}분 전이라 멈춤 — 남은 ${left}곳 다음 회차`;

  // 2. 시도 목록 — 대상 단지가 있는 시도만, 시도 코드마다 한 번(광주·전남 = "12" 공유).
  //    2u 창 검사는 **시작 때와 단지마다**(검사 A1·C1 — 러너는 놓친 날을 같은 실행에 이어 돌고 늦게 켜진 날은
  //    늦게 시작해, 시작 + 40분 예산만으로는 2u 06:20 회차를 못 피한다).
  /** @type {Map<string, import("./_molit-api.mjs").MolitAptItem[] | null>} 시도 코드 → 목록(조회 실패면 null) */
  const lists = new Map();
  for (const region of new Set(targets.map((t) => t.region || "기타"))) {
    if (rpt.interrupted()) break;
    if (budgetExceeded(startedAt, budgetMin)) { budgetHit = true; break; }
    if (nearSiblingKaptWindow(clock())) { windowStop = windowMessage(share); rpt.skip(share); break; }
    const sidoCode = SIDO_CODE[region];
    if (!sidoCode || lists.has(sidoCode)) continue;
    try {
      const list = await fetchSidoAptList(PHASE, sidoCode, API_KEY || "");
      apiCalls++;
      gate.success();
      lists.set(sidoCode, list);
      log(PHASE, `${region} (${sidoCode}): API 목록 ${list.length}건`);
      await sleep(REQUEST_DELAY);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `${region} (${sidoCode}) 목록 조회 실패: ${msg} — 이 시도 단지는 이번 회차에서 빠진다`);
      lists.set(sidoCode, null);
      rpt.fail(1);
      apiCalls++; // 던진 목록 호출도 1회(재검사 🟡2 — 결과 코드 아닌 실패도 쿼터를 쓴다)
      const stop = gate.failure(err);
      if (stop) { abortMessage = stop; break; }
    }
  }

  // 3. 짝 고르기(호출 0) → 짝이 붙은 단지만 --limit 만큼
  /** @type {Array<{ target: MaintAptTarget; kaptCode: string }>} */
  const selected = [];
  if (!windowStop && !abortMessage) {
    for (const target of targets) {
      if (limit > 0 && selected.length >= limit) break;
      const sidoCode = SIDO_CODE[target.region || "기타"];
      if (!sidoCode) { log(PHASE, `  ${target.name}: 시도코드 없음(region=${target.region}), 건너뜀`); rpt.skip(1); continue; }
      const list = lists.get(sidoCode);
      if (!list) continue; // 목록을 못 받은 시도(조회 실패는 위에서 실패 1건으로 셌다 · 중단·예산으로 못 간 시도)
      // 짝 짓기 게이트(세션589 K1·K2·K3·K5) — 완공월·입주 후·같은 시군구·차수·이름 0.6 · 동점이면 안 붙임
      const pick = pickKaptMatch(target, list, { now });
      if (!pick.match?.kaptCode) { log(PHASE, `  ${target.name}: 매칭 안 함 — ${pick.reason ?? "kaptCode 없음"}`); rpt.skip(1); continue; }
      selected.push({ target, kaptCode: pick.match.kaptCode });
    }
    log(PHASE, `짝이 붙은 단지 ${selected.length}곳 처리`);
  }

  // 4. 짝이 붙은 단지마다 기본정보 → 관리비
  for (let i = 0; i < selected.length; i++) {
    const { target, kaptCode } = selected[i];
    if (rpt.interrupted()) break;
    if (budgetExceeded(startedAt, budgetMin)) { budgetHit = true; break; }
    if (nearSiblingKaptWindow(clock())) { windowStop = windowMessage(selected.length - i); rpt.skip(selected.length - i); break; }

    try {
      await sleep(REQUEST_DELAY);

      // 기본정보 — 세대수(관리비 / 세대수 = 세대당 관리비) + 사용승인일(K4)
      apiCalls++; // fetchBassInfo — 부르기 전에 센다(던져도 1회, 재검사 🟡2)
      const bass = await fetchBassInfo(kaptCode);
      if (!bass) { gate.success(); rpt.skip(1); continue; }
      // K4 — 사용승인일이 우리 완공월과 24개월 넘게 다르면 그 짝을 버린다(관리비 호출 전에 — 5콜 절약)
      if (!usedateConsistent(target.completion, bass.usedate)) {
        log(PHASE, `  ${target.name}: 사용승인일 불일치 (kaptUsedate=${bass.usedate ?? "없음"}, completion=${target.completion}, kaptCode=${kaptCode}) — 쓰지 않음`);
        gate.success();
        rpt.skip(1);
        continue;
      }
      const totalHouseholds = bass.households;
      if (!totalHouseholds) { gate.success(); rpt.skip(1); continue; }
      await sleep(REQUEST_DELAY);

      // 5개 항목 각각 API 호출 — 부르기 전에 센다. 중간에 던지면(04 등 — 회차 중단) 실제보다 몇 콜 많게 잡힌다(쿼터는 넉넉한 쪽)
      apiCalls += COST_ENDPOINTS.length;
      const costs = await fetchMaintenanceCost(kaptCode, searchDate);
      gate.success(); // K-apt 호출이 이 단지에서 끝까지 됐다 — 연속 실패 수를 0 으로

      if (costs == null) { rpt.skip(1); continue; }

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

      const { error: updErr } = await sb.from("apartments").update(maintUpdateRow(perUnit, { heat, hotwater, gas, elec, water })).eq("id", target.id);

      if (updErr) { logError(PHASE, `  ${target.name} UPDATE 실패: ${updErr.message}`); rpt.fail(1); }
      else rpt.success(1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `  ${target.name}: ${msg}`);
      rpt.fail(1);
      // 일시·fatal 코드는 즉시, 10·11 과 결과 코드 아닌 실패는 연속 5건이면 회차를 멈춘다(세션589 보완 B3·B4)
      const stop = gate.failure(err);
      if (stop) { abortMessage = stop; break; }
    }
  }

  if (budgetHit) {
    log(PHASE, `\n[budget] ${budgetMin}분 예산 초과 — graceful 종료 (남은 단지는 다음 회차 resume, 세션 447)`);
  }
  if (windowStop) log(PHASE, windowStop);
  if (abortMessage) {
    logError(PHASE, `${abortMessage} — 회차 중단(벌칙 중 계속 부르면 길어진다). 남은 단지는 다음 회차`);
  }

  const result = rpt.summary();
  const retryCalls = kaptTransientRetryCount() - retryBase;
  apiCalls += retryCalls;
  log(PHASE, `API 호출: ${apiCalls}회(일시 재시도 ${retryCalls}회 포함)`);

  if (!dryRun) await recordApiQuota("collect-maintenance", "MOLIT_KEY", apiCalls);

  log(PHASE, "\n=== 완료 ===");
  // 회차 중단은 error_message 머리말 KAPT_RESULT_<코드> · KAPT_FETCH_FAIL 로(세션589 R2·보완 B4),
  // 2u 창 때문에 멈춘 회차는 SIBLING_KAPT_WINDOW 로 남긴다(감시 ⑮ 가 읽는다 — 보완 B2).
  if (abortMessage) await recordCollectorRun(PHASE, { ...result, status: "failure", errorMessage: abortMessage });
  else await recordCollectorRun(PHASE, windowStop ? { ...result, errorMessage: windowStop } : result);
  if (result.fail > 0) process.exit(1);
}

/**
 * K6(세션589) — 관리비 UPDATE 행. **값이 있는 칸만** 싣는다 — 옛 코드는 6칸을 무조건 써서 이번 달
 * 항목이 비면 지난번 값을 null 로 지웠다. `avg_maintenance_cost` 는 호출처가 합계 > 0 을 확인한 뒤라 늘 값이 있다.
 * @param {number} perUnit
 * @param {{ heat: number|null; hotwater: number|null; gas: number|null; elec: number|null; water: number|null }} items
 * @returns {Record<string, unknown>}
 */
export function maintUpdateRow(perUnit, items) {
  /** @type {Record<string, unknown>} */
  const row = { avg_maintenance_cost: perUnit };
  if (items.heat != null) row.maint_heat = items.heat;
  if (items.hotwater != null) row.maint_hotwater = items.hotwater;
  if (items.gas != null) row.maint_gas = items.gas;
  if (items.elec != null) row.maint_elec = items.elec;
  if (items.water != null) row.maint_water = items.water;
  row.updated_at = new Date().toISOString();
  return row;
}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });
