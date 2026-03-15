/**
 * 네이버 단지 데이터 → apartments 동기화
 *
 * naver_complexes 테이블에 수집된 용적률, 주차대수, 최고층, 수영장 등을
 * apartments 테이블로 동기화합니다.
 *
 * 사용법:
 *   node scripts/collectors/sync-naver-complex.mjs              (Supabase UPDATE)
 *   node scripts/collectors/sync-naver-complex.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, stringSimilarity } from "./_shared.mjs";

loadEnv();

const PHASE = "sync-naver";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();

  // 1. naver_complexes에서 유용한 필드가 있는 데이터 조회
  const { data: complexes, error: cErr } = await sb
    .from("naver_complexes")
    .select("complex_no, complex_name, floor_area_ratio, total_parking_count, total_households, high_floor, has_pool, nearby_apartment_ids");

  if (cErr) throw new Error(`naver_complexes 조회 실패: ${cErr.message}`);
  log(PHASE, `naver_complexes: ${complexes.length}건`);

  // 2. apartments 조회
  const { data: apartments, error: aErr } = await sb
    .from("apartments")
    .select("id, name, floor_area_ratio, parking_ratio, max_floor, has_pool");

  if (aErr) throw new Error(`apartments 조회 실패: ${aErr.message}`);
  log(PHASE, `apartments: ${apartments.length}건`);

  // 3. nearby_apartment_ids 기반 매칭 또는 이름 유사도 매칭
  let updated = 0, skipped = 0;

  for (const cpx of complexes) {
    // nearby_apartment_ids에 직접 참조가 있으면 우선 사용
    const nearbyIds = cpx.nearby_apartment_ids || [];

    // 매칭 대상 아파트 찾기
    let matchedApts = [];
    if (nearbyIds.length > 0) {
      matchedApts = apartments.filter(a => nearbyIds.includes(a.id));
    }

    // 직접 매칭 없으면 이름 유사도로
    if (matchedApts.length === 0) {
      const cpxName = (cpx.complex_name || "").replace(/\([^)]*\)/g, "").trim();
      for (const apt of apartments) {
        if (stringSimilarity(cpxName, apt.name) >= 0.6) {
          matchedApts.push(apt);
        }
      }
    }

    if (matchedApts.length === 0) continue;

    // 4. 동기화할 필드 구성
    for (const apt of matchedApts) {
      const row = {};

      // 용적률: 아파트에 없고 네이버에 있으면 동기화
      if (apt.floor_area_ratio == null && cpx.floor_area_ratio != null) {
        row.floor_area_ratio = cpx.floor_area_ratio;
      }

      // 주차비율: total_parking / total_households
      if (apt.parking_ratio == null && cpx.total_parking_count && cpx.total_households > 0) {
        row.parking_ratio = Math.round((cpx.total_parking_count / cpx.total_households) * 100) / 100;
      }

      // 최고층
      if (apt.max_floor == null && cpx.high_floor != null) {
        row.max_floor = cpx.high_floor;
      }

      // 수영장
      if (apt.has_pool == null && cpx.has_pool === true) {
        row.has_pool = true;
      }

      if (Object.keys(row).length === 0) { skipped++; continue; }

      row.updated_at = new Date().toISOString();

      if (dryRun) {
        log(PHASE, `  [DRY-RUN] ${apt.name}: ${JSON.stringify(row)}`);
        updated++;
        continue;
      }

      const { error } = await sb.from("apartments").update(row).eq("id", apt.id);
      if (error) {
        logError(PHASE, `  ${apt.name} UPDATE 실패: ${error.message}`);
      } else {
        updated++;
      }
    }
  }

  log(PHASE, `\n=== 완료: 갱신 ${updated}, 건너뜀 ${skipped} ===`);
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
