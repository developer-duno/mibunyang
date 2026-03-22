/**
 * 서버 사전 스코어링 — 모든 아파트의 6개 카테고리 점수를 사전 계산하여 cats_cache에 저장
 *
 * 실행:
 *   node --loader ./scripts/alias-loader.mjs scripts/compute-scores.mjs
 *   node --loader ./scripts/alias-loader.mjs scripts/compute-scores.mjs --dry-run
 *
 * 효과:
 *   프론트엔드 calcCats() 355,440 ops → 0 ops (서버 캐시 사용)
 */
import { loadEnv, getSupabase, upsertBatch, log, logError, createReporter } from "./collectors/_shared.mjs";
import { computeRegionalMedians, calcCats } from "@/scoring/engine";

// ── 설정 ─────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 1000;

// ── cats_cache 검증 ──────────────────────────────────────────
const REQUIRED_KEYS = ["price", "location", "product", "benefit", "risk", "future"];

function validateCats(cats) {
  return REQUIRED_KEYS.every(k =>
    cats[k] &&
    typeof cats[k].total === "number" &&
    !Number.isNaN(cats[k].total) &&
    Array.isArray(cats[k].subs) &&
    typeof cats[k].label === "string"
  );
}

// ── JSON 안전 직렬화 (NaN/Infinity → null) ────────────────────
function safeJsonReplacer(key, value) {
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  loadEnv();
  const sb = getSupabase();
  const reporter = createReporter("compute-scores");

  // 1) 전체 아파트 로드 (apartments_flat VIEW)
  log("compute-scores", "아파트 데이터 로드 중...");
  const allApartments = [];
  let offset = 0;

  while (true) {
    const { data, error } = await sb
      .from("apartments_flat")
      .select("*")
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      logError("compute-scores", `데이터 로드 실패: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allApartments.push(...data);
    if (data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  if (allApartments.length === 0) {
    log("compute-scores", "아파트 데이터 없음 — 종료");
    process.exit(0);
  }

  log("compute-scores", `${allApartments.length}건 로드 완료`);

  // 2) 지역 중앙값 계산
  const regionMedians = computeRegionalMedians(allApartments);
  const ctx = { regionMedians };

  // 3) 각 아파트별 6개 카테고리 스코어링
  log("compute-scores", "스코어링 시작...");
  const rows = [];
  let skipCount = 0;

  for (const apt of allApartments) {
    try {
      const cats = calcCats(apt, ctx);

      if (!validateCats(cats)) {
        logError("compute-scores", `검증 실패 (id=${apt.id}, name=${apt.name}) — 스킵`);
        reporter.fail();
        skipCount++;
        continue;
      }

      rows.push({
        id: apt.id,
        cats_cache: JSON.parse(JSON.stringify(cats, safeJsonReplacer)),
      });
      reporter.success();
    } catch (err) {
      logError("compute-scores", `스코어링 실패 (id=${apt.id}): ${err.message}`);
      reporter.fail();
      skipCount++;
    }
  }

  log("compute-scores", `스코어링 완료: ${rows.length}건 성공, ${skipCount}건 스킵`);

  // 4) DB 업서트
  if (DRY_RUN) {
    log("compute-scores", `[DRY-RUN] ${rows.length}건 계산 완료 — DB 미반영`);
    // 샘플 출력
    if (rows.length > 0) {
      const sample = rows[0];
      log("compute-scores", `  샘플 (${sample.id}):`);
      for (const k of REQUIRED_KEYS) {
        log("compute-scores", `    ${k}: ${sample.cats_cache[k]?.total ?? "N/A"}`);
      }
    }
  } else {
    log("compute-scores", `${rows.length}건 DB 업서트 중...`);
    const inserted = await upsertBatch("apartments", rows, "id", 500, sb);
    log("compute-scores", `DB 업서트 완료: ${inserted}/${rows.length}건`);
  }

  reporter.summary();
}

main().catch(err => {
  logError("compute-scores", err.message);
  process.exit(1);
});
