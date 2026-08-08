// @ts-check
/**
 * 주택건설 인허가실적 → 시도별 공급비율(regions.supply_ratio) 수집
 *
 * 출처: KOSIS 국가통계포털 `DT_MLTM_666` (지역별 주택건설 인허가실적, orgId 116)
 *   - 시도 17개 × 연간(1990~2025), 단위 "호", **호출 1회**로 전 시도 확보
 *   - 차원은 교차 cells (C1_NM 이 실제 시도명) — 분리 group 아님
 *
 * ⚠️ 세션 501: 옛 출처였던 국토부 `ArchPmsService_v2/getApHsptPrmsnLst` 는 **폐기**됐다.
 *    raw 실측 = HTTP 400 + `NO_OPENAPI_SERVICE_ERROR`(returnReasonCode 12, "해당 오픈API
 *    서비스가 없거나 폐기됨"). BACKLOG 가 세 세션째 "HTTP 500 = 서버 사고 → 복구 대기" 로
 *    적어두고 재발화를 반복했지만, 500(일시 장애)이 아니라 **서비스 소멸**이라 기다려도 오지 않는다.
 *
 *    후속 `ArchPmsHubService`(카탈로그 15136267)는 살아 있으나 `getApHsTpInfo` 가
 *    `sigunguCd`+`bjdongCd` **둘 다 필수**인 법정동 단위라 시도 집계에 쓸 수 없다
 *    (전국 법정동 전수 = 일 10,000회 쿼터 초과). 그래서 KOSIS 로 갈아탔다.
 *
 * ⚠️ kosis.kr 은 해외 클라우드 IP(GitHub 러너)를 차단한다 → **로컬 러너 전용**.
 *    `kosis-local-runner.mjs` DAY_TABLE 에 등록돼 매월 11일 05:30 KST 에 실행된다.
 *    GitHub 워크플로(`collect-housing-permits.yml`)는 세션 501 에서 삭제했다.
 *
 * 사용법:
 *   node scripts/collectors/housing-permits.mjs           (Supabase regions 업데이트)
 *   node scripts/collectors/housing-permits.mjs --dry-run (미리보기만)
 *
 * 필요 환경변수:
 *   KOSIS_KEY            — KOSIS 오픈API 인증키
 *   SUPABASE_URL         — Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_KEY — Supabase service_role 키
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, REGION_MAP, today, recordApiQuota, recordCollectorRun, setupGracefulShutdown } from "./_shared.mjs";

loadEnv();

const PHASE = "housing-permits";
const KOSIS_KEY = process.env.KOSIS_KEY;

const ORG_ID = "116";
const TBL_ID = "DT_MLTM_666";

/**
 * KOSIS 응답의 C1_NM 에 시도와 함께 섞여 오는 집계·메타 행.
 * 이걸 시도로 착각하면 "실적"(전국 합계 약 38만 호)이 한 시도로 잡혀 공급비율이 통째로 틀어진다.
 *
 * ⚠️ 정직하게 적어둔다 — **지금은 이중 방어다.** `resolveRegion` 이 이 이름들을 이미 `null` 로
 * 떨어뜨려서, 이 Set 을 지워도 현재 테스트는 전부 통과한다(세션 501 뮤테이션으로 확인).
 * 그래도 남겨두는 이유는 그 통과가 **`REGION_MAP` 의 현재 내용에 우연히 기대고 있기 때문**이다.
 * REGION_MAP 에 항목이 추가돼 부분 매칭이 집계행을 물면 조용히 새는데, 그때 이 Set 이 막는다.
 */
const AGGREGATE_ROWS = new Set(["전국", "실적", "계획", "수도권", "지방"]);

/**
 * @typedef {{ C1_NM?: string; ITM_NM?: string; PRD_DE?: string; DT?: string; UNIT_NM?: string }} KosisRow
 * @typedef {{ units: number; year: string }} PermitSummary
 */

// ── 시도명 역매핑 ────────────────────────────────────────
/**
 * @param {string | null | undefined} fullName
 * @returns {string | null}
 */
export function resolveRegion(fullName) {
  if (!fullName) return null;
  if (REGION_MAP[fullName]) return REGION_MAP[fullName] || null;
  for (const [k, v] of Object.entries(REGION_MAP)) {
    if (fullName.includes(v) || k.includes(fullName)) return v;
  }
  return null;
}

// ── KOSIS 응답 → 시도별 최신 연도 인허가 호수 ─────────────
/**
 * 같은 시도에 여러 연도가 오므로 **가장 최근 연도**만 남긴다.
 * 집계행(전국·수도권 등)은 시도가 아니므로 버린다.
 *
 * @param {KosisRow[]} rows
 * @returns {Record<string, PermitSummary>} region 약칭 → { units, year }
 */
export function parseKosisPermits(rows) {
  /** @type {Record<string, PermitSummary>} */
  const byRegion = {};
  for (const row of rows) {
    const name = row.C1_NM;
    if (!name || AGGREGATE_ROWS.has(name)) continue;
    const region = resolveRegion(name);
    if (!region) continue;

    const year = row.PRD_DE;
    if (!year) continue;
    const units = parseInt(String(row.DT ?? "").replace(/,/g, ""), 10);
    if (!Number.isFinite(units) || units <= 0) continue;

    const prev = byRegion[region];
    if (!prev || year > prev.year) byRegion[region] = { units, year };
  }
  return byRegion;
}

// ── 시도별 최신 스냅샷 id 추출 ────────────────────────────
/**
 * regions 는 region 당 여러 recorded_at 시계열 스냅샷을 가지며 PK 는 id.
 * PostgREST PATCH 는 order/limit 을 무시하므로 (`.eq("region").is("gu", null).order().limit(1)`
 * 은 같은 시도의 모든 스냅샷을 덮어쓰는 버그 — childcare-info PR #76 과 동종) supply_ratio 를
 * "최신 1건만" 갱신하려면 메모리에서 최신행 id 를 추려 `.eq("id", ...)` 로 좁혀야 한다.
 * housing-permits 는 시도행(gu null)만 갱신하므로 키 = region 하나로 자족.
 * @param {Array<{id: number, region: string, recorded_at: string}>} sidoRows  gu IS NULL 행만 전달
 * @returns {Map<string, number>}  region → 최신 스냅샷 id
 */
export function pickLatestRegionId(sidoRows) {
  /** @type {Map<string, {id: number, recorded_at: string}>} */
  const latest = new Map();
  for (const r of sidoRows) {
    if (!r.region) continue;
    const prev = latest.get(r.region);
    if (!prev || r.recorded_at > prev.recorded_at) {
      latest.set(r.region, { id: r.id, recorded_at: r.recorded_at });
    }
  }
  /** @type {Map<string, number>} */
  const idMap = new Map();
  for (const [region, { id }] of latest) idMap.set(region, id);
  return idMap;
}

// ── 메인 ─────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const isInterrupted = setupGracefulShutdown(PHASE);

  let ok = 0;
  let skipped = 0;
  let errorMessage = /** @type {string | undefined} */ (undefined);
  let apiCalls = 0;

  try {
    if (!KOSIS_KEY) throw new Error("KOSIS_KEY 환경변수 필요 (KOSIS 오픈API 인증키)");

    const now = new Date();
    const endYear = String(now.getFullYear());
    const startYear = String(now.getFullYear() - 3);
    log(PHASE, `KOSIS 주택건설 인허가실적 조회: ${startYear} ~ ${endYear}`);

    // 1. KOSIS 호출 (1회로 전 시도 × 4년)
    //    ⚠️ objL2/objL3 를 넘기면 err 21 — 이 통계표는 분류 차원이 시도(objL1) 하나뿐이다.
    const params = new URLSearchParams({
      method: "getList",
      apiKey: KOSIS_KEY,
      orgId: ORG_ID,
      tblId: TBL_ID,
      itmId: "ALL",
      objL1: "ALL",
      prdSe: "A",
      startPrdDe: startYear,
      endPrdDe: endYear,
      format: "json",
      jsonVD: "Y",
    });

    let data;
    try {
      const res = await fetchWithRetry(`https://kosis.kr/openapi/Param/statisticsParameterData.do?${params}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      apiCalls++;
      try {
        data = await res.json();
      } catch {
        throw new Error("JSON 파싱 실패");
      }
    } catch (err) {
      throw new Error(`KOSIS ${err instanceof Error ? err.message : String(err)}`);
    }
    if (data && data.err) throw new Error(`KOSIS 에러: ${data.errMsg || data.err}`);

    const rows = Array.isArray(data) ? data : [];
    log(PHASE, `KOSIS 응답: ${rows.length}건`);
    if (rows.length === 0) {
      log(PHASE, "데이터 없음 — 종료");
      return;
    }

    const permitsByRegion = parseKosisPermits(rows);
    const regionCount = Object.keys(permitsByRegion).length;
    log(PHASE, `시도 파싱: ${regionCount}건`);
    if (regionCount === 0) {
      throw new Error("시도 매칭 0건 — KOSIS 응답 형식 변경 의심 (C1_NM 확인 필요)");
    }

    // 2. regions 에서 가구 수 + 최신 스냅샷 id
    const sb = getSupabase();
    const { data: regionData, error: rErr } = await sb
      .from("regions")
      .select("id, region, households, population, recorded_at")
      .is("gu", null)
      .order("recorded_at", { ascending: false });
    if (rErr) throw new Error(`regions 조회 실패: ${rErr.message}`);

    const sidoRows = /** @type {Array<{ id: number; region: string; households: number | null; population: number | null; recorded_at: string }>} */ (regionData);

    // 시도별 최신 가구 수 (정렬이 recorded_at DESC 라 첫 등장이 최신)
    /** @type {Record<string, number>} */
    const householdMap = {};
    for (const r of sidoRows) {
      if (householdMap[r.region] === undefined) {
        householdMap[r.region] = r.households || r.population || 0; // 가구수 없으면 인구수 사용
      }
    }
    const latestIdMap = pickLatestRegionId(sidoRows);

    // 3. supply_ratio 계산
    /** @type {Array<{ region: string; supply_ratio: number | null; units: number; year: string }>} */
    const calcRows = [];
    for (const [region, { units, year }] of Object.entries(permitsByRegion)) {
      const base = householdMap[region];
      /** @type {number | null} */
      let supplyRatio = null;
      if (base && base > 0 && units > 0) {
        supplyRatio = Math.round((units / base) * 100 * 100) / 100; // 소수점 2자리 (값이 1% 내외라 1자리면 뭉갠다)
      }
      calcRows.push({ region, supply_ratio: supplyRatio, units, year });
    }

    const withRatio = calcRows.filter(r => r.supply_ratio != null);
    const avgRatio = withRatio.length > 0
      ? (withRatio.reduce((s, r) => s + (r.supply_ratio || 0), 0) / withRatio.length).toFixed(2)
      : "N/A";
    log(PHASE, `공급비율 산출: ${withRatio.length}건, 평균 ${avgRatio}%`);

    if (dryRun) {
      log(PHASE, "미리보기 모드 — 업데이트 생략");
      console.log("\n시도별 주택건설 인허가실적:");
      for (const r of [...calcRows].sort((a, b) => (b.supply_ratio ?? 0) - (a.supply_ratio ?? 0))) {
        console.log(`  ${r.region}: ${r.year}년 ${r.units.toLocaleString()}호, 공급비율=${r.supply_ratio ?? "N/A"}%`);
      }
      return;
    }

    // 4. Supabase 업데이트 (시도별 최신 스냅샷 1행만)
    for (const r of calcRows) {
      if (isInterrupted()) break;
      if (r.supply_ratio == null) { skipped++; continue; }
      const latestId = latestIdMap.get(r.region);
      if (latestId === undefined) {
        // regions 에 해당 시도행 자체가 없음 (집계 collector 미수집) — 새 행 생성은 본 collector 책임 아님
        skipped++;
        continue;
      }
      const { error } = await sb.from("regions").update({ supply_ratio: r.supply_ratio }).eq("id", latestId);
      if (error) logError(PHASE, `${r.region}: ${error.message}`);
      else ok++;
    }
    if (skipped > 0) log(PHASE, `${skipped}개 시도 건너뜀 (regions 행 부재 또는 계산 불가)`);
    log(PHASE, `regions.supply_ratio ${ok}건 업데이트 완료 (${today()})`);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    logError(PHASE, errorMessage);
  } finally {
    // 세션 395 하드닝 답습: 실패 경로도 collector_runs 에 남겨 monitor 사각을 없앤다.
    if (!dryRun) {
      if (apiCalls > 0) await recordApiQuota(PHASE, "KOSIS_KEY", apiCalls);
      await recordCollectorRun(PHASE, {
        ok,
        fail: errorMessage ? 1 : 0,
        skip: skipped,
        status: errorMessage ? "failure" : "success",
        errorMessage,
      });
    }
  }
  if (errorMessage) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });
