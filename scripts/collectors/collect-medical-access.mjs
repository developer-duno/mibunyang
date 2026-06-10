// @ts-check
/**
 * KOSIS 의료 인프라 묶음 수집기 (BACKLOG #11·#12, 세션 267)
 *
 * KOSIS 국가통계포털 통계표 2개에서 시군구별 의료 접근성 지표를 수집해
 * regions 테이블 (gu 있는 시군구 행) 업데이트.
 *   - DT_1YL20981 인구 천명당 의료기관 종사 의사수 → doctors_per_1k
 *   - DT_1YL20971 인구 천명당 의료기관 병상수      → hospital_beds_per_1k
 *
 * - itmId = 'T10' (천명당 지표). T001 분자 / T002 분모는 API 단계 필터로 제외.
 * - prdSe = 'A' (연간), 1차원 통계표 — objL1 만 사용.
 * - C1 코드: 2자리 = 집계행(전국/시도, 버림) / 5자리 = 시군구.
 *   5자리 앞 2자리 = KOSIS 시도코드 (법정동코드와 다른 체계 — KOSIS_SIDO).
 * - collect-fertility-rate.mjs (세션 266) 답습 + 통계표 2개 루프.
 *
 * 사용법:
 *   node scripts/collectors/collect-medical-access.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-medical-access.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, recordApiQuota, recordCollectorRun } from "./_shared.mjs";

/** @typedef {{ C1: string; C1_NM: string; ITM_ID?: string; PRD_DE: string; DT: string }} KosisRow */
/** @typedef {{ matched: Record<string, number>; unmatched: string[]; aggSkipped: number }} ParseResult */

loadEnv();

const PHASE = "kosis-medical-access";
const KOSIS_KEY = process.env.KOSIS_KEY;

/**
 * KOSIS C1 코드 앞 2자리 → regions.region.
 * 법정동코드 체계(_shared.REGION_LAWD_PREFIX) 와 다름 — 재사용 금지.
 * 값 출처: KOSIS 시도 집계행 17개 실측 (collect-fertility-rate.mjs 답습).
 */
const KOSIS_SIDO = {
  "11": "서울", "21": "부산", "22": "대구", "23": "인천", "24": "광주",
  "25": "대전", "26": "울산", "29": "세종", "31": "경기", "32": "강원",
  "33": "충북", "34": "충남", "35": "전북", "36": "전남", "37": "경북",
  "38": "경남", "39": "제주",
};

/**
 * 수집 대상 통계표 — { tblId, regions 컬럼명 }.
 */
const TABLES = [
  { tblId: "DT_1YL20981", column: "doctors_per_1k", label: "의사수" },
  { tblId: "DT_1YL20971", column: "hospital_beds_per_1k", label: "병상수" },
];

/**
 * KOSIS 통계표 행 → "region::gu" 키별 천명당 지표값 (최신 연도).
 * - C1 길이 2 (전국/시도 집계행) → aggSkipped 증가, 버림
 * - C1 길이 5 (시군구) → KOSIS_SIDO[C1.slice(0,2)] + C1_NM 으로 매칭
 * - ITM_ID 가 T10 아니면 skip (T001 분자 / T002 분모 제외)
 * @param {KosisRow[]} rows
 * @returns {ParseResult}
 */
export function parseKosisRows(rows) {
  /** @type {Record<string, number>} */
  const matched = {};
  /** @type {Record<string, string>} */
  const latestYear = {};
  /** @type {Set<string>} */
  const unmatchedSet = new Set();
  let aggSkipped = 0;

  for (const row of rows) {
    // itmId=T10 만 호출하지만 다른 ITM 이 섞이면 skip
    if (row.ITM_ID && row.ITM_ID !== "T10") continue;

    const code = String(row.C1 ?? "");
    if (code.length === 2) {
      aggSkipped++;
      continue;
    }
    if (code.length !== 5) continue;

    const year = String(row.PRD_DE ?? "");
    if (!/^\d{4}$/.test(year)) continue;

    const value = parseFloat(row.DT);
    if (!isFinite(value) || value <= 0) continue;

    const region = /** @type {Record<string, string>} */ (KOSIS_SIDO)[code.slice(0, 2)];
    if (!region) {
      if (row.C1_NM) unmatchedSet.add(row.C1_NM);
      continue;
    }

    const key = `${region}::${row.C1_NM}`;
    if (!latestYear[key] || year > latestYear[key]) {
      latestYear[key] = year;
      matched[key] = value;
    }
  }

  return { matched, unmatched: [...unmatchedSet], aggSkipped };
}

/**
 * KOSIS 통계표 1개 호출 → parseKosisRows 결과.
 * @param {string} tblId
 * @param {string} startYear
 * @param {string} endYear
 * @returns {Promise<ParseResult>}
 */
async function fetchTable(tblId, startYear, endYear) {
  const params = new URLSearchParams({
    method: "getList",
    apiKey: KOSIS_KEY ?? "",
    orgId: "101",
    tblId,
    itmId: "T10",
    objL1: "ALL",
    prdSe: "A",
    startPrdDe: startYear,
    endPrdDe: endYear,
    format: "json",
    jsonVD: "Y",
  });

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
    throw new Error(`KOSIS ${tblId} ${err instanceof Error ? err.message : String(err)}`);
  }
  if (data.err) throw new Error(`KOSIS ${tblId} 에러: ${data.errMsg || data.err}`);

  const rows = Array.isArray(data) ? data : [];
  log(PHASE, `KOSIS ${tblId} 응답: ${rows.length}건`);
  return parseKosisRows(rows);
}

// 세션 394: try/catch/finally 하드닝 — KOSIS 러너 차단(6/9~) 중 실패가
// collector_runs 에 0행으로 남는 사각 정정 (PR #83 sync-naver 패턴 답습).
export async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  let ok = 0;
  let skip = 0;
  let errorMessage = /** @type {string | undefined} */ (undefined);
  try {
    if (!KOSIS_KEY) throw new Error("KOSIS_KEY not configured");

    const sb = getSupabase();

    const now = new Date();
    const endYear = String(now.getFullYear());
    const startYear = String(now.getFullYear() - 3);
    log(PHASE, `KOSIS 의료 인프라 조회: ${startYear} ~ ${endYear}`);

    // 통계표별 수집 → { column: matched }
    /** @type {Record<string, Record<string, number>>} */
    const byColumn = {};
    let totalUnmatched = 0;
    for (const { tblId, column, label } of TABLES) {
      const { matched, unmatched, aggSkipped } = await fetchTable(tblId, startYear, endYear);
      log(PHASE, `${label}: 시군구 매칭 ${Object.keys(matched).length}개 / 집계행 skip ${aggSkipped}개`);
      if (unmatched.length > 0) {
        logError(PHASE, `${label} 매칭 실패 ${unmatched.length}개: ${unmatched.join(", ")}`);
        totalUnmatched += unmatched.length;
      }
      byColumn[column] = matched;
    }

    if (Object.values(byColumn).every(m => Object.keys(m).length === 0)) {
      log(PHASE, "전 통계표 매칭 0건 — 종료 (KOSIS 응답 형식 변경 의심)");
      return;
    }

    // regions UPDATE (gu 있는 시군구 행)
    const { data: regions, error: rErr } = await sb
      .from("regions")
      .select("id, region, gu, doctors_per_1k, hospital_beds_per_1k")
      .not("gu", "is", null);

    if (rErr) {
      logError(PHASE, `regions 조회 실패: ${rErr.message}`);
      return;
    }

    /** @type {Array<{ id: string; region: string; gu: string | null; doctors_per_1k: number | null; hospital_beds_per_1k: number | null }>} */
    const regionsTyped = /** @type {any} */ (regions ?? []);

    let updated = 0;
    for (const reg of regionsTyped) {
      const key = `${reg.region}::${reg.gu}`;
      const doctors = byColumn["doctors_per_1k"]?.[key];
      const beds = byColumn["hospital_beds_per_1k"]?.[key];
      if (doctors == null && beds == null) continue;

      /** @type {Record<string, number>} */
      const patch = {};
      if (doctors != null && (reg.doctors_per_1k == null || Math.abs(reg.doctors_per_1k - doctors) >= 0.05)) {
        patch.doctors_per_1k = doctors;
      }
      if (beds != null && (reg.hospital_beds_per_1k == null || Math.abs(reg.hospital_beds_per_1k - beds) >= 0.05)) {
        patch.hospital_beds_per_1k = beds;
      }
      if (Object.keys(patch).length === 0) continue;

      if (dryRun) {
        log(PHASE, `  [DRY-RUN] regions ${reg.region} ${reg.gu}: ${JSON.stringify(patch)}`);
        updated++;
        continue;
      }

      const { error } = await sb.from("regions").update(patch).eq("id", reg.id);
      if (error) logError(PHASE, `  regions ${reg.id} UPDATE 실패: ${error.message}`);
      else updated++;
    }

    log(PHASE, `regions 갱신: ${updated}건 / ${regionsTyped.length}건 대상`);

    if (!dryRun) await recordApiQuota(PHASE, "KOSIS_KEY", TABLES.length);
    ok = updated;
    skip = totalUnmatched;

    log(PHASE, "\n=== 완료 ===");
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await recordCollectorRun(PHASE, errorMessage
      ? { ok, skip, status: "failure", errorMessage }
      : { ok, skip });
  }
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((/** @type {unknown} */ err) => {
  logError(PHASE, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
