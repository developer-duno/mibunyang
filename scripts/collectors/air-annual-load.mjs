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
 * ## 사용법
 *   node scripts/collectors/air-annual-load.mjs --file artifacts/air-annual.json    (dry-run)
 *   node scripts/collectors/air-annual-load.mjs --file artifacts/air-annual.json --apply
 */
import { readFileSync } from "node:fs";
import { loadEnv, log, logError, upsertBatch, recordCollectorRun, createReporter } from "./_shared.mjs";

loadEnv();

const PHASE = "air-annual";

/**
 * 표본이 너무 적은 측정소는 거른다 (세션559).
 *
 * 3년치가 정상이면 약 26,000시간(365×24×3)이다. **1년치(8,760시간) 미만**이면
 * 중간에 신설·폐지됐거나 결측이 많다는 뜻이라, 그 평균은 "3년 평균"이라 부를 수 없다.
 * 실측: 671곳 중 20곳이 여기 걸린다.
 *
 * ⚠️ 거른 측정소를 쓰는 단지는 `AIR_QUALITY_DEFAULT`(중립)를 받는다 — 표본이 얇은 값으로
 * 채점하느니 "모른다"가 정직하다.
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

async function main() {
  const apply = process.argv.includes("--apply");
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

  if (!apply) {
    log(PHASE, "DRY-RUN 종료");
    return;
  }

  const rpt = createReporter(PHASE);
  await upsertBatch("air_station_annual", accepted, "station_name");
  rpt.success(accepted.length);
  rpt.skip(rejected.length);
  const result = rpt.summary();
  await recordCollectorRun(PHASE, result);
  log(PHASE, `완료 — 반영 ${accepted.length}곳`);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) {
  main().catch((e) => {
    logError(PHASE, e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
