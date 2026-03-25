/**
 * 건축HUB 통합 수집기 — 건물에너지 + 주택인허가 데이터
 *
 * API: data.go.kr 국토교통부_건축HUB (1613000/BldEngyHubService)
 *   1. getBeElctyUsgInfo  — 전기사용량 (kWh)
 *   2. getBeGasUsgInfo    — 가스사용량 (MJ)
 *   3. getHpMgmCoopTpOulnInfo — 관리공동형별개요 (난방연료코드명 → heatFuel gap-fill)
 *   4. getHpBasisOulnInfo — 기본개요 (내진설계적용여부 → quakeDesign 실데이터)
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
 * 필요 환경변수:
 *   MOLIT_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 *
 * 전제조건:
 *   reverse-geocode.mjs --force 실행 후 bjd_code가 채워져 있어야 함
 */
import { loadEnv, getSupabase, log, logError, sleep, createReporter } from "./_shared.mjs";
import { REQUEST_DELAY } from "./_molit-api.mjs";

loadEnv();

const PHASE = "building-hub";
const API_KEY = process.env.MOLIT_KEY;
if (!API_KEY) {
  logError(PHASE, "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)");
  process.exit(1);
}

const API_BASE = "https://apis.data.go.kr/1613000/BldEngyHubService";

// data.go.kr는 빈 결과 시 type=json이어도 XML 반환 → 별도 처리 필요
async function hubApiCall(endpoint, params) {
  const qs = new URLSearchParams({ serviceKey: API_KEY, type: "json", ...params });
  const url = `${API_BASE}/${endpoint}?${qs}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  // XML 빈 결과 감지: resultCode=00 + totalCount=0 → 정상 빈 응답
  if (text.startsWith("<?xml") || text.startsWith("<")) {
    if (text.includes("SERVICE_KEY_IS_NOT_REGISTERED")) {
      throw new Error("API 키 미등록 — data.go.kr에서 서비스 신청 필요");
    }
    if (text.includes("<totalCount>0</totalCount>")) {
      return { response: { body: { items: [], totalCount: 0 } } };
    }
    throw new Error(`XML 응답: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

// ── 지번 파라미터 구성 ──────────────────────────────────────
function makeLotParams(bjdCode, lotMain, lotSub) {
  return {
    sigunguCd: bjdCode.slice(0, 5),
    bjdongCd: bjdCode.slice(5, 10),
    bun: String(lotMain ?? 0).padStart(4, "0"),
    ji: String(lotSub ?? 0).padStart(4, "0"),
  };
}

// ── 에너지 수집 (전기 + 가스) ────────────────────────────────
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
    log(PHASE, `  전기 조회 실패: ${err.message}`);
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
    log(PHASE, `  가스 조회 실패: ${err.message}`);
  }

  return { elec, gas };
}

// ── 관리공동형별개요 (heatFuel gap-fill) ─────────────────────
async function fetchHeatFuel(bjdCode, lotMain, lotSub) {
  const params = { ...makeLotParams(bjdCode, lotMain, lotSub), numOfRows: "10", pageNo: "1" };
  try {
    const json = await hubApiCall("getHpMgmCoopTpOulnInfo", params);
    const items = json?.response?.body?.items ?? [];
    const arr = Array.isArray(items) ? items : (items.item ? [].concat(items.item) : []);
    if (arr.length === 0) return null;
    // MODE 집계: 가장 많이 나오는 난방연료코드명
    const counts = {};
    for (const item of arr) {
      const fuel = item.heatMethCdNm || item.fuelCdNm || null; // 난방연료코드명
      if (fuel) counts[fuel] = (counts[fuel] || 0) + 1;
    }
    const entries = Object.entries(counts);
    return entries.length > 0 ? entries.sort((a, b) => b[1] - a[1])[0][0] : null;
  } catch (err) {
    log(PHASE, `  관리개요 조회 실패: ${err.message}`);
    return null;
  }
}

// ── 기본개요 (quakeDesign 실데이터) ──────────────────────────
async function fetchQuakeDesign(bjdCode, lotMain, lotSub) {
  const params = { ...makeLotParams(bjdCode, lotMain, lotSub), numOfRows: "10", pageNo: "1" };
  try {
    const json = await hubApiCall("getHpBasisOulnInfo", params);
    const items = json?.response?.body?.items ?? [];
    const arr = Array.isArray(items) ? items : (items.item ? [].concat(items.item) : []);
    if (arr.length === 0) return null;
    // AND 집계: 모든 건물이 내진설계 적용이어야 true
    for (const item of arr) {
      const val = item.eqkDsgnApplyYn ?? item.quakeDesignApplyYn ?? null;
      // data.go.kr 문자열 → boolean 변환
      if (val === "0" || val === "N" || val === false || val === "미적용") return false;
      if (val == null) return null; // 데이터 없으면 판단 보류
    }
    return true; // 모든 건물이 "1"/"Y"/true/"적용"
  } catch (err) {
    log(PHASE, `  기본개요 조회 실패: ${err.message}`);
    return null;
  }
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
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
    logError(PHASE, `bjd_code가 채워진 단지 0건. reverse-geocode.mjs --force를 먼저 실행하세요.`);
    process.exit(1);
  }

  // 조회 월 (2개월 전)
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const useYm = `${target.getFullYear()}${String(target.getMonth() + 1).padStart(2, "0")}`;
  log(PHASE, `조회 월: ${useYm}, bjd_code 보유: ${count}건`);

  // 대상 아파트 조회
  const { data: apts, error } = await sb
    .from("apartments")
    .select("id, name, bjd_code, lot_main, lot_sub, heat_fuel, quake_design, elec_usage_kwh")
    .not("bjd_code", "is", null);
  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);

  log(PHASE, `대상: ${apts.length}건`);

  // 첫 호출 시 응답 샘플 로깅 (안전장치 #5)
  let sampleLogged = false;

  for (let i = 0; i < apts.length; i++) {
    const apt = apts[i];
    const row = {};

    try {
      // 1. 에너지 (전기 + 가스)
      if (force || apt.elec_usage_kwh == null) {
        const energy = await fetchEnergy(apt.bjd_code, apt.lot_main, apt.lot_sub, useYm);
        if (energy.elec != null) row.elec_usage_kwh = energy.elec;
        if (energy.gas != null) row.gas_usage_mj = energy.gas;
        if (energy.elec != null || energy.gas != null) row.energy_collected_at = new Date().toISOString();

        if (!sampleLogged && (energy.elec != null || energy.gas != null)) {
          log(PHASE, `  [샘플] ${apt.name}: 전기=${energy.elec}kWh, 가스=${energy.gas}MJ`);
          sampleLogged = true;
        }
      }
      await sleep(REQUEST_DELAY);

      // 2. 난방연료 gap-fill — 비활성화 (getHpMgmCoopTpOulnInfo는 BldEngyHubService에 없음, 별도 구독 필요)
      // TODO: HpPermitService 또는 별도 건축허가 API 구독 후 활성화
      // if (force || apt.heat_fuel == null) {
      //   const heatFuel = await fetchHeatFuel(apt.bjd_code, apt.lot_main, apt.lot_sub);
      //   if (heatFuel != null && (apt.heat_fuel == null || force)) {
      //     row.heat_fuel = heatFuel;
      //   }
      // }

      // 3. 내진설계 실데이터 — 비활성화 (getHpBasisOulnInfo는 BldEngyHubService에 없음, 별도 구독 필요)
      // TODO: HpPermitService 또는 별도 건축허가 API 구독 후 활성화
      // if (force || apt.quake_design == null) {
      //   const quake = await fetchQuakeDesign(apt.bjd_code, apt.lot_main, apt.lot_sub);
      //   if (quake != null && (apt.quake_design == null || force)) {
      //     row.quake_design = quake;
      //   }
      // }

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
      logError(PHASE, `  ${apt.name}: ${err.message}`);
      rpt.fail(1);
    }

    if ((i + 1) % 100 === 0) log(PHASE, `진행: ${i + 1}/${apts.length}`);
  }

  rpt.summary();
  log(PHASE, "\n=== 완료 ===");
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
