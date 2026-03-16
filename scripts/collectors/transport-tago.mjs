/**
 * 교통 접근성 수집기 — Kakao Places 기반
 *
 * 지하철(SW8, 10km), 버스정류장(1km), 고속도로IC(30km), KTX(80km) 검색
 *
 * 사용법:
 *   node scripts/collectors/transport-tago.mjs              (Supabase UPDATE)
 *   node scripts/collectors/transport-tago.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep } from "./_shared.mjs";

loadEnv();

const PHASE = "transport";
const KAKAO_KEY = process.env.KAKAO_KEY;
if (!KAKAO_KEY) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }

async function searchKakao(lat, lng, keyword, radius) {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=15`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  const data = await res.json();
  return data.documents || [];
}

async function searchKakaoCategory(lat, lng, categoryCode, radius) {
  const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=${categoryCode}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=15`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  const data = await res.json();
  return data.documents || [];
}

/** KTX역 결과 필터: place_name이 "역"으로 끝나거나 category에 "기차"/"철도" 포함 */
function isValidStation(doc) {
  const name = doc.place_name || "";
  const cat = doc.category_name || "";
  return name.endsWith("역") || cat.includes("기차") || cat.includes("철도");
}

/** IC 결과 필터: place_name에 "IC" 또는 "나들목" 또는 "인터체인지" 포함 */
function isValidIC(doc) {
  const name = doc.place_name || "";
  return name.includes("IC") || name.includes("나들목") || name.includes("인터체인지");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const { data: apts, error } = await sb.from("apartments").select("id, name, lat, lng");
  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);

  const targets = apts.filter(a => a.lat && a.lng);
  log(PHASE, `대상: ${targets.length}건 (좌표 있음)`);

  let updated = 0, skipped = 0;

  for (let i = 0; i < targets.length; i++) {
    const apt = targets[i];
    try {
      // 지하철역 (SW8 카테고리, 10km)
      const subways = await searchKakaoCategory(apt.lat, apt.lng, "SW8", 10000);
      const subwayDist = subways.length > 0 ? Math.round(Number(subways[0].distance)) : 9999;
      await sleep(100);

      // 버스 정류장 (키워드 "정류장", 1km)
      const busStops = await searchKakao(apt.lat, apt.lng, "정류장", 1000);
      await sleep(100);

      // 고속도로 IC (키워드 + 필터, 30km)
      const icResults = await searchKakao(apt.lat, apt.lng, "IC 나들목", 30000);
      const validICs = icResults.filter(isValidIC);
      await sleep(100);

      // KTX역 (키워드 + 필터, 80km)
      const ktxResults = await searchKakao(apt.lat, apt.lng, "KTX역", 80000);
      const validKTX = ktxResults.filter(isValidStation);
      await sleep(100);

      // 결과 계산
      const uniqueBus = new Set(busStops.map(d => d.place_name)).size;
      const icDist = validICs.length > 0 ? Math.round(Number(validICs[0].distance) / 1000 * 10) / 10 : 99;
      const ktxDist = validKTX.length > 0 ? Math.round(Number(validKTX[0].distance) / 1000 * 10) / 10 : 99;

      const row = {
        apartment_id: apt.id,
        subway_dist: subwayDist,
        bus_routes: uniqueBus,
        ic_dist: icDist,
        ktx_dist: ktxDist,
        updated_at: new Date().toISOString(),
      };

      if (dryRun) {
        log(PHASE, `  [DRY] ${apt.name}: 지하철${subwayDist}m 버스${uniqueBus} IC${icDist}km KTX${ktxDist}km`);
        updated++;
        continue;
      }

      const { error: uErr } = await sb.from("infra").upsert([{ apartment_id: apt.id }], { onConflict: "apartment_id", ignoreDuplicates: true });
      const { error: tErr } = await sb.from("transport").upsert([row], { onConflict: "apartment_id" });
      if (tErr) { logError(PHASE, `${apt.name}: ${tErr.message}`); skipped++; }
      else updated++;
    } catch (err) {
      logError(PHASE, `${apt.name}: ${err.message}`);
      skipped++;
    }

    if ((i + 1) % 30 === 0) log(PHASE, `진행: ${i + 1}/${targets.length} (갱신 ${updated})`);
  }

  log(PHASE, `
=== 완료: 갱신 ${updated}, 건너뜀 ${skipped} ===`);
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
