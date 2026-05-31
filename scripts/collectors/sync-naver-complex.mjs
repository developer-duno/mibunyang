// @ts-check
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
import { loadEnv, getSupabase, getMibuyangSupabase, log, logError, stringSimilarity, createSemaphore } from "./_shared.mjs";

/** @typedef {{ complex_no: string; complex_name: string | null; floor_area_ratio: number | null; total_parking_count: number | null; total_household_count: number | null; high_floor: number | null; has_pool: boolean | null; use_approve_ymd: string | null; latitude: number | null; longitude: number | null; heat_fuel_type: string | null; corridor_type: string | null; building_coverage_ratio: number | null }} ComplexRow */
/** @typedef {{ id: string; name: string; floor_area_ratio: number | null; parking_ratio: number | null; max_floor: number | null; has_pool: boolean | null; heating: string | null; exclusive_ratio: number | null; quake_design: unknown; view: string | null; sunlight: string | null; heat_fuel: string | null; corridor_type: string | null; building_coverage_ratio: number | null }} AptBaseRow */
/** @typedef {{ id: string; name: string; units: number | null; unsold: number | null; unsold_rate: number | null; naver_sell_count: number | null; naver_jeonse_count: number | null; naver_wolse_count: number | null }} AptUnsoldRow */
/** @typedef {{ id: string; name: string; lat: number | null; lng: number | null; naver_nearby_median: number | null; naver_nearby_avg: number | null; naver_jeonse_rate: number | null; naver_build_year: number | null; naver_avg_floor: number | null; naver_nearby_count: number | null; naver_fetched_at: string | null }} AptNaverRow */
/** @typedef {{ complex_no: string; area1_m2: number | null; area2_m2: number | null; direction: string | null; building_name: string | null }} ArticleAreaRow */
/** @typedef {{ complex_no: string; area1_m2: number | null; area2_m2: number | null; direction: string | null; building_name: string | null; trade_type_name: string | null; floor_info: string | null; numeric_maintenance_cost: number | null }} ArticleRow */
/** @typedef {{ grid: Record<string, ComplexRow[]>; cellSize: number }} SpatialGrid */

loadEnv();

const PHASE = "sync-naver";

/**
 * 전건 페이지네이션 fetch. PostgREST max_rows=1000 제한 우회.
 * 단일 .range(0, 99999) 호출은 1000건만 반환 → 1000행씩 끝까지 누적.
 * 1페이지 실패 시 throw 대신 { rows: 누적분, error } 반환 (graceful degradation 보존 —
 * articles fetch 가 실패해도 다른 필드 동기화는 계속).
 * @param {(sb: any) => any} buildQuery  - sb 받아 .from().select().eq()... 까지 빌드 (.range 제외)
 * @param {any} sb
 * @param {number} [page=1000]
 * @returns {Promise<{ rows: any[]; error: string | null }>}
 */
export async function fetchAllPages(buildQuery, sb, page = 1000) {
  /** @type {any[]} */
  const rows = [];
  for (let off = 0; ; off += page) {
    const { data, error } = await buildQuery(sb).range(off, off + page - 1);
    if (error) return { rows, error: error.message };
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < page) break;
  }
  return { rows, error: null };
}

/**
 * complex → apartment 매칭 (complex_links 우선, 이름 유사도 폴백)
 * @param {ComplexRow} cpx
 * @param {AptBaseRow[] | AptUnsoldRow[]} aptList
 * @param {Map<string, string[]>} complexLinksMap
 * @returns {(AptBaseRow | AptUnsoldRow)[]}
 */
export function matchApartments(cpx, aptList, complexLinksMap) {
  const nearbyIds = complexLinksMap.get(cpx.complex_no) || [];
  /** @type {(AptBaseRow | AptUnsoldRow)[]} */
  let matched = [];
  if (nearbyIds.length > 0) {
    matched = /** @type {(AptBaseRow | AptUnsoldRow)[]} */ (aptList).filter(a => nearbyIds.includes(a.id));
  }
  if (matched.length === 0) {
    const cpxName = (cpx.complex_name || "").replace(/\([^)]*\)/g, "").trim();
    for (const apt of /** @type {(AptBaseRow | AptUnsoldRow)[]} */ (aptList)) {
      if (stringSimilarity(cpxName, apt.name) >= 0.6) {
        matched.push(apt);
      }
    }
  }
  return matched;
}

/**
 * 중앙값 계산
 * @param {number[]} arr
 * @returns {number}
 */
export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid];
}

/**
 * floor_info "3/15" → 3 파싱
 * @param {string | null | undefined} fi
 * @returns {number | null}
 */
export function parseFloor(fi) {
  if (!fi) return null;
  const first = String(fi).split("/")[0].trim();
  /** @type {Record<string, number>} */
  const KOR = { "저": 3, "중": 8, "고": 20 };
  if (KOR[first]) return KOR[first];
  const n = parseInt(first);
  return (n > 0 && n < 200) ? n : null;
}

/**
 * Spatial grid index (0.02deg ~ 2km cells)
 * @param {ComplexRow[]} allComplexes
 * @param {number} [cellSize]
 * @returns {SpatialGrid}
 */
export function buildSpatialGrid(allComplexes, cellSize = 0.02) {
  /** @type {Record<string, ComplexRow[]>} */
  const grid = {};
  for (const cpx of allComplexes) {
    if (!cpx.latitude || !cpx.longitude) continue;
    const key = Math.floor(cpx.latitude / cellSize) + "," + Math.floor(cpx.longitude / cellSize);
    if (!grid[key]) grid[key] = [];
    grid[key].push(cpx);
  }
  return { grid, cellSize };
}

/**
 * Find nearby complexes within radius using grid
 * @param {{ lat: number | null; lng: number | null }} apt
 * @param {SpatialGrid} spatialGrid
 * @param {number} [radiusKm]
 * @returns {string[]}
 */
export function findNearbyComplexes(apt, spatialGrid, radiusKm = 2) {
  if (!apt.lat || !apt.lng) return [];
  const { grid, cellSize } = spatialGrid;
  const R = 6371;
  /** @param {number} d */
  const toRad = (d) => d * Math.PI / 180;
  const cellRadius = Math.ceil(radiusKm / (cellSize * 111));
  const cr = Math.floor(apt.lat / cellSize);
  const cc = Math.floor(apt.lng / cellSize);
  /** @type {string[]} */
  const results = [];
  for (let dr = -cellRadius; dr <= cellRadius; dr++) {
    for (let dc = -cellRadius; dc <= cellRadius; dc++) {
      const cell = grid[(cr + dr) + "," + (cc + dc)];
      if (!cell) continue;
      for (const cpx of cell) {
        if (cpx.latitude == null || cpx.longitude == null) continue;
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

/** @typedef {{ id: string; name: string; row: Record<string, unknown> }} AptUpdate */

/**
 * apartments 직렬 update → BATCH 슬라이스 병렬 (trade-stats.mjs L575 답습).
 * createSemaphore 는 실행 동시성만 제한하므로 whole-array Promise.all 대신
 * BATCH 슬라이스로 in-flight Promise 수를 BATCH 로 제한 (세션 355 critic 권고).
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {AptUpdate[]} updates
 * @param {string} label  실패 로그 접두어 (Phase 구분)
 * @returns {Promise<number>} 성공 건수
 */
async function flushUpdates(sb, updates, label) {
  if (updates.length === 0) return 0;
  const BATCH = 200;
  let ok = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    const limit = createSemaphore(10);
    const results = await Promise.all(
      slice.map((u) => limit(async () => await sb.from("apartments").update(u.row).eq("id", u.id)))
    );
    for (let j = 0; j < results.length; j++) {
      const { error } = /** @type {{ error: { message: string } | null }} */ (results[j]);
      if (error) logError(PHASE, `  ${slice[j].name} ${label ? label + " " : ""}UPDATE 실패: ${error.message}`);
      else ok++;
    }
  }
  return ok;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const sbMibunyang = getMibuyangSupabase();

  // 1. complexes에서 유용한 필드가 있는 데이터 조회
  // complexes 페이지네이션 (1000행 제한 우회)
  /** @type {ComplexRow[]} */
  const complexes = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data: page, error: cErr } = await sbMibunyang
      .from("complexes")
      .select("complex_no, complex_name, floor_area_ratio, total_parking_count, total_household_count, high_floor, has_pool, use_approve_ymd, latitude, longitude, heat_fuel_type, corridor_type, building_coverage_ratio")
      .range(off, off + PAGE - 1);
    if (cErr) throw new Error(`complexes 조회 실패: ${cErr.message}`);
    if (!page) break;
    complexes.push(.../** @type {ComplexRow[]} */ (page));
    if (page.length < PAGE) break;
  }
  log(PHASE, `complexes: ${complexes.length}건`);

  // 1-b. articles에서 complex_no별 최다 빈도 heating_type 집계
  const { data: heatingRows, error: hErr } = await sbMibunyang
    .from("articles")
    .select("complex_no, heating_type")
    .not("heating_type", "is", null);

  if (hErr) logError(PHASE, `articles heating 조회 실패: ${hErr.message}`);

  /** @type {Record<string, string>} */
  const heatingByComplex = {};
  if (heatingRows) {
    /** @type {Record<string, Record<string, number>>} */
    const freq = {};
    for (const r of /** @type {Array<{ complex_no: string; heating_type: string }>} */ (heatingRows)) {
      if (!freq[r.complex_no]) freq[r.complex_no] = {};
      freq[r.complex_no][r.heating_type] = (freq[r.complex_no][r.heating_type] || 0) + 1;
    }
    for (const [cno, types] of Object.entries(freq)) {
      const sorted = Object.entries(types).sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0) heatingByComplex[cno] = sorted[0][0];
    }
  }
  // complex_links 조회 (mibunyang 스키마)
  /** @type {Map<string, string[]>} */
  const complexLinksMap = new Map();
  const { data: complexLinks, error: clErr } = await sbMibunyang
    .from("complex_links")
    .select("complex_no, apartment_id")
    .range(0, 49999);

  if (clErr) {
    log(PHASE, `complex_links 미사용 (이름 유사도 매칭으로 폴백)`);
  } else if (complexLinks) {
    for (const cl of /** @type {Array<{ complex_no: string; apartment_id: string }>} */ (complexLinks)) {
      if (!complexLinksMap.has(cl.complex_no)) complexLinksMap.set(cl.complex_no, []);
      const list = complexLinksMap.get(cl.complex_no);
      if (list) list.push(cl.apartment_id);
    }
  }
  log(PHASE, `complex_links: ${complexLinksMap.size}개 단지 매핑`);

  log(PHASE, `heating_type 집계: ${Object.keys(heatingByComplex).length}개 단지`);

  // 2. apartments 조회 (페이지네이션 — 1000행 제한 우회)
  /** @type {AptBaseRow[]} */
  const apartments = [];
  for (let off = 0; ; off += PAGE) {
    const { data: page, error: aErr } = await sbMibunyang
      .from("apartments")
      .select("id, name, floor_area_ratio, parking_ratio, max_floor, has_pool, heating, exclusive_ratio, quake_design, view, sunlight, heat_fuel, corridor_type, building_coverage_ratio")
      .range(off, off + PAGE - 1);
    if (aErr) throw new Error(`apartments 조회 실패: ${aErr.message}`);
    if (!page) break;
    apartments.push(.../** @type {AptBaseRow[]} */ (page));
    if (page.length < PAGE) break;
  }
  log(PHASE, `apartments: ${apartments.length}건`);

  // articles 통합 조회 (1회 전건 fetch → Phase 1/2/3b/4 공유) — 같은 is_active=true 전건을
  // 4번 따로 읽던 것을 8컬럼 1회로 통합 (fetch ~16분 → ~4분). 매칭 캐시(아래)와 독립.
  const { rows: allArticles, error: artFetchErr } = await fetchAllPages(
    (s) => s.from("articles").select(
      "complex_no, area1_m2, area2_m2, direction, building_name, trade_type_name, floor_info, numeric_maintenance_cost",
    ).eq("is_active", true),
    sbMibunyang,
  );
  if (artFetchErr) logError(PHASE, `articles 통합 조회 실패: ${artFetchErr}`);
  log(PHASE, `articles 통합: ${allArticles.length}건`);

  /** @type {Record<string, ArticleAreaRow[]>} */
  const articlesByComplex = {};
  for (const r of /** @type {ArticleRow[]} */ (allArticles)) {
    if (!articlesByComplex[r.complex_no]) articlesByComplex[r.complex_no] = [];
    articlesByComplex[r.complex_no].push(r);
  }

  // 매칭 1회 계산 후 재사용 (세션 355): complex_links 부재 시 matchApartments 가
  // complexes(63,535) × apartments(2,001) 이름 유사도 LCS 폴백 → Phase 1·2·4 가
  // 같은 apartments 전체를 3번 매칭 = 3패스. complex_no → matched apt id[] 를
  // 1회만 계산해 공유 (3패스 → 1패스).
  /** @type {Map<string, string[]>} */
  const matchCache = new Map();
  for (const cpx of complexes) {
    const matched = matchApartments(cpx, apartments, complexLinksMap);
    if (matched.length > 0) matchCache.set(cpx.complex_no, matched.map(a => a.id));
  }
  log(PHASE, `매칭 캐시: ${matchCache.size}개 단지 (이후 Phase 재사용)`);

  /**
   * id → apt 인덱스 (캐시된 id 로 각 Phase 의 aptList 에서 O(1) 룩업)
   * @template {{ id: string }} T
   * @param {T[]} list
   * @returns {Map<string, T>}
   */
  const indexById = (list) => {
    /** @type {Map<string, T>} */
    const m = new Map();
    for (const a of list) m.set(a.id, a);
    return m;
  };

  // ── Phase 1: 단지정보 동기화 ──
  let updated = 0, skipped = 0;
  /** @type {AptUpdate[]} */
  const phase1Updates = [];
  const aptIndexBase = indexById(apartments);

  for (const cpx of complexes) {
    const ids = matchCache.get(cpx.complex_no);
    if (!ids) continue;
    const matchedApts = /** @type {AptBaseRow[]} */ (ids.map(id => aptIndexBase.get(id)).filter(Boolean));
    if (matchedApts.length === 0) continue;

    for (const apt of matchedApts) {
      /** @type {Record<string, unknown>} */
      const row = {};

      // 용적률: 아파트에 없고 네이버에 있으면 동기화
      if (apt.floor_area_ratio == null && cpx.floor_area_ratio != null) {
        row.floor_area_ratio = cpx.floor_area_ratio;
      }

      // 주차비율: total_parking / total_household_count
      if (apt.parking_ratio == null && cpx.total_parking_count && cpx.total_household_count && cpx.total_household_count > 0) {
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
          .filter(a => a.area1_m2 != null && a.area1_m2 > 0 && a.area2_m2 != null && a.area2_m2 > 0);
        if (withArea.length >= 1) {
          const ratios = withArea.map(a => (/** @type {number} */ (a.area2_m2) / /** @type {number} */ (a.area1_m2)) * 100);
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
        const southCount = arts.filter(a => /남/.test(/** @type {string} */ (a.direction))).length;
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

      phase1Updates.push({ id: apt.id, name: apt.name, row });
    }
  }

  updated += await flushUpdates(sbMibunyang, phase1Updates, "");
  log(PHASE, `\n=== Phase 1 완료: 단지정보 갱신 ${updated}, 건너뜀 ${skipped} ===`);

  // ── Phase 2: articles 매물 수 집계 → unsold / unsold_rate 업데이트 ──
  // (통합 fetch 한 allArticles 재사용 — trade_type_name 만 읽음)
  log(PHASE, "\n── Phase 2: 매물 수 기반 미분양 추정 ──");

  // 통합 fetch 실패/부분 시 매물 수가 과소 집계되어 unsold/unsold_rate(핵심 미분양 지표)가
  // silent 하게 작아짐 → Phase 2 만 스킵 (변경 전 `if(artErr){skip}` 동작 복원).
  // 다른 Phase(전용률/조망/일조/시세/층수/관리비)는 "계산값 있을 때만 write" 가드라 부분 진행 무해.
  if (artFetchErr) {
    logError(PHASE, "Phase 2 스킵 — articles 통합 조회 실패로 매물수 과소 집계 위험");
  } else {
    // 집계: { complex_no: { sell, jeonse, wolse } }
    /** @type {Record<string, { sell: number; jeonse: number; wolse: number }>} */
    const counts = {};
    for (const row of /** @type {ArticleRow[]} */ (allArticles)) {
      if (!counts[row.complex_no]) counts[row.complex_no] = { sell: 0, jeonse: 0, wolse: 0 };
      if (row.trade_type_name === "매매") counts[row.complex_no].sell++;
      else if (row.trade_type_name === "전세") counts[row.complex_no].jeonse++;
      else if (row.trade_type_name === "월세") counts[row.complex_no].wolse++;
    }
    log(PHASE, `active 매물 집계: ${Object.keys(counts).length}개 단지`);

    // apartments 재조회 (unsold 관련 필드, 페이지네이션)
    /** @type {AptUnsoldRow[]} */
    const aptsForUnsold = [];
    /** @type {string | null} */
    let aErr2Msg = null;
    for (let off = 0; ; off += PAGE) {
      const { data: page, error: aErr2 } = await sbMibunyang
        .from("apartments")
        .select("id, name, units, unsold, unsold_rate, naver_sell_count, naver_jeonse_count, naver_wolse_count")
        .range(off, off + PAGE - 1);
      if (aErr2) { aErr2Msg = aErr2.message; logError(PHASE, `apartments 재조회 실패: ${aErr2Msg}`); break; }
      if (!page) break;
      aptsForUnsold.push(.../** @type {AptUnsoldRow[]} */ (page));
      if (page.length < PAGE) break;
    }

    if (aptsForUnsold.length === 0) {
      logError(PHASE, `apartments 재조회 실패: ${aErr2Msg ?? "데이터 없음"}`);
    } else {
      let unsoldUpdated = 0;
      /** @type {AptUpdate[]} */
      const phase2Updates = [];
      const aptIndexUnsold = indexById(aptsForUnsold);

      for (const cpx of complexes) {
        const cnt = counts[cpx.complex_no];
        if (!cnt) continue;

        const ids = matchCache.get(cpx.complex_no);
        if (!ids) continue;
        const matchedApts = /** @type {AptUnsoldRow[]} */ (ids.map(id => aptIndexUnsold.get(id)).filter(Boolean));
        if (matchedApts.length === 0) continue;

        for (const apt of matchedApts) {
          /** @type {Record<string, unknown>} */
          const row = {};

          // 매물 수 업데이트
          if (cnt.sell !== (apt.naver_sell_count ?? 0)) row.naver_sell_count = cnt.sell;
          if (cnt.jeonse !== (apt.naver_jeonse_count ?? 0)) row.naver_jeonse_count = cnt.jeonse;
          if (cnt.wolse !== (apt.naver_wolse_count ?? 0)) row.naver_wolse_count = cnt.wolse;

          // 매매 매물 수를 미분양 근사치로 사용
          if (cnt.sell > 0 && apt.units != null && apt.units > 0) {
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

          phase2Updates.push({ id: apt.id, name: apt.name, row });
        }
      }

      unsoldUpdated += await flushUpdates(sbMibunyang, phase2Updates, "매물수");
      log(PHASE, `Phase 2 완료: 매물수 기반 갱신 ${unsoldUpdated}건`);
    }
  }

  const spatialGrid = buildSpatialGrid(complexes);
  log(PHASE, `공간 그리드: ${Object.keys(spatialGrid.grid).length}개 셀`);

  // ── Phase 3: 시세/통계 → naver_* 필드 동기화 ──
  log(PHASE, "\n── Phase 3: 시세/통계 → naver_* 필드 동기화 ──");

  // 3-a. complex_price_history 조회 (최근 데이터) — 전건 페이지네이션
  const { rows: priceRows, error: prErr } = await fetchAllPages(
    (s) => s.from("complex_price_history").select("complex_no, trade_type, price_avg"),
    sbMibunyang,
  );

  if (prErr) logError(PHASE, `price_history 조회 실패: ${prErr}`);

  // price_avg를 complex_no + trade_type별로 그룹핑
  /** @type {Record<string, { A1: number[]; B1: number[] }>} */
  const priceByComplex = {};
  if (priceRows) {
    for (const r of /** @type {Array<{ complex_no: string; trade_type: string; price_avg: number | null }>} */ (priceRows)) {
      if (!r.price_avg || r.price_avg <= 0) continue;
      if (!priceByComplex[r.complex_no]) priceByComplex[r.complex_no] = { A1: [], B1: [] };
      if (r.trade_type === "A1") priceByComplex[r.complex_no].A1.push(r.price_avg);
      else if (r.trade_type === "B1") priceByComplex[r.complex_no].B1.push(r.price_avg);
    }
  }
  log(PHASE, `시세 데이터: ${Object.keys(priceByComplex).length}개 단지`);

  // 3-b. articles floor_info 집계 (통합 fetch 한 allArticles 재사용 — floor_info 만 읽음.
  // parseFloor(null)=null 이 아래 continue 로 스킵되므로 not-null 필터 불필요)
  /** @type {Record<string, number[]>} */
  const floorByComplex = {};
  for (const r of /** @type {ArticleRow[]} */ (allArticles)) {
    const f = parseFloor(r.floor_info);
    if (f == null) continue;
    if (!floorByComplex[r.complex_no]) floorByComplex[r.complex_no] = [];
    floorByComplex[r.complex_no].push(f);
  }
  log(PHASE, `층수 데이터: ${Object.keys(floorByComplex).length}개 단지`);

  // 3-c. apartments 재조회 (naver_* 필드, 페이지네이션)
  /** @type {AptNaverRow[]} */
  const aptsForNaver = [];
  /** @type {string | null} */
  let aErr3Msg = null;
  for (let off = 0; ; off += PAGE) {
    const { data: page, error: aErr3 } = await sbMibunyang
      .from("apartments")
      .select("id, name, lat, lng, naver_nearby_median, naver_nearby_avg, naver_jeonse_rate, naver_build_year, naver_avg_floor, naver_nearby_count, naver_fetched_at")
      .range(off, off + PAGE - 1);
    if (aErr3) { aErr3Msg = aErr3.message; logError(PHASE, `apartments naver 재조회 실패: ${aErr3Msg}`); break; }
    if (!page) break;
    aptsForNaver.push(.../** @type {AptNaverRow[]} */ (page));
    if (page.length < PAGE) break;
  }

  if (aptsForNaver.length === 0) {
    logError(PHASE, `apartments 재조회 실패: ${aErr3Msg ?? "데이터 없음"}`);
  } else {
    let naverUpdated = 0;
    /** @type {AptUpdate[]} */
    const phase3Updates = [];
    /** @type {Set<string>} */
    const seen = new Set();

    for (const apt of aptsForNaver) {
      if (seen.has(apt.id)) continue;
      seen.add(apt.id);

      // 이 아파트 반경 2km 인근 단지 찾기
      const allCnos = findNearbyComplexes(apt, spatialGrid, 2);
      if (allCnos.length === 0) continue;

      /** @type {Record<string, unknown>} */
      const row = {};

        // 매매 시세 (A1) 중위/평균
        /** @type {number[]} */
        const salePrices = [];
        for (const cno of allCnos) {
          if (priceByComplex[cno]?.A1) salePrices.push(...priceByComplex[cno].A1);
        }
        if (salePrices.length > 0) {
          row.naver_nearby_median = median(salePrices);
          row.naver_nearby_avg = Math.round(salePrices.reduce((a, b) => a + b, 0) / salePrices.length);
        }

        // 전세 시세 (B1) → 전세가율
        /** @type {number[]} */
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
        /** @type {number[]} */
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
        /** @type {number[]} */
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

        phase3Updates.push({ id: apt.id, name: apt.name, row });
      }

    naverUpdated += await flushUpdates(sbMibunyang, phase3Updates, "naver");
    log(PHASE, `Phase 3 완료: 시세/통계 갱신 ${naverUpdated}건`);
  }

  // ── Phase 4: articles 집계 → apartments (관리비, 방향) ──────
  {
    log(PHASE, "\n── Phase 4: 관리비/방향 집계 ──");

    // complex_no → apartment_id 매핑이 이미 Phase 2에서 구축됨
    // articles 관리비 평균·방향 최빈값 집계 (통합 fetch 한 allArticles 재사용 —
    // numeric_maintenance_cost + direction 만 읽음)
    if (allArticles.length > 0) {
      // complex_no별 집계
      /** @type {Record<string, { costs: number[]; dirs: Record<string, number> }>} */
      const complexAgg = {};
      for (const art of /** @type {ArticleRow[]} */ (allArticles)) {
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
      /** @type {AptUpdate[]} */
      const phase4Updates = [];
      // complexes → apartments 매칭 (Phase 1 매칭 캐시 + 인덱스 재사용)
      for (const cpx of complexes) {
        const agg = complexAgg[cpx.complex_no];
        if (!agg) continue;
        const ids = matchCache.get(cpx.complex_no);
        if (!ids) continue;
        const matchedApts = /** @type {AptBaseRow[]} */ (ids.map(id => aptIndexBase.get(id)).filter(Boolean));
        if (matchedApts.length === 0) continue;

        for (const apt of matchedApts) {
          /** @type {Record<string, unknown>} */
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
          phase4Updates.push({ id: apt.id, name: apt.name, row });
        }
      }

      phase4Updated += await flushUpdates(sbMibunyang, phase4Updates, "Phase4");
      log(PHASE, `Phase 4 완료: 관리비/방향 갱신 ${phase4Updated}건`);
    }
  }

  log(PHASE, "\n=== 전체 동기화 완료 ===");
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((/** @type {unknown} */ err) => {
  logError(PHASE, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
