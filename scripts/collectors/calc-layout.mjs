/**
 * 평면구조(layout) 추정기 — 면적 + 건물 특성 기반
 *
 * 외부 API 호출 없이 DB 내 기존 데이터만으로 계산:
 * - 전용면적 → 베이 수 (4베이/3베이/2베이이하)
 * - 층수·세대밀도·단지명 → 판상/타워
 *
 * 사용법:
 *   node scripts/collectors/calc-layout.mjs              (Supabase UPDATE)
 *   node scripts/collectors/calc-layout.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, stringSimilarity } from "./_shared.mjs";

loadEnv();

const PHASE = "calc-layout";

// 면적 기반 베이 수 임계값 (m²)
const BAY4_THRESHOLD = 100; // >= 100m² → 4베이
const BAY3_THRESHOLD = 60;  // >= 60m²  → 3베이

// 타워 판별 시그널 임계값
const TOWER_HIGH_FLOOR = 25;
const PLATE_LOW_FLOOR = 15;
const TOWER_LOW_DENSITY = 6;   // 층당 세대 <= 6 → 타워
const PLATE_HIGH_DENSITY = 12; // 층당 세대 >= 12 → 판상

/** 면적(m²)으로 베이 수 추정 */
function estimateBayCount(area) {
  if (area >= BAY4_THRESHOLD) return 4;
  if (area >= BAY3_THRESHOLD) return 3;
  return 2;
}

/** 건물 특성으로 판상/타워 판별 (양수=타워, 0이하=판상) */
function estimateBuildingType(complexName, highFloor, totalHouseholds) {
  let score = 0;

  // 1. 이름에 "타워" 포함
  const name = (complexName || "").toLowerCase();
  if (name.includes("타워") || name.includes("tower")) score += 1;

  // 2. 최고층 기반
  if (highFloor != null) {
    if (highFloor >= TOWER_HIGH_FLOOR) score += 1;
    if (highFloor < PLATE_LOW_FLOOR) score -= 1;
  }

  // 3. 세대밀도 (총세대 / 최고층 ≈ 층당 세대수)
  if (totalHouseholds > 0 && highFloor > 0) {
    const density = totalHouseholds / highFloor;
    if (density <= TOWER_LOW_DENSITY) score += 1;
    if (density >= PLATE_HIGH_DENSITY) score -= 1;
  }

  return score > 0 ? "타워" : "판상";
}

/** 베이 수 + 건물 유형 → layout 문자열 */
function toLayoutString(bayCount, buildingType) {
  if (bayCount <= 2) return "2베이이하";
  return `${bayCount}베이${buildingType}`;
}

/** 배열의 중앙값 */
function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();

  // 1. layout이 없는 아파트 조회
  const { data: apts, error: aErr } = await sb
    .from("apartments")
    .select("id, name, area")
    .is("layout", null);
  if (aErr) throw new Error(`apartments 조회 실패: ${aErr.message}`);
  log(PHASE, `대상: ${apts.length}건 (layout null)`);

  if (!apts.length) { log(PHASE, "대상 없음, 종료"); return; }

  // 2. complexes 조회
  const { data: complexes, error: cErr } = await sb
    .from("complexes")
    .select("complex_no, complex_name, high_floor, total_household_count");
  if (cErr) throw new Error(`complexes 조회 실패: ${cErr.message}`);
  log(PHASE, `complexes: ${complexes.length}건`);

  // 3. articles에서 전용면적 조회 (active 매물만)
  const { data: articles, error: artErr } = await sb
    .from("articles")
    .select("complex_no, area2_m2")
    .eq("is_active", true)
    .not("area2_m2", "is", null);
  if (artErr) throw new Error(`articles 조회 실패: ${artErr.message}`);
  log(PHASE, `articles (with area): ${articles.length}건`);

  // 4. complex_no별 전용면적 그룹핑
  const areaByComplex = new Map();
  for (const art of articles) {
    if (!areaByComplex.has(art.complex_no)) areaByComplex.set(art.complex_no, []);
    areaByComplex.get(art.complex_no).push(art.area2_m2);
  }

  // 5. apartment_id → complex 역색인 ( 기반)
  const aptToComplexes = new Map();
  for (const cpx of complexes) {
    const nearbyIds = cpx. || [];
    for (const aptId of nearbyIds) {
      if (!aptToComplexes.has(aptId)) aptToComplexes.set(aptId, []);
      aptToComplexes.get(aptId).push(cpx);
    }
  }

  // 6. 각 아파트에 대해 layout 추정
  let updated = 0, skipped = 0;

  for (const apt of apts) {
    // 매칭:  우선, 이름 유사도 폴백
    let matchedComplexes = aptToComplexes.get(apt.id) || [];

    if (matchedComplexes.length === 0) {
      for (const cpx of complexes) {
        const cpxName = (cpx.complex_name || "").replace(/\([^)]*\)/g, "").trim();
        if (stringSimilarity(cpxName, apt.name) >= 0.6) {
          matchedComplexes.push(cpx);
        }
      }
    }

    if (matchedComplexes.length === 0) { skipped++; continue; }

    // 전용면적: 매칭 단지의 매물 면적 중앙값 → 아파트 면적 폴백
    const allAreas = [];
    for (const cpx of matchedComplexes) {
      const areas = areaByComplex.get(cpx.complex_no) || [];
      allAreas.push(...areas);
    }

    const medianArea = median(allAreas);
    const area = medianArea ?? apt.area;

    if (area == null || area <= 0) { skipped++; continue; }

    // 베이 수 추정
    const bayCount = estimateBayCount(area);

    // 판상/타워 추정 (매칭 단지 중 첫 번째 기준, 복수면 합산)
    let typeScore = 0;
    for (const cpx of matchedComplexes) {
      const name = (cpx.complex_name || "").toLowerCase();
      if (name.includes("타워") || name.includes("tower")) typeScore += 1;
      if (cpx.high_floor != null) {
        if (cpx.high_floor >= TOWER_HIGH_FLOOR) typeScore += 1;
        if (cpx.high_floor < PLATE_LOW_FLOOR) typeScore -= 1;
      }
      if (cpx.total_household_count > 0 && cpx.high_floor > 0) {
        const density = cpx.total_household_count / cpx.high_floor;
        if (density <= TOWER_LOW_DENSITY) typeScore += 1;
        if (density >= PLATE_HIGH_DENSITY) typeScore -= 1;
      }
    }
    const buildingType = typeScore > 0 ? "타워" : "판상";
    const layout = toLayoutString(bayCount, buildingType);

    if (dryRun) {
      log(PHASE, `  [DRY] ${apt.name}: area=${area}m² → ${bayCount}베이, type=${buildingType} → ${layout}`);
      updated++;
      continue;
    }

    const { error } = await sb
      .from("apartments")
      .update({ layout, updated_at: new Date().toISOString() })
      .eq("id", apt.id);
    if (error) { logError(PHASE, `${apt.name}: ${error.message}`); skipped++; }
    else updated++;
  }

  log(PHASE, `\n=== 완료: 갱신 ${updated}, 건너뜀 ${skipped} ===`);
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
