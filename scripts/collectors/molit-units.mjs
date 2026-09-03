// @ts-check
/**
 * 국토부 공동주택 기본정보 → 총세대수(units) 보정 수집기
 *
 * API: 국토교통부 공동주택 서비스
 *   - AptListService3 (#15057332): 시도별 단지 목록 (kaptCode, kaptName)
 *   - AptBasisInfoServiceV5: 단지 기본 정보 (getAphusBassInfoV5 — kaptdaCnt = 세대수,
 *     2026-08-19 data.go.kr 인증체계 개편으로 V4에서 교체, 필드명 동일 유지)
 *
 * 사용법:
 *   node scripts/collectors/molit-units.mjs              (Supabase apartments 직접 UPDATE)
 *   node scripts/collectors/molit-units.mjs --dry-run     (미리보기만)
 *
 * 필요 환경변수:
 *   MOLIT_KEY            — data.go.kr 인증키
 *   SUPABASE_URL         — Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_KEY — Supabase service_role 키
 */
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { loadEnv, getSupabase, log, logError, sleep, recordApiQuota, recordCollectorRun, selectAll, setupGracefulShutdown, today, clampUnsoldRate } from "./_shared.mjs";
import {
  SIDO_CODE, API_DETAIL_BASE, MIN_SIMILARITY, REQUEST_DELAY,
  molitApiCall, fetchSidoAptList, findBestMatch,
} from "./_molit-api.mjs";

/** @typedef {import("@supabase/supabase-js").SupabaseClient} SupabaseClient */
/** @typedef {{ id: string; name: string; region: string; gu: string | null; address: string | null; units: number | null; unsold: number | null; unsold_rate: number | null; unit_source: string | null }} TargetApt */
/** @typedef {{ id: string; name: string; region: string; gu: string | null; reason: string }} UnmatchedEntry */

loadEnv();

const PHASE = "molit-units";
const API_KEY = process.env.MOLIT_KEY;
if (!API_KEY) {
  logError(PHASE, "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)");
  process.exit(1);
}
/** @type {string} */
const API_KEY_SAFE = API_KEY;

// ── 1. Supabase에서 보정 대상 조회 ──────────────────────────
/**
 * @param {SupabaseClient} sb
 * @returns {Promise<TargetApt[]>}
 */
export async function getTargets(sb) {
  // selectAll: 1000행 제한 자동 페이지네이션
  const data = await selectAll(
    (s) => s.from("apartments")
      .select("id, name, region, gu, address, units, unsold, unsold_rate, unit_source")
      .or("units.lte.1,unsold_rate.gte.100"),
    sb
  );
  return /** @type {TargetApt[]} */ (data ?? []);
}

// ── 2. 단지 기본 조회 (V5: getAphusBassInfoV5, 2026-08-19 개편으로 V4에서 교체) ──
/**
 * @param {string} kaptCode
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function fetchAptDetail(kaptCode) {
  const json = await molitApiCall(PHASE, API_DETAIL_BASE, "getAphusBassInfoV5", { kaptCode }, API_KEY_SAFE);
  const body = /** @type {{ item?: Record<string, unknown>; items?: { item?: Record<string, unknown> } } | undefined} */ (json?.response?.body);
  return body?.item ?? body?.items?.item ?? null;
}

/**
 * 단지 상세에서 보정용 세대수를 결정한다. kaptdaCnt(공동주택 세대수) 우선,
 * 0/누락이면 hoCnt(호수)로 폴백 — 임의공급·계약취소·블록 단위 등 특수 물량은
 * kaptdaCnt=0 으로 응답하나 hoCnt 는 채워져 있다. kaptdaCnt>1 인 정상 단지는
 * hoCnt 와 동일(실측 4/4)이라 폴백이 회귀를 만들지 않는다 (세션 444).
 * @param {Record<string, unknown> | null | undefined} detail
 * @returns {{ units: number, field: string }} units<=1 이면 보정 불가
 */
export function resolveUnits(detail) {
  const kaptdaCnt = parseInt(String(detail?.kaptdaCnt ?? "0"), 10);
  const hoCnt = parseInt(String(detail?.hoCnt ?? "0"), 10);
  const validKaptda = !isNaN(kaptdaCnt) && kaptdaCnt > 1;
  const validHo = !isNaN(hoCnt) && hoCnt > 1;
  if (validKaptda) return { units: kaptdaCnt, field: "kaptdaCnt" };
  if (validHo) return { units: hoCnt, field: "hoCnt(폴백)" };
  return { units: 0, field: `kaptdaCnt=${kaptdaCnt} hoCnt=${hoCnt}` };
}

// ── 3. 보정 적용 ────────────────────────────────────────────
/**
 * @param {SupabaseClient} sb
 * @param {string} aptId
 * @param {number} newUnits
 * @param {number | null | undefined} unsold
 * @param {boolean} dryRun
 * @returns {Promise<boolean>}
 */
export async function updateUnits(sb, aptId, newUnits, unsold, dryRun) {
  // 세션539 F-2: 형제 writer(collect-data·sync-naver-complex·applyhome-seed 는 clampUnsoldRate,
  // collect-unsold-kosis 는 calcProportionalUnsold 내부에 같은 >100→null 방어)는 전부 갖고
  // 있는데 이 수집기만 없었다. 하물며 이 수집기의 **대상 자체가**
  // `unsold_rate>=100`(위 SELECT `.or("units.lte.1,unsold_rate.gte.100")`)인 망가진 행이라,
  // 매칭 실패나 이번 회차 데이터가 다시 폭발값을 주면 자기가 그 폭발값을 재기입하는 자리다.
  const unsoldRate = clampUnsoldRate(
    newUnits > 0 && unsold != null ? Math.round((unsold / newUnits) * 1000) / 10 : null,
  );

  if (dryRun) {
    log(PHASE, `  [DRY-RUN] ${aptId}: units=${newUnits}, unsoldRate=${unsoldRate}%`);
    return true;
  }

  const { error } = await sb
    .from("apartments")
    .update({
      units: newUnits,
      unsold_rate: unsoldRate,
      unit_source: "molit",
      updated_at: new Date().toISOString(),
    })
    .eq("id", aptId);

  if (error) {
    logError(PHASE, `  ${aptId} UPDATE 실패: ${error.message}`);
    return false;
  }
  return true;
}

// ── 4. 미매칭 목록 파일 기록 ────────────────────────────────
// 왜 파일인가: "국토부 목록에서 이름을 못 찾은 단지" 는 콘솔에만 찍히면 다음 실행의
// 로그 마커 사이에 묻히고, collector_runs 에도 unmatched 가 안 들어가 며칠 뒤엔 "몇 건이
// 왜 안 붙었나" 를 되짚을 근거가 0 이었다 (세션 495). 날짜별 파일로 남겨 다음 세션이
// 직접 읽게 한다. ⚠️ 세션519 정정 — "run-naver-local.bat 이 stdout 을 어디에도 안 남긴다"는
// 옛 전제는 세션518(PR #412)이 그 배치의 각 단계 출력을 naver-collect.log 로 리다이렉트하며
// 깨졌다. 이 파일이 별도 산출물을 남기는 이유는 이제 "stdout 자체가 사라짐"이 아니라
// "콘솔 로그는 단지별 unmatched 상세를 파싱하기엔 구조화가 안 돼 있음"이다.
const DEFAULT_UNMATCHED_LOG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "logs");

/**
 * @param {string} dir
 * @param {string} [date] KST YYYY-MM-DD (기본 today())
 * @returns {string}
 */
export function unmatchedLogPath(dir, date = today()) {
  return resolve(dir, `molit-units-unmatched-${date}.json`);
}

/**
 * 미매칭 목록을 JSON 파일로 저장한다. 빈 목록이면 파일을 만들지 않고 null.
 * 기록 실패는 수집을 막지 않는다(로그만) — 진단 부산물이 본체를 죽이면 안 됨.
 * @param {UnmatchedEntry[]} entries
 * @param {string} [dir]
 * @param {string} [date]
 * @returns {string | null} 기록한 파일 경로 (미기록 시 null)
 */
export function writeUnmatchedLog(entries, dir = DEFAULT_UNMATCHED_LOG_DIR, date = today()) {
  if (!entries.length) return null;
  const filePath = unmatchedLogPath(dir, date);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify({ collector: PHASE, date, count: entries.length, entries }, null, 2),
      "utf8",
    );
    return filePath;
  } catch (err) {
    logError(PHASE, `미매칭 목록 기록 실패(무시): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const isInterrupted = setupGracefulShutdown(PHASE);  // 세션 344: graceful shutdown

  // 1. 보정 대상 조회
  const targets = await getTargets(sb);
  log(PHASE, `보정 대상: ${targets.length}건 (units≤1 또는 unsoldRate≥100%)`);

  if (!targets.length) {
    log(PHASE, "보정 대상 없음, 종료");
    return;
  }

  // 2. 시도별로 그룹핑 (API 호출 최소화 — V3는 시도 코드 기반)
  /** @type {Record<string, { sidoCode: string; targets: TargetApt[] }>} */
  const groups = {};
  for (const t of targets) {
    const sidoCode = /** @type {Record<string, string>} */ (SIDO_CODE)[t.region];
    if (!sidoCode) {
      logError(PHASE, `  ${t.name}: 시도코드 매핑 없음 (region=${t.region})`);
      continue;
    }
    if (!groups[t.region]) groups[t.region] = { sidoCode, targets: [] };
    groups[t.region].targets.push(t);
  }

  // 3. 시도별 API 조회 + 매칭
  let corrected = 0;
  let failed = 0;      // 진짜 장애 (API/DB 에러) — exit code 결정
  let unmatched = 0;   // 이름 매칭/데이터 부재 — 정상 범주
  let skipped = 0;
  let apiCalls = 0;
  /** @type {UnmatchedEntry[]} 미매칭 단지 목록 — 파일로 남겨 사후 추적 가능하게 (세션 495) */
  const unmatchedList = [];

  for (const [region, group] of Object.entries(groups)) {
    if (isInterrupted()) break;  // 세션 344: graceful shutdown (외부 region loop)
    log(PHASE, `\n--- ${region} (${group.sidoCode}) ${group.targets.length}건 ---`);

    /** @type {Array<Record<string, unknown>>} */
    let aptList;
    try {
      aptList = await fetchSidoAptList(PHASE, group.sidoCode, API_KEY_SAFE);
      apiCalls += Math.ceil(aptList.length / 500) || 1;
      log(PHASE, `  API 단지 목록: ${aptList.length}건`);
    } catch (err) {
      logError(PHASE, `  API 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
      failed += group.targets.length;
      continue;
    }

    if (!aptList.length) {
      log(PHASE, `  단지 목록 없음, 건너뛰기`);
      skipped += group.targets.length;
      continue;
    }

    await sleep(REQUEST_DELAY);

    for (const target of group.targets) {
      if (isInterrupted()) break;  // 세션 344: graceful shutdown (내부 target loop)
      log(PHASE, `  [${target.id}] ${target.name}`);

      // 이름 매칭
      const match = findBestMatch(target.name, target.gu, aptList, {
        guField: "address", guBonus: 0.15, attachScore: true,
      });
      if (!match) {
        log(PHASE, `    → 매칭 실패 (유사도 < ${MIN_SIMILARITY})`);
        unmatched++;
        unmatchedList.push({
          id: target.id, name: target.name, region: target.region, gu: target.gu,
          reason: `이름 매칭 실패 (유사도 < ${MIN_SIMILARITY})`,
        });
        continue;
      }

      const kaptCode = /** @type {string} */ (match.kaptCode);
      log(PHASE, `    → 매칭: ${match.kaptName || match.as3} (code=${kaptCode}, 유사도=${match.matchScore})`);

      // 단지 상세 조회 → 세대수
      try {
        await sleep(REQUEST_DELAY);
        const detail = await fetchAptDetail(kaptCode);
        apiCalls++;
        if (!detail) {
          log(PHASE, `    → 상세 조회 실패`);
          unmatched++;
          unmatchedList.push({
            id: target.id, name: target.name, region: target.region, gu: target.gu,
            reason: `상세 조회 실패 (kaptCode=${kaptCode})`,
          });
          continue;
        }

        // 세대수: kaptdaCnt(공동주택 세대수) 우선, 0/누락이면 hoCnt(호수)로 폴백.
        const { units: newUnits, field: usedField } = resolveUnits(detail);
        if (newUnits <= 1) {
          log(PHASE, `    → 세대수 보정 불가 (${usedField})`);
          skipped++;
          continue;
        }

        log(PHASE, `    → 세대수: ${newUnits} (${usedField})`);

        // 보정 적용
        const ok = await updateUnits(sb, target.id, newUnits, target.unsold, dryRun);
        if (ok) corrected++;
        else failed++;

      } catch (err) {
        logError(PHASE, `    → 상세 조회 에러: ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      }
    }
  }

  log(PHASE, `\n=== 완료 ===`);
  log(PHASE, `보정: ${corrected}건, 미매칭: ${unmatched}건, 장애: ${failed}건, 건너뛰기: ${skipped}건, API: ${apiCalls}회`);

  const unmatchedLog = writeUnmatchedLog(unmatchedList);
  if (unmatchedLog) log(PHASE, `미매칭 ${unmatchedList.length}건 목록 저장: ${unmatchedLog}`);

  if (!dryRun) await recordApiQuota("molit-units", "MOLIT_KEY", apiCalls);
  // unmatched 를 skip 에 합산한다. collector_runs 는 ok/fail/skip 3칸뿐이라 별도 칸이 없고,
  // "이름을 못 찾음"·"세대수 못 씀" 은 둘 다 장애가 아닌 건너뜀이라 같은 칸이 맞다.
  // 합산 전에는 미매칭이 어느 칸에도 안 들어가 ok=0·skip=0 인 실행이 monitor ② 에 "성공인데
  // 처리 0건" 으로 잡히거나, 반대로 수백 건이 조용히 증발해도 기록만 보면 멀쩡해 보였다 (세션 495).
  await recordCollectorRun(PHASE, { ok: corrected, skip: skipped + unmatched, fail: failed });
  if (failed > 0) process.exit(1);   // 진짜 장애만 — 미매칭은 정상 종료
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((/** @type {unknown} */ err) => {
  logError(PHASE, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
