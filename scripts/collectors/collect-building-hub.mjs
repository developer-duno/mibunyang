// @ts-check
/**
 * 건축HUB 통합 수집기 — 건물에너지 + 주택인허가 데이터
 *
 * API: data.go.kr 국토교통부_건축HUB (1613000/BldEngyHubService)
 *   1. getBeElctyUsgInfo  — 전기사용량 (kWh)
 *   2. getBeGasUsgInfo    — 가스사용량 (MJ)
 *
 * heat_fuel·quake_design 은 네이버 수집 경로(sync-naver-complex.mjs)로 확보.
 * HpPermitService(별도 구독 필요) 연동 코드는 세션139에서 제거. scripts/CLAUDE.md 정책 참조.
 *
 * 미사용 엔드포인트 (Phase 2 또는 불필요):
 *   - getBeWaterUsgInfo (수도) — 스코어링 무관
 *   - getBeHeatUsgInfo (난방열) — 가스와 중복
 *   - getHpActOulnInfo (행위개요) — 면적/용도, 기존 molit V4로 충분
 *   - getHpPlatPlcInfo (대지위치) — 대지면적, 기존 데이터로 충분
 *   - getHpFlrOulnInfo (층별) — 층수 정보, molit V4로 충분
 *   - getHpExposPubuseAreaInfo (전유공용) — 면적 세부, 불필요
 *   - getHpWclfInfo (오수정화) — 스코어링 무관
 *   - getHpJijiguInfo (지역지구) — 규제, 별도 소스 있음
 *   - getBeElctyUsgInfoAI, getBeGasUsgInfoAI (AI 예측) — 추후 검토
 *   - getHpGrndDlInfo (토지거래) — 거래 데이터, 별도 수집기 있음
 *   - getHpRstrctAreaInfo (건축제한) — 규제, 별도 소스
 *
 * 사용법:
 *   node scripts/collectors/collect-building-hub.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-building-hub.mjs --dry-run    (미리보기만)
 *   node scripts/collectors/collect-building-hub.mjs --force      (null이 아닌 값도 재수집)
 *
 * 조회 월 자동 탐지 (세션568): 국토부 건물에너지 공개가 실제로는 약 5개월 지연되어
 * "2개월 전 고정" 조회가 매 회차 0건으로 헛돌았다(collector_runs 수개월간 ok=0). 표본
 * 단지 몇 곳으로 최근 달부터 거슬러 자료가 있는 가장 가까운 달을 찾아 그 달로 본조회한다.
 *
 * 필요 환경변수:
 *   MOLIT_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 *
 * 전제조건:
 *   reverse-geocode.mjs --only-null-bjd 실행 후 bjd_code가 채워져 있어야 함
 *   ⛔ `--force` 를 쓰지 말 것 — 좌표 있는 **전 단지**의 region/gu/dong/address/road_address/
 *      bjd_code/lot 를 카카오 값으로 덮어써, 세션539~544 가 209곳에 손으로 박은 address 출처
 *      표기와 district 결정을 되돌릴 수 없이 지운다(세션546 H1).
 */
import { loadEnv, getSupabase, log, logError, sleep, createReporter, recordApiQuota, recordCollectorRun, selectAll } from "./_shared.mjs";
import { REQUEST_DELAY } from "./_molit-api.mjs";

loadEnv();

const PHASE = "building-hub";
const API_KEY = process.env.MOLIT_KEY;

const API_BASE = "https://apis.data.go.kr/1613000/BldEngyHubService";

// BldEngyHubService는 type=json이어도 항상 XML 반환 → XML 파싱 필수
/**
 * @param {string} endpoint
 * @param {Record<string, string>} params
 * @returns {Promise<any>}
 */
async function hubApiCall(endpoint, params) {
  const qs = new URLSearchParams({ serviceKey: API_KEY ?? "", type: "json", ...params });
  const url = `${API_BASE}/${endpoint}?${qs}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();

  // JSON 응답인 경우 (일부 엔드포인트)
  if (text.startsWith("{")) return JSON.parse(text);

  // XML 에러 체크
  if (text.includes("SERVICE_KEY_IS_NOT_REGISTERED")) {
    throw new Error("API 키 미등록 — data.go.kr에서 서비스 신청 필요");
  }

  // XML 빈 결과
  if (text.includes("<totalCount>0</totalCount>") || !text.includes("<item>")) {
    return { response: { body: { items: [], totalCount: 0 } } };
  }

  // XML → 간이 파싱 (item 태그 추출)
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(text)) !== null) {
    /** @type {Record<string, string>} */
    const obj = {};
    const fieldRegex = /<(\w+)>([^<]*)<\/\1>/g;
    let fm;
    while ((fm = fieldRegex.exec(match[1])) !== null) {
      obj[fm[1]] = fm[2];
    }
    items.push(obj);
  }
  return { response: { body: { items, totalCount: items.length } } };
}

// ── 지번 파라미터 구성 ──────────────────────────────────────
/**
 * @param {string} bjdCode
 * @param {number | null | undefined} lotMain
 * @param {number | null | undefined} lotSub
 * @returns {{sigunguCd: string, bjdongCd: string, bun: string, ji: string}}
 */
export function makeLotParams(bjdCode, lotMain, lotSub) {
  return {
    sigunguCd: bjdCode.slice(0, 5),
    bjdongCd: bjdCode.slice(5, 10),
    bun: String(lotMain ?? 0).padStart(4, "0"),
    ji: String(lotSub ?? 0).padStart(4, "0"),
  };
}

// ── 에너지 수집 (전기 + 가스) ────────────────────────────────
/**
 * @param {string} bjdCode
 * @param {number | null | undefined} lotMain
 * @param {number | null | undefined} lotSub
 * @param {string} useYm
 * @returns {Promise<{elec: number | null, gas: number | null}>}
 */
async function fetchEnergy(bjdCode, lotMain, lotSub, useYm) {
  const params = { ...makeLotParams(bjdCode, lotMain, lotSub), useYm, numOfRows: "10", pageNo: "1" };
  let elec = null, gas = null;

  try {
    const elecJson = await hubApiCall("getBeElctyUsgInfo", params);
    const elecItems = elecJson?.response?.body?.items ?? [];
    const items = Array.isArray(elecItems) ? elecItems : (elecItems.item ? [].concat(elecItems.item) : []);
    if (items.length > 0) {
      // MAX 집계 (복수 건물 중 최대 사용량)
      elec = Math.max(...items.map(i => parseFloat(i.useQty) || 0));
      if (elec === 0) elec = null;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(PHASE, `  전기 조회 실패: ${msg}`);
  }

  await sleep(REQUEST_DELAY);

  try {
    const gasJson = await hubApiCall("getBeGasUsgInfo", params);
    const gasItems = gasJson?.response?.body?.items ?? [];
    const items = Array.isArray(gasItems) ? gasItems : (gasItems.item ? [].concat(gasItems.item) : []);
    if (items.length > 0) {
      gas = Math.max(...items.map(i => parseFloat(i.useQty) || 0));
      if (gas === 0) gas = null;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(PHASE, `  가스 조회 실패: ${msg}`);
  }

  return { elec, gas };
}

// ── 조회 월 자동 탐지 ────────────────────────────────────────
const MONTH_DETECT_MAX_BACK = 8;

/**
 * 표본 단지들로 최근 달부터 거슬러 자료가 있는 가장 최근 달을 찾는다(순수 함수).
 * probe(useYm) 는 그 달의 "표본 중 하나라도 자료가 있는가"를 알려주는 콜백:
 *   - true  → 그 달 채택, 즉시 반환
 *   - false → 그 달은 전부 0건(자료 없음 확정), 한 달 더 거슬러감
 *   - null  → 오류(503 등)로 "모름". 그 달은 건너뛰고(탐지 실패로 세지 않음) 계속 거슬러감
 *
 * @param {(useYm: string) => Promise<boolean | null>} probe
 * @param {{ now?: Date, maxBackMonths?: number }} [opts]
 * @returns {Promise<{ useYm: string | null, monthsBack: number, calls: number }>}
 */
export async function pickLatestAvailableMonth(probe, opts = {}) {
  const { now = new Date(), maxBackMonths = MONTH_DETECT_MAX_BACK } = opts;
  let calls = 0;
  // "2개월 전"부터 시작 — 국토부 공개 지연이 통상 그 언저리라 헛탐지를 줄인다.
  for (let back = 2; back <= maxBackMonths; back++) {
    const target = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const useYm = `${target.getFullYear()}${String(target.getMonth() + 1).padStart(2, "0")}`;

    let result = await probe(useYm);
    calls++;
    if (result === null) {
      // 오류(503 등) — 1회 재시도
      result = await probe(useYm);
      calls++;
    }
    if (result === true) return { useYm, monthsBack: back, calls };
    // false(자료 없음 확정) 또는 재시도 후에도 null(모름) → 다음 달로 계속 거슬러감
  }
  return { useYm: null, monthsBack: -1, calls };
}

// ── 메인 ─────────────────────────────────────────────────────
export async function main() {
  if (!API_KEY) {
    logError(PHASE, "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const rpt = createReporter(PHASE);

  // 가드 #6: 컬럼 존재 확인
  try {
    await sb.from("apartments").select("bjd_code").limit(0);
  } catch {
    logError(PHASE, "bjd_code 컬럼이 없습니다. 마이그레이션 20260327000000을 먼저 실행하세요.");
    process.exit(1);
  }

  // 가드 #7: bjd_code 데이터 존재 확인
  const { count, error: cntErr } = await sb
    .from("apartments")
    .select("id", { count: "exact", head: true })
    .not("bjd_code", "is", null);
  if (cntErr || !count || count === 0) {
    // ⛔ `--force` 를 권하지 않는다 — 전 단지를 카카오 값으로 덮어써 손으로 박은
    //    address 출처 표기·district 결정이 지워진다(세션546 H1). 빈 칸만 채우는 쪽을 권한다.
    logError(PHASE, `bjd_code가 채워진 단지 0건. reverse-geocode.mjs --only-null-bjd를 먼저 실행하세요 (--force 금지: 전 단지 덮어쓰기).`);
    process.exit(1);
  }

  // 조회 월 자동 탐지: 이미 elec_usage_kwh 가 채워진 표본 단지 몇 곳으로
  // 최근 달부터 거슬러 "실제로 자료가 있는" 가장 최근 달을 찾는다.
  let apiCalls = 0;
  const { data: sampleApts, error: sampleErr } = await sb
    .from("apartments")
    .select("id, bjd_code, lot_main, lot_sub")
    .not("elec_usage_kwh", "is", null)
    .not("bjd_code", "is", null)
    .order("id", { ascending: true })
    .limit(3);
  if (sampleErr || !sampleApts || sampleApts.length === 0) {
    const errorMessage = `조회 월 탐지용 표본 단지를 찾지 못함 (${sampleErr?.message ?? "표본 0건"}) — 본 조회를 건너뜁니다.`;
    logError(PHASE, errorMessage);
    // 세션568 검사관 지적: 실패 경로도 collector_runs 에 남겨 감시 ⑤ 사각을 없앤다(housing-permits.mjs 하드닝 패턴).
    await recordCollectorRun(PHASE, { ok: 0, fail: 1, skip: 0, status: "failure", errorMessage });
    process.exit(1);
  }

  const detect = await pickLatestAvailableMonth(async (candidateYm) => {
    try {
      for (const s of sampleApts) {
        const params = { ...makeLotParams(s.bjd_code, s.lot_main, s.lot_sub), useYm: candidateYm, numOfRows: "10", pageNo: "1" };
        const elecJson = await hubApiCall("getBeElctyUsgInfo", params);
        const total = Number(elecJson?.response?.body?.totalCount ?? 0);
        if (total > 0) return true;
      }
      return false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(PHASE, `  [탐지] ${candidateYm} 조회 실패(모름): ${msg}`);
      return null;
    }
  });
  apiCalls += detect.calls;

  if (!detect.useYm) {
    const errorMessage = `조회 월 탐지 실패 — 최근 ${MONTH_DETECT_MAX_BACK}개월 모두 자료 없음/오류. 본 조회를 건너뜁니다 (탐지 호출 ${detect.calls}회).`;
    logError(PHASE, errorMessage);
    if (!dryRun) await recordApiQuota("collect-building-hub", "MOLIT_KEY", apiCalls);
    // 세션568 검사관 지적: 실패 경로도 collector_runs 에 남겨 감시 ⑤ 사각을 없앤다(housing-permits.mjs 하드닝 패턴).
    await recordCollectorRun(PHASE, { ok: 0, fail: 1, skip: 0, status: "failure", errorMessage });
    process.exit(1);
  }
  const useYm = detect.useYm;
  log(PHASE, `조회 월: ${useYm} (탐지: 2개월 전부터 ${detect.monthsBack}개월 거슬러 확인, 탐지 호출 ${detect.calls}회), bjd_code 보유: ${count}건`);

  // 대상 아파트 조회 (selectAll: 고유키(id) 커서 페이지네이션)
  const apts = await selectAll(
    (s) => s.from("apartments")
      .select("id, name, bjd_code, lot_main, lot_sub, elec_usage_kwh")
      .not("bjd_code", "is", null),
    sb,
    "id"
  );

  log(PHASE, `대상: ${apts.length}건`);

  // 첫 호출 시 응답 샘플 로깅 (안전장치 #5)
  let sampleLogged = false;

  for (let i = 0; i < apts.length; i++) {
    if (rpt.interrupted()) break;
    const apt = apts[i];
    /** @type {{ elec_usage_kwh?: number | null, gas_usage_mj?: number | null, energy_collected_at?: string | null, updated_at?: string }} */
    const row = {};

    try {
      // 1. 에너지 (전기 + 가스)
      if (force || apt.elec_usage_kwh == null) {
        const energy = await fetchEnergy(apt.bjd_code, apt.lot_main, apt.lot_sub, useYm);
        apiCalls += 2; // 전기 + 가스 각 1회
        if (energy.elec != null) row.elec_usage_kwh = energy.elec;
        if (energy.gas != null) row.gas_usage_mj = energy.gas;
        if (energy.elec != null || energy.gas != null) row.energy_collected_at = new Date().toISOString();

        if (!sampleLogged && (energy.elec != null || energy.gas != null)) {
          log(PHASE, `  [샘플] ${apt.name}: 전기=${energy.elec}kWh, 가스=${energy.gas}MJ`);
          sampleLogged = true;
        }
      }
      await sleep(REQUEST_DELAY);

      // DB 업데이트
      if (Object.keys(row).length === 0) { rpt.skip(1); continue; }
      row.updated_at = new Date().toISOString();

      if (dryRun) {
        log(PHASE, `  [DRY] ${apt.name}: ${JSON.stringify(row)}`);
        rpt.success(1);
      } else {
        const { error: updErr } = await sb.from("apartments").update(row).eq("id", apt.id);
        if (updErr) { logError(PHASE, `  ${apt.name} UPDATE 실패: ${updErr.message}`); rpt.fail(1); }
        else rpt.success(1);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `  ${apt.name}: ${msg}`);
      rpt.fail(1);
    }

    if ((i + 1) % 100 === 0) log(PHASE, `진행: ${i + 1}/${apts.length}`);
  }

  const result = rpt.summary();
  log(PHASE, `API 호출: ${apiCalls}회`);

  if (!dryRun) await recordApiQuota("collect-building-hub", "MOLIT_KEY", apiCalls);

  log(PHASE, "\n=== 완료 ===");
  await recordCollectorRun(PHASE, result);
  if (result.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  logError(PHASE, msg);
  process.exit(1);
});
