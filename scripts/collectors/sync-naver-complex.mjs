/**
 * 네이버 단지 데이터 → apartments 동기화
 *
 * Phase 1: complexes → apartments (용적률, 주차, 최고층, 수영장)
 * Phase 2: articles → apartments (매물 수 집계 → 미분양 추정)
 *
 * 사용법:
 *   node scripts/collectors/sync-naver-complex.mjs              (Supabase UPDATE)
 *   node scripts/collectors/sync-naver-complex.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, getMibuyangSupabase, log, logError, stringSimilarity } from "./_shared.mjs";

loadEnv();

const PHASE = "sync-naver";

/** complex → apartment 매칭 (complex_links 우선, 이름 유사도 폴백) */
function matchApartments(cpx, aptList, complexLinksMap) {
  const nearbyIds = complexLinksMap.get(cpx.complex_no) || [];
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
  const sbMibunyang = getMibuyangSupabase();

  // 1. complexes에서 유용한 필드가 있는 데이터 조회
  const { data: complexes, error: cErr } = await sbMibunyang
    .from("complexes")
    .select("complex_no, complex_name, floor_area_ratio, total_parking_count, total_household_count, high_floor, has_pool")
    .range(0, 9999);

  if (cErr) throw new Error(`complexes 조회 실패: ${cErr.message}`);
  log(PHASE, `complexes: ${complexes.length}건`);

  // 1-b. articles에서 complex_no별 최다 빈도 heating_type 집계
  const { data: heatingRows, error: hErr } = await sbMibunyang
    .from("articles")
    .select("complex_no, heating_type")
    .not("heating_type", "is", null);

  if (hErr) logError(PHASE, `articles heating 조회 실패: ${hErr.message}`);

  const heatingByComplex = {};
  if (heatingRows) {
    const freq = {};
    for (const r of heatingRows) {
      if (!freq[r.complex_no]) freq[r.complex_no] = {};
      freq[r.complex_no][r.heating_type] = (freq[r.complex_no][r.heating_type] || 0) + 1;
    }
    for (const [cno, types] of Object.entries(freq)) {
      const sorted = Object.entries(types).sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0) heatingByComplex[cno] = sorted[0][0];
    }
  }
  // complex_links 조회 (mibunyang 스키마)
  const complexLinksMap = new Map();
  const { data: complexLinks, error: clErr } = await sbMibunyang
    .from("complex_links")
    .select("complex_no, apartment_id")
    .range(0, 49999);

  if (clErr) {
    logError(PHASE, `complex_links 조회 실패: ${clErr.message}`);
  } else if (complexLinks) {
    for (const cl of complexLinks) {
      if (!complexLinksMap.has(cl.complex_no)) complexLinksMap.set(cl.complex_no, []);
      complexLinksMap.get(cl.complex_no).push(cl.apartment_id);
    }
  }
  log(PHASE, `complex_links: ${complexLinksMap.size}개 단지 매핑`);

  log(PHASE, `heating_type 집계: ${Object.keys(heatingByComplex).length}개 단지`);

  // 2. apartments 조회
  const { data: apartments, error: aErr } = await sbMibunyang
    .from("apartments")
    .select("id, name, floor_area_ratio, parking_ratio, max_floor, has_pool, heating")
    .range(0, 9999);

  if (aErr) throw new Error(`apartments 조회 실패: ${aErr.message}`);
  log(PHASE, `apartments: ${apartments.length}건`);

  // ── Phase 1: 단지정보 동기화 ──
  let updated = 0, skipped = 0;

  for (const cpx of complexes) {
    const matchedApts = matchApartments(cpx, apartments, complexLinksMap);
    if (matchedApts.length === 0) continue;

    for (const apt of matchedApts) {
      const row = {};

      // 용적률: 아파트에 없고 네이버에 있으면 동기화
      if (apt.floor_area_ratio == null && cpx.floor_area_ratio != null) {
        row.floor_area_ratio = cpx.floor_area_ratio;
      }

      // 주차비율: total_parking / total_household_count
      if (apt.parking_ratio == null && cpx.total_parking_count && cpx.total_household_count > 0) {
        row.parking_ratio = Math.round((cpx.total_parking_count / cpx.total_household_count) * 100) / 100;
      }

      // 최고층
      if (apt.max_floor == null && cpx.high_floor != null) {
        row.max_floor = cpx.high_floor;
      }

      // 수영장
      if (apt.has_pool == null && cpx.has_pool === true) {
        row.has_pool = true;
      }

      // 난방방식 (articles에서 집계)
      if (apt.heating == null && heatingByComplex[cpx.complex_no]) {
        row.heating = heatingByComplex[cpx.complex_no];
      }

      if (Object.keys(row).length === 0) { skipped++; continue; }

      row.updated_at = new Date().toISOString();

      if (dryRun) {
        log(PHASE, `  [DRY-RUN] ${apt.name}: ${JSON.stringify(row)}`);
        updated++;
        continue;
      }

      const { error } = await sbMibunyang.from("apartments").update(row).eq("id", apt.id);
      if (error) {
        logError(PHASE, `  ${apt.name} UPDATE 실패: ${error.message}`);
      } else {
        updated++;
      }
    }
  }

  log(PHASE, `\n=== Phase 1 완료: 단지정보 갱신 ${updated}, 건너뜀 ${skipped} ===`);

  // ── Phase 2: articles 매물 수 집계 → unsold / unsold_rate 업데이트 ──
  log(PHASE, "\n── Phase 2: 매물 수 기반 미분양 추정 ──");

  const { data: articles, error: artErr } = await sbMibunyang
    .from("articles")
    .select("complex_no, trade_type_name")
    .eq("is_active", true)
    .range(0, 99999);

  if (artErr) {
    logError(PHASE, `articles 조회 실패: ${artErr.message}`);
  } else {
    // 집계: { complex_no: { sell, jeonse, wolse } }
    const counts = {};
    for (const row of articles) {
      if (!counts[row.complex_no]) counts[row.complex_no] = { sell: 0, jeonse: 0, wolse: 0 };
      if (row.trade_type_name === "매매") counts[row.complex_no].sell++;
      else if (row.trade_type_name === "전세") counts[row.complex_no].jeonse++;
      else if (row.trade_type_name === "월세") counts[row.complex_no].wolse++;
    }
    log(PHASE, `active 매물 집계: ${Object.keys(counts).length}개 단지`);

    // apartments 재조회 (unsold 관련 필드)
    const { data: aptsForUnsold, error: aErr2 } = await sbMibunyang
      .from("apartments")
      .select("id, name, units, unsold, unsold_rate, naver_sell_count, naver_jeonse_count, naver_wolse_count")
      .range(0, 9999);

    if (aErr2) {
      logError(PHASE, `apartments 재조회 실패: ${aErr2.message}`);
    } else {
      let unsoldUpdated = 0;

      for (const cpx of complexes) {
        const cnt = counts[cpx.complex_no];
        if (!cnt) continue;

        const matchedApts = matchApartments(cpx, aptsForUnsold, complexLinksMap);
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

          const { error } = await sbMibunyang.from("apartments").update(row).eq("id", apt.id);
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
