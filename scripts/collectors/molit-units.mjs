/**
 * 국토부 공동주택 기본정보 → 총세대수(units) 보정 수집기
 *
 * API: 국토교통부 공동주택 서비스
 *   - AptListService3 (#15057332): 시도별 단지 목록 (kaptCode, kaptName)
 *   - AptBasisInfoServiceV4: 단지 기본 정보 (getAphusBassInfoV4 — kaptdaCnt = 세대수)
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
import { loadEnv, getSupabase, log, logError, sleep, recordApiQuota } from "./_shared.mjs";
import {
  SIDO_CODE, API_DETAIL_BASE, MIN_SIMILARITY, REQUEST_DELAY,
  molitApiCall, fetchSidoAptList, findBestMatch,
} from "./_molit-api.mjs";

loadEnv();

const PHASE = "molit-units";
const API_KEY = process.env.MOLIT_KEY;
if (!API_KEY) {
  logError(PHASE, "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)");
  process.exit(1);
}

// ── 1. Supabase에서 보정 대상 조회 ──────────────────────────
export async function getTargets(sb) {
  const { data, error } = await sb
    .from("apartments")
    .select("id, name, region, gu, address, units, unsold, unsold_rate, unit_source")
    .or("units.lte.1,unsold_rate.gte.100");

  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);
  return data ?? [];
}

// ── 2. 단지 기본 조회 (V4: getAphusBassInfoV4) ──────────────
export async function fetchAptDetail(kaptCode) {
  const json = await molitApiCall(PHASE, API_DETAIL_BASE, "getAphusBassInfoV4", { kaptCode }, API_KEY);
  const body = json?.response?.body;
  return body?.item ?? body?.items?.item ?? null;
}

// ── 3. 보정 적용 ────────────────────────────────────────────
export async function updateUnits(sb, aptId, newUnits, unsold, dryRun) {
  const unsoldRate = newUnits > 0 && unsold != null
    ? Math.round((unsold / newUnits) * 1000) / 10
    : null;

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

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();

  // 1. 보정 대상 조회
  const targets = await getTargets(sb);
  log(PHASE, `보정 대상: ${targets.length}건 (units≤1 또는 unsoldRate≥100%)`);

  if (!targets.length) {
    log(PHASE, "보정 대상 없음, 종료");
    return;
  }

  // 2. 시도별로 그룹핑 (API 호출 최소화 — V3는 시도 코드 기반)
  const groups = {};
  for (const t of targets) {
    const sidoCode = SIDO_CODE[t.region];
    if (!sidoCode) {
      logError(PHASE, `  ${t.name}: 시도코드 매핑 없음 (region=${t.region})`);
      continue;
    }
    if (!groups[t.region]) groups[t.region] = { sidoCode, targets: [] };
    groups[t.region].targets.push(t);
  }

  // 3. 시도별 API 조회 + 매칭
  let corrected = 0;
  let failed = 0;
  let skipped = 0;
  let apiCalls = 0;

  for (const [region, group] of Object.entries(groups)) {
    log(PHASE, `\n--- ${region} (${group.sidoCode}) ${group.targets.length}건 ---`);

    let aptList;
    try {
      aptList = await fetchSidoAptList(PHASE, group.sidoCode, API_KEY);
      apiCalls += Math.ceil(aptList.length / 500) || 1;
      log(PHASE, `  API 단지 목록: ${aptList.length}건`);
    } catch (err) {
      logError(PHASE, `  API 조회 실패: ${err.message}`);
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
      log(PHASE, `  [${target.id}] ${target.name}`);

      // 이름 매칭
      const match = findBestMatch(target.name, target.gu, aptList, {
        guField: "address", guBonus: 0.15, attachScore: true,
      });
      if (!match) {
        log(PHASE, `    → 매칭 실패 (유사도 < ${MIN_SIMILARITY})`);
        failed++;
        continue;
      }

      const kaptCode = match.kaptCode;
      log(PHASE, `    → 매칭: ${match.kaptName || match.as3} (code=${kaptCode}, 유사도=${match.matchScore})`);

      // 단지 상세 조회 → 세대수
      try {
        await sleep(REQUEST_DELAY);
        const detail = await fetchAptDetail(kaptCode);
        apiCalls++;
        if (!detail) {
          log(PHASE, `    → 상세 조회 실패`);
          failed++;
          continue;
        }

        const kaptdaCnt = parseInt(detail.kaptdaCnt || "0", 10);
        if (isNaN(kaptdaCnt) || kaptdaCnt <= 1) {
          log(PHASE, `    → 세대수 ${kaptdaCnt} (보정 불가)`);
          skipped++;
          continue;
        }

        log(PHASE, `    → 세대수: ${kaptdaCnt}`);

        // 보정 적용
        const ok = await updateUnits(sb, target.id, kaptdaCnt, target.unsold, dryRun);
        if (ok) corrected++;
        else failed++;

      } catch (err) {
        logError(PHASE, `    → 상세 조회 에러: ${err.message}`);
        failed++;
      }
    }
  }

  log(PHASE, `\n=== 완료 ===`);
  log(PHASE, `보정: ${corrected}건, 실패: ${failed}건, 건너뛰기: ${skipped}건, API: ${apiCalls}회`);

  if (!dryRun) await recordApiQuota("molit-units", "MOLIT_KEY", apiCalls);
  if (failed > 0) process.exit(1);
}

const isCLI = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isCLI) main().catch(err => {
  logError(PHASE, err.message);
  process.exit(1);
});
