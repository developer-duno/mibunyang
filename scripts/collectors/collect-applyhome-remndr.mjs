// @ts-check
/**
 * 청약홈 단계1 수집기 — 잔여세대 평형(#8) + 취소후재공급 경쟁률(#7)
 *
 * 설계: docs/superpowers/specs/2026-08-07-applyhome-competition-8ch-design.md §5-A
 *
 * API (2026-08-07 실호출 확인):
 *   - getRemndrLttotPblancMdl        (DetailSvc) 4,626행 → applyhome_unit_supply (source='remndr')
 *   - getCancResplLttotPblancCmpet   (CmpetRtSvc)  436행 → applyhome_cancel_respl
 *
 * 매칭: 두 채널 모두 `ah-{HOUSE_MANAGE_NO}` 직접 매칭 (이름 유사도 불필요).
 *   실측 매칭률 = 잔여세대 1,547/1,652(93.6%) · 취소후재공급 228/236(96.6%).
 *   → apartments 로스터를 건드리지 않는다 (INSERT 0, 기존 단지에 부속 데이터만 적재).
 *
 * 기존 collect-applyhome*.mjs 3종과 별개 파일인 이유 = 에러 격리
 *   (collect-applyhome-detail.mjs 헤더 주석 답습 — 한 채널 장애가 나머지를 죽이지 않게).
 *
 * ⚠️ 값 형태 함정 (설계 §3 — 기존 toDate/toInt 를 그대로 쓰면 조용히 틀린다):
 *   - CMPET_RATE 는 숫자가 아니다: "2,182.00"(콤마) / "-"(미접수) / "(△13)"(13세대 미달) / null
 *   - LTTOT_TOP_AMOUNT 는 채널마다 콤마 유무가 다르다 (잔여세대는 없고 임의공급은 있다)
 *   - HOUSE_TY 는 "084.7500A" 처럼 끝에 공백이 붙어 온다 → trim 필수
 *
 * 사용법:
 *   node scripts/collectors/collect-applyhome-remndr.mjs              (적재)
 *   node scripts/collectors/collect-applyhome-remndr.mjs --dry-run    (파싱·매칭 미리보기, DB 쓰기 0)
 *
 * 필요 환경변수: MOLIT_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import {
  loadEnv, getSupabase, log, logError, createReporter,
  selectAll, upsertBatch, recordApiQuota, recordCollectorRun,
} from "./_shared.mjs";

loadEnv();

const PHASE = "applyhome-remndr";
const API_KEY = process.env.MOLIT_KEY;
const CMPET_BASE = "https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1";
const DETAIL_BASE = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1";
let apiCalls = 0;

/**
 * 취소후재공급 유형 6종 — API 필드 접두사 → 저장 키.
 * 청약홈이 유형을 추가하면 여기에 1줄 추가한다 (by_type JSONB 라 마이그 불필요).
 */
export const CANC_TYPES = /** @type {const} */ ([
  ["NORMAL", "normal"],
  ["INSTT_RECOMEND", "instt"],
  ["MNYCH", "mnych"],
  ["LFE_FRST", "lfe_frst"],
  ["NWWDS", "nwwds"],
  ["OLD_PARNTS_SUPORT", "old_parnts"],
]);

/**
 * @typedef {{ HOUSE_MANAGE_NO?: string | number; PBLANC_NO?: string | number; MODEL_NO?: string | number;
 *   HOUSE_TY?: string; LTTOT_TOP_AMOUNT?: string | number | null; SUPLY_AR?: string | number | null;
 *   SUPLY_HSHLDCO?: string | number | null; SPSPLY_HSHLDCO?: string | number | null;
 *   [k: string]: unknown }} MdlRow
 * @typedef {{ HOUSE_MANAGE_NO?: string | number; PBLANC_NO?: string | number; MODEL_NO?: string | number;
 *   HOUSE_TY?: string; SUPLY_HSHLDCO?: string | number | null; [k: string]: unknown }} CancRow
 */

// ── 값 파서 (설계 §3 — 전부 순수 함수, 단위 테스트 대상) ───────────────

/**
 * 청약홈 경쟁률 문자열 → { rate, shortfall }.
 *
 * 2026-08-07 실측 5형태를 전부 처리한다:
 *   "73.00" → rate 73          (정상)
 *   "2,182.00" → rate 2182     (콤마 — #7 NORMAL_CMPET_RATE 의 20.9%)
 *   "-" → 둘 다 null           (미접수/해당없음 — #1 의 28.6%)
 *   "(△13)" → shortfall 13     (13세대 미달)
 *   null/"" → 둘 다 null
 *
 * ⚠️ shortfall 을 버리지 말 것. rate=null 로만 저장하면 "미달"과 "미수집"이 구분 불가능해진다.
 * @param {unknown} v
 * @returns {{ rate: number | null, shortfall: number | null }}
 */
export function parseCmpetRate(v) {
  if (v == null) return { rate: null, shortfall: null };
  const s = String(v).trim();
  if (s === "" || s === "-") return { rate: null, shortfall: null };
  // "(△13)" — 괄호·공백 변형을 흡수. 숫자만 뽑는다.
  const m = s.match(/^\(?\s*△\s*(\d+)\s*\)?$/);
  if (m) return { rate: null, shortfall: Number(m[1]) };
  const n = Number(s.replace(/,/g, ""));
  return { rate: Number.isFinite(n) ? n : null, shortfall: null };
}

/**
 * 콤마가 섞일 수 있는 정수 필드 파서 (분양가·세대수·신청건수).
 * 기존 _shared 계열 toInt 는 Number("62,342") → NaN 이라 값이 통째로 사라진다.
 * @param {unknown} v
 * @returns {number | null}
 */
export function parseIntLoose(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * 콤마가 섞일 수 있는 실수 필드 파서 (공급면적 등).
 * @param {unknown} v
 * @returns {number | null}
 */
export function parseRealLoose(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * HOUSE_TY 정규화 — 원문은 "084.7500A" 처럼 끝에 공백이 붙어 온다.
 * @param {unknown} v
 * @returns {string | null}
 */
export function normHouseTy(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// ── 행 변환 (순수 함수 — DB 호출 없음) ────────────────────────────────

/**
 * 잔여세대 평형 row → applyhome_unit_supply 행.
 *
 * special_by_type 은 채우지 않는다 — 이 채널은 유형별 내역을 주지 않고
 * SPSPLY_HSHLDCO(특공 합계)만 준다. 빈 객체를 넣으면 "유형 정보 있음"으로 오해된다.
 * @param {MdlRow} row
 * @param {string} aptId
 */
export function buildUnitRow(row, aptId) {
  return {
    apartment_id: aptId,
    house_manage_no: String(row.HOUSE_MANAGE_NO ?? ""),
    model_no: String(row.MODEL_NO ?? ""),
    house_ty: normHouseTy(row.HOUSE_TY),
    supply_area: parseRealLoose(row.SUPLY_AR),     // 실측 87.4% null — 정상
    general_supply: parseIntLoose(row.SUPLY_HSHLDCO),
    special_supply: parseIntLoose(row.SPSPLY_HSHLDCO),
    special_by_type: null,
    top_amount: parseIntLoose(row.LTTOT_TOP_AMOUNT),
    source: "remndr",
  };
}

/**
 * 취소후재공급 row → applyhome_cancel_respl 행.
 *
 * by_type 에는 값이 하나라도 있는 유형만 담는다 — 6유형 전부 0 인 행이 흔해서
 * 전부 담으면 JSONB 가 의미 없는 0 으로 채워진다.
 * @param {CancRow} row
 * @param {string} aptId
 */
export function buildCancelRow(row, aptId) {
  /** @type {Record<string, { rate: number | null, supply: number | null, req: number | null, shortfall?: number }>} */
  const byType = {};
  /** @type {number[]} */
  const rates = [];

  for (const [prefix, key] of CANC_TYPES) {
    const supply = parseIntLoose(row[`${prefix}_HSHLDCO`]);
    const req = parseIntLoose(row[`${prefix}_REQ_CNT`]);
    const { rate, shortfall } = parseCmpetRate(row[`${prefix}_CMPET_RATE`]);
    // 이 주택형에 배정이 없는 유형 = 담지 않는다.
    // ⚠️ `rate == null` 로 판정하면 안 된다 — 배정 없는 유형은 "0.00" 으로 오고
    //    parseCmpetRate 가 그걸 rate 0 (null 아님)으로 정직하게 돌려주기 때문에
    //    6유형이 전부 담겨 JSONB 가 의미 없는 0 으로 채워진다.
    //    `!rate` 는 0 과 null 을 함께 걸러 낸다. 실제 배정(supply>0)·신청(req>0)·
    //    미달(shortfall)이 하나라도 있으면 남긴다.
    if (!supply && !req && !rate && shortfall == null) continue;
    /** @type {{ rate: number | null, supply: number | null, req: number | null, shortfall?: number }} */
    const entry = { rate, supply, req };
    if (shortfall != null) entry.shortfall = shortfall;
    byType[key] = entry;
    if (rate != null) rates.push(rate);
  }

  return {
    apartment_id: aptId,
    house_manage_no: String(row.HOUSE_MANAGE_NO ?? ""),
    pblanc_no: row.PBLANC_NO != null ? String(row.PBLANC_NO) : null,
    model_no: String(row.MODEL_NO ?? ""),
    house_ty: normHouseTy(row.HOUSE_TY),
    total_supply: parseIntLoose(row.SUPLY_HSHLDCO),
    by_type: Object.keys(byType).length ? byType : null,
    // 전 유형이 미달/미접수면 null. 0 으로 채우면 "경쟁률 0" 과 "미수집" 이 뒤섞인다.
    max_rate: rates.length ? Math.max(...rates) : null,
  };
}

/**
 * 로스터에 있는 공고만 남기고 apartment_id 를 붙인다.
 * @template T
 * @param {T[]} rows
 * @param {Set<string>} rosterIds
 * @param {(row: T, aptId: string) => Record<string, unknown>} build
 * @returns {{ built: Record<string, unknown>[]; matchedNos: Set<string>; unmatchedNos: Set<string> }}
 */
export function buildMatched(rows, rosterIds, build) {
  /** @type {Record<string, unknown>[]} */
  const built = [];
  const matchedNos = new Set();
  const unmatchedNos = new Set();
  for (const row of rows) {
    const no = String(/** @type {{ HOUSE_MANAGE_NO?: unknown }} */ (row).HOUSE_MANAGE_NO ?? "").trim();
    if (!no) continue;
    const aptId = `ah-${no}`;
    if (!rosterIds.has(aptId)) { unmatchedNos.add(no); continue; }
    matchedNos.add(no);
    built.push(build(row, aptId));
  }
  return { built, matchedNos, unmatchedNos };
}

/**
 * 설계 §5-A 불변식 재검증 — 잔여세대 평형이 기존 APT 계열 행의 충돌키를 침범하는가.
 *
 * 마이그레이션이 UNIQUE(apartment_id, house_manage_no, model_no) 를 그대로 둔 근거가
 * "2026-08-07 실측 충돌 0건" 이다. 번호대가 겹치기 시작하면 그 근거가 무너지고
 * 잔여세대 행이 APT 행을 덮어쓴다 → DB 쓰기 전에 멈춰야 한다.
 * @param {Record<string, unknown>[]} newRows   source='remndr' 로 넣을 행
 * @param {{ apartment_id: string, house_manage_no: string, model_no: string, source?: string | null }[]} existing
 * @returns {{ key: string, existingSource: string }[]} 충돌 목록 (비어 있으면 안전)
 */
export function findKeyCollisions(newRows, existing) {
  /** @type {Map<string, string>} */
  const byKey = new Map();
  for (const e of existing) {
    if ((e.source ?? "apt") === "remndr") continue;   // 자기 자신(이전 run 적재분)은 충돌 아님
    byKey.set(`${e.apartment_id}|${e.house_manage_no}|${e.model_no}`, e.source ?? "apt");
  }
  /** @type {{ key: string, existingSource: string }[]} */
  const hits = [];
  for (const r of newRows) {
    const key = `${r.apartment_id}|${r.house_manage_no}|${r.model_no}`;
    const src = byKey.get(key);
    if (src) hits.push({ key, existingSource: src });
  }
  return hits;
}

// ── odcloud 페이지네이션 (collect-applyhome-detail.mjs:57-74 답습) ──────
/**
 * @param {string} base
 * @param {string} op
 * @param {{ interrupted: () => boolean }} rpt  페이지 루프도 SIGTERM 에 끊긴다 (긴 루프는 여기다)
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function fetchAllPages(base, op, rpt) {
  /** @type {Record<string, unknown>[]} */
  const all = [];
  let page = 1;
  while (true) {
    if (rpt.interrupted()) break;
    const params = new URLSearchParams({ page: String(page), perPage: "1000", serviceKey: API_KEY || "" });
    const res = await fetch(`${base}/${op}?${params}`, { signal: AbortSignal.timeout(30000) });
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

/**
 * 기존 평형 행을 읽어 충돌키 대조용으로 돌려준다.
 *
 * `source` 컬럼은 20260807000000 마이그가 만든다. 아직 Dashboard 에 적용되지 않았으면
 * PostgREST 가 "column ... does not exist"(PG 42703) 로 실패한다 — 그 경우를 일반 조회
 * 실패와 섞지 않고 명시적으로 구분한다 (설계 §5-A, workflow-name-hallucination 룰 답습).
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @returns {Promise<{ rows: { apartment_id: string, house_manage_no: string, model_no: string, source?: string | null }[] } | { migrationMissing: true }>}
 */
async function loadExistingUnits(sb) {
  try {
    const rows = /** @type {{ apartment_id: string, house_manage_no: string, model_no: string, source?: string | null }[]} */ (
      await selectAll((s) => s.from("applyhome_unit_supply").select("apartment_id, house_manage_no, model_no, source"), sb)
    );
    return { rows };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/source/.test(msg) && /does not exist|42703/.test(msg)) return { migrationMissing: true };
    throw err;
  }
}

// ── 메인 ──────────────────────────────────────────────────────────────
async function main() {
  if (!API_KEY) {
    logError(PHASE, "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 (DB 쓰기 0) ===");

  const sb = getSupabase();
  const rpt = createReporter(PHASE);
  // process.exit() 를 try 안에서 부르면 대기 중인 finally(recordApiQuota)를 건너뛴다
  // (Node 실측, 세션 395 정정 패턴 — collect-applyhome.mjs 답습).
  // 그래서 exit 여부는 플래그로만 들고, 실제 exit 는 finally 안 recordApiQuota 직후에 한다.
  let shouldExit1 = false;

  try {
    // 1. 두 채널 전수 수집
    log(PHASE, "청약홈 잔여세대 평형 + 취소후재공급 경쟁률 조회 시작...");
    const mdls = /** @type {MdlRow[]} */ (await fetchAllPages(DETAIL_BASE, "getRemndrLttotPblancMdl", rpt));
    log(PHASE, `잔여세대 평형: ${mdls.length}건`);
    const cancs = /** @type {CancRow[]} */ (await fetchAllPages(CMPET_BASE, "getCancResplLttotPblancCmpet", rpt));
    log(PHASE, `취소후재공급 경쟁률: ${cancs.length}건`);

    // 1.5. API 응답 형식 변경 조기 감지 (DB 쓰기 전 — collect-applyhome.mjs 패턴 답습).
    //      두 채널 모두 HOUSE_TY 가 필수 식별자라, 그게 대량으로 비면 응답 구조가 바뀐 것이다.
    for (const [label, rows] of /** @type {[string, Record<string, unknown>[]][]} */ ([
      ["잔여세대 평형", mdls], ["취소후재공급", cancs],
    ])) {
      if (rows.length === 0) continue;
      const noTy = rows.filter((r) => !normHouseTy(r.HOUSE_TY)).length;
      const ratio = noTy / rows.length;
      if (ratio > 0.5) {
        logError(PHASE, `⚠️ ${label} HOUSE_TY 부재 ${(ratio * 100).toFixed(1)}% (${noTy}/${rows.length}) — 청약홈 API 응답 구조 변경 가능성. 적재 중단.`);
        shouldExit1 = true;
        return;
      }
    }

    // 2. 로스터 매칭 (ah-{HOUSE_MANAGE_NO} 직접 — 이름 유사도 불필요)
    const apts = /** @type {{ id: string }[]} */ (await selectAll(
      (s) => s.from("apartments").select("id"),
      sb,
    ));
    const rosterIds = new Set(apts.map((a) => a.id));
    log(PHASE, `로스터: ${apts.length}건`);

    const unit = buildMatched(mdls, rosterIds, (r, id) => buildUnitRow(/** @type {MdlRow} */ (r), id));
    const canc = buildMatched(cancs, rosterIds, (r, id) => buildCancelRow(/** @type {CancRow} */ (r), id));
    log(PHASE, `평형 매칭: 공고 ${unit.matchedNos.size}건 / 미매칭 ${unit.unmatchedNos.size}건 → 행 ${unit.built.length}`);
    log(PHASE, `취소후재공급 매칭: 공고 ${canc.matchedNos.size}건 / 미매칭 ${canc.unmatchedNos.size}건 → 행 ${canc.built.length}`);

    // 2.5. 충돌키 불변식 재검증 (설계 §5-A — 마이그가 UNIQUE 를 안 바꾼 근거).
    //      DB 쓰기 전이라 exit(1) 해도 데이터 무결.
    const existing = await loadExistingUnits(sb);
    if ("migrationMissing" in existing) {
      // 마이그 20260807000000 이 아직 Dashboard 에 적용되지 않았다.
      // dry-run 은 파싱 검증이 목적이라 경고 후 계속, 실적재는 중단 (source 컬럼 없이 쓰면 실패).
      if (!dryRun) {
        logError(PHASE, "⚠️ applyhome_unit_supply.source 컬럼 없음 — 마이그 20260807000000_applyhome_stage1_remndr.sql 미적용. Dashboard SQL Editor 적용 후 재실행.");
        shouldExit1 = true;
        return;
      }
      log(PHASE, "⚠️ [DRY-RUN] source 컬럼 없음 = 마이그 미적용. 충돌키 검사 건너뜀 (파싱 검증만 계속).");
    } else {
      const collisions = findKeyCollisions(unit.built, existing.rows);
      if (collisions.length > 0) {
        logError(PHASE, `⚠️ 충돌키 ${collisions.length}건 — 잔여세대 행이 기존 ${collisions[0].existingSource} 계열 행을 덮어쓴다. 설계 §5-A 전제(2026-08-07 실측 충돌 0) 붕괴. 적재 중단.`);
        logError(PHASE, `  예시: ${collisions.slice(0, 3).map((c) => c.key).join(" / ")}`);
        shouldExit1 = true;
        return;
      }
      log(PHASE, `충돌키 검사: 0건 (기존 ${existing.rows.length}행 대조) — UNIQUE 유지 근거 확인`);
    }

    if (dryRun) {
      for (const r of unit.built.slice(0, 5)) {
        log(PHASE, `  [DRY-RUN 평형] ${r.apartment_id} ${r.house_ty} 분양가 ${r.top_amount ?? "-"}만원 면적 ${r.supply_area ?? "-"} 일반 ${r.general_supply ?? "-"} 특공 ${r.special_supply ?? "-"}`);
      }
      for (const r of canc.built.slice(0, 5)) {
        const bt = /** @type {Record<string, unknown> | null} */ (r.by_type);
        log(PHASE, `  [DRY-RUN 취소후재공급] ${r.apartment_id} ${r.house_ty} 최고경쟁률 ${r.max_rate ?? "미달/미접수"} 유형 ${bt ? Object.keys(bt).join(",") : "없음"}`);
      }
      log(PHASE, `\n=== DRY-RUN 요약: 평형 ${unit.built.length}행 / 취소후재공급 ${canc.built.length}행 (DB 쓰기 0) ===`);
      rpt.success(unit.built.length + canc.built.length);
      rpt.summary();
      // ⚠️ dry-run 은 recordCollectorRun 을 부르지 않는다 — "DB 쓰기 0" 을 글자 그대로 지키기 위해서다.
      //    부르면 collector_runs 에 fresh 한 success 행이 남아 monitor ⑤-b(미발화)가
      //    "이미 돌았다" 로 오인하고, 진짜 미배포 상태를 stale_days(14일) 동안 가린다.
      return;
    }

    // 3. 적재 — apartments base 컬럼은 건드리지 않는다 (로스터 변화 0)
    //    graceful: 배치 사이에서 끊기면 남은 배치를 버리고 partial 로 기록한다.
    for (const [table, rows, conflict] of /** @type {[string, Record<string, unknown>[], string][]} */ ([
      ["applyhome_unit_supply", unit.built, "apartment_id,house_manage_no,model_no"],
      ["applyhome_cancel_respl", canc.built, "apartment_id,house_manage_no,model_no"],
    ])) {
      if (rpt.interrupted()) break;
      if (rows.length === 0) continue;
      const ins = await upsertBatch(table, rows, conflict, 500, sb);
      rpt.success(ins);
      if (rows.length - ins > 0) rpt.fail(rows.length - ins);
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
    // ⚠️ try/finally *뒤* 로 빼면 안 된다 — 위 조기 감지 3곳이 try 안에서 return 하므로 그 줄에는
    //    도달하지 못해 exit 0(성공)으로 끝난다(Node 실측).
    if (shouldExit1) process.exit(1);
  }
}

// isCLI v2 (typescript-patterns.md §5.2) — test import 시 main() 방지
const isCLI = !!process.argv[1] && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "",
);
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
