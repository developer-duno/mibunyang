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
import { loadEnv, getSupabase, getMibuyangSupabase, log, logError, stringSimilarity, createSemaphore, recordCollectorRun, selectAll } from "./_shared.mjs";

/** @typedef {{ complex_no: string; complex_name: string | null; floor_area_ratio: number | null; total_parking_count: number | null; total_household_count: number | null; high_floor: number | null; has_pool: boolean | null; use_approve_ymd: string | null; latitude: number | null; longitude: number | null; heat_fuel_type: string | null; corridor_type: string | null; building_coverage_ratio: number | null }} ComplexRow */
/** @typedef {{ id: string; name: string; lat: number | null; lng: number | null; floor_area_ratio: number | null; parking_ratio: number | null; max_floor: number | null; has_pool: boolean | null; heating: string | null; exclusive_ratio: number | null; quake_design: unknown; view: string | null; sunlight: string | null; heat_fuel: string | null; corridor_type: string | null; building_coverage_ratio: number | null }} AptBaseRow */
/** @typedef {{ id: string; name: string; units: number | null; unsold: number | null; unsold_rate: number | null; naver_sell_count: number | null; naver_jeonse_count: number | null; naver_wolse_count: number | null }} AptUnsoldRow */
/** @typedef {{ id: string; name: string; lat: number | null; lng: number | null; naver_nearby_median: number | null; naver_nearby_avg: number | null; naver_jeonse_rate: number | null; naver_build_year: number | null; naver_avg_floor: number | null; naver_nearby_count: number | null; naver_fetched_at: string | null }} AptNaverRow */
/** @typedef {{ article_no: string; complex_no: string; area1_m2: number | null; area2_m2: number | null; direction: string | null; building_name: string | null }} ArticleAreaRow */
/** @typedef {{ article_no: string; complex_no: string; area1_m2: number | null; area2_m2: number | null; direction: string | null; building_name: string | null; trade_type_name: string | null; floor_info: string | null; numeric_maintenance_cost: number | null }} ArticleRow */
/** @typedef {{ grid: Record<string, ComplexRow[]>; cellSize: number }} SpatialGrid */

loadEnv();

const PHASE = "sync-naver";

/**
 * 전건 페이지네이션 fetch — 고유키 커서(keyset). PostgREST max_rows=1000 제한 우회.
 *
 * ⚠️ 옛 구현은 `.range(off, off+999)` 를 정렬 없이 반복하는 OFFSET 페이징이었다. 정렬이 없으면
 * 매 페이지가 **다른 표본**을 주므로 에러도 경고도 없이 행이 새고 중복된다
 * (.claude/rules/collectors/unordered-pagination-loses-rows.md §1).
 * 세션534 라이브 실측 — articles(활성 260,548행)에서 같은 offset 을 2회 조회했더니 교집합 0/100.
 * complex_price_history 는 385,694행으로 같은 위험권.
 *
 * 방향(desc)은 **성능 최적화**일 뿐 전량 보장은 어느 방향이든 같다. articles 는 활성 매물이
 * 큰 article_no(최신)에 몰려 있어 오름차순으로 훑으면 죽은 행 지대를 먼저 지나며 statement
 * timeout 위험이 있다(같은 룰 §2, 세션514 실측) → `desc: true` + lt 커서.
 * 실측: articles article_no 내림차순 76~213ms/페이지, cph id 오름차순 74ms.
 *
 * ⚠️ fail-open 계약 유지 — 1페이지라도 실패하면 throw 대신 `{ rows: 누적분, error }` 반환.
 * `_shared.mjs` 의 `selectAll` 은 throw(fail-close)라 여기 못 쓴다: articles fetch 가 죽어도
 * 다른 필드 동기화는 계속돼야 한다(graceful degradation).
 *
 * @param {(sb: any) => any} buildQuery  - sb 받아 .from().select().eq()... 까지 빌드
 *   (.order/.limit/.lt/.gt 는 이 함수가 붙인다). **select 에 keyCol 을 반드시 포함**할 것 —
 *   없으면 커서를 못 만들어 조용히 1페이지만 받고 끝나므로 error 로 되돌린다.
 * @param {any} sb
 * @param {{ keyCol: string; desc?: boolean; page?: number }} opts
 * @returns {Promise<{ rows: any[]; error: string | null }>}
 */
export async function fetchAllPages(buildQuery, sb, { keyCol, desc = false, page = 1000 }) {
  /** @type {any[]} */
  const rows = [];
  /** @type {any} */
  let cursor = null;
  for (;;) {
    let q = buildQuery(sb).order(keyCol, { ascending: !desc }).limit(page);
    if (cursor != null) q = desc ? q.lt(keyCol, cursor) : q.gt(keyCol, cursor);
    const { data, error } = await q;
    if (error) return { rows, error: error.message };
    if (!data || data.length === 0) break;
    if (!(keyCol in data[0])) return { rows, error: `fetchAllPages: select 에 keyCol '${keyCol}' 누락` };
    rows.push(...data);
    if (data.length < page) break;
    cursor = data[data.length - 1][keyCol];
    // null 키가 페이지 끝에 오면 다음 회차가 커서 없이 같은 페이지를 다시 받아 무한루프.
    // 현 호출처 키(article_no·id)는 전부 PK 라 도달 불가지만 범용 export 헬퍼라 가드
    // (_shared.mjs selectAll 의 throw 가드와 동일 취지 — 여기선 fail-open 계약대로 error 반환).
    if (cursor == null) return { rows, error: `fetchAllPages: keyCol '${keyCol}' 값이 null — 커서 진행 불가` };
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
  const cellRadius = Math.ceil(radiusKm / (cellSize * 111));
  const cr = Math.floor(apt.lat / cellSize);
  const cc = Math.floor(apt.lng / cellSize);
  const radiusM = radiusKm * 1000;
  /** @type {string[]} */
  const results = [];
  for (let dr = -cellRadius; dr <= cellRadius; dr++) {
    for (let dc = -cellRadius; dc <= cellRadius; dc++) {
      const cell = grid[(cr + dr) + "," + (cc + dc)];
      if (!cell) continue;
      for (const cpx of cell) {
        if (cpx.latitude == null || cpx.longitude == null) continue;
        const dist = distanceM(apt.lat, apt.lng, cpx.latitude, cpx.longitude);
        if (dist <= radiusM) results.push(cpx.complex_no);
      }
    }
  }
  return results;
}

/**
 * 두 좌표 간 haversine 거리(미터). findNearbyComplexes 인라인 계산을 추출(세션536) —
 * withinMatchRange(거리 게이트)와 findNearbyComplexes(Phase 3 인근 단지 탐색)가 공유한다.
 * @param {number} lat1 @param {number} lng1 @param {number} lat2 @param {number} lng2
 * @returns {number} 거리(m)
 */
export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000; // 지구 반지름(m)
  /** @param {number} d */
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Phase 1 재오염 방지 거리 게이트(세션536) — matchApartments(이름 유사도 0.6, 거리 무제한)가
 * 만드는 (단지,아파트) 짝의 92.07%가 500m 밖(짝 거리 중앙값 85km)이었다. 그 오염을 값으로
 * 확정(용적률 33.2%·건폐율 55.6%·최고층 12.9% 대조가능분 어긋남)해 세션536 정리 스크립트로
 * 지운 뒤, **앞으로 빈 칸을 채울 때만** 이 게이트를 적용한다(사장님 결정 ② — 기존 값은 불변).
 *
 * 500m 채택 근거 = 선행 실측 전반의 공통 기준선. 거리 임계는 300~1000m 구간에서 완만하게만
 * 움직여(용적률 어긋남 208·213·249건) 정밀 튜닝 여지가 낮고, 그보다 자의적인 배율(1.5배) 축과
 * 달리 "500m 안에 이름이 거의 같은 단지가 있는데 값이 다르다"는 그 자체로 오염 신호였다.
 * @type {number}
 */
export const MATCH_MAX_M = 500;

/**
 * cpx(네이버 단지) 값을 apt(아파트)에 채워도 되는 거리인지 판정.
 *
 * ⚠️ fail-close: 좌표가 하나라도 없으면 채우지 않는다(false). 거리를 확인할 수 없다는 것은
 * 곧 출처를 확인할 수 없다는 뜻이라, 통과시키면 예전과 같은 무제한 매칭 오염이 재발한다.
 * 세션536 실측 = apartments·complexes 둘 다 좌표 결측 0건(현재 시점) — 이 분기는 지금 당장은
 * 안 걸리지만, 향후 좌표 없는 신규 행이 생겨도 안전한 쪽(안 채움)으로 고정해 둔다.
 * @param {{ lat: number | null; lng: number | null }} apt
 * @param {{ latitude: number | null; longitude: number | null }} cpx
 * @returns {boolean}
 */
export function withinMatchRange(apt, cpx) {
  if (apt.lat == null || apt.lng == null || cpx.latitude == null || cpx.longitude == null) return false;
  return distanceM(apt.lat, apt.lng, cpx.latitude, cpx.longitude) <= MATCH_MAX_M;
}

/** @typedef {{ id: string; name: string; row: Record<string, unknown> }} AptUpdate */

/**
 * apartments 직렬 update → BATCH 슬라이스 병렬 (trade-stats.mjs L575 답습).
 * createSemaphore 는 실행 동시성만 제한하므로 whole-array Promise.all 대신
 * BATCH 슬라이스로 in-flight Promise 수를 BATCH 로 제한 (세션 355 critic 권고).
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {AptUpdate[]} updates
 * @param {string} label  실패 로그 접두어 (Phase 구분)
 * @returns {Promise<{ ok: number, fail: number }>} 성공·실패 건수 (collector_runs fail 집계용)
 */
export async function flushUpdates(sb, updates, label) {
  if (updates.length === 0) return { ok: 0, fail: 0 };
  const BATCH = 200;
  let ok = 0, fail = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    const limit = createSemaphore(10);
    const results = await Promise.all(
      slice.map((u) => limit(async () => await sb.from("apartments").update(u.row).eq("id", u.id)))
    );
    for (let j = 0; j < results.length; j++) {
      const { error } = /** @type {{ error: { message: string } | null }} */ (results[j]);
      if (error) { logError(PHASE, `  ${slice[j].name} ${label ? label + " " : ""}UPDATE 실패: ${error.message}`); fail++; }
      else ok++;
    }
  }
  return { ok, fail };
}

export async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  // collector_runs 집계 (텔레그램 감시 편입, 세션 373) — 조건부 블록 밖 최상위 선언.
  const startedAt = new Date().toISOString();
  let totalOk = 0, totalFail = 0;
  let runStatus = "success";
  /** @type {string | null} */
  let errMsg = null;

  try {
  const sb = getSupabase();
  const sbMibunyang = getMibuyangSupabase();

  // 1. complexes에서 유용한 필드가 있는 데이터 조회
  // 세션534: 무정렬 OFFSET → 고유키(complex_no) 커서 (unordered-pagination-loses-rows.md §1).
  // ⚠️ complexes 는 id 컬럼이 없다 — 고유키는 complex_no. 6.4만행이라 3페이지 경계 유실 위험.
  const PAGE = 1000;
  /** @type {ComplexRow[]} */
  const complexes = /** @type {ComplexRow[]} */ (
    await selectAll(
      (s) => s.from("complexes").select("complex_no, complex_name, floor_area_ratio, total_parking_count, total_household_count, high_floor, has_pool, use_approve_ymd, latitude, longitude, heat_fuel_type, corridor_type, building_coverage_ratio"),
      sbMibunyang,
      "complex_no",
    )
  );
  log(PHASE, `complexes: ${complexes.length}건`);

  // 1-b. articles에서 complex_no별 최다 빈도 heating_type 집계
  // 세션534: .range 도 .limit 도 없던 생 쿼리 → PostgREST 가 1000행에서 조용히 잘랐다.
  // heating_type not-null 행이 지금은 0이라 잠복 상태였을 뿐 같은 뿌리 결함 → 커서 경유로 전환.
  const { rows: heatingRows, error: hErr } = await fetchAllPages(
    (s) => s.from("articles").select("article_no, complex_no, heating_type").not("heating_type", "is", null),
    sbMibunyang,
    { keyCol: "article_no", desc: true },
  );

  if (hErr) logError(PHASE, `articles heating 조회 실패: ${hErr}`);

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

  // 2. apartments 조회 — 세션534: 무정렬 OFFSET → 고유키(id) 커서
  // (unordered-pagination-loses-rows.md §1). 3페이지 경계에서의 행 유실 차단.
  /** @type {AptBaseRow[]} */
  const apartments = /** @type {AptBaseRow[]} */ (
    await selectAll(
      (s) => s.from("apartments").select("id, name, lat, lng, floor_area_ratio, parking_ratio, max_floor, has_pool, heating, exclusive_ratio, quake_design, view, sunlight, heat_fuel, corridor_type, building_coverage_ratio"),
      sbMibunyang,
      "id",
    )
  );
  log(PHASE, `apartments: ${apartments.length}건`);

  // articles 통합 조회 (1회 전건 fetch → Phase 1/2/3b/4 공유) — 같은 is_active=true 전건을
  // 4번 따로 읽던 것을 8컬럼 1회로 통합 (fetch ~16분 → ~4분). 매칭 캐시(아래)와 독립.
  // 세션534: article_no 는 커서 키(고유). 무정렬 OFFSET 이면 활성 26만행에서 행이 샌다.
  const { rows: allArticles, error: artFetchErr } = await fetchAllPages(
    (s) => s.from("articles").select(
      "article_no, complex_no, area1_m2, area2_m2, direction, building_name, trade_type_name, floor_info, numeric_maintenance_cost",
    ).eq("is_active", true),
    sbMibunyang,
    { keyCol: "article_no", desc: true },
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
      // 거리 게이트(세션536, 재오염 방지) — Phase 1 이 채우는 11개 필드가 전부 이 cpx 에서
      // 나오므로 필드별로 나눠 걸지 않고 apt 진입 직후 한 번에 건다(matchApartments 자체는
      // 22개 필드에 영향을 주므로 건드리지 않음 — 채움 라인 쪽만 좁힌다).
      if (!withinMatchRange(apt, cpx)) { skipped++; continue; }

      /** @type {Record<string, unknown>} */
      const row = {};

      // 용적률 — 0 은 값이 아니라 "미수집" 표시다(세션537).
      //
      // 저장소는 이미 그렇게 합의하고 있다: 화면 `nPos`(fieldMeta.ts)는 `v > 0` 이라야 숫자를
      // 쓰고 아니면 "미수집", 점수 `_noFar`(engine.ts)는 `=== 0` 을 "모름"으로 잡아 중립값을
      // 쓴다. 그런데 **이 채움 가드만 `== null`** 이라, 한 번 0 이 박히면 영영 안 채워졌다
      // (실측 292곳). 바로 아래 view/sunlight 가 문자열 sentinel `""` 를 함께 보는 것과 같은
      // 사상인데 숫자 쪽만 빠져 있었던 것이다.
      //
      // 출처도 `> 0` 으로 좁힌다 — complexes 에 **진짜 0** 이 용적률 7,025건·건폐율 7,372건
      // 있어 `!= null` 로 두면 **0 을 0 으로 덮는 쓰기가 계속된다**(0 이 들어온 경로 자체).
      // 대상만 넓히고 출처를 그대로 두면 고친 자리가 다시 0 으로 채워진다.
      // `Number(null)` 은 0 이라 null·0 이 한 번에 걸린다(NaN 도 `> 0` 이 false).
      if (!(Number(apt.floor_area_ratio) > 0) && Number(cpx.floor_area_ratio) > 0) {
        row.floor_area_ratio = cpx.floor_area_ratio;
      }

      // 주차비율: total_parking / total_household_count
      if (apt.parking_ratio == null && cpx.total_parking_count && cpx.total_household_count && cpx.total_household_count > 0) {
        row.parking_ratio = Math.round((cpx.total_parking_count / cpx.total_household_count) * 100) / 100;
      }

      // 최고층 — 0 처리는 위 용적률과 같다. **다만 근거는 용적률·건폐율보다 약하다**:
      // apartments 에 0 은 0곳이고 complexes.high_floor 에도 **진짜 0 은 0건**이다
      // (세션537 최초 서술은 NULL 15,647건을 0 으로 잘못 셌다 — `Number(null)===0` 함정.
      //  후속 감사가 정정). 그래도 유지하는 이유는 **0층 건물이 물리적으로 없어** 방어가
      // 무해하고, 화면(`nPos`)·점수(`_noFloor`)를 같은 세션에 0-sentinel 로 맞췄기 때문이다
      // — 여기만 `!= null` 로 두면 그 셋이 다시 어긋난다.
      if (!(Number(apt.max_floor) > 0) && Number(cpx.high_floor) > 0) {
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

      // 건폐율 — 0 처리는 위 용적률과 같다(실측: apartments 133곳 · complexes 7,535건).
      if (!(Number(apt.building_coverage_ratio) > 0) && Number(cpx.building_coverage_ratio) > 0) {
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

  const r1 = await flushUpdates(sbMibunyang, phase1Updates, "");
  updated += r1.ok; totalFail += r1.fail;
  log(PHASE, `\n=== Phase 1 완료: 단지정보 갱신 ${updated}, 건너뜀 ${skipped} ===`);
  totalOk += updated;

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
    // 세션534: 무정렬 OFFSET → 고유키(id) 손제작 커서 (unordered-pagination-loses-rows.md §1).
    // fail-open(에러 시 break·throw 안 함)을 유지해야 해서 selectAll(throw) 대신 손제작.
    /** @type {any} */
    let cursorU = null;
    while (true) {
      let q = sbMibunyang
        .from("apartments")
        .select("id, name, units, unsold, unsold_rate, naver_sell_count, naver_jeonse_count, naver_wolse_count")
        .order("id", { ascending: true })
        .limit(PAGE);
      if (cursorU != null) q = q.gt("id", cursorU);
      const { data: page, error: aErr2 } = await q;
      if (aErr2) { aErr2Msg = aErr2.message; logError(PHASE, `apartments 재조회 실패: ${aErr2Msg}`); break; }
      if (!page) break;
      aptsForUnsold.push(.../** @type {AptUnsoldRow[]} */ (page));
      if (page.length < PAGE) break;
      cursorU = page[page.length - 1].id;
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

      const r2 = await flushUpdates(sbMibunyang, phase2Updates, "매물수");
      unsoldUpdated += r2.ok; totalFail += r2.fail;
      log(PHASE, `Phase 2 완료: 매물수 기반 갱신 ${unsoldUpdated}건`);
      totalOk += unsoldUpdated;
    }
  }

  const spatialGrid = buildSpatialGrid(complexes);
  log(PHASE, `공간 그리드: ${Object.keys(spatialGrid.grid).length}개 셀`);

  // ── Phase 3: 시세/통계 → naver_* 필드 동기화 ──
  log(PHASE, "\n── Phase 3: 시세/통계 → naver_* 필드 동기화 ──");

  // 3-a. complex_price_history 조회 (최근 데이터) — 고유키(id) 커서 페이지네이션
  // 세션534: 38.5만행. 무정렬 OFFSET 이면 페이지마다 다른 표본을 받는다.
  const { rows: priceRows, error: prErr } = await fetchAllPages(
    (s) => s.from("complex_price_history").select("id, complex_no, trade_type, price_avg"),
    sbMibunyang,
    { keyCol: "id" },
  );

  if (prErr) logError(PHASE, `price_history 조회 실패: ${prErr}`);

  // price_avg를 complex_no + trade_type별로 그룹핑
  /** @type {Record<string, { A1: number[]; B1: number[] }>} */
  const priceByComplex = {};
  if (priceRows) {
    for (const r of /** @type {Array<{ id: number; complex_no: string; trade_type: string; price_avg: number | null }>} */ (priceRows)) {
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
  // 세션534: 무정렬 OFFSET → 고유키(id) 손제작 커서 (unordered-pagination-loses-rows.md §1).
  // fail-open(에러 시 break·throw 안 함)을 유지해야 해서 selectAll(throw) 대신 손제작.
  /** @type {any} */
  let cursorN = null;
  while (true) {
    let q = sbMibunyang
      .from("apartments")
      .select("id, name, lat, lng, naver_nearby_median, naver_nearby_avg, naver_jeonse_rate, naver_build_year, naver_avg_floor, naver_nearby_count, naver_fetched_at")
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursorN != null) q = q.gt("id", cursorN);
    const { data: page, error: aErr3 } = await q;
    if (aErr3) { aErr3Msg = aErr3.message; logError(PHASE, `apartments naver 재조회 실패: ${aErr3Msg}`); break; }
    if (!page) break;
    aptsForNaver.push(.../** @type {AptNaverRow[]} */ (page));
    if (page.length < PAGE) break;
    cursorN = page[page.length - 1].id;
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

    const r3 = await flushUpdates(sbMibunyang, phase3Updates, "naver");
    naverUpdated += r3.ok; totalFail += r3.fail;
    log(PHASE, `Phase 3 완료: 시세/통계 갱신 ${naverUpdated}건`);
    totalOk += naverUpdated;
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

      const r4 = await flushUpdates(sbMibunyang, phase4Updates, "Phase4");
      phase4Updated += r4.ok; totalFail += r4.fail;
      log(PHASE, `Phase 4 완료: 관리비/방향 갱신 ${phase4Updated}건`);
      totalOk += phase4Updated;
    }
  }

  log(PHASE, "\n=== 전체 동기화 완료 ===");
  } catch (/** @type {unknown} */ err) {
    runStatus = "failure";
    errMsg = err instanceof Error ? err.message : String(err);
    throw err; // 재던짐 → 진입점 catch 의 logError + exit(1) 보존 (워크플로 failure + 하류 step 스킵)
  } finally {
    await recordCollectorRun(PHASE, {
      status: runStatus,
      ok: totalOk,
      fail: totalFail,
      // skip=0 고정: Phase1 skipped("변경할 필드 없음")는 정상 잡음(상시 수백~1400)이라
      // skip 으로 넘기면 monitor ②(ok===0 && skip===0)가 영원히 못 잡아 silent fail 감시 무력화.
      // skip=0 이어야 전 Phase ok=0(DB 쓰기 전부 실패) 시 ②가 즉시 발화. (세션 373 적대검증)
      skip: 0,
      errorMessage: errMsg,
      startedAt,
      elapsed: ((Date.now() - new Date(startedAt).getTime()) / 1000).toFixed(1),
    });
  }
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((/** @type {unknown} */ err) => {
  logError(PHASE, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
