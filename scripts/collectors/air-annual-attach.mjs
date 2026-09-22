// @ts-check
/**
 * 측정소별 3년 평균을 각 단지의 `apartments.air_quality.annual` 에 붙인다 (세션560).
 *
 * ## 왜 필요한가
 * 세션559 가 `air_station_annual` 표를 만들었지만 **그 표를 읽는 코드가 하나도 없었다**
 * (실측: `grep -rn air_station_annual` → 쓰는 곳·정의뿐, 읽는 곳 0건). 즉 3년 평균은
 * DB 에 있으되 점수에도 화면에도 닿지 않는 중간 상태였다. 이 스크립트가 그 통로다.
 *
 * ## 왜 새 컬럼이 아니라 `air_quality.annual` 인가
 * `air_quality` 는 이미 점수(`scoreLocation`)·화면·감사(`data-audit`)가 함께 쓰는 통로다.
 * 여기에 한 칸을 더하면 새 컬럼·새 조인·타입 재생성이 전부 불필요하다.
 *
 * ## 실시간 키는 건드리지 않는다
 * `pm25`/`pm10`/`o3`/`grade` 최상위 키는 `collect-air-quality.mjs` 가 매일 덮어쓰는
 * **오늘 값**이다. 화면이 "오늘:보통"으로 계속 쓰므로 그대로 둔다. 되돌리려면 이 스크립트가
 * 넣은 `annual` 키만 지우면 된다.
 *
 * ## 언제 돌리나
 * `air-annual-load.mjs` 가 표를 갱신한 **직후 한 번**. 원본이 연 1회 나오므로
 * 주기 수집기가 아니다(선례 = air-annual-load 자신).
 *
 * ⚠️ 매일 도는 `collect-air-quality.mjs` 가 `air_quality` 를 **통째로 교체**해서 `annual` 이
 *    다음 날 새벽에 날아갈 상태였다(세션560 발견). 그 수집기가 기존 `annual` 을 보존하도록
 *    같이 고쳤다 — 그 보존 코드를 지우면 이 스크립트의 결과가 매일 조용히 사라진다.
 *
 * ## 사용법
 *   node scripts/collectors/air-annual-attach.mjs            (dry-run)
 *   node scripts/collectors/air-annual-attach.mjs --apply
 */
import {
  loadEnv,
  log,
  logError,
  getSupabase,
  selectAll,
  createSemaphore,
  recordCollectorRun,
  createReporter,
} from "./_shared.mjs";

loadEnv();

const PHASE = "air-annual-attach";

/**
 * 단지에 붙일 `annual` 객체를 만든다.
 *
 * 3년 평균 표에 그 측정소가 없으면 **null 을 준다**(호출자가 건너뛴다). 억지로 채우지 않는
 * 이유는, 표본이 얇아 걸러진 측정소의 값으로 채점하느니 `AIR_QUALITY_DEFAULT`(중립 14점)를
 * 받는 편이 정직하기 때문이다 — 사장님 확정 2026-09-22 "가운데 칸".
 *
 * @param {{ station?: string } | null | undefined} airQuality 단지의 기존 air_quality
 * @param {Map<string, { pm25: number | null; pm10: number | null; o3: number | null; years: string | null }>} byStation
 * @returns {{ pm25: number | null; pm10: number | null; o3: number | null; years: string | null } | null}
 */
export function buildAnnual(airQuality, byStation) {
  const station = airQuality?.station;
  if (typeof station !== "string" || !station) return null;
  const row = byStation.get(station);
  if (!row) return null;
  // pm25 가 없으면 채점에 쓸 수 없다 — 붙여 봐야 의미가 없으므로 건너뛴다.
  if (row.pm25 == null) return null;
  return { pm25: row.pm25, pm10: row.pm10, o3: row.o3, years: row.years };
}

/**
 * 이미 같은 값이 붙어 있으면 다시 쓰지 않는다(멱등).
 *
 * @param {Record<string, unknown> | null | undefined} existing 기존 air_quality.annual
 * @param {Record<string, unknown>} next
 * @returns {boolean} 갱신이 필요하면 true
 */
export function needsUpdate(existing, next) {
  if (!existing) return true;
  for (const k of ["pm25", "pm10", "o3", "years"]) {
    if (existing[k] !== next[k]) return true;
  }
  return false;
}

/**
 * Supabase 응답 배열에서 **실제** 성공/실패를 센다.
 *
 * ⚠️ 이 함수가 따로 있는 이유 = 세션560 실사고. 옛 코드는 보낸 건수(슬라이스 길이)를 그대로
 * `rpt.success()` 에 더했다. 그래서 2,992건이 **전부 실패**했는데도 로그와 `collector_runs` 가
 * **"성공 2992 · 실패 0"** 이라고 보고했다(DB 는 한 칸도 안 바뀐 상태였다).
 * 보낸 수가 아니라 **돌아온 결과**를 세야 한다 — 이 저장소가 말하는 "조용한 실패" 그 자체였다.
 *
 * @param {Array<unknown>} results Supabase 호출 결과(각각 `{ error }` 를 가진다)
 * @returns {{ ok: number; fail: number; firstError: string | null }}
 */
export function countResults(results) {
  let ok = 0;
  let fail = 0;
  /** @type {string | null} */
  let firstError = null;
  for (const r of results) {
    const err = /** @type {{ error?: { message?: string } | null }} */ (r)?.error;
    if (err) {
      if (firstError == null) firstError = err.message ?? String(err);
      fail++;
    } else ok++;
  }
  return { ok, fail, firstError };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const sb = getSupabase();

  const annualRows = await selectAll(
    (s) => s.from("air_station_annual").select("station_name,pm25,pm10,o3,years"),
    sb,
    "station_name"
  );
  if (!annualRows.length) {
    logError(PHASE, "air_station_annual 이 비었습니다 — 반영하지 않습니다(fail-close).");
    process.exit(1);
  }
  const byStation = new Map(
    annualRows.map((r) => [
      String(r.station_name),
      {
        pm25: typeof r.pm25 === "number" ? r.pm25 : null,
        pm10: typeof r.pm10 === "number" ? r.pm10 : null,
        o3: typeof r.o3 === "number" ? r.o3 : null,
        years: typeof r.years === "string" ? r.years : null,
      },
    ])
  );
  log(PHASE, `3년 평균 표 ${byStation.size}곳`);

  const apts = await selectAll((s) => s.from("apartments").select("id,air_quality"), sb, "id");
  log(PHASE, `단지 ${apts.length}곳`);

  /** @type {Array<Record<string, unknown>>} */
  const updates = [];
  let skipNoStation = 0;
  let skipNoAnnual = 0;
  let skipSame = 0;
  /** @type {Set<string>} */
  const missingStations = new Set();

  for (const apt of apts) {
    const aq = /** @type {Record<string, unknown> | null} */ (apt.air_quality);
    const station = aq && typeof aq.station === "string" ? aq.station : null;
    if (!station) {
      skipNoStation++;
      continue;
    }
    const next = buildAnnual(/** @type {{ station?: string }} */ (aq), byStation);
    if (!next) {
      skipNoAnnual++;
      missingStations.add(station);
      continue;
    }
    if (!needsUpdate(/** @type {Record<string, unknown> | null} */ (aq?.annual ?? null), next)) {
      skipSame++;
      continue;
    }
    updates.push({ id: apt.id, air_quality: { ...aq, annual: next } });
  }

  log(
    PHASE,
    `붙일 대상 ${updates.length}곳 | 이미 최신 ${skipSame} | 3년평균 없음 ${skipNoAnnual}(측정소 ${missingStations.size}종) | 측정소 미상 ${skipNoStation}`
  );
  if (missingStations.size) {
    log(PHASE, `  3년평균 없는 측정소: ${[...missingStations].slice(0, 10).join(", ")}`);
    log(PHASE, `  → 그 단지들은 AIR_QUALITY_DEFAULT(중립 14점)를 받는다`);
  }

  if (!apply) {
    log(PHASE, "DRY-RUN 종료");
    return;
  }

  const rpt = createReporter(PHASE);
  // ⚠️ **`upsertBatch` 를 쓰면 안 된다**(세션560 실사고). 그건 행 전체를 넣는 insert-or-update 라
  //    `{id, air_quality}` 만 주면 `name` 이 빠진 **새 행을 만들려다** NOT NULL 제약에 걸린다
  //    (실측: 2,992건 전부 실패). 우리가 하려는 건 기존 행의 **한 칸만 고치는 것**이므로
  //    다른 수집기들과 같이 `update(...).eq("id", ...)` 를 쓴다.
  // 동시 10건 — 직렬이면 3,000건 × 왕복시간이라 너무 느리다(선례: trade-stats 세션309).
  // 중단 신호(SIGTERM·워크플로 취소)는 덩어리 사이에서 확인한다([[graceful-shutdown-coverage]]).
  const limit = createSemaphore(10);
  const CHUNK = 500;
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    if (rpt.interrupted()) {
      log(PHASE, `중단 신호 — ${ok}곳까지 반영하고 멈춥니다`);
      break;
    }
    const slice = updates.slice(i, i + CHUNK);
    const results = await Promise.all(
      slice.map((row) =>
        limit(async () =>
          sb.from("apartments").update({ air_quality: row.air_quality }).eq("id", row.id)
        )
      )
    );
    const tally = countResults(results);
    if (tally.fail && !fail) logError(PHASE, `업데이트 실패 예시: ${tally.firstError}`);
    ok += tally.ok;
    fail += tally.fail;
  }
  rpt.success(ok);
  if (fail) rpt.fail(fail);
  rpt.skip(skipSame + skipNoAnnual + skipNoStation);
  const result = rpt.summary();
  await recordCollectorRun(PHASE, result);
  log(PHASE, `완료 — 반영 ${ok}곳${fail ? ` / 실패 ${fail}곳` : ""}`);
  if (fail) process.exitCode = 1;
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) {
  main().catch((e) => {
    logError(PHASE, e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
