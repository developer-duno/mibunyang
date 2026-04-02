/**
 * 행안부 지역안전지수 범죄 등급 수집기 — CSV 파일 기반
 *
 * data.go.kr/15069240 CSV → 시군구별 범죄 안전등급(1~5) → apartments.crime_safety_grade
 * CSV 파일: data/crime-safety-index.csv (수동 다운로드, 연 1회 갱신)
 *
 * 사용법:
 *   node scripts/collectors/collect-crime-safety.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-crime-safety.mjs --dry-run    (미리보기만)
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnv, getSupabase, REGION_MAP, log, logError, createReporter } from "./_shared.mjs";

loadEnv();

const PHASE = "crime-safety";
const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(__dirname, "../../data/crime-safety-index.csv");

/**
 * CSV 텍스트 파싱 → Map<"region|gu", grade>
 * CSV 형식: 시도,시군구,교통사고,화재,범죄,생활안전,자살,감염병
 * 또는: 시도,시군구,범죄 (최소 3컬럼)
 */
export function parseCrimeCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV 데이터 부족 (헤더+1행 이상 필요)");

  // 헤더에서 범죄 컬럼 인덱스 찾기
  const header = lines[0].split(",").map(h => h.trim());
  let crimeIdx = header.findIndex(h => h === "범죄");
  if (crimeIdx === -1) crimeIdx = header.findIndex(h => h.includes("범죄"));
  // 3컬럼 구조(시도,시군구,등급)인 경우
  if (crimeIdx === -1 && header.length === 3) crimeIdx = 2;
  if (crimeIdx === -1) throw new Error(`CSV에서 '범죄' 컬럼을 찾을 수 없음. 헤더: ${header.join(",")}`);

  const map = new Map();
  let parsed = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim());
    if (cols.length < 3) continue;

    const rawSido = cols[0];
    const rawGu = cols[1];
    const gradeStr = cols[crimeIdx];
    const grade = parseInt(gradeStr, 10);
    if (!rawSido || !rawGu || isNaN(grade) || grade < 1 || grade > 5) continue;

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
 * @returns {number|null} 1~5 등급 또는 null
 */
export function matchCrimeGrade(apt, crimeMap) {
  if (!apt.region) return null;
  // 1. region|gu 정확 매칭
  if (apt.gu) {
    const key = `${apt.region}|${apt.gu}`;
    if (crimeMap.has(key)) return crimeMap.get(key);
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
  if (result.fail > 0) process.exit(1);
}

// isCLI 패턴 — 직접 실행 시 main(), import 시 미실행
const isCLI = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isCLI) main().catch(err => { logError(PHASE, err.message); process.exit(1); });
