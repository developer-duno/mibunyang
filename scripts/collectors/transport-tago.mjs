/**
 * 교통 접근성 수집기 — Kakao Places + TAGO 대중교통 API
 *
 * 지하철(Kakao SW8, 10km), 버스(TAGO 좌표기반, 1km),
 * 고속도로IC(Kakao, 30km), KTX(Kakao, 80km)
 *
 * 사용법:
 *   node scripts/collectors/transport-tago.mjs              (Supabase UPDATE)
 *   node scripts/collectors/transport-tago.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep } from "./_shared.mjs";

loadEnv();

const PHASE = "transport";
const KAKAO_KEY = process.env.KAKAO_KEY;
const TAGO_KEY = process.env.TAGO_KEY;
if (!KAKAO_KEY) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }
if (!TAGO_KEY) log(PHASE, "⚠️ TAGO_KEY 없음 — 버스 정류장 수집 건너뜀");

const RADIUS = { SUBWAY: 10000, IC: 30000, KTX: 80000 };
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

/** TAGO API: 좌표 기반 근처 버스 정류장 조회 */
async function searchBusStopsTago(lat, lng) {
  if (!TAGO_KEY) return [];
  const url = `http://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList?serviceKey=${encodeURIComponent(TAGO_KEY)}&gpsLati=${lat}&gpsLong=${lng}&_type=json&numOfRows=15`;
  const res = await fetchWithRetry(url, { signal: AbortSignal.timeout(15000) }, 3);
  if (!res.ok) return [];
  const data = await res.json();
  const items = data?.response?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

/** KTX역 결과 필터 */
function isValidStation(doc) {
  const name = doc.place_name || "";
  const cat = doc.category_name || "";
  return name.endsWith("역") || cat.includes("기차") || cat.includes("철도");
}

/** IC 결과 필터 */
function isValidIC(doc) {
  const name = doc.place_name || "";
  return name.includes("IC") || name.includes("나들목") || name.includes("인터체인지");
}

/** 가장 가까운 지하철역의 역명 추출 */
function extractSubwayName(doc) {
  if (!doc) return null;
  const name = doc.place_name || "";
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
    const cat = s.category_name || "";
    const lineMatch = cat.match(/(\d+호선|[가-힣]+선)$/);
    if (lineMatch) lines.add(lineMatch[1]);
    const nameMatch = (s.place_name || "").match(/(\d+호선|[가-힣]+선)$/);
    if (nameMatch) lines.add(nameMatch[1]);
  }
  return lines.size > 0 ? [...lines].join(",") : null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const forceAll = process.argv.includes("--force");
  const maxTago = Number(process.argv.find(a => a.startsWith("--limit="))?.split("=")[1]) || 10000;
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const { data: apts, error } = await sb.from("apartments").select("id, name, lat, lng");
  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);

  const withCoords = (apts || []).filter(a => a.lat && a.lng);

  let targets = withCoords;
  if (!forceAll) {
    const { data: collected } = await sb.from("transport").select("apartment_id").not("bus_routes", "is", null);
    const doneSet = new Set((collected || []).map(r => r.apartment_id));
    targets = withCoords.filter(a => !doneSet.has(a.id));
    log(PHASE, `전체 ${withCoords.length}건 중 수집완료 ${doneSet.size}건 → 미수집 ${targets.length}건`);
  }
  log(PHASE, `대상: ${targets.length}건, TAGO 일일 상한: ${maxTago}건`);

  let updated = 0, skipped = 0, tagoCallCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const apt = targets[i];
    try {
      let subways = [], busStops = [], validICs = [], validKTX = [];

      // 지하철역 (Kakao SW8 카테고리)
      try {
        subways = await searchKakaoCategory(apt.lat, apt.lng, "SW8", RADIUS.SUBWAY);
      } catch (e) { /* 빈 배열 유지 */ }
      await sleep(100);

      // 버스 정류장 (TAGO 좌표기반 API — 일일 상한 제어)
      try {
        if (tagoCallCount < maxTago) {
          busStops = await searchBusStopsTago(apt.lat, apt.lng);
          tagoCallCount++;
        } else if (tagoCallCount === maxTago) {
          log(PHASE, `⚠️ TAGO 일일 상한 ${maxTago}건 도달 — 버스 수집 중단`);
          tagoCallCount++;
        }
      } catch (e) { /* 빈 배열 유지 */ }
      await sleep(100);

      // 고속도로 IC (Kakao 키워드)
      try {
        const icResults = await searchKakao(apt.lat, apt.lng, "IC 나들목", RADIUS.IC);
        validICs = icResults.filter(isValidIC);
      } catch (e) { /* 빈 배열 유지 */ }
      await sleep(100);

      // KTX역 (Kakao 키워드)
      try {
        const ktxResults = await searchKakao(apt.lat, apt.lng, "KTX역", RADIUS.KTX);
        validKTX = ktxResults.filter(isValidStation);
      } catch (e) { /* 빈 배열 유지 */ }
      await sleep(100);

      // 결과 계산
      const subwayDist = subways.length > 0 ? Math.round(Number(subways[0].distance)) : DEFAULT_SUBWAY_DIST;
      const subwayName = extractSubwayName(subways[0]);
      const subwayLines = extractSubwayLines(subways, subwayName);

      // TAGO 버스 정류장: nodenm(정류장명) 기준 고유 개수
      const busStopNames = [...new Set(busStops.map(d => d.nodenm).filter(Boolean))];
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
        log(PHASE, `  [DRY] ${apt.name}: 지하철${subwayDist}m(${subwayName || "없음"},${subwayLines || "?"}) 버스${uniqueBus}(${busStopNames.slice(0, 3).join("·")}) IC${icDist}km KTX${ktxDist}km`);
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

  log(PHASE, `\n=== 완료: 갱신 ${updated}, 건너뜀 ${skipped}, TAGO 호출 ${tagoCallCount > maxTago ? maxTago : tagoCallCount}건 ===`);
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
