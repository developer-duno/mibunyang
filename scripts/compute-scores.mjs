// @ts-check
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
import { loadEnv, getSupabase, upsertBatch, log, logError, createReporter, recordCollectorRun } from "./collectors/_shared.mjs";
import { computeRegionalMedians, calcCats } from "@/scoring/engine";

// ── 설정 ─────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 1000;
/** collector_runs 기록명 — monitor ⑤ 라벨 드리프트 방지용 단일 출처. */
const PHASE = "compute-scores";

// ── cats_cache 검증 ──────────────────────────────────────────
const REQUIRED_KEYS = ["price", "location", "product", "benefit", "risk", "future"];

/** @param {unknown} cats */
function validateCats(cats) {
  if (!cats || typeof cats !== "object") return false;
  const c = /** @type {Record<string, { total?: unknown, subs?: unknown, label?: unknown }>} */ (cats);
  return REQUIRED_KEYS.every(k =>
    c[k] &&
    typeof c[k].total === "number" &&
    !Number.isNaN(c[k].total) &&
    Array.isArray(c[k].subs) &&
    c[k].subs.length > 0 &&
    typeof c[k].label === "string"
  );
}

/**
 * JSON 안전 직렬화 (NaN/Infinity → null)
 * @param {string} _key
 * @param {unknown} value
 */
function safeJsonReplacer(_key, value) {
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

// ── 메인 ─────────────────────────────────────────────────────
export async function main() {
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
      .order("id")
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      logError("compute-scores", `데이터 로드 실패: ${error.message}`);
      // 기록 후 종료 — 여기서 그냥 죽으면 collector_runs 에 아무 흔적이 안 남아
      // "점수 갱신이 며칠째 안 됐다" 를 아무도 못 본다 (세션 495).
      await recordCollectorRun(PHASE, { ...reporter.summary(), status: "failure", errorMessage: error.message });
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allApartments.push(...data);
    if (data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  if (allApartments.length === 0) {
    log("compute-scores", "아파트 데이터 없음 — 종료");
    // ok=0·skip=0 으로 기록된다 → monitor ② 가 "성공인데 처리 0건" 으로 잡는다.
    // 아파트가 0건이면 그건 정상이 아니므로 울리는 게 맞다.
    await recordCollectorRun(PHASE, reporter.summary());
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
      const msg = err instanceof Error ? err.message : String(err);
      logError("compute-scores", `스코어링 실패 (id=${apt.id}): ${msg}`);
      reporter.fail();
      skipCount++;
    }
  }

  log("compute-scores", `스코어링 완료: ${rows.length}건 성공, ${skipCount}건 스킵`);

  // 4) DB 업서트
  // DB 반영 실패 건수 — reporter 는 "계산" 성공/실패만 세므로 여기서 따로 받아 합산한다.
  // 안 합치면 2000건 계산 성공 + 2000건 UPDATE 전멸이 collector_runs 에 status=success 로 남는다.
  let dbFailed = 0;
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
    log("compute-scores", `${rows.length}건 DB UPDATE 중...`);
    let updated = 0, failed = 0;
    const BATCH = 10;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const promises = batch.map(row =>
        sb.from("apartments")
          .update({ cats_cache: row.cats_cache })
          .eq("id", row.id)
          .select("id")
      );
      const results = await Promise.all(promises);
      for (const { data, error } of results) {
        if (error) {
          logError("compute-scores", `UPDATE 실패: ${error.message}`);
          failed++;
        } else if (!data || data.length === 0) {
          failed++; // RLS에 의해 행이 업데이트되지 않음
        } else {
          updated++;
        }
      }
      if ((i + BATCH) % 500 === 0 || i + BATCH >= rows.length) {
        log("compute-scores", `  진행: ${Math.min(i + BATCH, rows.length)}/${rows.length} (성공 ${updated}, 실패 ${failed})`);
      }
    }
    if (failed > 0) {
      logError("compute-scores", `${failed}건 UPDATE 실패 — RLS 정책 또는 ID 불일치 확인 필요`);
    }
    log("compute-scores", `DB UPDATE 완료: ${updated}/${rows.length}건 (실패 ${failed}건)`);
    dbFailed = failed;
  }

  if (dbFailed > 0) reporter.fail(dbFailed);
  await recordCollectorRun(PHASE, reporter.summary());
}

// CLI 직접 실행 시에만 main() 호출 — import 만으로 수집이 돌면 테스트가 실 DB 를 친다
// (다른 수집기 전부가 쓰는 isCLI 관행. 이 파일만 빠져 있어 테스트를 못 붙이고 있었다.)
const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  logError("compute-scores", msg);
  process.exit(1);
});
