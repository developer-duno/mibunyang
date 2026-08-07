// @ts-check
/**
 * 청약홈 공식 분양 일정 + 평형 수집기
 *
 * API: 한국부동산원 청약홈 분양정보 조회 서비스 (data.go.kr 15098547)
 *   - getAPTLttotPblancDetail: APT 분양정보 상세 (일정 12종 ISO, 시행/시공/주소/공급)
 *   - getAPTLttotPblancMdl:    주택형(평형)별 면적/세대수/특공유형/최고가
 *
 * 기존 collect-applyhome.mjs(경쟁률, getRemndrLttotPblancCmpet)와 별개 서비스 — 에러 격리.
 * apartments base 컬럼은 안 건드림 → 미분양 stage·기존 날짜 보존.
 * 매칭된 단지만 presale_schedule_official(일정 + 규제 7종) + applyhome_unit_supply(평형) 적재.
 *
 * 사용법:
 *   node scripts/collectors/collect-applyhome-detail.mjs              (적재)
 *   node scripts/collectors/collect-applyhome-detail.mjs --dry-run    (매칭 미리보기만)
 *
 * 필요 환경변수: MOLIT_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import {
  loadEnv, getSupabase, log, logError, createReporter,
  selectAll, upsertBatch, stringSimilarity,
  recordApiQuota, recordCollectorRun, REGION_MAP,
} from "./_shared.mjs";

loadEnv();

const PHASE = "applyhome-detail";
const API_KEY = process.env.MOLIT_KEY;
const BASE = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1";
let apiCalls = 0;

// 매칭 안전 게이트 (plan: sim>=0.85 AND region 일치 — 동명이지역 오매칭 차단)
const MATCH_SIM_MIN = 0.85;

/**
 * @typedef {{ HOUSE_MANAGE_NO?: string; PBLANC_NO?: string; HOUSE_NM?: string; HSSPLY_ADRES?: string | null;
 *   RCRIT_PBLANC_DE?: string | null; SPSPLY_RCEPT_BGNDE?: string | null; SPSPLY_RCEPT_ENDDE?: string | null;
 *   GNRL_RNK1_CRSPAREA_RCPTDE?: string | null; GNRL_RNK1_CRSPAREA_ENDDE?: string | null;
 *   GNRL_RNK2_CRSPAREA_RCPTDE?: string | null; GNRL_RNK2_CRSPAREA_ENDDE?: string | null;
 *   PRZWNER_PRESNATN_DE?: string | null; CNTRCT_CNCLS_BGNDE?: string | null; CNTRCT_CNCLS_ENDDE?: string | null;
 *   MVN_PREARNGE_YM?: string | null; TOT_SUPLY_HSHLDCO?: string | number | null; PBLANC_URL?: string | null;
 *   BSNS_MBY_NM?: string | null; CNSTRCT_ENTRPS_NM?: string | null;
 *   MDAT_TRGET_AREA_SECD?: string | null; PARCPRC_ULS_AT?: string | null; SPECLT_RDN_EARTH_AT?: string | null;
 *   IMPRMN_BSNS_AT?: string | null; PUBLIC_HOUSE_EARTH_AT?: string | null; LRSCL_BLDLND_AT?: string | null;
 *   NPLN_PRVOPR_PUBLIC_HOUSE_AT?: string | null; [k: string]: unknown }} DetailRow
 * @typedef {{ HOUSE_MANAGE_NO?: string; PBLANC_NO?: string; MODEL_NO?: string; HOUSE_TY?: string;
 *   SUPLY_AR?: string | number; SUPLY_HSHLDCO?: string | number; SPSPLY_HSHLDCO?: string | number;
 *   MNYCH_HSHLDCO?: string | number; NWBB_HSHLDCO?: string | number; LFE_FRST_HSHLDCO?: string | number;
 *   OLD_PARNTS_SUPORT_HSHLDCO?: string | number; YGMN_HSHLDCO?: string | number; NWWDS_HSHLDCO?: string | number;
 *   INSTT_RECOMEND_HSHLDCO?: string | number; ETC_HSHLDCO?: string | number;
 *   LTTOT_TOP_AMOUNT?: string | number; [k: string]: unknown }} MdlRow
 * @typedef {{ id: string; name: string; region: string | null }} AptRow
 */

// ── odcloud 페이지네이션 (collect-applyhome.mjs:33-61 패턴) ──
/**
 * @param {string} op
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function fetchAllPages(op) {
  /** @type {Record<string, unknown>[]} */
  const all = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({ page: String(page), perPage: "1000", serviceKey: API_KEY || "" });
    const res = await fetch(`${BASE}/${op}?${params}`, { signal: AbortSignal.timeout(30000) });
    apiCalls++;
    if (!res.ok) throw new Error(`HTTP ${res.status} (${op})`);
    const json = /** @type {{ data?: Record<string, unknown>[]; totalCount?: number }} */ (await res.json());
    const data = json.data || [];
    all.push(...data);
    log(PHASE, `  ${op} page ${page}: ${data.length}건 (누적 ${all.length}/${json.totalCount})`);
    if (all.length >= (json.totalCount || 0) || data.length < 1000) break;
    page++;
  }
  return all;
}

// ── 이름 정규화 (괄호/공백 제거) ──
/** @param {string | null | undefined} s */
export function normName(s) {
  return (s || "").replace(/\([^)]*\)/g, "").replace(/\s+/g, "").trim();
}

// ── 주소 → region 약칭 (HSSPLY_ADRES 시도 첫 토큰) ──
// head(시도명 토큰)만으로 판정 + 정식명 우선(긴 키 먼저) 매칭.
// 세션 360 버그 정정: 이전엔 addr 전체에서 약칭 부분문자열을 잡아
// "경기도 광주시"가 광주광역시로 오파싱 → region 게이트에서 경기 단지 오차단.
/** @param {string | null | undefined} addr @returns {string | null} */
export function addrToRegion(addr) {
  if (!addr) return null;
  const head = addr.trim().split(/\s+/)[0] || "";
  // 정식명(예: "경기도")이 약칭(예: "경기")보다 먼저 매칭되도록 긴 키 우선 정렬
  const entries = Object.entries(REGION_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [full, short] of entries) {
    if (head === full || head.startsWith(full)) return short;
  }
  const stripped = head.replace(/(특별자치|특별|광역)?(시|도)$/, "");
  return stripped || null;
}

// ── 안전 게이트 매칭: sim>=0.85 AND region 일치 ──
/**
 * 청약홈 Detail row → apartments 매칭. 동명이지역 오매칭 차단.
 * @param {DetailRow} row
 * @param {AptRow[]} apts
 * @returns {{ apt: AptRow; sim: number } | null}
 */
export function matchDetailToApt(row, apts) {
  const rn = normName(row.HOUSE_NM);
  if (!rn) return null;
  const rRegion = addrToRegion(row.HSSPLY_ADRES);
  /** @type {AptRow | null} */
  let best = null;
  let bestSim = 0;
  for (const a of apts) {
    const sim = stringSimilarity(rn, normName(a.name));
    if (sim >= MATCH_SIM_MIN && sim > bestSim) { best = a; bestSim = sim; }
  }
  if (!best) return null;
  // region 게이트: 청약홈 주소 시도 ↔ apartments.region 접두 일치
  if (rRegion && best.region) {
    const ok = rRegion.startsWith(best.region) || best.region.startsWith(rRegion);
    if (!ok) return null;
  }
  return { apt: best, sim: bestSim };
}

// ── 날짜 정규화: ISO("2026-05-29") → DATE 문자열, 그 외 null ──
/** @param {unknown} v @returns {string | null} */
function toDate(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}
/** @param {unknown} v @returns {number | null} */
function toInt(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
/** @param {unknown} v @returns {number | null} */
function toReal(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
// 규제 지정 플래그: raw API 표본 1000행 실측 = "Y"/"N" 두 값뿐. 그 외(부재·이상값)는 null 보존.
/** @param {unknown} v @returns {boolean | null} */
function toYn(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "Y" ? true : t === "N" ? false : null;
}

// ── Detail row → presale_schedule_official 행 ──
/** @param {DetailRow} row @param {string} aptId */
export function buildScheduleRow(row, aptId) {
  return {
    apartment_id: aptId,
    house_manage_no: String(row.HOUSE_MANAGE_NO ?? ""),
    pblanc_no: row.PBLANC_NO ? String(row.PBLANC_NO) : null,
    recruit_date: toDate(row.RCRIT_PBLANC_DE),
    special_receipt_bgnde: toDate(row.SPSPLY_RCEPT_BGNDE),
    special_receipt_endde: toDate(row.SPSPLY_RCEPT_ENDDE),
    general_rank1_bgnde: toDate(row.GNRL_RNK1_CRSPAREA_RCPTDE),
    general_rank1_endde: toDate(row.GNRL_RNK1_CRSPAREA_ENDDE),
    general_rank2_bgnde: toDate(row.GNRL_RNK2_CRSPAREA_RCPTDE),
    general_rank2_endde: toDate(row.GNRL_RNK2_CRSPAREA_ENDDE),
    winner_announce_date: toDate(row.PRZWNER_PRESNATN_DE),
    contract_bgnde: toDate(row.CNTRCT_CNCLS_BGNDE),
    contract_endde: toDate(row.CNTRCT_CNCLS_ENDDE),
    move_in_ym: row.MVN_PREARNGE_YM ? String(row.MVN_PREARNGE_YM).trim() : null,
    tot_supply: toInt(row.TOT_SUPLY_HSHLDCO),
    pblanc_url: row.PBLANC_URL ? String(row.PBLANC_URL) : null,
    biz_entity: row.BSNS_MBY_NM ? String(row.BSNS_MBY_NM).trim() : null,
    constructor: row.CNSTRCT_ENTRPS_NM ? String(row.CNSTRCT_ENTRPS_NM).trim() : null,
    adjustment_target_area: toYn(row.MDAT_TRGET_AREA_SECD),
    price_cap_applied: toYn(row.PARCPRC_ULS_AT),
    speculation_overheated: toYn(row.SPECLT_RDN_EARTH_AT),
    redevelopment_biz: toYn(row.IMPRMN_BSNS_AT),
    public_housing_district: toYn(row.PUBLIC_HOUSE_EARTH_AT),
    large_scale_district: toYn(row.LRSCL_BLDLND_AT),
    metro_private_public_housing: toYn(row.NPLN_PRVOPR_PUBLIC_HOUSE_AT),
  };
}

// ── Mdl row → applyhome_unit_supply 행 ──
/** @param {MdlRow} row @param {string} aptId */
export function buildUnitRow(row, aptId) {
  /** @type {Record<string, number>} */
  const special = {};
  const types = {
    dazanyeo: row.MNYCH_HSHLDCO, sinhon: row.NWBB_HSHLDCO,
    saengae_choecho: row.LFE_FRST_HSHLDCO, nobumo: row.OLD_PARNTS_SUPORT_HSHLDCO,
    cheongnyeon: row.YGMN_HSHLDCO, sinsaenga: row.NWWDS_HSHLDCO,
    gigwan: row.INSTT_RECOMEND_HSHLDCO, etc: row.ETC_HSHLDCO,
  };
  for (const [k, v] of Object.entries(types)) {
    const n = toInt(v);
    if (n != null && n > 0) special[k] = n;
  }
  return {
    apartment_id: aptId,
    house_manage_no: String(row.HOUSE_MANAGE_NO ?? ""),
    model_no: String(row.MODEL_NO ?? ""),
    house_ty: row.HOUSE_TY ? String(row.HOUSE_TY) : null,
    supply_area: toReal(row.SUPLY_AR),
    general_supply: toInt(row.SUPLY_HSHLDCO),
    special_supply: toInt(row.SPSPLY_HSHLDCO),
    special_by_type: Object.keys(special).length ? special : null,
    top_amount: toInt(row.LTTOT_TOP_AMOUNT),
  };
}

// ── 메인 ──────────────────────────────────────────────────────
async function main() {
  if (!API_KEY) {
    logError(PHASE, "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const rpt = createReporter(PHASE);
  // process.exit() 를 try 안에서 부르면 대기 중인 finally(recordApiQuota)를 건너뛴다
  // (Node 실측, 세션 395 정정 패턴 — collect-market-stats.mjs 답습).
  // 그래서 exit 여부는 플래그로만 들고, 실제 exit 는 finally 안 recordApiQuota 직후에 한다.
  let shouldExit1 = false;

  try {
    // 1. 청약홈 Detail(일정) + Mdl(평형) 전수 수집
    log(PHASE, "청약홈 분양정보 상세 조회 시작...");
    const details = /** @type {DetailRow[]} */ (await fetchAllPages("getAPTLttotPblancDetail"));
    log(PHASE, `Detail 총 ${details.length}건`);
    const mdls = /** @type {MdlRow[]} */ (await fetchAllPages("getAPTLttotPblancMdl"));
    log(PHASE, `Mdl(평형) 총 ${mdls.length}건`);

    // 1.5. API 형식 변경 조기 감지 (collect-applyhome.mjs 패턴) — DB 쓰기 전
    const noDateRatio = details.length > 0
      ? details.filter(d => !toDate(d.RCRIT_PBLANC_DE)).length / details.length
      : 1;
    if (noDateRatio > 0.5) {
      logError(PHASE, `⚠️ RCRIT_PBLANC_DE 파싱 실패 ${(noDateRatio * 100).toFixed(1)}% — 청약홈 API 날짜 형식 변경 가능성.`);
      shouldExit1 = true;
      return;
    }

    // 2. 매칭 후보 로드 (전체 apartments)
    //    presale_stage NOT NULL 제약 제거 — 청약홈 공고가 있는데 분양 단계 미태깅된
    //    단지가 후보에서 빠지던 진앙 정정 (세션 360, +466 단지 회수). 적재는 별도
    //    테이블(presale_schedule_official/applyhome_unit_supply)에만 = apartments base 불변.
    const apts = /** @type {AptRow[]} */ (await selectAll(
      (s) => s.from("apartments").select("id, name, region"),
      sb,
    ));
    log(PHASE, `매칭 후보 단지: ${apts.length}건`);

    // 3. Detail 매칭 (sim>=0.85 AND region 일치) → house_manage_no별 apartment_id 맵
    /** @type {Map<string, string>} */
    const hmnToApt = new Map();
    /** @type {Record<string, unknown>[]} */
    const scheduleRows = [];
    let matched = 0;
    for (const d of details) {
      if (rpt.interrupted()) break;
      const m = matchDetailToApt(d, apts);
      if (!m) continue;
      const hmn = String(d.HOUSE_MANAGE_NO ?? "");
      if (!hmn) continue;
      matched++;
      hmnToApt.set(hmn, m.apt.id);
      scheduleRows.push(buildScheduleRow(d, m.apt.id));
      if (dryRun && matched <= 10) {
        log(PHASE, `  [DRY-RUN] ${d.HOUSE_NM} → ${m.apt.name} (sim=${m.sim.toFixed(2)}, recruit=${toDate(d.RCRIT_PBLANC_DE)})`);
      }
    }
    log(PHASE, `매칭(일정): ${matched}/${details.length}건`);

    // 4. Mdl 평형 — 매칭된 단지(hmn)만 적재
    /** @type {Record<string, unknown>[]} */
    const unitRows = [];
    for (const u of mdls) {
      if (rpt.interrupted()) break;
      const aptId = hmnToApt.get(String(u.HOUSE_MANAGE_NO ?? ""));
      if (!aptId) continue;
      unitRows.push(buildUnitRow(u, aptId));
    }
    log(PHASE, `평형 행(매칭 단지): ${unitRows.length}건`);

    if (dryRun) {
      log(PHASE, `\n=== DRY-RUN 요약: 일정 ${scheduleRows.length}건 / 평형 ${unitRows.length}건 (DB 쓰기 0) ===`);
      rpt.success(matched);
      const result = rpt.summary();
      await recordCollectorRun(PHASE, result);
      return;
    }

    // 5. 적재 (apartments base 컬럼은 안 건드림)
    if (scheduleRows.length) {
      const ins = await upsertBatch("presale_schedule_official", scheduleRows, "apartment_id,house_manage_no", 500, sb);
      rpt.success(ins);
      if (scheduleRows.length - ins > 0) rpt.fail(scheduleRows.length - ins);
    }
    if (unitRows.length) {
      await upsertBatch("applyhome_unit_supply", unitRows, "apartment_id,house_manage_no,model_no", 500, sb);
    }

    const result = rpt.summary();
    log(PHASE, "\n=== 완료 ===");
    await recordCollectorRun(PHASE, result);
    if (result.fail > 0) shouldExit1 = true;
  } finally {
    if (!dryRun && apiCalls > 0) {
      await recordApiQuota(PHASE, "MOLIT_KEY", apiCalls);
    }
    // exit 은 recordApiQuota 를 await 한 바로 뒤 = 쿼터 기록 보장(scripts/CLAUDE.md Exit Code 정책).
    // ⚠️ try/finally *뒤* 로 빼면 안 된다 — 조기 중단 경로가 try 안에서 return 하므로 그 줄에는
    //    도달하지 못해 exit 0(성공)으로 끝난다(Node 실측).
    if (shouldExit1) process.exit(1);
  }
}

// isCLI v2 (typescript-patterns.md §5.2) — test import 시 main() 방지
const isCLI = !!process.argv[1] && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "",
);
if (isCLI) {
  main().catch(err => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
