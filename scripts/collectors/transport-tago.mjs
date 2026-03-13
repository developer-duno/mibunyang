/**
 * 교통 접근성 수집기 — Kakao Places 기반
 *
 * 버스정류장(500m), 고속도로IC(20km), KTX(50km) 검색
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
      // 버스정류장 500m
      const busStops = await searchKakao(apt.lat, apt.lng, "버스정류장", 500);
      await sleep(100);

      // 고속도로 IC 20km
      const ics = await searchKakao(apt.lat, apt.lng, "고속도로IC", 20000);
      await sleep(100);

      // KTX역 50km
      const ktxs = await searchKakao(apt.lat, apt.lng, "KTX", 50000);
      await sleep(100);

      // 유니크 정류장명
      const uniqueBus = new Set(busStops.map(d => d.place_name)).size;
      const icDist = ics.length > 0 ? Math.round(Number(ics[0].distance) / 1000 * 10) / 10 : 99;
      const ktxDist = ktxs.length > 0 ? Math.round(Number(ktxs[0].distance) / 1000 * 10) / 10 : 99;

      const row = {
        apartment_id: apt.id,
        bus_routes: uniqueBus,
        ic_dist: icDist,
        ktx_dist: ktxDist,
        updated_at: new Date().toISOString(),
      };

      if (dryRun) {
        log(PHASE, `  [DRY] ${apt.name}: 버스${uniqueBus} IC${icDist}km KTX${ktxDist}km`);
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

  log(PHASE, `\n=== 완료: 갱신 ${updated}, 건너뜀 ${skipped} ===`);
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
