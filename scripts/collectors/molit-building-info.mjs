// @ts-check
/**
 * 국토부 공동주택 기본정보 → 건물 상세 (주차, 최고층, 난방방식, 복도유형) 수집기
 *
 * API: 국토교통부 공동주택 서비스
 *   - AptListService3 (#15057332): 시도별 단지 목록
 *   - AptBasisInfoServiceV5: 단지 기본 정보 (getAphusBassInfoV5, 2026-08-19 data.go.kr
 *     인증체계 개편으로 V4에서 교체 — 필드명은 V4와 동일)
 *   - AptBasisInfoServiceV5: 단지 상세 정보 (getAphusDtlInfoV5) — 주차, 난방, 복도 등
 *
 * 세션 358 정정: energy_grade(kaptdEcnt=승강기대수 오인) + 건폐율/용적률(kaptdBcRat/
 * kaptdVlRat=응답에 없는 죽은 코드) 추출 제거. 건폐율/용적률은 네이버(sync-naver-complex)가 채움.
 *
 * 사용법:
 *   node scripts/collectors/molit-building-info.mjs              (Supabase UPDATE)
 *   node scripts/collectors/molit-building-info.mjs --dry-run    (미리보기만)
 *   node scripts/collectors/molit-building-info.mjs --force      (이미 데이터 있는 것도 재수집)
 *
 * 필요 환경변수:
 *   MOLIT_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, logError, sleep, recordApiQuota, recordCollectorRun, selectAll, setupGracefulShutdown } from "./_shared.mjs";
import {
  SIDO_CODE, API_DETAIL_BASE, REQUEST_DELAY,
  molitApiCall, fetchSidoAptList, findBestMatch,
} from "./_molit-api.mjs";

/**
 * @typedef {{ id: string; name: string; region: string | null; gu: string | null; address: string | null; parking_ratio: number | null; max_floor: number | null }} BuildingAptTarget
 * @typedef {Record<string, unknown>} BuildingDetail
 * @typedef {{ parking_ratio: number | null; max_floor: number | null; heating: string | null; corridor_type: string | null }} BuildingInfo
 */

loadEnv();

const PHASE = "molit-building";
const API_KEY = process.env.MOLIT_KEY;
if (!API_KEY) {
  logError(PHASE, "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)");
  process.exit(1);
}

// ── 단지 기본+상세 조회 (V4: 두 엔드포인트 병합) ─────────────
/**
 * @param {string} kaptCode
 * @returns {Promise<BuildingDetail | null>}
 */
export async function fetchAptDetail(kaptCode) {
  // 기본 정보 (세대수, 최고층 등)
  const bassJson = /** @type {{ response?: { body?: { item?: BuildingDetail; items?: { item?: BuildingDetail } } } }} */ (await molitApiCall(PHASE, API_DETAIL_BASE, "getAphusBassInfoV5", { kaptCode }, API_KEY || ""));
  const bassBody = bassJson?.response?.body;
  const bass = bassBody?.item ?? bassBody?.items?.item ?? null;

  await sleep(REQUEST_DELAY);

  // 상세 정보 (주차, 에너지, 구조 등)
  const dtlJson = /** @type {{ response?: { body?: { item?: BuildingDetail; items?: { item?: BuildingDetail } } } }} */ (await molitApiCall(PHASE, API_DETAIL_BASE, "getAphusDtlInfoV5", { kaptCode }, API_KEY || ""));
  const dtlBody = dtlJson?.response?.body;
  const dtl = dtlBody?.item ?? dtlBody?.items?.item ?? null;

  if (!bass && !dtl) return null;
  return { ...bass, ...dtl }; // 두 응답 병합
}

// ── 상세 필드 추출 (V4 응답 기준) ────────────────────────────
/**
 * @param {BuildingDetail} detail
 * @returns {BuildingInfo}
 */
export function extractBuildingInfo(detail) {
  /** @param {unknown} v */
  const safeInt = (v) => { const n = parseInt(String(v ?? ""), 10); return isNaN(n) ? null : n; };

  // 주차: V4에서 kaptdPcnt(지상) + kaptdPcntu(지하) 합산
  const groundParking = safeInt(detail.kaptdPcnt) || 0;
  const underParking = safeInt(detail.kaptdPcntu) || 0;
  const totalParking = groundParking + underParking;
  const totalHouseholds = safeInt(detail.kaptdaCnt);
  const parkingRatio = (totalParking > 0 && totalHouseholds && totalHouseholds > 0)
    ? Math.round((totalParking / totalHouseholds) * 100) / 100
    : null;

  // 에너지 효율 등급: 수집 안 함 (세션 358 정정).
  // kaptdEcnt/kaptdEcntp 는 에너지등급이 아니라 "승강기 대수(승용)" 필드 — raw API 실측
  // 결과 값 분포 0/5/8/21 = 등급(1~7) 불가. 주거용 아파트 에너지효율등급은 공공
  // data.go.kr API 미제공 (scripts/CLAUDE.md "BldEngyHubService 한계" 참조).

  // 최고층: V4에서 ktownFlrNo가 실제 최고층
  const highFloor = safeInt(detail.ktownFlrNo) || null;

  // 내진설계/녹색건축: V4 API에서 필드 제거됨 — 별도 추론(calc-quake-design)으로 처리

  // 난방방식: Bass에서 codeHeatNm (예: "개별난방", "지역난방", "중앙난방")
  const heating = /** @type {string | null} */ (detail.codeHeatNm ?? null) || null;

  // 복도유형: Bass에서 codeHallNm (예: "복도식", "계단식", "혼합식")
  const corridor_type = /** @type {string | null} */ (detail.codeHallNm ?? null) || null;

  // 건폐율/용적률: 수집 안 함 (세션 358 정정).
  // kaptdBcRat/kaptdVlRat 는 getAphus*InfoV4 응답에 존재하지 않아 항상 null = 죽은 코드였음
  // (raw API Bass 31개 키 전수 덤프로 확인). 실제 building_coverage_ratio/floor_area_ratio 는
  // 네이버(complexes 테이블) → sync-naver-complex.mjs L328-330/L363-364 가 채움.

  return {
    parking_ratio: parkingRatio,
    max_floor: highFloor,
    heating,
    corridor_type,
  };
}

// ── DB 업데이트 ─────────────────────────────────────────────
/**
 * @param {ReturnType<typeof getSupabase>} sb
 * @param {string} aptId
 * @param {BuildingInfo} info
 * @param {boolean} dryRun
 */
export async function updateBuilding(sb, aptId, info, dryRun) {
  // null 필드는 업데이트에서 제외 (기존 데이터 보존)
  /** @type {Record<string, unknown>} */
  const row = {};
  if (info.parking_ratio != null) row.parking_ratio = info.parking_ratio;
  if (info.max_floor != null) row.max_floor = info.max_floor;
  if (info.heating != null) row.heating = info.heating;
  if (info.corridor_type != null) row.corridor_type = info.corridor_type;

  if (Object.keys(row).length === 0) return false;

  row.updated_at = new Date().toISOString();

  if (dryRun) {
    log(PHASE, `  [DRY-RUN] ${aptId}: ${JSON.stringify(row)}`);
    return true;
  }

  const { error } = await sb.from("apartments").update(row).eq("id", aptId);
  if (error) {
    logError(PHASE, `  ${aptId} UPDATE 실패: ${error.message}`);
    return false;
  }
  return true;
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const isInterrupted = setupGracefulShutdown(PHASE);  // 세션 321: graceful shutdown
  const sb = getSupabase();

  // 1. 대상 아파트 조회 (건물 상세 미수집, selectAll: 1000행 제한 자동 페이지네이션)
  const data = /** @type {BuildingAptTarget[] | null} */ (await selectAll((s) => {
    let q = s.from("apartments")
      .select("id, name, region, gu, address, parking_ratio, max_floor");
    if (!force) {
      q = q.or("parking_ratio.is.null,max_floor.is.null");
    }
    return q;
  }, sb));
  const targets = data ?? [];
  log(PHASE, `대상: ${targets.length}건 ${force ? "(전체 재수집)" : "(상품성 필드 null 포함)"}`);

  if (!targets.length) { log(PHASE, "대상 없음, 종료"); return; }

  // 2. 지역별 그룹핑
  /** @type {Record<string, BuildingAptTarget[]>} */
  const regionGroups = {};
  for (const t of targets) {
    const r = t.region || "기타";
    if (!regionGroups[r]) regionGroups[r] = [];
    regionGroups[r].push(t);
  }

  let updated = 0, skipped = 0, failed = 0, apiCalls = 0;

  // 3. 지역별 API 호출 → 매칭 → 상세 조회
  for (const [region, regionTargets] of Object.entries(regionGroups)) {
    if (isInterrupted()) break;  // 세션 321: graceful shutdown (외부 region loop)
    const sidoCode = SIDO_CODE[region];
    if (!sidoCode) { log(PHASE, `  ${region}: 시도코드 매핑 없음, 건너뜀`); skipped += regionTargets.length; continue; }

    log(PHASE, `\n${region} (${sidoCode}): ${regionTargets.length}건`);

    let aptList;
    try {
      aptList = await fetchSidoAptList(PHASE, sidoCode, API_KEY || "");
      apiCalls += Math.ceil(aptList.length / 500) || 1; // 페이지네이션 횟수
      await sleep(REQUEST_DELAY);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `  목록 조회 실패: ${msg}`);
      failed += regionTargets.length;
      continue;
    }

    if (!aptList.length) {
      log(PHASE, `  API 목록 0건`);
      skipped += regionTargets.length;
      continue;
    }

    log(PHASE, `  API 목록: ${aptList.length}건`);

    for (const target of regionTargets) {
      if (isInterrupted()) break;  // 세션 321: graceful shutdown
      const match = findBestMatch(target.name, target.gu, aptList, {
        guField: "address", guBonus: 0.15, attachScore: false,
      });
      if (!match) {
        skipped++;
        continue;
      }

      const kaptCode = match.kaptCode;
      if (!kaptCode) { skipped++; continue; }

      try {
        await sleep(REQUEST_DELAY);
        const detail = await fetchAptDetail(kaptCode);
        apiCalls += 2; // Bass + Dtl 2개 엔드포인트
        if (!detail) { log(PHASE, `    ${target.name}: 상세 조회 실패`); failed++; continue; }

        const info = extractBuildingInfo(detail);
        log(PHASE, `    ${target.name}: parking=${info.parking_ratio}, floor=${info.max_floor}, heating=${info.heating}, corridor=${info.corridor_type}`);

        const ok = await updateBuilding(sb, target.id, info, dryRun);
        if (ok) updated++;
        else skipped++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(PHASE, `    ${target.name}: ${msg}`);
        failed++;
      }
    }
  }

  log(PHASE, `\n=== 완료 ===`);
  log(PHASE, `갱신: ${updated}, 건너뜀: ${skipped}, 실패: ${failed}, API: ${apiCalls}회`);

  if (!dryRun) await recordApiQuota("molit-building-info", "MOLIT_KEY", apiCalls);
  await recordCollectorRun(PHASE, { ok: updated, skip: skipped, fail: failed });
  if (failed > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });
