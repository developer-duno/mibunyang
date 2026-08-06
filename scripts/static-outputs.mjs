// @ts-check
// 정적 JSON 출력 공유 빌더 — collect-data.mjs writeOutputs 와 split-apartments-json.mjs 가
// 이 단일 소스를 호출한다. 두 곳에 인라인 복제하던 로직이 catsCache/nearbySchools 슬림을
// 한쪽만 반영하지 못해 list 가 9배 팽창한 드리프트(세션 468)를 구조적으로 차단한다.
// fs 를 만지지 않고 순수 데이터만 반환 — collect-data.test 의 writeFileSpy/fs mock 체계 호환.
import { DETAIL_BUCKET_COUNT, bucketOf, detailBucketName } from "../src/utils/bucketHash.mjs";

export { DETAIL_BUCKET_COUNT, detailBucketName };

// list 에서 상세로 분리하는 필드 (키 자체 삭제 = DetailModal undefined sentinel 보존).
// 가격배열 4개(기존)는 buildListData 의 destructure 로 별도 제외.
const DETAIL_ONLY_FIELDS = ["nearbySchools", "nearbyChildcare", "nearbyFacilities", "benefits"];

// 목록에 잔존할 catsCache subs (첫 항목만) — AptCard 가 price/location subs[0] 의 info/detail 사용.
const KEEP_FIRST_SUB_CATS = new Set(["price", "location"]);

/**
 * catsCache 슬림 — subs 배열만 축소. cat-level 필드(total/label/key/deviation/totalWon 등)는
 * 전량 보존(useDataPipeline 가중합·필터·AptCard 배지 의존). price/location 은 subs[0] 만 남기고
 * 나머지 4 cat 은 subs=[] (키는 유지 — CatPanel `.subs.length`/`.map` 가드 없음).
 * @param {unknown} cats
 * @returns {unknown}
 */
export function slimCats(cats) {
  if (!cats || typeof cats !== "object" || Array.isArray(cats)) return cats;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, c] of Object.entries(/** @type {Record<string, unknown>} */ (cats))) {
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      out[k] = c; // catsCache.total 같은 스칼라 — 그대로 보존
      continue;
    }
    const cat = /** @type {Record<string, unknown>} */ (c);
    const subs = Array.isArray(cat.subs) ? cat.subs : null;
    const keep = KEEP_FIRST_SUB_CATS.has(k) && subs && subs.length > 0 ? [subs[0]] : [];
    out[k] = { ...cat, subs: keep };
  }
  return out;
}

/**
 * 목록 JSON 데이터 — 가격배열 4개 + 상세 전용 필드 제거 + catsCache subs 슬림.
 * @param {object[]} apartments
 * @returns {object[]}
 */
export function buildListData(apartments) {
  return apartments.map((a) => {
    const {
      priceByArea: _p,
      rentByArea: _r,
      jeonseByArea: _j,
      priceByFloor: _f,
      ...rest
    } = /** @type {Record<string, unknown>} */ (a);
    for (const field of DETAIL_ONLY_FIELDS) delete rest[field];
    if ("catsCache" in rest) rest.catsCache = slimCats(rest.catsCache);
    return rest;
  });
}

/**
 * 상세 버킷 데이터 — 단지 id 해시로 N개 버킷에 분산. 각 원소 = 상세 전용 필드 + 가격배열 + full catsCache.
 * DetailModal 이 버킷 1개 fetch → mergedApt/mergedRes 로 목록의 슬림 필드를 복원.
 * @param {object[]} apartments
 * @param {number} [n]
 * @returns {Array<{ bucket: number, data: object[] }>}
 */
export function buildDetailBuckets(apartments, n = DETAIL_BUCKET_COUNT) {
  /** @type {object[][]} */
  const buckets = Array.from({ length: n }, () => []);
  for (const a of apartments) {
    const apt = /** @type {Record<string, unknown>} */ (a);
    const b = bucketOf(String(apt.id), n);
    buckets[b].push({
      id: apt.id,
      catsCache: apt.catsCache ?? null,
      nearbySchools: apt.nearbySchools ?? null,
      nearbyChildcare: apt.nearbyChildcare ?? null,
      nearbyFacilities: apt.nearbyFacilities ?? null,
      benefits: apt.benefits ?? null,
      priceByArea: apt.priceByArea ?? null,
      rentByArea: apt.rentByArea ?? null,
      jeonseByArea: apt.jeonseByArea ?? null,
      priceByFloor: apt.priceByFloor ?? null,
    });
  }
  return buckets.map((data, bucket) => ({ bucket, data }));
}
