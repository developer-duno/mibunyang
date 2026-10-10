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
 * prices 는 빈칸만 채운다(세션622): 가격 행이 하나도 없는 비임대 단지에 84㎡ 에 가장 가까운 평형의
 *   최고가를 house_type "applyhome_rep" 로 1행(평당가 = 전용면적 기준). 평형 재료 = DB applyhome_unit_supply
 *   누적 행 + 이번 회차 행. 이미 가격 행이 있는 단지는 건드리지 않는다.
 *
 * 사용법:
 *   node scripts/collectors/collect-applyhome-detail.mjs              (적재)
 *   node scripts/collectors/collect-applyhome-detail.mjs --dry-run    (매칭 미리보기만)
 *   node scripts/collectors/collect-applyhome-detail.mjs --dry-run --impact-out=<절대경로>
 *     (prices 빈칸 채움 계획을 JSON 으로 저장 — dry-run 에서만 허용)
 *
 * 필요 환경변수: MOLIT_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import {
  loadEnv, getSupabase, log, logError, createReporter,
  selectAll, upsertBatch, stringSimilarity,
  recordApiQuota, recordCollectorRun, REGION_MAP, resolveRegionName, today,
} from "./_shared.mjs";
import { writeFileSync } from "node:fs";
import { isLeaseUnit } from "../../src/constants/leaseTypes.mjs";

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
 * @typedef {{ id: string; name: string; region: string | null; presale_type?: string | null }} AptRow
 * @typedef {ReturnType<typeof buildUnitRow> & { source?: string | null }} UnitRow
 *   source = DB 칸(기본 'apt' 원 공고 · 'remndr' 잔여세대, collect-applyhome-remndr.mjs). 이번 회차 행엔 없다.
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
  const parts = addr.trim().split(/\s+/);
  const head = parts[0] || "";
  // 세션545: 통합 시도("전남광주통합특별시")는 시도명만으로 못 가른다 — 시군구(parts[1])로
  // 광주/전남을 가르는 분할 헬퍼를 **가장 먼저** 태운다.
  //
  // ⚠️ 아래 긴 키 우선 순회에 맡기면 안 된다: 통합 이름은 `REGION_MAP` 에 없고
  //    `head.startsWith("전남")` 이 참이라 **27 시군구가 전부 "전남"으로** 떨어진다.
  //    그러면 청약홈이 새 시도명을 쓰기 시작하는 순간 광주 단지가 전부
  //    `matchDetailToApt` 의 region 게이트에서 오차단된다(일정·평형이 통째로 안 붙는다).
  const split = resolveRegionName(head, parts[1] ?? null);
  if (split) return split;
  // ⚠️ 헬퍼가 **못 가른 통합 시도**는 아래 순회에 넘기지 않는다(세션545 2차 리뷰):
  //    `head.startsWith("전남")` 이 참이라 "전남" 이 나오는데, 그건 판정이 아니라 글자 우연이다.
  //    둘째 토큰이 시군구가 아닌 주소(지구·블록)에서 광주 단지가 "전남" 으로 굳으면
  //    `matchDetailToApt` 의 region 게이트가 그 단지를 통째로 거부한다.
  //    null 을 주면 게이트를 건너뛰고 이름 유사도(≥0.85)만으로 판정한다 — 모른다고 말하는 쪽이 맞다.
  if (/^전남광주통합/.test(head)) return null;
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
// 규제 지정 플래그: raw API 전량 2,837건 실측 = "Y"/"N" 두 값뿐. 그 외(부재·이상값)는 null 보존.
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

// ── prices 빈칸 채움 (세션622) ─────────────────────────────────
// house_type 은 `presale_` 로 시작하면 안 된다 — VIEW latest_prices·trade-stats buildLatestPriceMap 이
// `presale_%` 를 뒤로 미루므로, 공식가(이 행)가 네이버 presale_min 보다 앞서려면 rank 0 이어야 한다.
const PRICE_HOUSE_TYPE = "applyhome_rep";
const REP_AREA_TARGET = 84; // 대표 평형 = 전용면적이 84㎡ 에 가장 가까운 평형
const PYEONG_M2 = 3.3058;
const PRICE_LOOKUP_CHUNK = 200;
// applyhome_unit_supply.source 실측 철자(세션622, 16,278행): "apt" 11,864 · "remndr" 4,414. 칸 기본값 'apt'
// (마이그 20260807000000) — buildUnitRow 는 source 를 안 넣으므로 이 수집기가 새로 넣는 행은 apt 가 된다.
const UNIT_SOURCE_ORIGINAL = "apt";

/**
 * house_ty("084.8443 ", "059.9649B", "101.2A") 앞 숫자 = 전용면적(㎡). 못 읽으면 null.
 * @param {unknown} houseTy
 * @returns {number | null}
 */
export function parseHouseTyArea(houseTy) {
  if (typeof houseTy !== "string") return null;
  const m = houseTy.match(/^\s*(\d{2,3}\.\d+)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 대표 평형 — top_amount>0 이고 전용면적을 읽을 수 있는 행 중 84㎡ 에 가장 가까운 것.
 * 거리가 같으면 top_amount 가 낮은 쪽. 중위값·평균은 쓰지 않는다. 고를 행이 없으면 null.
 * 원 공고(source 'apt', 없으면 apt 로 간주) 후보가 하나라도 있으면 그것만 본다 — 잔여세대(remndr)
 * 공고가는 할인·재공급 값이라 원 분양가와 다르다(세션622 실측: 레이카운티 66200 vs 원 71100). 없을 때만 remndr.
 * @param {readonly UnitRow[] | null | undefined} units
 * @returns {{ unit: UnitRow; area: number } | null}
 */
export function pickRepresentativeUnit(units) {
  /** @type {{ unit: UnitRow; area: number }[]} */
  const candidates = [];
  for (const u of units ?? []) {
    if (!u || u.top_amount == null || !(u.top_amount > 0)) continue;
    const area = parseHouseTyArea(u.house_ty);
    if (area == null) continue;
    candidates.push({ unit: u, area });
  }
  const original = candidates.filter((c) => (c.unit.source ?? UNIT_SOURCE_ORIGINAL) === UNIT_SOURCE_ORIGINAL);
  /** @type {{ unit: UnitRow; area: number } | null} */
  let best = null;
  let bestDist = Infinity;
  for (const { unit: u, area } of original.length ? original : candidates) {
    const top = /** @type {number} */ (u.top_amount);
    const dist = Math.abs(area - REP_AREA_TARGET);
    if (!best || dist < bestDist || (dist === bestDist && top < (best.unit.top_amount ?? Infinity))) {
      best = { unit: u, area };
      bestDist = dist;
    }
  }
  return best;
}

/**
 * 대표 평형 → prices 행(price·top_amount 단위 = 만원). 고를 평형이 없으면 null.
 * @param {string} aptId
 * @param {readonly UnitRow[] | null | undefined} units
 * @param {string} today KST YYYY-MM-DD
 */
export function buildApplyhomePriceRow(aptId, units, today) {
  const rep = pickRepresentativeUnit(units);
  if (!rep) return null;
  const { unit, area } = rep;
  const price = /** @type {number} */ (unit.top_amount);
  const supplyCount = unit.general_supply == null && unit.special_supply == null
    ? null
    : (unit.general_supply ?? 0) + (unit.special_supply ?? 0);
  return {
    apartment_id: aptId,
    area,
    supply_area: unit.supply_area,
    price,
    // 평당가는 **전용면적** 기준 — 같은 rank 0 인 seed 행(운영 DB 1,000표본 100% 전용 기준)과 맞춰야
    // 평당가 편차 막대(src/constants/deviationFields.ts field "pp")가 공정하다. presale_min 은 공급 기준이라 다르다.
    pp: Math.round(price / (area / PYEONG_M2)),
    house_type: PRICE_HOUSE_TYPE,
    supply_count: supplyCount,
    recorded_at: today,
  };
}

/**
 * 빈칸 채움 계획 — 순수 함수(네트워크·DB 0). 단지마다 임대 → 이미 가격 있음 → 평형 없음 순으로 건너뛴다.
 * @param {Map<string, UnitRow[]>} unitsByApt
 * @param {Map<string, AptRow>} aptById
 * @param {Set<string>} hasPriceIds prices 에 price>0 행이 하나라도 있는 단지(house_type 무관)
 * @param {string} today
 */
export function planApplyhomePrices(unitsByApt, aptById, hasPriceIds, today) {
  /** @type {NonNullable<ReturnType<typeof buildApplyhomePriceRow>>[]} */
  const rows = [];
  const counts = { planned: 0, skippedLease: 0, skippedHasPrice: 0, skippedNoUnit: 0, skippedNoApt: 0 };
  /** @type {Record<string, number>} */
  const byPresaleType = {};
  for (const [aptId, units] of unitsByApt) {
    const apt = aptById.get(aptId);
    if (!apt) { counts.skippedNoApt++; continue; } // apartments 에 없는 id — 쓰면 FK 오류
    if (isLeaseUnit(apt)) { counts.skippedLease++; continue; }
    if (hasPriceIds.has(aptId)) { counts.skippedHasPrice++; continue; }
    const row = buildApplyhomePriceRow(aptId, units, today);
    if (!row) { counts.skippedNoUnit++; continue; }
    rows.push(row);
    counts.planned++;
    const k = apt?.presale_type ?? "(null)";
    byPresaleType[k] = (byPresaleType[k] ?? 0) + 1;
  }
  return { rows, counts, byPresaleType };
}

/**
 * `--impact-out=<경로>` 읽기. dry-run 이 아니면 던진다(미리보기 전용).
 * @param {readonly string[]} argv
 * @returns {string | null}
 */
export function parseImpactOutArg(argv) {
  // `--impact-out <경로>`(= 없이 띄어 씀)·값 없는 `--impact-out` 을 조용히 무시하면 미리보기 파일이 안 생긴다
  if (argv.includes("--impact-out")) throw new Error("--impact-out=<경로> 꼴로 써야 한다(= 필수)");
  const arg = argv.find((a) => a.startsWith("--impact-out="));
  if (!arg) return null;
  if (!argv.includes("--dry-run")) throw new Error("--impact-out 은 --dry-run 에서만 쓸 수 있다");
  const p = arg.slice("--impact-out=".length);
  if (!p) throw new Error("--impact-out 경로가 비었다");
  return p;
}

/**
 * prices 에 price>0 행이 있는 단지 id — 매칭된 단지만 200개씩 `.in()` 으로(전체 표 훑기 금지).
 * 한 단지에 행이 많아 1,000행을 넘을 수 있으니 id 커서로 끝까지 읽는다.
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string[]} aptIds
 * @param {typeof selectAll} selectAll main 이 넘긴 selectAll(시험에선 가짜) — 이름을 selectAll 로 둬야 정적 가드(_selectall-keycol-coverage)가 keyCol 을 본다
 * @returns {Promise<Set<string>>}
 */
async function loadAptIdsWithPrice(sb, aptIds, selectAll) {
  /** @type {Set<string>} */
  const has = new Set();
  for (let i = 0; i < aptIds.length; i += PRICE_LOOKUP_CHUNK) {
    const chunk = aptIds.slice(i, i + PRICE_LOOKUP_CHUNK);
    const rows = /** @type {{ apartment_id: string }[]} */ (await selectAll(
      (s) => s.from("prices").select("id, apartment_id").in("apartment_id", chunk).gt("price", 0),
      sb,
      "id",
    ));
    for (const r of rows) has.add(r.apartment_id);
  }
  return has;
}

/**
 * 평형 재료 합치기 — DB 누적 행 + 이번 회차 행을 (apartment_id, house_manage_no, model_no) 로 합치고
 * 같은 키면 이번 회차가 이긴다. 결과는 단지별 묶음. 순수 함수.
 * (지금 API 에 더는 안 나오는 옛 공고의 평형도 DB 에 남아 있어 대상이 된다 — 세션622 미리보기 66 vs 246)
 * @param {readonly UnitRow[]} dbRows
 * @param {readonly UnitRow[]} roundRows
 * @returns {Map<string, UnitRow[]>}
 */
export function mergeUnitRows(dbRows, roundRows) {
  /** @type {Map<string, UnitRow>} */
  const byKey = new Map();
  for (const u of [...dbRows, ...roundRows]) {
    const key = `${u.apartment_id}|${u.house_manage_no}|${u.model_no}`;
    const prev = byKey.get(key);
    // 이번 회차 행엔 source 가 없다 — upsert 가 source 를 안 건드려 DB 값이 남으므로 그 값을 물려받는다.
    byKey.set(key, u.source == null && prev?.source != null ? { ...u, source: prev.source } : u);
  }
  /** @type {Map<string, UnitRow[]>} */
  const byApt = new Map();
  for (const u of byKey.values()) {
    const list = byApt.get(u.apartment_id);
    if (list) list.push(u);
    else byApt.set(u.apartment_id, [u]);
  }
  return byApt;
}

/**
 * prices 빈칸 채움 계획 — 평형 재료는 DB applyhome_unit_supply 전체(top_amount>0) + 이번 회차 행.
 * 실제 실행에서는 평형 upsert **뒤**에 부른다(그때 DB 가 이번 회차를 이미 담고 있다).
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {AptRow[]} apts
 * @param {UnitRow[]} roundRows
 * @param {typeof selectAll} selectAll main 이 넘긴 selectAll(이름 유지 이유 = 위 loadAptIdsWithPrice)
 * @param {typeof today} todayFn main 이 넘긴 KST 날짜 함수(recorded_at)
 */
async function buildPricePlan(sb, apts, roundRows, selectAll, todayFn) {
  const dbRows = /** @type {UnitRow[]} */ (await selectAll(
    (s) => s.from("applyhome_unit_supply")
      .select("id, apartment_id, house_manage_no, model_no, house_ty, supply_area, general_supply, special_supply, top_amount, source")
      .gt("top_amount", 0),
    sb,
    "id",
  ));
  const unitsByApt = mergeUnitRows(dbRows, roundRows);
  const aptById = new Map(apts.map((a) => [a.id, a]));
  const hasPriceIds = await loadAptIdsWithPrice(sb, [...unitsByApt.keys()], selectAll);
  const plan = planApplyhomePrices(unitsByApt, aptById, hasPriceIds, todayFn());
  const c = plan.counts;
  log(PHASE, `[prices] 평형 재료 DB ${dbRows.length}행 + 이번 회차 ${roundRows.length}행 → 단지 ${unitsByApt.size}곳`);
  log(PHASE, `[prices] 빈칸 채움 ${c.planned}건(임대 제외 ${c.skippedLease} · 이미 값 있음 ${c.skippedHasPrice} · 평형 없음 ${c.skippedNoUnit}${c.skippedNoApt ? ` · 단지 없음 ${c.skippedNoApt}` : ""})`);
  return plan;
}

// ── 메인 ──────────────────────────────────────────────────────
/**
 * @typedef {{ apiKey: string | undefined; argv: readonly string[]; getSupabase: typeof getSupabase;
 *   createReporter: typeof createReporter; fetchAllPages: typeof fetchAllPages; selectAll: typeof selectAll;
 *   upsertBatch: typeof upsertBatch; recordCollectorRun: typeof recordCollectorRun;
 *   recordApiQuota: typeof recordApiQuota; today: typeof today }} MainDeps
 */
/**
 * 매칭 후보 = apartments 전체(id 커서). main 이 넘긴 selectAll 을 받는다 — 인자 이름을 selectAll 로 둬야
 * 정적 가드(_selectall-keycol-coverage)가 이 호출의 keyCol 을 본다(점 붙은 호출은 가드가 다른 심볼로 건너뛴다, 세션623 CI).
 * @param {any} sb
 * @param {typeof selectAll} selectAll
 * @returns {Promise<AptRow[]>}
 */
async function loadMatchCandidates(sb, selectAll) {
  return /** @type {AptRow[]} */ (await selectAll(
    (s) => s.from("apartments").select("id, name, region, presale_type"),
    sb,
    "id", // 무정렬 OFFSET 이면 상세 매칭 후보가 조용히 빠진다 (세션543 W2)
  ));
}

/**
 * CLI 는 인자 없이 불러 진짜 함수로 돈다. 시험은 가짜 deps 로 main 흐름(순서·중단·날짜)을 본다(세션623).
 * @param {Partial<MainDeps>} [overrides]
 */
export async function main(overrides = {}) {
  /** @type {MainDeps} */
  const deps = {
    apiKey: API_KEY, argv: process.argv, getSupabase, createReporter, fetchAllPages,
    selectAll, upsertBatch, recordCollectorRun, recordApiQuota, today, ...overrides,
  };
  if (!deps.apiKey) {
    logError(PHASE, "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)");
    process.exit(1);
  }
  const dryRun = deps.argv.includes("--dry-run");
  const impactOutPath = parseImpactOutArg(deps.argv); // dry-run 없이 오면 throw — API 호출 전
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = deps.getSupabase();
  const rpt = deps.createReporter(PHASE);
  // process.exit() 를 try 안에서 부르면 대기 중인 finally(recordApiQuota)를 건너뛴다
  // (Node 실측, 세션 395 정정 패턴 — collect-market-stats.mjs 답습).
  // 그래서 exit 여부는 플래그로만 들고, 실제 exit 는 finally 안 recordApiQuota 직후에 한다.
  let shouldExit1 = false;

  try {
    // 1. 청약홈 Detail(일정) + Mdl(평형) 전수 수집
    log(PHASE, "청약홈 분양정보 상세 조회 시작...");
    const details = /** @type {DetailRow[]} */ (await deps.fetchAllPages("getAPTLttotPblancDetail"));
    log(PHASE, `Detail 총 ${details.length}건`);
    const mdls = /** @type {MdlRow[]} */ (await deps.fetchAllPages("getAPTLttotPblancMdl"));
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
    const apts = await loadMatchCandidates(sb, deps.selectAll);
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
    /** @type {UnitRow[]} */
    const unitRows = [];
    for (const u of mdls) {
      if (rpt.interrupted()) break;
      const aptId = hmnToApt.get(String(u.HOUSE_MANAGE_NO ?? ""));
      if (!aptId) continue;
      unitRows.push(buildUnitRow(u, aptId));
    }
    log(PHASE, `평형 행(매칭 단지): ${unitRows.length}건`);

    // 4.5. prices 빈칸 채움 계획 — 중단(SIGTERM)으로 평형이 덜 모였으면 대표 평형이 틀릴 수 있어 건너뜀.
    //      조회 실패도 건너뜀(모르는 채로 쓰면 이미 값 있는 단지에 끼어든다) — 비치명.
    //      실제 실행은 평형 upsert 뒤에 부른다(아래 5).
    /** @returns {Promise<ReturnType<typeof planApplyhomePrices> | null>} */
    const planPrices = async () => {
      if (rpt.interrupted()) return null;
      try {
        return await buildPricePlan(sb, apts, unitRows, deps.selectAll, deps.today);
      } catch (e) {
        logError(PHASE, `prices 빈칸 채움 계획 실패 (비치명적, 이번 회차 건너뜀): ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    };

    if (dryRun) {
      const pricePlan = await planPrices();
      if (impactOutPath && pricePlan) {
        const plan = pricePlan;
        const aptById = new Map(apts.map((a) => [a.id, a]));
        const rows = plan.rows.map((r) => {
          const a = aptById.get(r.apartment_id);
          return { ...r, name: a?.name ?? null, presale_type: a?.presale_type ?? null };
        });
        writeFileSync(impactOutPath, JSON.stringify({ takenAt: new Date().toISOString(), counts: plan.counts, byPresaleType: plan.byPresaleType, rows }, null, 2), "utf8");
        log(PHASE, `[IMPACT] prices 빈칸 채움 계획 저장: ${impactOutPath}`);
      } else if (impactOutPath) {
        logError(PHASE, "prices 계획이 없어 --impact-out 저장 안 함");
      }
      log(PHASE, `\n=== DRY-RUN 요약: 일정 ${scheduleRows.length}건 / 평형 ${unitRows.length}건 (DB 쓰기 0) ===`);
      rpt.success(matched);
      const result = rpt.summary();
      await deps.recordCollectorRun(PHASE, result);
      return;
    }

    // 5. 적재 (apartments base 컬럼은 안 건드림)
    if (scheduleRows.length) {
      const ins = await deps.upsertBatch("presale_schedule_official", scheduleRows, "apartment_id,house_manage_no", 500, sb);
      rpt.success(ins);
      if (scheduleRows.length - ins > 0) rpt.fail(scheduleRows.length - ins);
    }
    // 평형 저장이 일부라도 실패하면 이번 회차 prices 를 쓰지 않는다 — 계획 재료는 메모리 행이라 값이
    // 틀리지는 않지만 '부분 반영 금지'(세션622 결정) 때문. upsertBatch 는 429 아닌 오류에도 던지지 않고
    // 성공 행 수만 돌려주므로 그 수로 판정한다(비치명 · rpt 수치·exit 코드는 그대로, 세션623).
    let unitsComplete = true;
    if (unitRows.length) {
      const unitIns = await deps.upsertBatch("applyhome_unit_supply", unitRows, "apartment_id,house_manage_no,model_no", 500, sb);
      if (unitIns < unitRows.length) {
        unitsComplete = false;
        logError(PHASE, `평형 upsert 일부 실패 ${unitIns}/${unitRows.length} — prices 빈칸 채움 이번 회차 건너뜀 (비치명적)`);
      }
    }
    // prices 는 평형 적재 뒤 · 실패는 비치명(naver-presale 과 같은 꼴) — rpt 수치(일정 행 수)의 뜻은 그대로
    const pricePlan = unitsComplete ? await planPrices() : null;
    if (pricePlan?.rows.length) {
      try {
        await deps.upsertBatch("prices", pricePlan.rows, "apartment_id,house_type,recorded_at", 500, sb);
      } catch (e) {
        logError(PHASE, `prices upsert 실패 (비치명적): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const result = rpt.summary();
    log(PHASE, "\n=== 완료 ===");
    await deps.recordCollectorRun(PHASE, result);
    if (result.fail > 0) shouldExit1 = true;
  } finally {
    if (!dryRun && apiCalls > 0) {
      await deps.recordApiQuota(PHASE, "MOLIT_KEY", apiCalls);
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
