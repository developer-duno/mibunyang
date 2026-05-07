// @ts-check
/**
 * 어린이집/유치원 수집기 — Kakao Places 기반
 *
 * 단지 주변 1km 내 어린이집+유치원 개수 및 최근접 거리 수집.
 * infra 테이블의 childcare/childcare_dist 컬럼에 저장.
 *
 * 사용법:
 *   node scripts/collectors/collect-childcare.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-childcare.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep, createReporter } from "./_shared.mjs";

loadEnv();

const PHASE = "childcare";
const KAKAO_KEY = process.env.KAKAO_KEY;

/**
 * @typedef {{ x: string; y: string; distance: string; place_name?: string }} KakaoPlaceItem
 * @typedef {{ documents: KakaoPlaceItem[] }} KakaoPlacesResponse
 */

/**
 * Kakao 키워드 검색 (반경 내 시설 조회)
 * @param {number} lat
 * @param {number} lng
 * @param {string} keyword
 * @param {number} radius
 * @returns {Promise<KakaoPlaceItem[]>}
 */
export async function searchKakao(lat, lng, keyword, radius) {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=15`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  const data = /** @type {KakaoPlacesResponse} */ (await res.json());
  return data.documents || [];
}

/**
 * 어린이집+유치원 합산 수집
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{ count: number; dist: number | null }>}
 */
export async function collectChildcare(lat, lng) {
  const [daycares, kindergartens] = await Promise.all([
    searchKakao(lat, lng, "어린이집", 1000),
    searchKakao(lat, lng, "유치원", 1000),
  ]);
  // 중복 제거 (같은 좌표의 시설)
  const seen = new Set();
  const all = [];
  for (const d of [...daycares, ...kindergartens]) {
    const key = `${d.x},${d.y}`;
    if (!seen.has(key)) { seen.add(key); all.push(d); }
  }
  // 거리순 정렬
  all.sort((a, b) => Number(a.distance) - Number(b.distance));
  const first = all[0];
  return {
    count: all.length,
    dist: first ? Math.round(Number(first.distance)) : null,
  };
}

async function main() {
  if (!KAKAO_KEY) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const { data: apts, error } = await sb.from("apartments").select("id, name, lat, lng").limit(10000);
  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);

  const targets = apts.filter(a => a.lat && a.lng);
  log(PHASE, `대상: ${targets.length}건 (좌표 있음)`);

  const rpt = createReporter(PHASE);

  for (let i = 0; i < targets.length; i++) {
    const apt = targets[i];
    try {
      const { count, dist } = await collectChildcare(apt.lat, apt.lng);
      await sleep(200); // Kakao API rate limit 대응

      if (dryRun) {
        log(PHASE, `  [DRY] ${apt.name}: 어린이집/유치원 ${count}개, 최근접 ${dist}m`);
        rpt.success(1);
        continue;
      }

      const { error: uErr } = await sb.from("infra").upsert([{
        apartment_id: apt.id, childcare: count, childcare_dist: dist,
        updated_at: new Date().toISOString(),
      }], { onConflict: "apartment_id" });

      if (uErr) { logError(PHASE, `${apt.name}: ${uErr.message}`); rpt.fail(1); }
      else rpt.success(1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `${apt.name}: ${msg}`);
      rpt.fail(1);
    }

    if ((i + 1) % 50 === 0) log(PHASE, `진행: ${i + 1}/${targets.length}`);
  }

  const result = rpt.summary();
  if (result.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });
