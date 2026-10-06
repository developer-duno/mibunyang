// @ts-check
/**
 * 측정소별 대기질 3년 평균을 DB 에 반영 (세션559)
 *
 * ## 2단 구조인 이유
 * 원본은 연도별 XLSX 300~400MB × 3개(1,707만 행)다. 이 저장소에 xlsx 를 읽는 선례가 0건이라
 * Node 에 새 의존성을 들이는 대신, 이미 있는 python(openpyxl)이 집계해 JSON 을 만들고
 * 이 스크립트가 그 JSON 만 읽어 DB 에 넣는다.
 *
 *   ① python scripts/air-annual-aggregate.py --files <xlsx...> --years "2022,2023,2024" \
 *        --out artifacts/air-annual.json
 *   ② node scripts/collectors/air-annual-load.mjs --file artifacts/air-annual.json [--apply]
 *
 * ## 주기적 수집기가 아니다
 * 원본이 **연 1회, 그것도 약 6개월 늦게** 나온다(2024년분이 2025-06 등록). 그래서
 * `kosis-local-runner.mjs` DAY_TABLE 에 넣지 않는다 — 자료가 갱신될 때 사람이 한 번 돌린다.
 * 선례 = `collect-crime-safety.mjs`(연 1회 수동 CSV).
 *
 * ## 새 파일에 없는 측정소 행은 지운다 (세션605)
 * 반영(upsert) 뒤 **기존 표에 있고 새 파일 반영 대상에 없는**(폐쇄·개명) 측정소 행을 지운다.
 * ⚠️ 표에서 지우면 2u 화면(air_station_annual 직접 조회)만 비고, 미분양 단지의 `air_quality.annual` 은
 *    `air-annual-attach.mjs` 가 건너뛰어 옛 값이 남는다(비울지는 사장님 결정 — BACKLOG 후속).
 *    매일 측정소 배정이 그 단지를 새 측정소로 옮기면 그때 새 평균이 붙는다.
 * 반영이 일부라도 실패하면(`upsertBatch` 반환 < 반영 대상) 삭제는 건너뛴다 — 새 값이 안 들어간 채 옛 행만 지우지 않게.
 * 차단기: 지울 비율이 기존의 10% 를 넘으면(정확히 10% 는 통과) 아무것도 쓰지 않고 실패로 끝낸다 —
 * 집계가 잘못 잘린 파일 하나로 표가 통째로 비는 것을 막는다. 사람이 명단을 확인했으면
 * `--expect-purge=N` 으로 "정확히 N곳 지울 것"을 못 박는다(그때는 비율 대신 개수 일치로 판정).
 *
 * ## 사용법
 *   node scripts/collectors/air-annual-load.mjs --file artifacts/air-annual.json    (dry-run — 지울 명단까지 보여 줌)
 *   node scripts/collectors/air-annual-load.mjs --file artifacts/air-annual.json --apply
 *   node scripts/collectors/air-annual-load.mjs --file artifacts/air-annual.json --apply --expect-purge=N
 *     (dry-run 이 보여 준 "지울 N곳"을 확인한 뒤 — 10% 를 넘어도 개수가 정확히 N 이면 진행)
 */
import { readFileSync } from "node:fs";
import {
  loadEnv,
  log,
  logError,
  upsertBatch,
  recordCollectorRun,
  createReporter,
  selectAll,
  getSupabase,
  joinRunMessage,
} from "./_shared.mjs";

loadEnv();

const PHASE = "air-annual";

/**
 * 표본이 너무 적은 측정소는 거른다 (세션559).
 *
 * 3년치가 정상이면 약 26,000시간(365×24×3)이다. **1년치(8,760시간) 미만**이면
 * 중간에 신설·폐지됐거나 결측이 많다는 뜻이라, 그 평균은 "3년 평균"이라 부를 수 없다.
 * 실측: 671곳 중 20곳이 여기 걸린다(최소 48시간 = 이틀분).
 *
 * ⚠️ 거른 측정소에 **새로** 배정되는 단지는 `annual` 이 안 붙어 `AIR_QUALITY_DEFAULT`(중립)를 받는다 — 표본이
 * 얇은 값으로 채점하느니 "모른다"가 정직하다. 이미 `annual` 이 붙은 단지는 `air-annual-attach.mjs` 가 건너뛰어
 * 옛 값이 남는다(위 머리말 · 세션605 검사관 C).
 */
export const MIN_SAMPLE_HOURS = 8760;

/**
 * 반영할 행만 걸러 DB 형태로 변환.
 *
 * @param {Array<Record<string, unknown>>} rows 집계 JSON
 * @returns {{ accepted: Array<Record<string, unknown>>; rejected: Array<{ station: string; reason: string }> }}
 */
export function prepareRows(rows) {
  /** @type {Array<Record<string, unknown>>} */
  const accepted = [];
  /** @type {Array<{ station: string; reason: string }>} */
  const rejected = [];
  for (const r of rows) {
    const station = typeof r.station_name === "string" ? r.station_name.trim() : "";
    if (!station) {
      rejected.push({ station: String(r.station_name ?? "(빈값)"), reason: "측정소명 없음" });
      continue;
    }
    const pm25 = typeof r.pm25 === "number" ? r.pm25 : null;
    const pm10 = typeof r.pm10 === "number" ? r.pm10 : null;
    if (pm25 == null && pm10 == null) {
      rejected.push({ station, reason: "미세먼지 측정값 전무" });
      continue;
    }
    const hours = typeof r.sample_hours === "number" ? r.sample_hours : 0;
    if (hours < MIN_SAMPLE_HOURS) {
      rejected.push({ station, reason: `표본 ${hours}시간 (1년 미만)` });
      continue;
    }
    accepted.push({
      station_name: station,
      station_code: typeof r.station_code === "string" ? r.station_code : null,
      pm25,
      pm10,
      o3: typeof r.o3 === "number" ? r.o3 : null,
      years: typeof r.years === "string" ? r.years : "",
      sample_hours: hours,
      address: typeof r.address === "string" ? r.address : null,
      updated_at: new Date().toISOString(),
    });
  }
  return { accepted, rejected };
}

/** 지울 비율 한도 기본값 — 기존 행의 10% 초과면 차단(세션605). */
export const PURGE_LIMIT_RATIO = 0.1;
/** 삭제 한 번에 넘기는 이름 수(`.in()` URL 길이 보호). */
export const PURGE_CHUNK = 200;

/**
 * 지울 측정소 계획(세션605) — 기존 표에 있고 새 파일 반영 대상(accepted)에 없는 이름.
 * 차단기 = `expect` 가 있으면 `toDelete.length !== expect`, 없으면 `ratio > limitRatio`(정확히 한도는 통과).
 * @param {Iterable<string>} existingNames
 * @param {Iterable<string>} acceptedNames
 * @param {{ limitRatio?: number, expect?: number | null }} [opts]
 * @returns {{ toDelete: string[], ratio: number, breaker: { fired: boolean, limit: number, expect: number | null } }}
 */
export function planPurge(existingNames, acceptedNames, { limitRatio = PURGE_LIMIT_RATIO, expect = null } = {}) {
  const existing = new Set(existingNames);
  const accepted = new Set(acceptedNames);
  const toDelete = [...existing].filter((n) => !accepted.has(n)).sort();
  const ratio = existing.size === 0 ? 0 : toDelete.length / existing.size;
  const fired = expect != null ? toDelete.length !== expect : ratio > limitRatio;
  return { toDelete, ratio, breaker: { fired, limit: limitRatio, expect } };
}

/**
 * `--expect-purge=N` 읽기. 없으면 null, 0 이상 정수가 아니면 throw(즉시 실패 — 잘못 친 값으로 차단기를 우회하지 않게).
 * @param {string[]} argv
 * @returns {number | null}
 */
export function parseExpectPurge(argv) {
  const all = argv.filter((x) => x === "--expect-purge" || x.startsWith("--expect-purge="));
  if (all.length > 1) throw new Error(`--expect-purge 는 한 번만 줄 수 있습니다(${all.length}번 받음)`);
  const a = all[0];
  if (a == null) return null;
  const v = a.startsWith("--expect-purge=") ? a.slice("--expect-purge=".length) : "";
  if (!/^[0-9]+$/.test(v)) throw new Error(`--expect-purge 는 0 이상 정수만 받습니다(받은 값: "${v}")`);
  return Number(v);
}

/**
 * 반영 흐름(세션605 — 시험이 가짜 클라이언트로 돌린다). 파일 읽기 뒤의 모든 단계.
 * 순서 = prepareRows → 기존 이름 조회 → planPurge → 로그 → (dry-run 끝) → 차단기면 아무것도 안 씀 → upsert → 삭제 → 기록.
 * @param {Array<Record<string, unknown>>} raw 집계 JSON
 * @param {{ apply: boolean, expectPurge?: number | null, sb?: any, recordSb?: any }} opts
 * @returns {Promise<{ exitCode: number, plan: ReturnType<typeof planPurge> }>}
 */
export async function runLoad(raw, { apply, expectPurge = null, sb = null, recordSb = null }) {
  const { accepted, rejected } = prepareRows(raw);
  log(PHASE, `집계 ${raw.length}곳 → 반영 대상 ${accepted.length}곳 / 제외 ${rejected.length}곳`);
  for (const r of rejected.slice(0, 8)) log(PHASE, `  제외 ${r.station}: ${r.reason}`);
  if (rejected.length > 8) log(PHASE, `  … 외 ${rejected.length - 8}곳`);

  const pm = accepted.map((r) => Number(r.pm25)).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (pm.length) {
    const q = (/** @type {number} */ p) => pm[Math.floor(pm.length * p)];
    log(PHASE, `pm25 최소=${pm[0]} 25%=${q(0.25)} 중앙=${q(0.5)} 75%=${q(0.75)} 최대=${pm[pm.length - 1]}`);
    log(PHASE, `환경기준(연평균 15) 이하: ${pm.filter((x) => x <= 15).length}곳`);
  }

  const client = sb ?? getSupabase();
  /** @type {Array<{ station_name: string }>} */
  const existingRows = await selectAll(
    (/** @type {any} */ s) => s.from("air_station_annual").select("station_name"),
    client,
    "station_name",
  );
  const plan = planPurge(
    existingRows.map((r) => r.station_name),
    accepted.map((r) => String(r.station_name)),
    { expect: expectPurge },
  );
  const pct = (plan.ratio * 100).toFixed(1);
  log(PHASE, `기존 ${existingRows.length}곳 중 새 파일에 없는 측정소 ${plan.toDelete.length}곳(${pct}%) — 반영 시 지운다`);
  if (plan.toDelete.length > 0) {
    const head = plan.toDelete.slice(0, 10).join(", ");
    log(PHASE, `  지울 이름(앞 10개): ${head}${plan.toDelete.length > 10 ? ` … 외 ${plan.toDelete.length - 10}곳` : ""}`);
  }
  const limitPct = (plan.breaker.limit * 100).toFixed(0);
  const breakerWhy =
    plan.breaker.expect != null
      ? `기대 ${plan.breaker.expect}곳 ≠ 실제 ${plan.toDelete.length}곳`
      : `${pct}% > 한도 ${limitPct}%`;
  if (plan.breaker.fired) {
    logError(PHASE, `차단기 발동: 지울 ${plan.toDelete.length}곳 / 기존 ${existingRows.length}곳 — ${breakerWhy}`);
  } else {
    log(PHASE, `차단기: 통과${plan.breaker.expect != null ? ` (기대 ${plan.breaker.expect}곳 일치)` : ` (한도 ${limitPct}%)`}`);
  }

  if (!apply) {
    log(PHASE, "DRY-RUN 종료");
    return { exitCode: 0, plan };
  }

  if (plan.breaker.fired) {
    // 아무것도 쓰지 않는다 — 반영(upsert)도 하지 않는다(반쪽 반영 뒤 삭제만 남는 상태를 만들지 않게).
    const errorMessage = `PURGE_BREAKER: 지울 ${plan.toDelete.length}/${existingRows.length} — ${breakerWhy}`;
    await recordCollectorRun(PHASE, { ok: 0, fail: 1, skip: 0, status: "failure", errorMessage }, recordSb);
    logError(PHASE, "반영하지 않았습니다. 명단을 확인했으면 --expect-purge=N 으로 다시 실행하세요.");
    return { exitCode: 1, plan };
  }

  const rpt = createReporter(PHASE);
  const upserted = await upsertBatch("air_station_annual", accepted, "station_name", 500, client);
  rpt.success(upserted);
  rpt.fail(accepted.length - upserted);
  rpt.skip(rejected.length);
  /** @type {string | undefined} */
  let errorMessage;

  let purged = 0;
  if (upserted < accepted.length) {
    // 새 값이 다 안 들어갔는데 옛 행을 지우면 그 측정소는 값이 아예 없어진다 → 삭제는 다음 회차로 미룬다.
    errorMessage = joinRunMessage(errorMessage, `UPSERT_PARTIAL=${upserted}/${accepted.length}`);
    if (plan.toDelete.length > 0) logError(PHASE, `반영 ${upserted}/${accepted.length}곳 — 삭제(${plan.toDelete.length}곳)는 건너뜀`);
  } else {
    let failedChunks = 0;
    /** @type {string | null} */
    let firstError = null;
    for (let i = 0; i < plan.toDelete.length; i += PURGE_CHUNK) {
      const chunk = plan.toDelete.slice(i, i + PURGE_CHUNK);
      const { error } = await client.from("air_station_annual").delete().in("station_name", chunk);
      if (error) {
        logError(PHASE, `삭제 실패(${chunk.length}곳): ${error.message}`);
        rpt.fail(chunk.length);
        failedChunks++;
        if (firstError == null) firstError = error.message;
      } else {
        purged += chunk.length;
      }
    }
    if (plan.toDelete.length > 0) log(PHASE, `지움 ${purged}/${plan.toDelete.length}곳`);
    if (failedChunks > 0) errorMessage = joinRunMessage(errorMessage, `PURGE_FAILED=${failedChunks}: ${firstError}`);
  }
  if (purged > 0) errorMessage = joinRunMessage(errorMessage, `ANNUAL_PURGED=${purged}`);

  const result = rpt.summary();
  await recordCollectorRun(PHASE, errorMessage ? { ...result, errorMessage } : result, recordSb);
  log(PHASE, `완료 — 반영 ${accepted.length}곳 · 지움 ${purged}곳`);
  return { exitCode: result.fail > 0 ? 1 : 0, plan };
}

async function main() {
  const apply = process.argv.includes("--apply");
  /** @type {number | null} */
  let expectPurge;
  try {
    expectPurge = parseExpectPurge(process.argv);
  } catch (e) {
    logError(PHASE, e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  const fi = process.argv.indexOf("--file");
  const file = fi >= 0 ? process.argv[fi + 1] : "artifacts/air-annual.json";
  log(PHASE, apply ? "=== 실제 반영 ===" : "=== DRY-RUN (반영하려면 --apply) ===");

  /** @type {Array<Record<string, unknown>>} */
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    logError(PHASE, `집계 JSON 을 읽지 못했습니다(${file}): ${e instanceof Error ? e.message : String(e)}`);
    logError(PHASE, "먼저 python scripts/air-annual-aggregate.py 로 집계하세요.");
    process.exit(1);
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    logError(PHASE, "집계 결과가 비었습니다 — 반영하지 않습니다(fail-close).");
    process.exit(1);
  }

  const { exitCode } = await runLoad(raw, { apply, expectPurge });
  if (exitCode !== 0) process.exit(exitCode);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) {
  main().catch(async (e) => {
    const errorMessage = e instanceof Error ? e.message : String(e);
    logError(PHASE, errorMessage);
    // 반영 실행(--apply)이 도중에 죽으면 실패를 남긴다(dry-run 은 원래 기록하지 않는다). 기록 실패는 삼킨다.
    if (process.argv.includes("--apply")) {
      try {
        await recordCollectorRun(PHASE, { ok: 0, fail: 1, skip: 0, status: "failure", errorMessage });
      } catch {
        /* best-effort */
      }
    }
    process.exit(1);
  });
}
