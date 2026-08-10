// @ts-check
/**
 * KOSIS 합계출산율 수집기 (W6 후속, 세션 265)
 *
 * KOSIS 국가통계포털 DT_1B81A17 (시군구/합계출산율 모의 연령별 출산율) 통계표에서
 * 시군구별 연간 합계출산율(명/여성1명) 을 수집하여
 * regions.fertility_rate (gu 있는 694행 시군구 단위) 업데이트.
 *
 * - itmId = 'T1' (합계출산율). 다른 ITM = 모의 연령별출산율 8종, 불필요 → API 단계 필터.
 * - prdSe = 'A' (연간만).
 * - 1차원 통계표 — objL1 만 사용. objL2 주면 KOSIS 에러 21 (잘못된 요청변수).
 * - C1 코드 체계: 2자리 = 집계행(전국/시도, 버림) / 5자리 = 시군구.
 *   5자리 앞 2자리 = KOSIS 시도코드 (법정동코드와 다른 체계 — KOSIS_SIDO 상수).
 * - 동명 시군구("중구" 6곳 등) 는 C1 앞 2자리 시도코드로 구분.
 * - housing-supply-ratio.mjs (세션 237/259) 답습 + 시군구 매칭 로직 추가.
 *
 * 사용법:
 *   node scripts/collectors/collect-fertility-rate.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-fertility-rate.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, recordApiQuota, recordCollectorRun, normalizeGu, guParentCity } from "./_shared.mjs";

/** @typedef {{ C1: string; C1_NM: string; ITM_NM?: string; PRD_DE: string; DT: string }} KosisRow */
/** @typedef {{ matched: Record<string, number>; unmatched: string[]; aggSkipped: number }} ParseResult */

loadEnv();

const PHASE = "kosis-fertility-rate";
const KOSIS_KEY = process.env.KOSIS_KEY;

/**
 * KOSIS C1 코드 앞 2자리 → regions.region.
 * 법정동코드 체계(_shared.REGION_LAWD_PREFIX: 부산26/대구27) 와 다름 — 재사용 금지.
 * 값 출처: DT_1B81A17 raw API 시도 집계행 17개 실측 (2026-05-17).
 */
const KOSIS_SIDO = {
  "11": "서울", "21": "부산", "22": "대구", "23": "인천", "24": "광주",
  "25": "대전", "26": "울산", "29": "세종", "31": "경기", "32": "강원",
  "33": "충북", "34": "충남", "35": "전북", "36": "전남", "37": "경북",
  "38": "경남", "39": "제주",
};

/**
 * KOSIS DT_1B81A17 행 → "region::gu" 키별 합계출산율 (최신 연도).
 * - C1 길이 2 (전국/시도 집계행) → aggSkipped 증가, 버림
 * - C1 길이 5 (시군구) → KOSIS_SIDO[C1.slice(0,2)] + C1_NM 으로 매칭
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
    // 방어: itmId=T1 만 호출하지만 다른 ITM 이 섞이면 skip
    if (row.ITM_NM && row.ITM_NM !== "합계출산율") continue;

    const code = String(row.C1 ?? "");
    if (code.length === 2) {
      aggSkipped++;
      continue;
    }
    if (code.length !== 5) continue;

    const year = String(row.PRD_DE ?? "");
    if (!/^\d{4}$/.test(year)) continue;

    const value = parseFloat(row.DT);
    if (!isFinite(value) || value <= 0 || value > 5) continue;

    const region = /** @type {Record<string, string>} */ (KOSIS_SIDO)[code.slice(0, 2)];
    if (!region) {
      if (row.C1_NM) unmatchedSet.add(row.C1_NM);
      continue;
    }

    // 세션510 ①: KOSIS 표기를 통일해 담는다. 뒤에서 regions 행을 찾을 때 같은 규칙으로 맞춘다.
    const key = `${region}::${normalizeGu(region, row.C1_NM) ?? row.C1_NM}`;
    if (!latestYear[key] || year > latestYear[key]) {
      latestYear[key] = year;
      matched[key] = value;
    }
  }

  return { matched, unmatched: [...unmatchedSet], aggSkipped };
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

    // KOSIS API 호출 (DT_1B81A17 연간 전체, itmId=T1, 1차원 → objL1 만)
    const now = new Date();
    const endYear = String(now.getFullYear());
    const startYear = String(now.getFullYear() - 3);

    log(PHASE, `KOSIS 합계출산율 조회: ${startYear} ~ ${endYear}`);

    const params = new URLSearchParams({
      method: "getList",
      apiKey: KOSIS_KEY,
      orgId: "101",
      tblId: "DT_1B81A17",
      itmId: "T1",
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
      throw new Error(`KOSIS ${err instanceof Error ? err.message : String(err)}`);
    }
    if (data.err) throw new Error(`KOSIS 에러: ${data.errMsg || data.err}`);

    const rows = Array.isArray(data) ? data : [];
    log(PHASE, `KOSIS 응답: ${rows.length}건`);

    if (rows.length === 0) {
      log(PHASE, "데이터 없음 — 종료");
      return;
    }

    const { matched, unmatched, aggSkipped } = parseKosisRows(rows);
    log(PHASE, `시군구 매칭: ${Object.keys(matched).length}개 / 집계행 skip ${aggSkipped}개`);
    if (unmatched.length > 0) {
      logError(PHASE, `매칭 실패 시군구 ${unmatched.length}개: ${unmatched.join(", ")}`);
    }

    if (Object.keys(matched).length === 0) {
      log(PHASE, "매칭 0건 — 종료 (KOSIS 응답 형식 변경 의심)");
      return;
    }

    // regions UPDATE (gu 있는 694행 시군구 단위)
    const { data: regions, error: rErr } = await sb
      .from("regions")
      .select("id, region, gu, fertility_rate")
      .not("gu", "is", null);

    if (rErr) {
      logError(PHASE, `regions 조회 실패: ${rErr.message}`);
      return;
    }

    /** @type {Array<{ id: string; region: string; gu: string | null; fertility_rate: number | null }>} */
    const regionsTyped = /** @type {any} */ (regions ?? []);

    let updated = 0;
    for (const reg of regionsTyped) {
      // 세션510 ①: ①표기를 통일해 찾고 ②그래도 없으면 **부모 시** 값으로 채운다.
      // 출산율·의사수·병상수는 KOSIS 가 시 단위로만 주기 때문에, 폴백이 없으면 "수원시 장안구"
      // 같은 일반구 행은 영영 비어 있고 화면엔 "미수집"으로 뜬다(실측 310곳·19.4%).
      // ⚠️ 부모 시를 모르면(별칭표 미등재·광역시 자치구) guParentCity 가 null 을 주고 그대로 건너뛴다 —
      //    추측으로 아무 시나 갖다 붙이지 않는다.
      const canonical = normalizeGu(reg.region, reg.gu) ?? reg.gu;
      const parent = guParentCity(reg.region, reg.gu);
      const value = matched[`${reg.region}::${canonical}`] ?? (parent ? matched[`${reg.region}::${parent}`] : undefined);
      if (value == null) continue;
      if (reg.fertility_rate != null && Math.abs(reg.fertility_rate - value) < 0.005) continue;

      if (dryRun) {
        log(PHASE, `  [DRY-RUN] regions ${reg.region} ${reg.gu}: ${reg.fertility_rate ?? "NULL"} → ${value}`);
        updated++;
        continue;
      }

      const { error } = await sb.from("regions").update({
        fertility_rate: value,
      }).eq("id", reg.id);

      if (error) logError(PHASE, `  regions ${reg.id} UPDATE 실패: ${error.message}`);
      else updated++;
    }

    log(PHASE, `regions 갱신: ${updated}건 / ${regionsTyped.length}건 대상`);

    if (!dryRun) await recordApiQuota(PHASE, "KOSIS_KEY", 1);
    ok = updated;
    skip = unmatched.length;

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
