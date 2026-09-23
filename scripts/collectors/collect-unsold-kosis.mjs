// @ts-check
/**
 * KOSIS 시군구별 미분양 세대수 수집기
 *
 * KOSIS 국가통계포털 DT_MLTM_2082 테이블에서 (세션 222 통계표 이전: DT_1YL202001E → DT_MLTM_2082)
 * 시군구별 월별 미분양 세대수를 수집하여
 * regions.regional_unsold + apartments.unsold/unsold_rate 업데이트
 *
 * 사용법:
 *   node scripts/collectors/collect-unsold-kosis.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-unsold-kosis.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, REGION_MAP, fetchWithRetry, upsertBatch, recordApiQuota, recordCollectorRun, setupGracefulShutdown, today, selectAll } from "./_shared.mjs";

/** @typedef {{ C1_NM: string; C2_NM: string; PRD_DE: string; DT: string }} KosisRow */
/** @typedef {Record<string, Record<string, Record<string, number>>>} UnsoldByRegionGuMonth */
/** @typedef {Record<string, Record<string, number>>} UnsoldByRegionGu */
/** @typedef {Record<string, number>} RegionTotals */

loadEnv();

const PHASE = "kosis-unsold";
const KOSIS_KEY = process.env.KOSIS_KEY;

/**
 * KOSIS 응답 행 → 시군구별 월별 미분양 맵 (전 월 유지)
 * 구조: { "서울::강남구": { "202601": 42, "202602": 38, "202603": 35 } }
 *
 * parseKosisRows 와 달리 모든 월 데이터를 보존 → unsold_history 시계열 upsert 용도.
 * 기존 parseKosisRows 는 "최신 월 단일값" 으로 regions/apartments 갱신에 사용 (병존).
 * PRD_DE 정규식 가드: KOSIS 응답이 YYYYMM 외 포맷(분기/반기 등) 반환 시 방어.
 *
 * @param {KosisRow[]} rows
 * @returns {UnsoldByRegionGuMonth}
 */
export function parseKosisRowsAllMonths(rows) {
  /** @type {UnsoldByRegionGuMonth} */
  const unsoldByRegionGuMonth = {};
  for (const row of rows) {
    if (!/^\d{6}$/.test(row.PRD_DE)) continue;
    const region = /** @type {Record<string, string>} */ (REGION_MAP)[row.C1_NM];
    if (!region) continue;
    const gu = row.C2_NM === "계" ? "_total" : row.C2_NM;
    const period = row.PRD_DE;
    const value = parseInt(row.DT, 10);
    if (isNaN(value)) continue;

    if (!unsoldByRegionGuMonth[region]) unsoldByRegionGuMonth[region] = {};
    if (!unsoldByRegionGuMonth[region][gu]) unsoldByRegionGuMonth[region][gu] = {};
    unsoldByRegionGuMonth[region][gu][period] = value;
  }
  return unsoldByRegionGuMonth;
}

/**
 * KOSIS 응답 행 → 시군구별 미분양 집계 (최신 월만)
 * @param {KosisRow[]} rows
 * @returns {UnsoldByRegionGu}
 */
export function parseKosisRows(rows) {
  /** @type {UnsoldByRegionGu} */
  const unsoldByRegionGu = {};
  /** @type {Record<string, string>} */
  const latestPeriod = {};

  for (const row of rows) {
    const region = /** @type {Record<string, string>} */ (REGION_MAP)[row.C1_NM];
    if (!region) continue;

    const gu = row.C2_NM === "계" ? "_total" : row.C2_NM;
    const period = row.PRD_DE;
    const value = parseInt(row.DT, 10);
    if (isNaN(value)) continue;

    const key = `${region}::${gu}`;
    if (!latestPeriod[key] || period > latestPeriod[key]) {
      latestPeriod[key] = period;
      if (!unsoldByRegionGu[region]) unsoldByRegionGu[region] = {};
      unsoldByRegionGu[region][gu] = value;
    }
  }

  return unsoldByRegionGu;
}

/**
 * 시군구 미분양 맵 → 시도별 합계
 * @param {UnsoldByRegionGu} unsoldByRegionGu
 * @returns {RegionTotals}
 */
export function aggregateRegionTotals(unsoldByRegionGu) {
  /** @type {RegionTotals} */
  const regionTotals = {};
  for (const [region, guMap] of Object.entries(unsoldByRegionGu)) {
    if (guMap["소계"] != null) {
      regionTotals[region] = guMap["소계"];
    } else if (guMap["_total"] != null) {
      regionTotals[region] = guMap["_total"];
    } else {
      regionTotals[region] = Object.values(guMap).reduce((s, v) => s + v, 0);
    }
  }
  return regionTotals;
}

/**
 * 비례배분 미분양 추정
 * @param {number | null | undefined} guUnsold
 * @param {number | null | undefined} aptUnits
 * @param {number | null | undefined} totalUnitsInGu
 * @returns {{ estimated: number; unsoldRate: number } | null}
 */
export function calcProportionalUnsold(guUnsold, aptUnits, totalUnitsInGu) {
  if (!guUnsold || guUnsold <= 0 || !aptUnits || aptUnits <= 0 || !totalUnitsInGu || totalUnitsInGu <= 0) return null;
  const estimated = Math.round(guUnsold * (aptUnits / totalUnitsInGu));
  if (estimated <= 0) return null;
  const unsoldRate = Math.round(estimated / aptUnits * 1000) / 10;
  if (unsoldRate > 100) return null; // 비정상 값 방지
  return { estimated, unsoldRate };
}

/**
 * KOSIS 공식 미분양 비례배분을 **건너뛸지** 판정 (세션559 신설)
 *
 * ## 왜 함수로 뺐나
 * 옛 코드는 루프 안 인라인 조건 3줄이었고, 그중 두 줄이 **공식 통계를 막고 있었다**:
 *
 * ```js
 * // 옛 코드 — 주석에 '우선순위: 청약홈 > 네이버 > KOSIS' 라고 적혀 있었다
 * if (apt.unsold != null && apt.unsold > 0) continue;                      // 옛 매물값이 있으면 영영 못 덮음
 * if (apt.naver_sell_count != null && apt.naver_sell_count > 0) continue;  // 매물이 공식보다 우선
 * ```
 *
 * 매물이 하나라도 있는 단지는 **공식 통계를 영원히 못 받았다**. 실측(세션559):
 * 1,989곳 중 1,157곳(58%)의 `unsold` 가 `naver_sell_count` 와 동일했고,
 * 81곳은 미분양이 총세대수를 넘었다(세종더샵예미지 L4블록 = 1세대인데 18, 미분양률 최대 11,800%(익산 제일풍경채 어바니티 = 1세대에 118)).
 *
 * ## 지금 규칙 — 공식만 남긴다
 * · `naver_sell_count` 는 **판정에 쓰지 않는다** — 매물은 미분양이 아니다
 * · `unsold` 가 있어도 **총세대수를 넘으면 오염된 값**이므로 덮어쓴다
 * · 나머지 유효한 기존 값(청약홈 단지별 실측)은 존중한다 — 구 단위 비례배분보다 정확하다
 *
 * ⚠️ `units <= 1` 은 비례배분의 분모가 될 수 없어 제외한다(옛 조건 유지).
 *
 * ## ⚠️ 세션559 말미 정정 — 첫 판에 1,090곳이 영구 보존되고 있었다
 *
 * 처음엔 "총세대수를 넘는 것만 오염"으로 봤는데, **매물 유래 값은 대부분 세대수 이내**라
 * `unsold <= units` 조건에 걸려 **"유효한 기존 값"으로 분류돼 영원히 안 덮어써졌다.**
 * 적대검증이 실제로 돌려 확인: 매물 유래 의심 1,090곳 중 **1,090곳(100%)을 건너뛰었다.**
 * 그중 **196곳은 미분양률 15% 초과**로 안전 점수를 깎는 중이었다
 * (두산위브 트리니뷰 구명역: **31세대인데 미분양 30**(=매물 30건) = 96.8%).
 *
 * PR #547 본문에 "1,090곳은 KOSIS 가 다음 회차에 덮어쓴다"고 적은 것은 **사실이 아니었다.**
 *
 * ## 지금 규칙
 * · `naver_sell_count` 는 판정에 쓰지 않는다 — **단, 값이 정확히 같으면 매물 유래로 본다**(아래)
 * · `unsold > units` → 오염값, 덮어쓴다
 * · **`unsold === naver_sell_count` → 매물 유래, 덮어쓴다** (세션559 말미 추가)
 * · 나머지 유효한 기존 값(청약홈 단지별 실측)은 존중한다
 *
 * ⚠️ **우연 일치 위험**: `unsold` 가 1~3 처럼 작으면 진짜 미분양이 매물 수와 우연히 같을 수 있다
 * (실측 166곳). 그래도 덮어쓰는 쪽을 택한 이유 — KOSIS 공식 통계가 매물 수보다 정확하므로
 * 덮어써서 손해 볼 게 없다. 반대로 남겨 두면 매물 수가 미분양으로 계속 행세한다.
 *
 * @param {{ unsold: number | null; units: number | null; region: string | null; gu: string | null; naver_sell_count?: number | null }} apt
 * @returns {boolean} true 면 이 단지는 KOSIS 로 채우지 않는다
 */
export function shouldSkipKosisFill(apt) {
  if (!apt.region || !apt.gu || !apt.units || apt.units <= 1) return true;
  // ⚠️ `unsold === 0` 은 **"다 팔렸다"는 단지별 실측**이다 — 값 없음이 아니다(세션559 말미 정정).
  //    옛 코드는 `<= 0` 이라 완판 91곳을 구 단위 추정치로 덮어썼다. 그건 이 수집기가 내세운
  //    원칙("단지별 실측이 구 단위 비례배분보다 정확하다")과 정면으로 어긋난다.
  //    ⚠️ 다만 `hideNoUnsold`(기본 켜짐)가 `unsold > 0` 만 목록에 남기므로 이 113곳은
  //    손님 목록에 안 뜬다 — 그건 "미분양 단지 목록"이라는 화면 성격상 의도된 동작이다.
  if (apt.unsold == null) return false; // 진짜 값 없음 → 채운다
  if (apt.unsold === 0) return true;    // 완판 실측 → 존중
  // 총세대수를 넘는 미분양은 오염값이다 — 덮어쓴다(= 건너뛰지 않는다)
  if (apt.unsold > apt.units) return false;
  // 매물 수와 정확히 같으면 매물이 흘러든 것이다 — 덮어쓴다
  if (apt.naver_sell_count != null && apt.unsold === apt.naver_sell_count) return false;
  return true; // 그 밖의 유효한 기존 값(청약홈 실측)은 존중
}

// 세션 395: try/catch/finally 하드닝 — KOSIS 실패가 collector_runs 에 0행으로
// 남는 사각 정정 (PR #97 collect-regional-economy 패턴 답습).
export async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  let ok = 0;
  let errorMessage = /** @type {string | undefined} */ (undefined);
  try {
    if (!KOSIS_KEY) throw new Error("KOSIS_KEY not configured");

    const isInterrupted = setupGracefulShutdown(PHASE);  // 세션 321: graceful shutdown
    const sb = getSupabase();

    // 월간 데이터 조회 (DT_MLTM_2082 시군구별 미분양, 1~2개월 지연)
    const now = new Date();
    const endMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const startMonth = `${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, "0")}`;

    log(PHASE, `KOSIS 미분양 조회: ${startMonth} ~ ${endMonth}`);

    // KOSIS API 호출
    const params = new URLSearchParams({
      method: "getList",
      apiKey: KOSIS_KEY,
      orgId: "116",
      tblId: "DT_MLTM_2082",
      itmId: "ALL",
      objL1: "ALL",
      objL2: "ALL",
      prdSe: "M",
      startPrdDe: startMonth,
      endPrdDe: endMonth,
      format: "json",
      jsonVD: "Y",
    });

    // 세션118: raw https.request → fetchWithRetry (429/500/503 + ECONNRESET 지수 백오프 3회).
    // AbortSignal.timeout(30s)은 fetchWithRetry 내부에 포함. 에러 prefix `KOSIS ...` 유지.
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

    const unsoldByRegionGu = parseKosisRows(rows);
    const regionTotals = aggregateRegionTotals(unsoldByRegionGu);

    log(PHASE, `시도별 미분양: ${Object.entries(regionTotals).map(([r, v]) => `${r}=${v}`).join(", ")}`);

    // 1. regions 테이블 업데이트
    // 세션549: 무정렬 select 는 2,249행 표에서 1,000행만 매칭한다(unordered-pagination-loses-rows.md §1).
    // selectAll 은 조회 실패 시 throw 하므로, 기존 fail-open(로그만 남기고 계속) 의미를 try/catch 로 보존한다.
    /** @type {Array<{ id: string; region: string; gu: string | null; regional_unsold: number | null }> | null} */
    let regions = null;
    /** @type {{ message: string } | null} */
    let rErr = null;
    try {
      regions = /** @type {any} */ (
        await selectAll((s) => s.from("regions").select("id, region, gu, regional_unsold"), sb, "id")
      );
    } catch (e) {
      rErr = { message: e instanceof Error ? e.message : String(e) };
    }

    let regUpdated = 0;
    if (rErr) {
      logError(PHASE, `regions 조회 실패: ${rErr.message}`);
    } else {
      for (const reg of /** @type {Array<{ id: string; region: string; gu: string | null; regional_unsold: number | null }>} */ (regions)) {
        if (isInterrupted()) break;  // 세션 321: graceful shutdown
        const guMap = unsoldByRegionGu[reg.region];
        if (!guMap) continue;

        // 시군구 매칭 (gu가 있으면 시군구별, 없으면 시도별)
        /** @type {number | null} */
        let unsoldValue = null;
        if (reg.gu && guMap[reg.gu] != null) {
          unsoldValue = guMap[reg.gu];
        } else if (regionTotals[reg.region] != null) {
          unsoldValue = regionTotals[reg.region];
        }

        if (unsoldValue == null || unsoldValue === reg.regional_unsold) continue;

        if (dryRun) {
          log(PHASE, `  [DRY-RUN] regions ${reg.region} ${reg.gu || ""}: ${reg.regional_unsold} → ${unsoldValue}`);
          regUpdated++;
          continue;
        }

        const { error } = await sb.from("regions").update({
          regional_unsold: unsoldValue,
        }).eq("id", reg.id);

        if (error) logError(PHASE, `  regions ${reg.id} UPDATE 실패: ${error.message}`);
        else regUpdated++;
      }
      log(PHASE, `regions 갱신: ${regUpdated}건`);
    }

    // 2. apartments unsold 추정 (KOSIS 비례배분)
    // 세션549: 무정렬 select 는 3,068행 표에서 1,000행만 매칭한다(unordered-pagination-loses-rows.md §1).
    // 1,000행 컷은 (a) unitsByGu(비례배분 분모)를 1/3 표본으로 계산해 값을 왜곡하고,
    // (b) 1,000행 밖의 채움 대상·unsold_history 대상을 영영 못 건드린다.
    /** @typedef {{ id: string; name: string; region: string | null; gu: string | null; units: number | null; unsold: number | null; unsold_rate: number | null; naver_sell_count: number | null }} AptRow */
    /** @type {AptRow[]} */
    let apartmentsTyped;
    try {
      apartmentsTyped = /** @type {any} */ (
        await selectAll((s) => s.from("apartments").select("id, name, region, gu, units, unsold, unsold_rate, naver_sell_count"), sb, "id")
      );
    } catch (e) {
      logError(PHASE, `apartments 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    // 시군구별 총 분양세대수 계산
    /** @type {Record<string, number>} */
    const unitsByGu = {};
    for (const apt of apartmentsTyped) {
      if (!apt.region || !apt.gu || !apt.units) continue;
      const key = `${apt.region}::${apt.gu}`;
      unitsByGu[key] = (unitsByGu[key] || 0) + apt.units;
    }

    let aptUpdated = 0;
    for (const apt of apartmentsTyped) {
      if (shouldSkipKosisFill(apt)) continue;
      // 판정 함수가 이미 확인했지만 타입 검사기는 그 안을 모른다 — 인덱스로 쓰기 전에 좁힌다.
      // (cast 로 덮지 않는 이유: 판정 함수의 조건이 나중에 바뀌면 여기가 조용히 깨진다)
      const { region, gu } = apt;
      if (!region || !gu) continue;

      // 시군구별 미분양 총량 조회
      const guMap = unsoldByRegionGu[region];
      const guUnsold = guMap?.[gu] ?? regionTotals[region] ?? null;
      if (guUnsold == null || guUnsold <= 0) continue;

      // 비례배분
      const guKey = `${region}::${gu}`;
      const totalUnitsInGu = unitsByGu[guKey] || apt.units;
      const result = calcProportionalUnsold(guUnsold, apt.units, totalUnitsInGu);
      if (!result) continue;

      const { estimated, unsoldRate } = result;

      if (dryRun) {
        log(PHASE, `  [DRY-RUN] ${apt.name} (${apt.region} ${apt.gu}): unsold=${estimated}, rate=${unsoldRate}%`);
        aptUpdated++;
        continue;
      }

      const { error } = await sb.from("apartments").update({
        unsold: estimated,
        unsold_rate: unsoldRate,
        updated_at: new Date().toISOString(),
      }).eq("id", apt.id);

      if (error) logError(PHASE, `  ${apt.name} UPDATE 실패: ${error.message}`);
      else aptUpdated++;
    }

    log(PHASE, `apartments 미분양 추정 갱신: ${aptUpdated}건`);

    // 3. unsold_history 시계열 upsert (세션134, 방향 A)
    // KOSIS 단일 API 호출 응답(3개월 범위)을 재파싱하여 월별 시계열 저장.
    // API 재호출 아님 → 쿼터 증가 0.
    const allMonthsMap = parseKosisRowsAllMonths(rows);
    /** @type {Array<{ apartment_id: string; base_month: string; unsold_count: number; post_completion_unsold: number | null; change: number | null; recorded_at: string }>} */
    const historyRows = [];
    const todayDate = today(); // KST 고정 (루프 밖 1회 — 자정 경계 중복 0)
    for (const apt of apartmentsTyped) {
      if (!apt.region || !apt.gu || !apt.units || apt.units <= 1) continue;
      const monthMap = allMonthsMap[apt.region]?.[apt.gu];
      if (!monthMap) continue;
      const guKey = `${apt.region}::${apt.gu}`;
      const totalUnitsInGu = unitsByGu[guKey] || apt.units;
      for (const [period, guUnsold] of Object.entries(monthMap)) {
        const result = calcProportionalUnsold(guUnsold, apt.units, totalUnitsInGu);
        if (!result) continue;
        historyRows.push({
          apartment_id: apt.id,
          base_month: period,
          unsold_count: result.estimated,
          post_completion_unsold: null,
          change: null,
          recorded_at: todayDate,
        });
      }
    }

    if (dryRun) {
      log(PHASE, `[DRY-RUN] unsold_history: ${historyRows.length}건 예상`);
    } else if (historyRows.length > 0) {
      const inserted = await upsertBatch("unsold_history", historyRows, "apartment_id,base_month", 500, sb);
      log(PHASE, `unsold_history 저장: ${inserted}건`);
    } else {
      log(PHASE, "unsold_history 저장: 0건 (대상 없음)");
    }

    // 4. API 쿼터 기록 (KOSIS 단일 호출)
    if (!dryRun) await recordApiQuota(PHASE, "KOSIS_KEY", 1);
    ok = regUpdated + aptUpdated;

    log(PHASE, "\n=== 완료 ===");
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await recordCollectorRun(PHASE, errorMessage
      ? { ok, status: "failure", errorMessage }
      : { ok });
  }
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((/** @type {unknown} */ err) => {
  logError(PHASE, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
