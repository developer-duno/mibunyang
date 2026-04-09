/**
 * 네이버 단지 데이터 → apartments 동기화
 *
 * Phase 1: complexes → apartments (용적률, 주차, 최고층, 수영장)
 * Phase 2: articles → apartments (매물 수 집계 → 미분양 추정)
 * Phase 3: 시세/통계 → apartments (중위가, 전세가율, 건축연도, 층수, 주변단지수)
 * Phase 4: articles 집계 → apartments (평균 관리비, 대표 방향)
 *
 * 사용법:
 *   node scripts/collectors/sync-naver-complex.mjs              (Supabase UPDATE)
 *   node scripts/collectors/sync-naver-complex.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, getMibuyangSupabase, log, logError, stringSimilarity } from "./_shared.mjs";

loadEnv();

const PHASE = "sync-naver";

/** complex → apartment 매칭 (complex_links 우선, 이름 유사도 폴백) */
export function matchApartments(cpx, aptList, complexLinksMap) {
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

/** 중앙값 계산 */
export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid];
}

/** floor_info "3/15" → 3 파싱 */
export function parseFloor(fi) {
  if (!fi) return null;
  const first = String(fi).split("/")[0].trim();
  const KOR = { "저": 3, "중": 8, "고": 20 };
  if (KOR[first]) return KOR[first];
  const n = parseInt(first);
  return (n > 0 && n < 200) ? n : null;
}

/** Spatial grid index (0.02deg ~ 2km cells) */
export function buildSpatialGrid(allComplexes, cellSize = 0.02) {
  const grid = {};
  for (const cpx of allComplexes) {
    if (!cpx.latitude || !cpx.longitude) continue;
    const key = Math.floor(cpx.latitude / cellSize) + "," + Math.floor(cpx.longitude / cellSize);
    if (!grid[key]) grid[key] = [];
    grid[key].push(cpx);
  }
  return { grid, cellSize };
}

/** Find nearby complexes within radius using grid */
export function findNearbyComplexes(apt, spatialGrid, radiusKm = 2) {
  if (!apt.lat || !apt.lng) return [];
  const { grid, cellSize } = spatialGrid;
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const cellRadius = Math.ceil(radiusKm / (cellSize * 111));
  const cr = Math.floor(apt.lat / cellSize);
  const cc = Math.floor(apt.lng / cellSize);
  const results = [];
  for (let dr = -cellRadius; dr <= cellRadius; dr++) {
    for (let dc = -cellRadius; dc <= cellRadius; dc++) {
      const cell = grid[(cr + dr) + "," + (cc + dc)];
      if (!cell) continue;
      for (const cpx of cell) {
        const dLat = toRad(cpx.latitude - apt.lat);
        const dLon = toRad(cpx.longitude - apt.lng);
        const a = Math.sin(dLat/2)**2 + Math.cos(toRad(apt.lat)) * Math.cos(toRad(cpx.latitude)) * Math.sin(dLon/2)**2;
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        if (dist <= radiusKm) results.push(cpx.complex_no);
      }
    }
  }
  return results;
}



async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const sbMibunyang = getMibuyangSupabase();

  // 1. complexes에서 유용한 필드가 있는 데이터 조회
  // complexes 페이지네이션 (1000행 제한 우회)
  const complexes = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data: page, error: cErr } = await sbMibunyang
      .from("complexes")
      .select("complex_no, complex_name, floor_area_ratio, total_parking_count, total_household_count, high_floor, has_pool, use_approve_ymd, latitude, longitude, heat_fuel_type, corridor_type, building_coverage_ratio")
      .range(off, off + PAGE - 1);
    if (cErr) throw new Error(`complexes 조회 실패: ${cErr.message}`);
    complexes.push(...page);
    if (page.length < PAGE) break;
  }
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
    log(PHASE, `complex_links 미사용 (이름 유사도 매칭으로 폴백)`);
  } else if (complexLinks) {
    for (const cl of complexLinks) {
      if (!complexLinksMap.has(cl.complex_no)) complexLinksMap.set(cl.complex_no, []);
      complexLinksMap.get(cl.complex_no).push(cl.apartment_id);
    }
  }
  log(PHASE, `complex_links: ${complexLinksMap.size}개 단지 매핑`);

  log(PHASE, `heating_type 집계: ${Object.keys(heatingByComplex).length}개 단지`);

  // 2. apartments 조회 (페이지네이션 — 1000행 제한 우회)
  const apartments = [];
  for (let off = 0; ; off += PAGE) {
    const { data: page, error: aErr } = await sbMibunyang
      .from("apartments")
      .select("id, name, floor_area_ratio, parking_ratio, max_floor, has_pool, heating, exclusive_ratio, quake_design, view, sunlight, heat_fuel, corridor_type, building_coverage_ratio")
      .range(off, off + PAGE - 1);
    if (aErr) throw new Error(`apartments 조회 실패: ${aErr.message}`);
    apartments.push(...page);
    if (page.length < PAGE) break;
  }
  log(PHASE, `apartments: ${apartments.length}건`);

  // articles area/direction 조회 (전용률 + 조망/일조 계산용)
  const { data: areaRows, error: arErr } = await sbMibunyang
    .from("articles")
    .select("complex_no, area1_m2, area2_m2, direction, building_name")
    .eq("is_active", true)
    .range(0, 99999);
  if (arErr) logError(PHASE, `articles area 조회 실패: ${arErr.message}`);

  const articlesByComplex = {};
  for (const r of (areaRows || [])) {
    if (!articlesByComplex[r.complex_no]) articlesByComplex[r.complex_no] = [];
    articlesByComplex[r.complex_no].push(r);
  }
  log(PHASE, `articles area/direction: ${(areaRows || []).length}건`);

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

      // 난방연료 (complexes.heat_fuel_type → apartments.heat_fuel)
      if (apt.heat_fuel == null && cpx.heat_fuel_type != null) {
        row.heat_fuel = cpx.heat_fuel_type;
      }

      // 복도유형
      if (apt.corridor_type == null && cpx.corridor_type != null) {
        row.corridor_type = cpx.corridor_type;
      }

      // 건폐율
      if (apt.building_coverage_ratio == null && cpx.building_coverage_ratio != null) {
        row.building_coverage_ratio = cpx.building_coverage_ratio;
      }

      // 전용률: articles area1(공급)/area2(전용) 비율
      if (apt.exclusive_ratio == null) {
        const withArea = (articlesByComplex[cpx.complex_no] || [])
          .filter(a => a.area1_m2 > 0 && a.area2_m2 > 0);
        if (withArea.length >= 1) {
          const ratios = withArea.map(a => (a.area2_m2 / a.area1_m2) * 100);
          row.exclusive_ratio = Math.round(median(ratios) * 10) / 10;
        }
      }

      // 조망: building_name 키워드 → VIEW_SCORES 키 ("블루"/"그린") 매칭
      if (apt.view == null || apt.view === "") {
        const names = (articlesByComplex[cpx.complex_no] || [])
          .map(a => a.building_name).filter(Boolean).join(" ");
        if (/한강|낙동강|강변|리버|바다|해변|호수/.test(names)) row.view = "블루";
        else if (/산|봉|마운틴|공원|파크|숲/.test(names)) row.view = "그린";
      }

      // 일조: 남향 비율 기반 추정
      if (apt.sunlight == null || apt.sunlight === "") {
        const arts = (articlesByComplex[cpx.complex_no] || []).filter(a => a.direction);
        const southCount = arts.filter(a => /남/.test(a.direction)).length;
        if (arts.length > 0 && southCount / arts.length >= 0.5) {
          row.sunlight = "양호";
        }
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

    // apartments 재조회 (unsold 관련 필드, 페이지네이션)
    const aptsForUnsold = [];
    for (let off = 0; ; off += PAGE) {
      const { data: page, error: aErr2 } = await sbMibunyang
        .from("apartments")
        .select("id, name, units, unsold, unsold_rate, naver_sell_count, naver_jeonse_count, naver_wolse_count")
        .range(off, off + PAGE - 1);
      if (aErr2) { logError(PHASE, `apartments 재조회 실패: ${aErr2.message}`); break; }
      aptsForUnsold.push(...page);
      if (page.length < PAGE) break;
    }

    if (aptsForUnsold.length === 0) {
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

  const spatialGrid = buildSpatialGrid(complexes);
  log(PHASE, `공간 그리드: ${Object.keys(spatialGrid.grid).length}개 셀`);

  // ── Phase 3: 시세/통계 → naver_* 필드 동기화 ──
  log(PHASE, "\n── Phase 3: 시세/통계 → naver_* 필드 동기화 ──");

  // 3-a. complex_price_history 조회 (최근 데이터)
  const { data: priceRows, error: prErr } = await sbMibunyang
    .from("complex_price_history")
    .select("complex_no, trade_type, price_avg")
    .range(0, 99999);

  if (prErr) logError(PHASE, `price_history 조회 실패: ${prErr.message}`);

  // price_avg를 complex_no + trade_type별로 그룹핑
  const priceByComplex = {};
  if (priceRows) {
    for (const r of priceRows) {
      if (!r.price_avg || r.price_avg <= 0) continue;
      if (!priceByComplex[r.complex_no]) priceByComplex[r.complex_no] = { A1: [], B1: [] };
      if (r.trade_type === "A1") priceByComplex[r.complex_no].A1.push(r.price_avg);
      else if (r.trade_type === "B1") priceByComplex[r.complex_no].B1.push(r.price_avg);
    }
  }
  log(PHASE, `시세 데이터: ${Object.keys(priceByComplex).length}개 단지`);

  // 3-b. articles floor_info 조회
  const { data: floorRows, error: flErr } = await sbMibunyang
    .from("articles")
    .select("complex_no, floor_info")
    .eq("is_active", true)
    .not("floor_info", "is", null)
    .range(0, 99999);

  if (flErr) logError(PHASE, `articles floor 조회 실패: ${flErr.message}`);

  const floorByComplex = {};
  if (floorRows) {
    for (const r of floorRows) {
      const f = parseFloor(r.floor_info);
      if (f == null) continue;
      if (!floorByComplex[r.complex_no]) floorByComplex[r.complex_no] = [];
      floorByComplex[r.complex_no].push(f);
    }
  }
  log(PHASE, `층수 데이터: ${Object.keys(floorByComplex).length}개 단지`);

  // 3-c. apartments 재조회 (naver_* 필드, 페이지네이션)
  const aptsForNaver = [];
  for (let off = 0; ; off += PAGE) {
    const { data: page, error: aErr3 } = await sbMibunyang
      .from("apartments")
      .select("id, name, lat, lng, naver_nearby_median, naver_nearby_avg, naver_jeonse_rate, naver_build_year, naver_avg_floor, naver_nearby_count, naver_fetched_at")
      .range(off, off + PAGE - 1);
    if (aErr3) { logError(PHASE, `apartments naver 재조회 실패: ${aErr3.message}`); break; }
    aptsForNaver.push(...page);
    if (page.length < PAGE) break;
  }

  if (aptsForNaver.length === 0) {
    logError(PHASE, `apartments 재조회 실패: ${aErr3.message}`);
  } else {
    let naverUpdated = 0;
    const seen = new Set();

    for (const apt of aptsForNaver) {
      if (seen.has(apt.id)) continue;
      seen.add(apt.id);

      // 이 아파트 반경 2km 인근 단지 찾기
      const allCnos = findNearbyComplexes(apt, spatialGrid, 2);
      if (allCnos.length === 0) continue;

      const row = {};

        // 매매 시세 (A1) 중위/평균
        const salePrices = [];
        for (const cno of allCnos) {
          if (priceByComplex[cno]?.A1) salePrices.push(...priceByComplex[cno].A1);
        }
        if (salePrices.length > 0) {
          row.naver_nearby_median = median(salePrices);
          row.naver_nearby_avg = Math.round(salePrices.reduce((a, b) => a + b, 0) / salePrices.length);
        }

        // 전세 시세 (B1) → 전세가율
        const jeonPrices = [];
        for (const cno of allCnos) {
          if (priceByComplex[cno]?.B1) jeonPrices.push(...priceByComplex[cno].B1);
        }
        if (jeonPrices.length > 0 && salePrices.length > 0) {
          const saleMedian = median(salePrices);
          const jeonMedian = median(jeonPrices);
          if (saleMedian > 0) {
            row.naver_jeonse_rate = Math.round(jeonMedian / saleMedian * 1000) / 10;
          }
        }

        // 건축연도
        const years = [];
        for (const cno of allCnos) {
          const c = complexes.find(x => x.complex_no === cno);
          if (c?.use_approve_ymd) {
            const y = parseInt(String(c.use_approve_ymd).slice(0, 4));
            if (y > 1970 && y < 2040) years.push(y);
          }
        }
        if (years.length > 0) {
          row.naver_build_year = Math.round(years.reduce((a, b) => a + b, 0) / years.length);
        }

        // 평균 층수
        const floors = [];
        for (const cno of allCnos) {
          if (floorByComplex[cno]) floors.push(...floorByComplex[cno]);
        }
        if (floors.length > 0) {
          row.naver_avg_floor = Math.round(floors.reduce((a, b) => a + b, 0) / floors.length * 10) / 10;
        }

        // 주변 단지 수
        row.naver_nearby_count = allCnos.length;
        row.naver_fetched_at = new Date().toISOString();

        // naver_nearby_count + naver_fetched_at만 있으면 스킵
        if (Object.keys(row).length <= 2) continue;

        row.updated_at = new Date().toISOString();

        if (dryRun) {
          log(PHASE, `  [DRY-RUN] ${apt.name}: ${JSON.stringify(row)}`);
          naverUpdated++;
          continue;
        }

        const { error } = await sbMibunyang.from("apartments").update(row).eq("id", apt.id);
        if (error) {
          logError(PHASE, `  ${apt.name} naver UPDATE 실패: ${error.message}`);
        } else {
          naverUpdated++;
        }
      }

    log(PHASE, `Phase 3 완료: 시세/통계 갱신 ${naverUpdated}건`);
  }

  // ── Phase 4: articles 집계 → apartments (관리비, 방향) ──────
  {
    log(PHASE, "\n── Phase 4: 관리비/방향 집계 ──");

    // complex_no → apartment_id 매핑이 이미 Phase 2에서 구축됨
    // articles에서 complex_no별 관리비 평균, 방향 최빈값 집계 (페이지네이션)
    const articleStats = [];
    for (let off = 0; ; off += PAGE) {
      const { data: page, error: asErr } = await sbMibunyang
        .from("articles")
        .select("complex_no, numeric_maintenance_cost, direction")
        .eq("is_active", true)
        .range(off, off + PAGE - 1);
      if (asErr) { logError(PHASE, `articles 조회 실패: ${asErr.message}`); break; }
      articleStats.push(...page);
      if (page.length < PAGE) break;
    }

    if (articleStats.length > 0) {
      // complex_no별 집계
      const complexAgg = {};
      for (const art of (articleStats || [])) {
        const cn = art.complex_no;
        if (!complexAgg[cn]) complexAgg[cn] = { costs: [], dirs: {} };
        if (art.numeric_maintenance_cost != null && art.numeric_maintenance_cost > 0) {
          complexAgg[cn].costs.push(art.numeric_maintenance_cost);
        }
        if (art.direction) {
          complexAgg[cn].dirs[art.direction] = (complexAgg[cn].dirs[art.direction] || 0) + 1;
        }
      }

      let phase4Updated = 0;
      // complexes → apartments 매칭 (Phase 1과 동일 방식)
      for (const cpx of complexes) {
        const agg = complexAgg[cpx.complex_no];
        if (!agg) continue;
        const matchedApts = matchApartments(cpx, apartments, complexLinksMap);
        if (matchedApts.length === 0) continue;

        for (const apt of matchedApts) {
          const row = {};
          if (agg.costs.length > 0) {
            row.avg_maintenance_cost = Math.round(agg.costs.reduce((a, b) => a + b, 0) / agg.costs.length);
          }
          const dirEntries = Object.entries(agg.dirs);
          if (dirEntries.length > 0) {
            dirEntries.sort((a, b) => b[1] - a[1]);
            row.primary_direction = dirEntries[0][0];
          }
          if (Object.keys(row).length === 0) continue;
          if (dryRun) { log(PHASE, `  [DRY-RUN] ${apt.name}: ${JSON.stringify(row)}`); phase4Updated++; continue; }
          const { error } = await sbMibunyang.from("apartments").update(row).eq("id", apt.id);
          if (error) { logError(PHASE, `  ${apt.name} Phase4 UPDATE 실패: ${error.message}`); }
          else { phase4Updated++; }
        }
      }

      log(PHASE, `Phase 4 완료: 관리비/방향 갱신 ${phase4Updated}건`);
    }
  }

  log(PHASE, "\n=== 전체 동기화 완료 ===");
}

const isCLI = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isCLI) main().catch(err => { logError(PHASE, err.message); process.exit(1); });
