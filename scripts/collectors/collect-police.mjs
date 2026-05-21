// @ts-check
/**
 * 경찰서/파출소 수집기 — Kakao Places 기반
 *
 * 단지 주변 3km 내 경찰관서(경찰서/파출소/지구대/치안센터) 개수 및 최근접 거리 수집.
 * infra 테이블의 police/police_dist 컬럼에 저장.
 *
 * 사용법:
 *   node scripts/collectors/collect-police.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-police.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep, createReporter, recordCollectorRun } from "./_shared.mjs";

loadEnv();

const PHASE = "police";
const KAKAO_KEY = process.env.KAKAO_KEY;
const RADIUS = 3000; // 반경 3km

/**
 * @typedef {{ x: string; y: string; distance: string; place_name?: string }} KakaoPlaceItem
 * @typedef {{ documents: KakaoPlaceItem[] }} KakaoPlacesResponse
 */

/**
 * Kakao 키워드 검색으로 경찰관서 조회 (반경 3km)
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{ count: number; dist: number | null }>}
 */
export async function searchPolice(lat, lng) {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent("경찰서")}&x=${lng}&y=${lat}&radius=${RADIUS}&sort=distance&size=15`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  const data = /** @type {KakaoPlacesResponse} */ (await res.json());
  const docs = data.documents || [];

  // 중복 좌표 제거
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {KakaoPlaceItem[]} */
  const unique = [];
  for (const d of docs) {
    const key = `${d.x},${d.y}`;
    if (!seen.has(key)) { seen.add(key); unique.push(d); }
  }

  // 거리순 정렬
  unique.sort((a, b) => Number(a.distance) - Number(b.distance));
  const first = unique[0];
  return {
    count: unique.length,
    dist: first ? Math.round(Number(first.distance)) : null,
  };
}

async function main() {
  if (!KAKAO_KEY) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const PAGE_SIZE = 1000;
  const apts = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb.from("apartments").select("id, name, lat, lng").range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`apartments 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    apts.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  const targets = apts.filter(a => a.lat && a.lng);
  log(PHASE, `대상: ${targets.length}건 (좌표 있음), 반경 ${RADIUS}m`);

  const rpt = createReporter(PHASE);

  for (let i = 0; i < targets.length; i++) {
    const apt = targets[i];
    try {
      const { count, dist } = await searchPolice(apt.lat, apt.lng);
      await sleep(200); // Kakao API rate limit 대응

      if (dryRun) {
        log(PHASE, `  [DRY] ${apt.name}: 경찰관서 ${count}개, 최근접 ${dist}m`);
        rpt.success(1);
        continue;
      }

      const { error: uErr } = await sb.from("infra").upsert([{
        apartment_id: apt.id, police: count, police_dist: dist,
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
  await recordCollectorRun(PHASE, result);
  if (result.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });
