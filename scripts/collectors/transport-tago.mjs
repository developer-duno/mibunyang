/**
 * 교통 접근성 수집기 — Kakao Places 기반
 *
 * 지하철(SW8, 10km), 버스정류장(BK9, 1.5km), 고속도로IC(30km), KTX(80km) 검색
 * 지하철 역명/노선, 버스 정류장명도 수집
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

const RADIUS = { SUBWAY: 10000, BUS: 1500, IC: 30000, KTX: 80000 };
const DEFAULT_SUBWAY_DIST = 9999;
const DEFAULT_IC_DIST = 99;
const DEFAULT_KTX_DIST = 99;

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

/** 가장 가까운 지하철역의 역명 추출 */
function extractSubwayName(doc) {
  if (!doc) return null;
  // place_name 예: "강남역 2호선", "서울역 1호선", "판교역"
  const name = doc.place_name || "";
  // "역" 뒤의 노선 정보 제거 후 역명만 추출
  const match = name.match(/^(.+?역)/);
  return match ? match[1] : name;
}

/** 지하철 결과에서 가장 가까운 역의 노선 추출 */
function extractSubwayLines(subways, stationName) {
  if (!stationName || subways.length === 0) return null;
  const baseName = stationName.replace(/역$/, "");
  const lines = new Set();
  for (const s of subways) {
    if (!(s.place_name || "").includes(baseName)) continue;
    // category_name 예: "교통,지하철,수도권 2호선" 또는 "교통,지하철,신분당선"
    const cat = s.category_name || "";
    const lineMatch = cat.match(/(\d+호선|[가-힣]+선)$/);
    if (lineMatch) lines.add(lineMatch[1]);
    // place_name에서도 추출: "강남역 2호선"
    const nameMatch = (s.place_name || "").match(/(\d+호선|[가-힣]+선)$/);
    if (nameMatch) lines.add(nameMatch[1]);
  }
  return lines.size > 0 ? [...lines].join(",") : null;
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
      // 각 API 호출을 개별 try-catch로 감싸서 부분 실패 허용
      let subways = [], busStops = [], validICs = [], validKTX = [];

      // 지하철역 (SW8 카테고리)
      try {
        subways = await searchKakaoCategory(apt.lat, apt.lng, "SW8", RADIUS.SUBWAY);
      } catch (e) { /* 지하철 검색 실패 시 빈 배열 유지 */ }
      await sleep(100);

      // 버스 정류장 (키워드 검색, 1.5km)
      try {
        busStops = await searchKakao(apt.lat, apt.lng, "버스정류장", RADIUS.BUS);
        // 결과가 적으면 "정류장" 키워드로 재시도
        if (busStops.length === 0) {
          busStops = await searchKakao(apt.lat, apt.lng, "정류장", RADIUS.BUS);
        }
      } catch (e) { /* 버스 검색 실패 시 빈 배열 유지 */ }
      await sleep(100);

      // 고속도로 IC (키워드 + 필터)
      try {
        const icResults = await searchKakao(apt.lat, apt.lng, "IC 나들목", RADIUS.IC);
        validICs = icResults.filter(isValidIC);
      } catch (e) { /* IC 검색 실패 시 빈 배열 유지 */ }
      await sleep(100);

      // KTX역 (키워드 + 필터)
      try {
        const ktxResults = await searchKakao(apt.lat, apt.lng, "KTX역", RADIUS.KTX);
        validKTX = ktxResults.filter(isValidStation);
      } catch (e) { /* KTX 검색 실패 시 빈 배열 유지 */ }
      await sleep(100);

      // 결과 계산
      const subwayDist = subways.length > 0 ? Math.round(Number(subways[0].distance)) : DEFAULT_SUBWAY_DIST;
      const subwayName = extractSubwayName(subways[0]);
      const subwayLines = extractSubwayLines(subways, subwayName);
      const busStopNames = [...new Set(busStops.map(d => d.place_name))];
      const uniqueBus = busStopNames.length;
      const icDist = validICs.length > 0 ? Math.round(Number(validICs[0].distance) / 1000 * 10) / 10 : DEFAULT_IC_DIST;
      const ktxDist = validKTX.length > 0 ? Math.round(Number(validKTX[0].distance) / 1000 * 10) / 10 : DEFAULT_KTX_DIST;

      const row = {
        apartment_id: apt.id,
        subway_dist: subwayDist,
        subway_name: subwayName,
        subway_lines: subwayLines,
        bus_routes: uniqueBus,
        bus_stop_names: busStopNames.length > 0 ? busStopNames.join(",") : null,
        ic_dist: icDist,
        ktx_dist: ktxDist,
        updated_at: new Date().toISOString(),
      };

      if (dryRun) {
        log(PHASE, `  [DRY] ${apt.name}: 지하철${subwayDist}m(${subwayName || "없음"}, ${subwayLines || "노선없음"}) 버스${uniqueBus}(${busStopNames.slice(0, 3).join("·")}) IC${icDist}km KTX${ktxDist}km`);
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
