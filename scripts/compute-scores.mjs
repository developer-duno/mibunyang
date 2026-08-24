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
import { loadEnv, getSupabase, upsertBatch, log, logError, createReporter, recordCollectorRun, selectAll, sleep } from "./collectors/_shared.mjs";
import { computeRegionalMedians, calcCats } from "@/scoring/engine";

// ── 설정 ─────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 1000;
/** collector_runs 기록명 — monitor ⑤ 라벨 드리프트 방지용 단일 출처. */
const PHASE = "compute-scores";

/**
 * cats_cache UPDATE 의 **동시 요청 수**. 이 스크립트는 단지 1곳당 요청 1개를 만들 수밖에 없어
 * (PostgREST 에 행마다 다른 값을 넣는 배치 UPDATE 문법이 없다) 요청 **수** 대신 **동시성**을 조인다.
 * 옛 값 10 은 초당 약 25회(피크 32회) 버스트를 만들었다 — 아래 UPDATE 루프 주석 참조.
 */
export const UPDATE_CONCURRENCY = 5;
/**
 * 배치 사이 지연(ms). `upsertBatch` 의 기본 지연과 같은 톤으로 맞췄다.
 * 동시성 5 + 100ms 로 초당 약 10회 — PostgREST 백엔드가 쌓이지 않는 수준.
 */
export const UPDATE_BATCH_DELAY_MS = 100;

// ── 낡은 점수 정리 (세션502) ──────────────────────────────────
// 이 스크립트는 `apartments_flat` VIEW 만 읽어 채점하는데, VIEW 는 이름·지역·동이 같은 단지를
// 중복 제거(dedup CTE)해서 원본 `apartments` 보다 적다. 그래서 **VIEW 밖으로 밀려난 행은 영영
// 재채점되지 않고 옛 점수를 그대로 들고 있었다** — 세션502 실측 시점에 579곳 중 570곳이 4.5개월
// 전(2026-03) 값. 지금은 API·정적 JSON 모두 VIEW 를 거치므로 손님에게 새지 않지만, 누가
// `apartments` 를 직접 읽는 코드를 하나 쓰는 순간 옛 점수가 조용히 나가는 잠복 지뢰다.
// → 매 회차 끝에 VIEW 밖 행의 cats_cache 를 NULL 로 비워 스스로 정리한다.

/** 한 회차에 지울 수 있는 최대 비율. 부분 조회 사고로 멀쩡한 점수를 쓸어버리는 것을 막는 안전판. */
export const STALE_CLEAR_MAX_RATIO = 0.4;

/**
 * 점수를 들고 있는 행 중 이번 회차 채점 대상(=VIEW 전량)에 없는 id 를 추린다.
 * ⚠️ 기준은 "채점에 **성공**한 행" 이 아니라 "VIEW 에 **있는** 행" 이다 — 검증 실패로 스킵된
 *    VIEW 내 단지의 기존 점수까지 지워버리면 화면에서 점수가 사라진다.
 * @param {Set<string>} viewIds apartments_flat 이 돌려준 전체 id
 * @param {{ id: string }[]} rowsWithScores apartments 에서 cats_cache 가 비어있지 않은 행
 * @returns {string[]}
 */
export function findStaleScoreIds(viewIds, rowsWithScores) {
  return rowsWithScores.filter((r) => !viewIds.has(r.id)).map((r) => r.id);
}

/**
 * 지우려는 양이 안전 범위인가. VIEW 조회가 일부만 돌아온 회차에 전량 삭제가 되는 것을 막는다.
 * @param {number} staleCount 지우려는 행 수
 * @param {number} totalWithScores 점수를 들고 있는 전체 행 수
 */
export function isStaleClearSafe(staleCount, totalWithScores) {
  if (!Number.isFinite(staleCount) || !Number.isFinite(totalWithScores)) return false;
  if (staleCount < 0 || totalWithScores <= 0) return false;
  return staleCount / totalWithScores <= STALE_CLEAR_MAX_RATIO;
}

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
    // ⚠️ 이 루프는 **단지 1곳당 요청 1개**를 만든다(약 2,200건). PostgREST 는 서로 다른 값으로
    // 여러 행을 한 번에 UPDATE 하는 문법이 없고, `upsert` 로 {id, cats_cache} 만 보내는 우회는
    // **실측 결과 불가**하다 — INSERT 를 선시도해 `null value in column "name" violates not-null
    // constraint` 로 전량 실패한다(세션527 운영 DB 실측). 전체 행 upsert 는 읽은 시점 이후 다른
    // 수집기가 바꾼 컬럼을 되돌리는 lost update 위험이 있어 쓰지 않는다.
    //
    // 그래서 요청 **수**는 그대로 두고 **동시성과 요청률**만 낮춘다.
    //
    // 실측(자매 레포 naver-estate-web 세션381 의 Supabase Logs Explorer 집계 + 본 코드 대조):
    // 옛 값(BATCH 10, 지연 0)은 88초에 2,211건 = 초당 약 25회(피크 32회)를 쏴서 PostgREST
    // 백엔드 ~20개를 만들고 idle 로 20분 가까이 잔존시켰다. 같은 시간대(8/22·8/24)에 공유
    // Supabase 인스턴스가 두 번 죽었다.
    // ⚠️ **다만 인과는 미확정이다.** 버스트(03:03)와 크래시(03:21) 사이 19분 공백이 설명되지
    // 않았고, 크래시 원인으로 지목된 OOM 도 Postgres 서버 로그 원문이 아니라 대시보드 그래프
    // 판독이다(자매 세션이 스스로 정정 통지). 즉 **시간적 근접까지가 확인된 전부**다.
    // 이 완화의 근거는 "크래시를 막는다" 가 아니라 **"공유 자원에 초당 32회 버스트를 쏠 이유가
    // 없다"** 는 것 하나로 충분하다 — 인과가 나중에 부정돼도 이 변경은 여전히 옳다.
    //
    // 근본책(Postgres RPC 로 배열 UPDATE = 요청 수 자체를 수십 건으로)은 마이그레이션이 필요해
    // `.claude/BACKLOG.md` 에 별도 등재했다.
    const BATCH = UPDATE_CONCURRENCY;
    for (let i = 0; i < rows.length; i += BATCH) {
      if (i > 0) await sleep(UPDATE_BATCH_DELAY_MS);
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

  // 5) VIEW 밖에 남은 낡은 점수 정리 (세션502 — 위 STALE_CLEAR_MAX_RATIO 주석 참조)
  dbFailed += await clearStaleScores(sb, new Set(allApartments.map((a) => a.id)));

  if (dbFailed > 0) reporter.fail(dbFailed);
  await recordCollectorRun(PHASE, reporter.summary());
}

/**
 * VIEW 밖 행의 cats_cache 를 NULL 로 비운다.
 * @param {any} sb Supabase 클라이언트
 * @param {Set<string>} viewIds apartments_flat 전체 id
 * @param {{ dryRun?: boolean }} [opts] dryRun 은 테스트에서 주입한다(기본 = CLI 플래그)
 * @returns {Promise<number>} 실패 건수 (호출부가 dbFailed 에 합산)
 */
export async function clearStaleScores(sb, viewIds, { dryRun = DRY_RUN } = {}) {
  // selectAll 이 .range() 페이지네이션을 붙여준다 (PostgREST 1,000행 제한 회피).
  /** @type {{ id: string }[]} */
  const scored = await selectAll((s) => s.from("apartments").select("id").not("cats_cache", "is", null), sb);
  const staleIds = findStaleScoreIds(viewIds, scored);
  if (staleIds.length === 0) {
    log(PHASE, "낡은 점수 없음 — 정리 생략");
    return 0;
  }
  if (!isStaleClearSafe(staleIds.length, scored.length)) {
    // 여기 걸리면 대개 VIEW 조회가 일부만 돌아온 것이다. 지우지 않고 크게 남긴다.
    logError(
      PHASE,
      `낡은 점수 ${staleIds.length}/${scored.length}건 = 안전 한도(${STALE_CLEAR_MAX_RATIO * 100}%) 초과 — 정리 중단. ` +
        `VIEW 조회가 온전했는지 확인 필요 (VIEW ${viewIds.size}건)`,
    );
    return 1;
  }
  if (dryRun) {
    log(PHASE, `[DRY-RUN] 낡은 점수 ${staleIds.length}건 정리 대상 — DB 미반영`);
    return 0;
  }
  log(PHASE, `낡은 점수 ${staleIds.length}건 정리 중... (VIEW 밖 = 손님에게 안 보이는 중복 행)`);
  let cleared = 0, failed = 0;
  const BATCH = 100;
  for (let i = 0; i < staleIds.length; i += BATCH) {
    const slice = staleIds.slice(i, i + BATCH);
    const { data, error } = await sb.from("apartments").update({ cats_cache: null }).in("id", slice).select("id");
    if (error) {
      logError(PHASE, `낡은 점수 정리 실패: ${error.message}`);
      failed += slice.length;
    } else {
      cleared += data?.length ?? 0;
    }
  }
  log(PHASE, `낡은 점수 정리 완료: ${cleared}건 (실패 ${failed}건)`);
  return failed;
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
