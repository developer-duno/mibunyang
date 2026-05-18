// @ts-check
/**
 * KOSIS 시도 단위 경제·교육 지표 묶음 수집기 (BACKLOG Phase 3, 세션 271)
 *
 * KOSIS 국가통계포털 통계표 4개에서 시도별 거시 지표를 수집해
 * regions 테이블 (gu IS NULL 시도 행) 업데이트.
 *   - INH_1C96_02 1인당 GRDP            → grdp_per_capita        (천원)
 *   - DT_1PE105   1인당 월평균 사교육비  → education_cost         (만원, ITM_ID=T00)
 *   - DT_1PE107   사교육 참여율          → education_participation (%, ITM_ID=T00)
 *   - DT_1DA7104S 실업률                → unemployment_rate      (%, prdSe=Y, C2=0)
 *
 * - 매칭은 C1 2자리 코드 기반 (KOSIS_SIDO). C1_NM(이름)은 통계표마다 다름
 *   (강원이 '강원특별자치도'/'강원도') → 코드 매칭이 이름 변동에 면역.
 * - C1 코드는 시도·전국 모두 2자리. 전국 '00' 은 KOSIS_SIDO 미등록이라 자동 제외.
 *   medical-access 의 C1 길이 2/5 분기를 답습하면 시도 행이 통째로 버려짐 — 금지.
 * - #13 DT_1DA7104S 는 prdSe='A' 면 KOSIS err 30. 반드시 'Y'. objL2='0'(성별 계).
 * - #9/#10 은 ITM 5종(평균/초/중/고/일반고) → ITM_ID='T00'(평균)만 추출.
 * - collect-medical-access.mjs (세션 267) 묶음 루프 + collect-fertility-rate.mjs 표준 답습.
 *
 * 사용법:
 *   node scripts/collectors/collect-regional-economy.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-regional-economy.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, recordApiQuota, recordCollectorRun } from "./_shared.mjs";

/** @typedef {{ C1: string; C1_NM?: string; C2?: string; ITM_ID?: string; PRD_DE: string; DT: string }} KosisRow */
/** @typedef {{ matched: Record<string, number>; unmatched: string[]; aggSkipped: number }} ParseResult */
/**
 * @typedef {object} TableSpec
 * @property {string} tblId       KOSIS 통계표 ID
 * @property {string} column      regions 신규 컬럼명
 * @property {string} label       로그용 한글 라벨
 * @property {string} prdSe       'A'(연간) | 'Y'(#13 전용 — 'A' 면 err 30)
 * @property {string|null} itmId  ITM_ID 필터 (null = 단일 ITM, 필터 없음)
 * @property {string|null} objL2  2차원 통계표용 objL2 코드 (null = 1차원)
 * @property {number} [maxValue]  이상치 상한 (없으면 무제한)
 */

loadEnv();

const PHASE = "kosis-regional-economy";
const KOSIS_KEY = process.env.KOSIS_KEY;

/**
 * KOSIS C1 2자리 코드 → regions.region 약칭.
 * 법정동코드 체계(_shared.REGION_LAWD_PREFIX) 와 다름 — 재사용 금지.
 * 전국 '00' 미등록 → 집계행 자동 제외. collect-medical-access.mjs 답습.
 */
const KOSIS_SIDO = {
  "11": "서울", "21": "부산", "22": "대구", "23": "인천", "24": "광주",
  "25": "대전", "26": "울산", "29": "세종", "31": "경기", "32": "강원",
  "33": "충북", "34": "충남", "35": "전북", "36": "전남", "37": "경북",
  "38": "경남", "39": "제주",
};

/**
 * 수집 대상 통계표 — 통계표별 ITM 필터·prdSe·objL2 차이를 spec 으로 표현.
 * @type {readonly TableSpec[]}
 */
const TABLES = [
  { tblId: "INH_1C96_02", column: "grdp_per_capita",         label: "1인당 GRDP",
    prdSe: "A", itmId: null,  objL2: null },
  { tblId: "DT_1PE105",   column: "education_cost",          label: "사교육비",
    prdSe: "A", itmId: "T00", objL2: null },
  { tblId: "DT_1PE107",   column: "education_participation", label: "사교육참여율",
    prdSe: "A", itmId: "T00", objL2: null, maxValue: 100 },
  { tblId: "DT_1DA7104S", column: "unemployment_rate",       label: "실업률",
    prdSe: "Y", itmId: null,  objL2: "0", maxValue: 100 },
];

/**
 * KOSIS 통계표 행 → "region" 키별 지표값 (최신 연도).
 * - C1 2자리 코드를 KOSIS_SIDO 로 매칭. 전국 '00' 미등록 → aggSkipped.
 * - spec.itmId 가 있으면 ITM_ID 불일치 행 skip (#9/#10 의 T00 외 4종 제외).
 * - spec.objL2 가 있으면 C2 불일치 행 skip — #13 은 API objL2='0' 으로 이미 '계'만
 *   응답하므로 무해한 방어 이중 가드 (KOSIS 가 파라미터 무시 시 보험).
 * @param {KosisRow[]} rows
 * @param {TableSpec} spec
 * @returns {ParseResult}
 */
export function parseKosisRows(rows, spec) {
  /** @type {Record<string, number>} */
  const matched = {};
  /** @type {Record<string, string>} */
  const latestYear = {};
  /** @type {Set<string>} */
  const unmatchedSet = new Set();
  let aggSkipped = 0;

  for (const row of rows) {
    // ITM 필터 (#9/#10 의 T00 만)
    if (spec.itmId != null && row.ITM_ID !== spec.itmId) continue;
    // C2 필터 (#13 의 성별 '계'='0' 만) — 방어 이중 가드
    if (spec.objL2 != null && String(row.C2 ?? "") !== spec.objL2) continue;

    const code = String(row.C1 ?? "");
    const region = /** @type {Record<string, string>} */ (KOSIS_SIDO)[code];
    if (!region) {
      // 전국 '00' 등 집계행 — KOSIS_SIDO 미등록
      aggSkipped++;
      continue;
    }

    const year = String(row.PRD_DE ?? "");
    if (!/^\d{4}$/.test(year)) continue;

    const value = parseFloat(row.DT);
    if (!isFinite(value) || value <= 0) continue;
    if (spec.maxValue != null && value > spec.maxValue) continue;

    if (!latestYear[region] || year > latestYear[region]) {
      latestYear[region] = year;
      matched[region] = value;
    }
  }

  return { matched, unmatched: [...unmatchedSet], aggSkipped };
}

/**
 * KOSIS 통계표 1개 호출 → parseKosisRows 결과.
 * @param {TableSpec} spec
 * @param {string} startYear
 * @param {string} endYear
 * @returns {Promise<ParseResult>}
 */
async function fetchTable(spec, startYear, endYear) {
  /** @type {Record<string, string>} */
  const paramObj = {
    method: "getList",
    apiKey: KOSIS_KEY ?? "",
    orgId: "101",
    tblId: spec.tblId,
    itmId: "ALL",
    objL1: "ALL",
    prdSe: spec.prdSe,
    startPrdDe: startYear,
    endPrdDe: endYear,
    format: "json",
    jsonVD: "Y",
  };
  if (spec.objL2 != null) paramObj.objL2 = spec.objL2;
  const params = new URLSearchParams(paramObj);

  const apiUrl = `https://kosis.kr/openapi/Param/statisticsParameterData.do?${params}`;
  let data;
  try {
    const res = await fetchWithRetry(apiUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    try {
      data = await res.json();
    } catch {
      throw new Error("JSON 파싱 실패");
    }
  } catch (err) {
    throw new Error(`KOSIS ${spec.tblId} ${err instanceof Error ? err.message : String(err)}`);
  }
  if (data.err) throw new Error(`KOSIS ${spec.tblId} 에러: ${data.errMsg || data.err}`);

  const rows = Array.isArray(data) ? data : [];
  log(PHASE, `KOSIS ${spec.tblId} 응답: ${rows.length}건`);
  return parseKosisRows(rows, spec);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");
  if (!KOSIS_KEY) throw new Error("KOSIS_KEY not configured");

  const sb = getSupabase();

  const now = new Date();
  const endYear = String(now.getFullYear());
  const startYear = String(now.getFullYear() - 3);
  log(PHASE, `KOSIS 경제·교육 지표 조회: ${startYear} ~ ${endYear}`);

  // 통계표별 수집 → { column: matched }
  /** @type {Record<string, Record<string, number>>} */
  const byColumn = {};
  let totalAggSkipped = 0;
  for (const spec of TABLES) {
    const { matched, aggSkipped } = await fetchTable(spec, startYear, endYear);
    log(PHASE, `${spec.label}: 시도 매칭 ${Object.keys(matched).length}개 / 집계행 skip ${aggSkipped}개`);
    byColumn[spec.column] = matched;
    totalAggSkipped += aggSkipped;
  }

  if (Object.values(byColumn).every(m => Object.keys(m).length === 0)) {
    log(PHASE, "전 통계표 매칭 0건 — 종료 (KOSIS 응답 형식 변경 의심)");
    return;
  }

  // regions UPDATE (gu IS NULL 시도 행 — recorded_at 누적으로 약 76행)
  const { data: regions, error: rErr } = await sb
    .from("regions")
    .select("id, region, gu, grdp_per_capita, education_cost, education_participation, unemployment_rate")
    .is("gu", null);

  if (rErr) {
    logError(PHASE, `regions 조회 실패: ${rErr.message}`);
    return;
  }

  /** @type {Array<{ id: string; region: string; gu: string | null; grdp_per_capita: number | null; education_cost: number | null; education_participation: number | null; unemployment_rate: number | null }>} */
  const regionsTyped = /** @type {any} */ (regions ?? []);

  let updated = 0;
  for (const reg of regionsTyped) {
    /** @type {Record<string, number>} */
    const patch = {};
    for (const spec of TABLES) {
      const value = byColumn[spec.column]?.[reg.region];
      if (value == null) continue;
      const old = /** @type {Record<string, number | null>} */ (/** @type {unknown} */ (reg))[spec.column];
      // GRDP 는 천원 단위 큰 값 → 1 이상 차이, 나머지 % → 0.05 이상 차이일 때만
      const minDiff = spec.column === "grdp_per_capita" ? 1 : 0.05;
      if (old == null || Math.abs(old - value) >= minDiff) {
        patch[spec.column] = value;
      }
    }
    if (Object.keys(patch).length === 0) continue;

    if (dryRun) {
      log(PHASE, `  [DRY-RUN] regions ${reg.region}: ${JSON.stringify(patch)}`);
      updated++;
      continue;
    }

    const { error } = await sb.from("regions").update(patch).eq("id", reg.id);
    if (error) logError(PHASE, `  regions ${reg.id} UPDATE 실패: ${error.message}`);
    else updated++;
  }

  log(PHASE, `regions 갱신: ${updated}건 / ${regionsTyped.length}건 대상`);

  if (!dryRun) await recordApiQuota(PHASE, "KOSIS_KEY", TABLES.length);
  await recordCollectorRun(PHASE, { ok: updated, skip: totalAggSkipped });

  log(PHASE, "\n=== 완료 ===");
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((/** @type {unknown} */ err) => {
  logError(PHASE, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
