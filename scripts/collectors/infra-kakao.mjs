/**
 * 인프라 시설 수집기 — Kakao Places 기반
 *
 * 병원, 마트, 편의점, 카페, 문화시설, 은행, 약국, 공원, 지하철 거리
 *
 * 사용법:
 *   node scripts/collectors/infra-kakao.mjs              (Supabase UPDATE)
 *   node scripts/collectors/infra-kakao.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep, createReporter } from "./_shared.mjs";

loadEnv();

const PHASE = "infra";
const KAKAO_KEY = process.env.KAKAO_KEY;
if (!KAKAO_KEY) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }

// Semaphore: 동시 실행 수 제한 (SC-2 — Kakao API 초당 50건 제한 대응)
function createSemaphore(max) {
  let running = 0;
  const queue = [];
  return async (fn) => {
    if (running >= max) await new Promise(r => queue.push(r));
    running++;
    try { return await fn(); }
    finally { running--; if (queue.length) queue.shift()(); }
  };
}
const sem = createSemaphore(5); // 동시 5건 (Kakao 초당 50건 중 안전 마진)

const CATEGORIES = [
  { key: "hospital", keyword: "병원", radius: 1000 },
  { key: "mart", keyword: "대형마트", radius: 1000 },
  { key: "conv", keyword: "편의점", radius: 500 },
  { key: "cafe", keyword: "카페", radius: 500 },
  { key: "culture", keyword: "문화시설", radius: 1000 },
  { key: "bank", keyword: "은행", radius: 1000 },
  { key: "pharmacy", keyword: "약국", radius: 500 },
  { key: "park", keyword: "공원", radius: 1000 },
];

async function searchKakao(lat, lng, keyword, radius) {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=5`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  const data = await res.json();
  return data.documents || [];
}

async function searchKakaoCategory(lat, lng, categoryCode, radius) {
  const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=${categoryCode}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=5`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  const data = await res.json();
  return data.documents || [];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const { data: apts, error } = await sb.from("apartments").select("id, name, lat, lng").limit(10000);
  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);

  const targets = apts.filter(a => a.lat && a.lng);
  log(PHASE, `대상: ${targets.length}건 (좌표 있음)`);

  let updated = 0, skipped = 0;

  const processApt = async (apt, i) => sem(async () => {
    try {
      const row = { apartment_id: apt.id, updated_at: new Date().toISOString() };

      for (const cat of CATEGORIES) {
        const results = await searchKakao(apt.lat, apt.lng, cat.keyword, cat.radius);
        row[cat.key] = results.length;
        row[`${cat.key}_dist`] = results.length > 0 ? Math.round(Number(results[0].distance)) : null;
        await sleep(120);
      }

      // 지하철역 검색 (SW8 카테고리, 반경 10km)
      const subways = await searchKakaoCategory(apt.lat, apt.lng, "SW8", 10000);
      row.subway_dist = subways.length > 0 ? Math.round(Number(subways[0].distance)) : 9999;
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
      logError(PHASE, `${apt.name}: ${err.message}`);
      skipped++;
    }

    if ((i + 1) % 30 === 0) log(PHASE, `진행: ${i + 1}/${targets.length} (갱신 ${updated})`);
  });

  // 배치 단위 병렬 실행 (동시 5건)
  const BATCH = 30;
  for (let b = 0; b < targets.length; b += BATCH) {
    const batch = targets.slice(b, b + BATCH);
    await Promise.all(batch.map((apt, j) => processApt(apt, b + j)));
  }

  const rpt = createReporter(PHASE);
  rpt.success(updated);
  rpt.skip(skipped);
  rpt.summary();
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
