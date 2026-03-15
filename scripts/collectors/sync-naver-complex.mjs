/**
 * 네이버 단지 데이터 → apartments 동기화
 *
 * Phase 1: naver_complexes → apartments (용적률, 주차, 최고층, 수영장)
 * Phase 2: naver_articles → apartments (매물 수 집계 → 미분양 추정)
 *
 * 사용법:
 *   node scripts/collectors/sync-naver-complex.mjs              (Supabase UPDATE)
 *   node scripts/collectors/sync-naver-complex.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, stringSimilarity } from "./_shared.mjs";

loadEnv();

const PHASE = "sync-naver";

/** complex → apartment 매칭 (nearby_apartment_ids 우선, 이름 유사도 폴백) */
function matchApartments(cpx, aptList) {
  const nearbyIds = cpx.nearby_apartment_ids || [];
  let matched = [];
  if (nearbyIds.length > 0) {
    matched = aptList.filter(a => nearbyIds.includes(a.id));
  }
  if (matched.length === 0) {
    const cpxName = (cpx.complex_name || "").replace(/\([^)]*\)/g, "").trim();
    for (const apt of aptList) {
      if (stringSimilarity(cpxName, apt.name) >= 0.6) {
        matched.push(apt);
      }
    }
  }
  return matched;
}

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

  // ── Phase 1: 단지정보 동기화 ──
  let updated = 0, skipped = 0;

  for (const cpx of complexes) {
    const matchedApts = matchApartments(cpx, apartments);
    if (matchedApts.length === 0) continue;

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

  log(PHASE, `\n=== Phase 1 완료: 단지정보 갱신 ${updated}, 건너뜀 ${skipped} ===`);

  // ── Phase 2: naver_articles 매물 수 집계 → unsold / unsold_rate 업데이트 ──
  log(PHASE, "\n── Phase 2: 매물 수 기반 미분양 추정 ──");

  const { data: articles, error: artErr } = await sb
    .from("naver_articles")
    .select("complex_no, trade_type")
    .eq("is_active", true);

  if (artErr) {
    logError(PHASE, `naver_articles 조회 실패: ${artErr.message}`);
  } else {
    // 집계: { complex_no: { sell, jeonse, wolse } }
    const counts = {};
    for (const row of articles) {
      if (!counts[row.complex_no]) counts[row.complex_no] = { sell: 0, jeonse: 0, wolse: 0 };
      if (row.trade_type === "매매") counts[row.complex_no].sell++;
      else if (row.trade_type === "전세") counts[row.complex_no].jeonse++;
      else if (row.trade_type === "월세") counts[row.complex_no].wolse++;
    }
    log(PHASE, `active 매물 집계: ${Object.keys(counts).length}개 단지`);

    // apartments 재조회 (unsold 관련 필드)
    const { data: aptsForUnsold, error: aErr2 } = await sb
      .from("apartments")
      .select("id, name, units, unsold, unsold_rate, naver_sell_count, naver_jeonse_count, naver_wolse_count");

    if (aErr2) {
      logError(PHASE, `apartments 재조회 실패: ${aErr2.message}`);
    } else {
      let unsoldUpdated = 0;

      for (const cpx of complexes) {
        const cnt = counts[cpx.complex_no];
        if (!cnt) continue;

        const matchedApts = matchApartments(cpx, aptsForUnsold);
        if (matchedApts.length === 0) continue;

        for (const apt of matchedApts) {
          const row = {};

          // 매물 수 업데이트
          if (cnt.sell !== (apt.naver_sell_count ?? 0)) row.naver_sell_count = cnt.sell;
          if (cnt.jeonse !== (apt.naver_jeonse_count ?? 0)) row.naver_jeonse_count = cnt.jeonse;
          if (cnt.wolse !== (apt.naver_wolse_count ?? 0)) row.naver_wolse_count = cnt.wolse;

          // 매매 매물 수를 미분양 근사치로 사용
          if (cnt.sell > 0 && apt.units > 0) {
            row.unsold = cnt.sell;
            row.unsold_rate = Math.round(cnt.sell / apt.units * 1000) / 10;
          }

          if (Object.keys(row).length === 0) continue;

          row.updated_at = new Date().toISOString();

          if (dryRun) {
            log(PHASE, `  [DRY-RUN] ${apt.name}: ${JSON.stringify(row)}`);
            unsoldUpdated++;
            continue;
          }

          const { error } = await sb.from("apartments").update(row).eq("id", apt.id);
          if (error) {
            logError(PHASE, `  ${apt.name} 매물수 UPDATE 실패: ${error.message}`);
          } else {
            unsoldUpdated++;
          }
        }
      }

      log(PHASE, `Phase 2 완료: 매물수 기반 갱신 ${unsoldUpdated}건`);
    }
  }

  log(PHASE, "\n=== 전체 동기화 완료 ===");
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
