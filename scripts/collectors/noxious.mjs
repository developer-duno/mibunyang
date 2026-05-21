// @ts-check
/**
 * 혐오시설 수집기 — Kakao 키워드 검색 기반
 *
 * 사용법:
 *   node scripts/collectors/noxious.mjs              (Supabase 업데이트)
 *   node scripts/collectors/noxious.mjs --dry-run    (미리보기만)
 *   node scripts/collectors/noxious.mjs --json       (apartments.json 직접 업데이트)
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep, ROOT, haversineMeters } from "./_shared.mjs";

loadEnv();

// ── 혐오시설 카테고리 및 키워드 ─────────────────────────────
const NOXIOUS_KEYWORDS = [
  { keyword: "소각장", category: "소각장" },
  { keyword: "하수처리장", category: "하수처리장" },
  { keyword: "폐수처리장", category: "폐수처리장" },
  { keyword: "쓰레기매립지", category: "매립지" },
  { keyword: "장례식장", category: "장례식장" },
  { keyword: "화장장", category: "화장장" },
  { keyword: "교도소", category: "교도소" },
  { keyword: "변전소", category: "고압선" },
  { keyword: "축산농장", category: "축산시설" },
  { keyword: "가축시장", category: "축산시설" },
  { keyword: "공장단지", category: "공장" },
];

const SEARCH_RADIUS = 2000; // 2km 반경 검색

/**
 * @typedef {Object} KakaoPlaceItem
 * @property {string} place_name
 * @property {string} y
 * @property {string} x
 * @property {string} [distance]
 */

/**
 * @typedef {Object} NoxiousPlace
 * @property {string} name
 * @property {number} lat
 * @property {number} lng
 * @property {number} dist
 */

/**
 * @typedef {Object} NoxiousAptRow
 * @property {string} id
 * @property {string} [name]
 * @property {number|null} [lat]
 * @property {number|null} [lng]
 * @property {string[]|null} [noxious]
 * @property {number|null} [noxious_dist]
 */

// ── Haversine 거리 (m) ──────────────────────────────────────
const haversineM = haversineMeters;

// ── Kakao 키워드 검색 ───────────────────────────────────────
/**
 * @param {number} lat
 * @param {number} lng
 * @param {string} keyword
 * @returns {Promise<NoxiousPlace[]>}
 */
async function searchNearby(lat, lng, keyword) {
  const kakaoKey = process.env.KAKAO_KEY;
  if (!kakaoKey) throw new Error("KAKAO_KEY 필요");

  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&x=${lng}&y=${lat}&radius=${SEARCH_RADIUS}&sort=distance&size=5`;
  const res = await fetchWithRetry(url, {
    headers: { Authorization: `KakaoAK ${kakaoKey}` },
  });
  const data = /** @type {{ documents?: KakaoPlaceItem[] }} */ (await res.json());
  return (data.documents || []).map((/** @type {KakaoPlaceItem} */ d) => ({
    name: d.place_name,
    lat: Number(d.y),
    lng: Number(d.x),
    dist: Number(d.distance) || haversineM(lat, lng, Number(d.y), Number(d.x)),
  }));
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const jsonMode = process.argv.includes("--json");

  if (!process.env.KAKAO_KEY) {
    logError("noxious", "KAKAO_KEY 환경변수가 필요합니다");
    process.exit(1);
  }

  // 1. 아파트 데이터 로드
  /** @type {NoxiousAptRow[]} */
  let apartments;
  if (jsonMode) {
    const jsonPath = resolve(ROOT, "public/data/apartments.json");
    apartments = JSON.parse(readFileSync(jsonPath, "utf8"));
    log("load", `apartments.json: ${apartments.length}건`);
  } else {
    const sb = getSupabase();
    const PAGE_SIZE = 1000;
    /** @type {NoxiousAptRow[]} */
    const acc = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await sb.from("apartments").select("id, name, lat, lng, noxious, noxious_dist").range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`Supabase 조회 실패: ${error.message}`);
      if (!data || data.length === 0) break;
      acc.push(.../** @type {NoxiousAptRow[]} */ (/** @type {unknown} */ (data)));
      if (data.length < PAGE_SIZE) break;
    }
    apartments = acc;
    log("load", `Supabase apartments: ${apartments.length}건`);
  }

  const withCoords = apartments.filter((/** @type {NoxiousAptRow} */ a) => a.lat && a.lng);
  log("filter", `좌표 있는 아파트: ${withCoords.length}/${apartments.length}건`);

  // 2. 각 아파트 주변 혐오시설 검색
  /** @type {{id: string, noxious: string[], noxious_dist: number}[]} */
  const updates = [];
  let searched = 0;

  for (const apt of withCoords) {
    /** @type {string[]} */
    const found = [];
    let minDist = Infinity;

    for (const { keyword, category } of NOXIOUS_KEYWORDS) {
      try {
        const results = await searchNearby(Number(apt.lat), Number(apt.lng), keyword);
        for (const r of results) {
          if (!found.includes(category)) found.push(category);
          if (r.dist < minDist) minDist = r.dist;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError("search", `${apt.name} "${keyword}": ${msg}`);
      }
      await sleep(100); // API rate limit 보호
    }

    searched++;
    if (searched % 50 === 0) {
      log("progress", `${searched}/${withCoords.length}건 검색 완료`);
    }

    if (found.length > 0) {
      updates.push({
        id: apt.id,
        noxious: found,
        noxious_dist: Math.round(minDist),
      });
    }
  }

  log("result", `혐오시설 발견: ${updates.length}/${withCoords.length}건`);

  if (dryRun) {
    log("dry-run", "미리보기 모드 — 업데이트 생략");
    for (const u of updates.slice(0, 30)) {
      const apt = apartments.find((/** @type {NoxiousAptRow} */ a) => a.id === u.id);
      console.log(`  ${apt?.name || u.id}: ${u.noxious.join(", ")} (최근접 ${u.noxious_dist}m)`);
    }
    if (updates.length > 30) console.log(`  ... 외 ${updates.length - 30}건`);
    return;
  }

  // 3. 업데이트
  if (jsonMode) {
    const aptMap = new Map(apartments.map((/** @type {NoxiousAptRow} */ a) => [a.id, a]));
    for (const u of updates) {
      const apt = aptMap.get(u.id);
      if (!apt) continue;
      apt.noxious = u.noxious;
      /** @type {Record<string, unknown>} */ (apt).noxiousDist = u.noxious_dist;
    }
    const jsonPath = resolve(ROOT, "public/data/apartments.json");
    writeFileSync(jsonPath, JSON.stringify([...aptMap.values()], null, 2), "utf8");
    log("json", `apartments.json 업데이트 완료 (${updates.length}건)`);
  } else {
    const sb = getSupabase();
    let ok = 0;
    for (const u of updates) {
      const { error } = await sb.from("apartments")
        .update({ noxious: u.noxious, noxious_dist: u.noxious_dist })
        .eq("id", u.id);
      if (error) logError("upsert", `${u.id}: ${error.message}`);
      else ok++;
    }
    log("supabase", `${ok}/${updates.length}건 업데이트`);
  }
}

// CLI 직접 실행 시에만 main() 호출 (테스트 환경 보호)
const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });

// 테스트용 순수 함수 export
export { haversineM };
