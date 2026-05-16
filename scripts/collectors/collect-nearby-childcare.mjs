// @ts-check
/**
 * 단지별 1km 내 어린이집 상세 5건 → schools.nearby_childcare JSONB 적재 (세션 257 W6-D2)
 *
 * 자원: regions.childcare.facilities[] (childcare-detail.mjs cpmsapi030 70 필드 답습 자산)
 * 출력: schools.nearby_childcare (단지당 1행, 거리순 최대 5건)
 *
 * 작업 흐름:
 *   1. apartments 전체 로드 (id / region / gu / lat / lng)
 *   2. regions.childcare 로드 — 같은 시군구에 여러 row 존재 (recorded_at 시계열) →
 *      좌표(la/lo) 보유 facility 가 가장 많은 row 를 시군구별로 선택
 *   3. 단지마다: 같은 region+gu facilities 중 Haversine 1km 이내 → 거리순 5건 추출
 *   4. schools 테이블 upsert (apartment_id PK)
 *
 * 좌표 없는 facility 는 거리 계산 불가 → 제외. 좌표 미수집 시군구 단지는 빈 배열 적재.
 * 70 필드(type/cctv/enrolled/status/dataStdDate)는 childcare-detail cron 미도달 시 null.
 *
 * 사용:
 *   node scripts/collectors/collect-nearby-childcare.mjs            (schools UPSERT)
 *   node scripts/collectors/collect-nearby-childcare.mjs --dry-run  (미리보기 sample)
 *
 * 필요 env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, logError, createReporter, haversineKm, sleep, selectAll } from "./_shared.mjs";

loadEnv();

const RADIUS_KM = 1;
const MAX_RESULTS = 5;

/**
 * regions.childcare.facilities[] 원소 (childcare-info 7 필드 + childcare-detail 70 필드).
 * @typedef {Object} Facility
 * @property {string} [crname]
 * @property {string|null} [la]
 * @property {string|null} [lo]
 * @property {string} [crtypename]
 * @property {string} [crstatusname]
 * @property {number} [crcapat]
 * @property {number} [crchcnt]
 * @property {number} [cctvinstlcnt]
 * @property {string} [datastdrdt]
 */

/**
 * schools.nearby_childcare JSONB 원소 (src/types/scoring.ts NearbyChildcare 와 동기화).
 * @typedef {Object} NearbyChildcare
 * @property {string} name
 * @property {number} distance              - 미터
 * @property {number|null} capacity
 * @property {string|null} type
 * @property {number|null} enrolled
 * @property {number|null} cctv
 * @property {string|null} status
 * @property {string|null} dataStdDate
 * @property {Record<string, unknown>|null} detail
 */

/**
 * facility → NearbyChildcare 변환. 70 필드 미수집 시 해당 값 null.
 * @param {Facility} fac
 * @param {number} distanceKm
 * @returns {NearbyChildcare}
 */
export function toNearbyChildcare(fac, distanceKm) {
  const hasDetail = !!fac.crtypename;
  return {
    name: fac.crname ?? "",
    distance: Math.round(distanceKm * 1000),
    capacity: fac.crcapat ?? null,
    type: fac.crtypename ?? null,
    enrolled: fac.crchcnt ?? null,
    cctv: fac.cctvinstlcnt ?? null,
    status: fac.crstatusname ?? null,
    dataStdDate: fac.datastdrdt ?? null,
    detail: hasDetail ? /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (fac)) : null,
  };
}

/**
 * 같은 시군구의 여러 regions row 중 좌표 보유 facility 가 가장 많은 facilities 선택.
 * regions 는 recorded_at 시계열 → 같은 region+gu 가 여러 row.
 * @param {Array<{ region: string, gu: string|null, childcare: { facilities?: Facility[] } | null }>} regions
 * @returns {Map<string, Facility[]>}  key = `${region}|${gu}`
 */
export function buildRegionFacilityMap(regions) {
  /** @type {Map<string, Facility[]>} */
  const map = new Map();
  /** @type {Map<string, number>} */
  const bestCoordCount = new Map();

  for (const r of regions) {
    if (!r.gu) continue;
    const key = `${r.region}|${r.gu}`;
    const facilities = r.childcare?.facilities ?? [];
    const coordCount = facilities.filter(f => f.la != null && f.lo != null).length;
    if (coordCount > (bestCoordCount.get(key) ?? -1)) {
      bestCoordCount.set(key, coordCount);
      map.set(key, facilities);
    }
  }
  return map;
}

/**
 * 단지 좌표 기준 1km 내 어린이집 거리순 5건.
 * @param {number} lat
 * @param {number} lng
 * @param {Facility[]} facilities
 * @returns {NearbyChildcare[]}
 */
export function findNearby(lat, lng, facilities) {
  /** @type {Array<{ item: NearbyChildcare, km: number }>} */
  const candidates = [];
  for (const fac of facilities) {
    const fLat = parseFloat(fac.la ?? "");
    const fLng = parseFloat(fac.lo ?? "");
    if (!Number.isFinite(fLat) || !Number.isFinite(fLng)) continue;  // 좌표 없는 facility 제외
    const km = haversineKm(lat, lng, fLat, fLng);
    if (km > RADIUS_KM) continue;
    candidates.push({ item: toNearbyChildcare(fac, km), km });
  }
  candidates.sort((a, b) => a.km - b.km);
  return candidates.slice(0, MAX_RESULTS).map(c => c.item);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  log("init", dryRun ? "--dry-run" : "schools UPSERT");

  const sb = getSupabase();

  // 단지 로드 (selectAll — Supabase 1000 row 기본 제한 회피)
  const apartments = await selectAll(
    /** @param {any} c */ (c) => c.from("apartments").select("id, region, gu, lat, lng"),
    sb,
  );
  log("init", `apartments: ${apartments.length}건`);

  // regions.childcare 로드
  const regions = await selectAll(
    /** @param {any} c */ (c) => c.from("regions").select("region, gu, childcare").not("childcare", "is", null),
    sb,
  );

  const facilityMap = buildRegionFacilityMap(/** @type {any} */ (regions));
  log("init", `regions.childcare 시군구: ${facilityMap.size}건`);

  const rpt = createReporter("collect-nearby-childcare");
  // 어린이집 1건 이상 매칭된 단지만 적재 (0건 단지는 API 가 ?? [] 폴백 → DB 행 불필요)
  /** @type {Array<{ apartment_id: string, nearby_childcare: NearbyChildcare[] }>} */
  const matched = [];

  for (const a of apartments) {
    const lat = typeof a.lat === "number" ? a.lat : parseFloat(a.lat ?? "");
    const lng = typeof a.lng === "number" ? a.lng : parseFloat(a.lng ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      logError("apt", `${a.id}: 좌표 부재 — skip`);
      continue;
    }
    const facilities = facilityMap.get(`${a.region}|${a.gu}`) ?? [];
    const nearby = findNearby(lat, lng, facilities);
    if (nearby.length > 0) matched.push({ apartment_id: a.id, nearby_childcare: nearby });
  }

  log("match", `1km 내 어린이집 매칭 단지: ${matched.length} / ${apartments.length}`);

  if (dryRun) {
    const sample = matched[0];
    if (sample) {
      log("dry-run", `sample ${sample.apartment_id}: ${sample.nearby_childcare.length}건`);
      for (const c of sample.nearby_childcare) {
        log("dry-run", `  ${c.name} ${c.distance}m type=${c.type} cctv=${c.cctv} cap=${c.capacity}`);
      }
    } else {
      log("dry-run", "1km 내 어린이집 매칭 단지 0건 (좌표 수집 시군구 부재 가능)");
    }
    return;
  }

  // schools 에 이미 행이 있는 단지 = UPDATE (nearby_childcare 컬럼만, school_score 등 보존)
  // 행이 없는 단지 = INSERT (apartment_id + nearby_childcare)
  const matchedIds = matched.map(m => m.apartment_id);
  /** @type {Set<string>} */
  const existing = new Set();
  for (let i = 0; i < matchedIds.length; i += 500) {
    const { data: scRows, error: scErr } = await sb
      .from("schools")
      .select("apartment_id")
      .in("apartment_id", matchedIds.slice(i, i + 500));
    if (scErr) throw new Error(`schools 조회 실패: ${scErr.message}`);
    for (const row of scRows) existing.add(row.apartment_id);
  }

  /** @type {Array<{ apartment_id: string, nearby_childcare: NearbyChildcare[] }>} */
  const toInsert = [];
  for (const m of matched) {
    if (existing.has(m.apartment_id)) {
      const { error: updErr } = await sb
        .from("schools")
        .update({ nearby_childcare: m.nearby_childcare })
        .eq("apartment_id", m.apartment_id);
      if (updErr) { logError("update", `${m.apartment_id}: ${updErr.message}`); rpt.fail(1); }
      else rpt.success(1);
      await sleep(20);
    } else {
      toInsert.push(m);
    }
  }

  if (toInsert.length > 0) {
    const { error: insErr } = await sb.from("schools").insert(toInsert);
    if (insErr) { logError("insert", insErr.message); rpt.fail(toInsert.length); }
    else rpt.success(toInsert.length);
  }

  log("done", `schools.nearby_childcare: UPDATE ${matched.length - toInsert.length} / INSERT ${toInsert.length}`);

  const summary = rpt.summary();
  if (summary.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });
