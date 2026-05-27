// @ts-check
/**
 * 인프라 시설 수집기 — Kakao Places 기반
 *
 * 병원, 마트, 편의점, 카페, 문화시설, 은행, 약국, 공원, 지하철 거리
 *
 * 사용법:
 *   node scripts/collectors/infra-kakao.mjs              (Supabase UPDATE)
 *   node scripts/collectors/infra-kakao.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep, createReporter, recordCollectorRun, createSemaphore } from "./_shared.mjs";

loadEnv();

const PHASE = "infra";
const KAKAO_KEY = process.env.KAKAO_KEY;
if (!KAKAO_KEY) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }

// re-export for backward compat (infra-kakao.test.mjs에서 import)
export { createSemaphore };
const sem = createSemaphore(5); // 동시 5건 (Kakao 초당 50건 중 안전 마진)

/**
 * @typedef {{ x: string; y: string; distance: string; place_name?: string }} KakaoPlaceItem
 * @typedef {{ documents: KakaoPlaceItem[] }} KakaoPlacesResponse
 * @typedef {{ id: string; name: string | null; lat: number | null; lng: number | null }} InfraAptRow
 */

const CATEGORIES = /** @type {const} */ ([
  { key: "hospital", keyword: "병원", radius: 1000 },
  { key: "mart", keyword: "대형마트", radius: 1000 },
  { key: "conv", keyword: "편의점", radius: 500 },
  { key: "cafe", keyword: "카페", radius: 500 },
  { key: "culture", keyword: "문화시설", radius: 1000 },
  { key: "bank", keyword: "은행", radius: 1000 },
  { key: "pharmacy", keyword: "약국", radius: 500 },
  { key: "park", keyword: "공원", radius: 1000 },
]);

/**
 * @param {number} lat
 * @param {number} lng
 * @param {string} keyword
 * @param {number} radius
 * @returns {Promise<KakaoPlaceItem[]>}
 */
async function searchKakao(lat, lng, keyword, radius) {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=5`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  const data = /** @type {KakaoPlacesResponse} */ (await res.json());
  return data.documents || [];
}

/**
 * @param {number} lat
 * @param {number} lng
 * @param {string} categoryCode
 * @param {number} radius
 * @returns {Promise<KakaoPlaceItem[]>}
 */
async function searchKakaoCategory(lat, lng, categoryCode, radius) {
  const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=${categoryCode}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=5`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  const data = /** @type {KakaoPlacesResponse} */ (await res.json());
  return data.documents || [];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const PAGE_SIZE = 1000;
  /** @type {InfraAptRow[]} */
  const apts = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb.from("apartments").select("id, name, lat, lng").range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`apartments 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    apts.push(.../** @type {InfraAptRow[]} */ (/** @type {unknown} */ (data)));
    if (data.length < PAGE_SIZE) break;
  }

  const targets = apts.filter(a => a.lat && a.lng);
  log(PHASE, `대상: ${targets.length}건 (좌표 있음)`);

  const rpt = createReporter(PHASE);  // 세션 327: SIGTERM 핸들러 등록을 loop 이전으로 이동 (이전에는 loop 끝난 뒤 호출되어 등록 0회)
  let updated = 0, skipped = 0;

  /**
   * @param {InfraAptRow} apt
   * @param {number} i
   */
  const processApt = async (apt, i) => sem(async () => {
    try {
      /** @type {Record<string, unknown>} */
      const row = { apartment_id: apt.id, updated_at: new Date().toISOString() };

      for (const cat of CATEGORIES) {
        const results = await searchKakao(Number(apt.lat), Number(apt.lng), cat.keyword, cat.radius);
        const first = results[0];
        row[cat.key] = results.length;
        row[`${cat.key}_dist`] = first ? Math.round(Number(first.distance)) : null;
        await sleep(120);
      }

      // 지하철역 검색 (SW8 카테고리, 반경 10km)
      const subways = await searchKakaoCategory(Number(apt.lat), Number(apt.lng), "SW8", 10000);
      const firstSubway = subways[0];
      row.subway_dist = firstSubway ? Math.round(Number(firstSubway.distance)) : 9999;
      await sleep(120);

      if (dryRun) {
        log(PHASE, `  [DRY] ${apt.name}: 병원${row.hospital} 마트${row.mart} 편의점${row.conv} 지하철${row.subway_dist}m`);
        updated++;
        return;
      }

      const { error: uErr } = await sb.from("infra").upsert([row], { onConflict: "apartment_id" });
      if (uErr) { logError(PHASE, `${apt.name}: ${uErr.message}`); skipped++; }
      else updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `${apt.name}: ${msg}`);
      skipped++;
    }

    if ((i + 1) % 30 === 0) log(PHASE, `진행: ${i + 1}/${targets.length} (갱신 ${updated})`);
  });

  // 배치 단위 병렬 실행 (동시 5건)
  const BATCH = 30;
  for (let b = 0; b < targets.length; b += BATCH) {
    if (rpt.interrupted()) break;  // 세션 327: graceful shutdown (SIGTERM 받으면 다음 배치 전 중단)
    const batch = targets.slice(b, b + BATCH);
    await Promise.all(batch.map((apt, j) => processApt(apt, b + j)));
  }

  rpt.success(updated);
  rpt.skip(skipped);
  const result = rpt.summary();
  await recordCollectorRun(PHASE, result);
  if (result.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });
