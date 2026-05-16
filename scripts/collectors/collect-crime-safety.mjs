// @ts-check
/**
 * 행안부 지역안전지수 범죄 등급 수집기 — CSV 파일 기반
 *
 * data.go.kr/15069240 CSV → 시군구별 범죄 안전등급(1~5)
 *  → apartments.crime_safety_grade (단지 단위)
 *  → regions.crime_grade (지역 단위, 세션 243 W6-E 신규)
 * CSV 파일: data/crime-safety-index.csv (수동 다운로드, 연 1회 갱신)
 *
 * 사용법:
 *   node scripts/collectors/collect-crime-safety.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-crime-safety.mjs --dry-run    (미리보기만)
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnv, getSupabase, REGION_MAP, log, logError, createReporter, recordCollectorRun } from "./_shared.mjs";

/**
 * @typedef {{ id: string | number; name?: string | null; region: string | null; gu: string | null }} CrimeAptRow
 */

loadEnv();

const PHASE = "crime-safety";
const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(__dirname, "../../data/crime-safety-index.csv");

/**
 * CSV 텍스트 파싱 → Map<"region|gu", grade>
 * CSV 형식: 시도,시군구,교통사고,화재,범죄,생활안전,자살,감염병
 * 또는: 시도,시군구,범죄 (최소 3컬럼)
 * @param {string} csvText
 * @returns {Map<string, number>}
 */
export function parseCrimeCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV 데이터 부족 (헤더+1행 이상 필요)");

  // 헤더에서 범죄 컬럼 인덱스 찾기
  const header = (lines[0] || "").split(",").map(/** @param {string} h */ h => h.trim());
  let crimeIdx = header.findIndex(/** @param {string} h */ h => h === "범죄");
  if (crimeIdx === -1) crimeIdx = header.findIndex(/** @param {string} h */ h => h.includes("범죄"));
  // 3컬럼 구조(시도,시군구,등급)인 경우
  if (crimeIdx === -1 && header.length === 3) crimeIdx = 2;
  if (crimeIdx === -1) throw new Error(`CSV에서 '범죄' 컬럼을 찾을 수 없음. 헤더: ${header.join(",")}`);

  /** @type {Map<string, number>} */
  const map = new Map();
  let parsed = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(",").map(/** @param {string} c */ c => c.trim());
    if (cols.length < 3) continue;

    const rawSido = cols[0];
    const rawGu = cols[1];
    const gradeStr = cols[crimeIdx];
    const grade = parseInt(gradeStr || "", 10);
    if (!rawSido || isNaN(grade) || grade < 1 || grade > 5) continue;

    // 시도명 정규화: "서울특별시" → "서울"
    const region = REGION_MAP[rawSido] || rawSido;
    // 시군구명: "종로구" 그대로 사용
    const key = `${region}|${rawGu}`;
    map.set(key, grade);
    parsed++;
  }
  log(PHASE, `CSV 파싱 완료: ${parsed}건`);
  return map;
}

/**
 * 아파트의 region+gu로 범죄 등급 매칭
 * @param {CrimeAptRow} apt
 * @param {Map<string, number>} crimeMap
 * @returns {number|null} 1~5 등급 또는 null
 */
export function matchCrimeGrade(apt, crimeMap) {
  if (!apt.region) return null;
  // 1. region|gu 정확 매칭
  if (apt.gu) {
    const key = `${apt.region}|${apt.gu}`;
    const hit = crimeMap.get(key);
    if (hit !== undefined) return hit;
  }
  // 2. 세종처럼 gu가 없는 경우 → region만으로 매칭 시도
  for (const [key, grade] of crimeMap) {
    if (key.startsWith(`${apt.region}|`)) return grade;
  }
  return null;
}

async function main() {
  // CSV 파일 읽기
  let csvText;
  try {
    csvText = readFileSync(CSV_PATH, "utf-8");
  } catch (err) {
    logError(PHASE, `CSV 파일 없음: ${CSV_PATH}`);
    logError(PHASE, "data.go.kr/15069240에서 CSV 다운로드 후 data/crime-safety-index.csv로 저장 필요");
    process.exit(1);
  }

  const crimeMap = parseCrimeCsv(csvText);
  if (crimeMap.size === 0) {
    logError(PHASE, "CSV에서 유효한 데이터 0건");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();

  // 아파트 목록 조회
  const { data: apts, error } = await sb.from("apartments").select("id, name, region, gu").limit(10000);
  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);
  log(PHASE, `대상: ${apts.length}건`);

  const rpt = createReporter(PHASE);
  let matchCount = 0;

  for (const apt of apts) {
    const grade = matchCrimeGrade(apt, crimeMap);
    if (grade == null) { rpt.skip(1); continue; }

    matchCount++;
    if (dryRun) {
      log(PHASE, `  [DRY] ${apt.name} (${apt.region} ${apt.gu || ""}): ${grade}등급`);
      rpt.success(1);
      continue;
    }

    const { error: uErr } = await sb.from("apartments").update({ crime_safety_grade: grade }).eq("id", apt.id);
    if (uErr) { logError(PHASE, `${apt.name}: ${uErr.message}`); rpt.fail(1); }
    else rpt.success(1);
  }

  log(PHASE, `매칭률: ${matchCount}/${apts.length} (${apts.length ? (matchCount / apts.length * 100).toFixed(1) : 0}%)`);
  const result = rpt.summary();

  // regions UPDATE (세션 243 W6-E): 시군구 단위 crime_grade 채움
  let regionsFailed = false;
  let rResult = { elapsed: "0", ok: 0, fail: 0, skip: 0, total: 0 };
  const { data: regions, error: rErr } = await sb.from("regions").select("id, region, gu").limit(10000);
  if (rErr) { logError(PHASE, `regions 조회 실패: ${rErr.message}`); }
  else if (regions) {
    const rRpt = createReporter(`${PHASE}-regions`);
    let rMatched = 0;
    for (const r of regions) {
      const grade = matchCrimeGrade(r, crimeMap);
      if (grade == null) { rRpt.skip(1); continue; }
      rMatched++;
      if (dryRun) {
        log(PHASE, `  [DRY-regions] ${r.region} ${r.gu || ""}: ${grade}등급`);
        rRpt.success(1);
        continue;
      }
      const { error: uErr } = await sb.from("regions").update({ crime_grade: grade }).eq("id", r.id);
      if (uErr) { logError(PHASE, `regions ${r.region} ${r.gu}: ${uErr.message}`); rRpt.fail(1); }
      else rRpt.success(1);
    }
    log(PHASE, `regions 매칭률: ${rMatched}/${regions.length} (${regions.length ? (rMatched / regions.length * 100).toFixed(1) : 0}%)`);
    rResult = rRpt.summary();
    regionsFailed = rResult.fail > 0;
  }

  // apartments + regions 두 단계 합산 1행 기록
  await recordCollectorRun(PHASE, {
    elapsed: result.elapsed,
    ok: result.ok + rResult.ok,
    fail: result.fail + rResult.fail,
    skip: result.skip + rResult.skip,
  });

  if (result.fail > 0 || regionsFailed) process.exit(1);
}

// isCLI 패턴 — 직접 실행 시 main(), import 시 미실행
const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { logError(PHASE, err.message); process.exit(1); });
