/**
 * 에어코리아 대기질 수집기 — data.go.kr 실시간 측정소별 측정정보
 *
 * 시도별 측정소 데이터 조회 → 단지별 최근접 측정소 매칭 → apartments.air_quality 저장.
 * 별도 AIRKOREA_KEY 필요 (미등록 시 스킵).
 *
 * 사용법:
 *   node scripts/collectors/collect-air-quality.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-air-quality.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep, createReporter, recordApiQuota } from "./_shared.mjs";

loadEnv();

const PHASE = "air-quality";
const API_KEY = process.env.AIRKOREA_KEY;

// 17개 시도
const SIDO_LIST = ["서울","부산","대구","인천","광주","대전","울산","세종","경기","강원","충북","충남","전북","전남","경북","경남","제주"];

/** Haversine 거리 (km) */
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 전국 측정소 좌표 조회 (MsrstnInfoInqireSvc) */
export async function fetchStationCoords() {
  const url = `https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList?serviceKey=${API_KEY}&returnType=json&numOfRows=700&pageNo=1`;
  const res = await fetchWithRetry(url);
  const json = await res.json();
  const items = json?.response?.body?.items || [];
  // stationName → { lat, lng } 맵
  const map = new Map();
  for (const i of items) {
    if (i.dmX && i.dmY && i.stationName) {
      map.set(i.stationName, { lat: parseFloat(i.dmX), lng: parseFloat(i.dmY) });
    }
  }
  return map;
}

/** 시도별 측정소 실시간 대기질 조회 — 좌표는 coordMap에서 조인 */
export async function fetchSidoData(sido, coordMap) {
  const url = `https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty?serviceKey=${API_KEY}&returnType=json&numOfRows=200&pageNo=1&sidoName=${encodeURIComponent(sido)}&ver=1.0`;
  const res = await fetchWithRetry(url);
  const json = await res.json();
  const items = json?.response?.body?.items || [];
  return items.filter(i => coordMap?.has(i.stationName)).map(i => {
    const coord = coordMap.get(i.stationName);
    return {
      station: i.stationName,
      lat: coord.lat,
      lng: coord.lng,
      pm10: i.pm10Value !== "-" ? (parseInt(i.pm10Value) || null) : null,
      pm25: i.pm25Value !== "-" ? (parseInt(i.pm25Value) || null) : null,
      o3: i.o3Value !== "-" ? (parseFloat(i.o3Value) || null) : null,
      grade: i.khaiGrade === "1" ? "좋음" : i.khaiGrade === "2" ? "보통" : i.khaiGrade === "3" ? "나쁨" : i.khaiGrade === "4" ? "매우나쁨" : null,
    };
  });
}

/** 단지별 최근접 측정소 매칭 */
export function matchNearestStation(apt, stations) {
  let minDist = Infinity, nearest = null;
  for (const s of stations) {
    const dist = haversine(apt.lat, apt.lng, s.lat, s.lng);
    if (dist < minDist) { minDist = dist; nearest = s; }
  }
  if (!nearest) return null;
  return {
    pm10: nearest.pm10, pm25: nearest.pm25, o3: nearest.o3,
    grade: nearest.grade, station: nearest.station,
    collected_at: new Date().toISOString().slice(0, 10),
  };
}

async function main() {
  if (!API_KEY) { log(PHASE, "AIRKOREA_KEY 미설정 — 대기질 수집 스킵"); return; }

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();

  // 1-1. 전국 측정소 좌표 조회 (1회 호출)
  log(PHASE, "측정소 좌표 조회 중...");
  const coordMap = await fetchStationCoords();
  log(PHASE, `측정소 좌표 ${coordMap.size}건 조회`);
  let apiCalls = 1;
  await sleep(300);

  // 1-2. 시도별 실시간 대기질 조회 + 좌표 조인
  log(PHASE, "시도별 대기질 데이터 조회 중...");
  const allStations = [];
  for (const sido of SIDO_LIST) {
    try {
      const stations = await fetchSidoData(sido, coordMap);
      allStations.push(...stations);
      apiCalls++;
      await sleep(300);
    } catch (err) { logError(PHASE, `${sido}: ${err.message}`); }
  }
  log(PHASE, `측정소 ${allStations.length}건 조회 완료 (API ${apiCalls}회)`);

  // 2. 단지 목록 조회
  const { data: apts, error } = await sb.from("apartments").select("id, name, lat, lng").limit(10000);
  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);
  const targets = apts.filter(a => a.lat && a.lng);
  log(PHASE, `대상: ${targets.length}건`);

  // 3. 단지별 매칭 + DB 저장
  const rpt = createReporter(PHASE);
  for (let i = 0; i < targets.length; i++) {
    const apt = targets[i];
    try {
      const aq = matchNearestStation(apt, allStations);
      if (!aq) { rpt.skip(1); continue; }
      if (dryRun) {
        log(PHASE, `  [DRY] ${apt.name}: PM2.5=${aq.pm25} PM10=${aq.pm10} ${aq.grade} (${aq.station})`);
        rpt.success(1);
        continue;
      }
      const { error: uErr } = await sb.from("apartments").update({ air_quality: aq }).eq("id", apt.id);
      if (uErr) { logError(PHASE, `${apt.name}: ${uErr.message}`); rpt.fail(1); }
      else rpt.success(1);
    } catch (err) {
      logError(PHASE, `${apt.name}: ${err.message}`);
      rpt.fail(1);
    }
    if ((i + 1) % 100 === 0) log(PHASE, `진행: ${i + 1}/${targets.length}`);
  }

  await recordApiQuota(PHASE, "data.go.kr/airkorea", apiCalls);
  const result = rpt.summary();
  if (result.fail > 0) process.exit(1);
}

const isCLI = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isCLI) main().catch(err => { logError(PHASE, err.message); process.exit(1); });
