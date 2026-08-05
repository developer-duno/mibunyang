// @ts-check
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
import { loadEnv, getSupabase, getMibuyangSupabase, log, logError, stringSimilarity, selectAll } from "./_shared.mjs";

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

/**
 * 면적(m²)으로 베이 수 추정
 * @param {number} area
 * @returns {number}
 */
function estimateBayCount(area) {
  if (area >= BAY4_THRESHOLD) return 4;
  if (area >= BAY3_THRESHOLD) return 3;
  return 2;
}

/**
 * 건물 특성으로 판상/타워 판별 (양수=타워, 0이하=판상)
 * @param {string | null | undefined} complexName
 * @param {number | null} highFloor
 * @param {number | null} totalHouseholds
 * @returns {"타워" | "판상"}
 */
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
  if (totalHouseholds != null && totalHouseholds > 0 && highFloor != null && highFloor > 0) {
    const density = totalHouseholds / highFloor;
    if (density <= TOWER_LOW_DENSITY) score += 1;
    if (density >= PLATE_HIGH_DENSITY) score -= 1;
  }

  return score > 0 ? "타워" : "판상";
}

/**
 * 베이 수 + 건물 유형 → layout 문자열
 * @param {number} bayCount
 * @param {string} buildingType
 * @returns {string}
 */
function toLayoutString(bayCount, buildingType) {
  if (bayCount <= 2) return "2베이이하";
  return `${bayCount}베이${buildingType}`;
}

/**
 * 배열의 중앙값
 * @param {number[]} arr
 * @returns {number | null}
 */
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
  const sbMibunyang = getMibuyangSupabase();

  // ⚠️ 세션 491 — 아래 세 조회는 전부 PostgREST max_rows=1000 함정에 걸려 있었다.
  //    `.limit(10000)` 은 숫자를 아무리 크게 줘도 **최대 1000행**만 돌아오고,
  //    limit 을 아예 안 써도 기본값이 1000 이라 마찬가지로 잘린다.
  //    그 결과 실측 로그가 매주 `대상: 1000건 / complexes: 1000건 / articles: 1000건
  //    → 갱신 0, 건너뜀 1000` — 서로 다른 complex_no 1000개씩을 뽑아 놓으니 매칭이 0이었다.
  //    3주 연속 갱신 0건이었고 layout 은 1109/1592(69.7%) 비어 있었다.
  //    전량 조회는 selectAll 페이지네이션으로만. 선례 = 커밋 01d0dd4(세션 295)·b348ac1(세션 490).

  // 1. layout이 없는 아파트 조회
  const apts = /** @type {{ id: string, name: string, area: number | null }[]} */ (
    await selectAll((s) => s.from("apartments_flat").select("id, name, area").is("layout", null), sb)
  );
  log(PHASE, `대상: ${apts.length}건 (layout null)`);

  if (!apts.length) { log(PHASE, "대상 없음, 종료"); return; }

  // 2. complexes 조회
  const complexes = /** @type {{ complex_no: string, complex_name: string, high_floor: number | null, total_household_count: number | null }[]} */ (
    await selectAll((s) => s.from("complexes").select("complex_no, complex_name, high_floor, total_household_count"), sb)
  );
  log(PHASE, `complexes: ${complexes.length}건`);

  // 3. apartment_id → complex 역색인 (complex_links 테이블 기반)
  const aptToComplexes = new Map();
  const { data: complexLinks, error: clErr } = await sbMibunyang
    .from("complex_links")
    .select("complex_no, apartment_id")
    .range(0, 49999);

  if (clErr) {
    log(PHASE, `complex_links 조회 실패, 이름 유사도 매칭만 사용: ${clErr.message}`);
  } else if (complexLinks) {
    const complexMap = new Map(complexes.map(c => [c.complex_no, c]));
    for (const cl of complexLinks) {
      const cpx = complexMap.get(cl.complex_no);
      if (!cpx) continue;
      if (!aptToComplexes.has(cl.apartment_id)) aptToComplexes.set(cl.apartment_id, []);
      aptToComplexes.get(cl.apartment_id).push(cpx);
    }
    log(PHASE, `complex_links: ${aptToComplexes.size}개 아파트 매핑`);
  }

  // 4. 매칭 선행 — 필요한 complex_no 만 추린다 (세션 491)
  //
  // ⚠️ 이전에는 여기서 articles 전량(17만 건)을 읽었다. selectAll 로 전량을 받으려 하면
  //    `canceling statement due to statement timeout` 으로 **매번 실패**한다(dry-run 실측).
  //    게다가 articles(131만 행)는 자매 레포 naver-estate-web 과 **공유하는 테이블**이라
  //    무거운 전량 조회는 저쪽 라이브 서비스에도 부담이 된다.
  //    실제로 쓰이는 건 "매칭된 단지의 면적"뿐이므로, 매칭을 먼저 하고 그 단지만 조회한다.
  //
  // 부수 효과로 기존 버그도 사라진다 — 옛 코드는 `aptToComplexes.get()` 이 돌려준 배열에
  // 직접 push 해 원본 색인을 오염시켰다. 아래는 filter 로 새 배열을 만든다.
  /** @type {Map<string, any[]>} */
  const matchByApt = new Map();
  /** @type {Set<string>} */
  const neededNos = new Set();
  for (const apt of apts) {
    let matched = aptToComplexes.get(apt.id) || [];
    if (matched.length === 0) {
      matched = complexes.filter((cpx) => {
        const cpxName = (cpx.complex_name || "").replace(/\([^)]*\)/g, "").trim();
        return stringSimilarity(cpxName, apt.name) >= 0.6;
      });
    }
    matchByApt.set(apt.id, matched);
    for (const cpx of matched) neededNos.add(cpx.complex_no);
  }
  log(PHASE, `매칭된 단지: ${neededNos.size}개 (대상 ${apts.length}건 기준)`);

  // 5. 매칭된 단지의 전용면적만 조회 → complex_no별 그룹핑
  /** @type {Map<string, number[]>} */
  const areaByComplex = new Map();
  const nos = [...neededNos];
  const CHUNK = 200;
  let artCount = 0;
  for (let i = 0; i < nos.length; i += CHUNK) {
    const chunk = nos.slice(i, i + CHUNK);
    const rows = /** @type {{ complex_no: string, area2_m2: number }[]} */ (
      await selectAll(
        (s) =>
          s
            .from("articles")
            .select("complex_no, area2_m2")
            .in("complex_no", chunk)
            .eq("is_active", true)
            .not("area2_m2", "is", null),
        sb,
      )
    );
    for (const art of rows) {
      if (!areaByComplex.has(art.complex_no)) areaByComplex.set(art.complex_no, []);
      (areaByComplex.get(art.complex_no) ?? []).push(art.area2_m2);
      artCount++;
    }
  }
  log(PHASE, `articles (with area): ${artCount}건 / 단지 ${areaByComplex.size}개`);

  // 6. 각 아파트에 대해 layout 추정
  let updated = 0, skipped = 0;

  for (const apt of apts) {
    const matchedComplexes = matchByApt.get(apt.id) || [];
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
      if (cpx.total_household_count != null && cpx.total_household_count > 0 && cpx.high_floor != null && cpx.high_floor > 0) {
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

// CLI 직접 실행 시에만 main() 호출 (테스트 환경 보호)
const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  logError(PHASE, msg);
  process.exit(1);
});

// 테스트용 순수 함수 export
export { estimateBayCount, estimateBuildingType, toLayoutString, median };
