// @ts-check
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
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep, createReporter, recordApiQuota, recordCollectorRun, haversineKm, today, selectAll } from "./_shared.mjs";

loadEnv();

const PHASE = "air-quality";
const API_KEY = process.env.AIRKOREA_KEY;

// 17개 시도
const SIDO_LIST = ["서울","부산","대구","인천","광주","대전","울산","세종","경기","강원","충북","충남","전북","전남","경북","경남","제주"];

export const haversine = haversineKm;

/**
 * @typedef {{ lat: number; lng: number }} StationCoord
 * @typedef {{ station: string; lat: number; lng: number; pm10: number | null; pm25: number | null; o3: number | null; grade: string | null }} StationData
 * @typedef {{ id: string; name: string | null; lat: number | null; lng: number | null }} AirQualityAptRow
 */

/**
 * 전국 측정소 좌표 조회 (MsrstnInfoInqireSvc)
 * @returns {Promise<Map<string, StationCoord>>}
 */
export async function fetchStationCoords() {
  const url = `https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList?serviceKey=${API_KEY}&returnType=json&numOfRows=700&pageNo=1`;
  const res = await fetchWithRetry(url);
  const json = /** @type {{ response?: { body?: { items?: Array<Record<string, unknown>> } } }} */ (await res.json());
  const items = json?.response?.body?.items || [];
  // stationName → { lat, lng } 맵
  /** @type {Map<string, StationCoord>} */
  const map = new Map();
  for (const i of items) {
    if (i.dmX && i.dmY && i.stationName) {
      map.set(String(i.stationName), { lat: parseFloat(String(i.dmX)), lng: parseFloat(String(i.dmY)) });
    }
  }
  return map;
}

/**
 * 시도별 측정소 실시간 대기질 조회 — 좌표는 coordMap에서 조인
 * @param {string} sido
 * @param {Map<string, StationCoord>} coordMap
 * @returns {Promise<StationData[]>}
 */
export async function fetchSidoData(sido, coordMap) {
  const url = `https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty?serviceKey=${API_KEY}&returnType=json&numOfRows=200&pageNo=1&sidoName=${encodeURIComponent(sido)}&ver=1.0`;
  const res = await fetchWithRetry(url);
  const json = /** @type {{ response?: { body?: { items?: Array<Record<string, unknown>> } } }} */ (await res.json());
  const items = json?.response?.body?.items || [];
  /** @type {StationData[]} */
  const out = [];
  for (const i of items) {
    const stationName = i.stationName;
    if (!stationName || typeof stationName !== "string") continue;
    const coord = coordMap.get(stationName);
    if (!coord) continue;
    out.push({
      station: stationName,
      lat: coord.lat,
      lng: coord.lng,
      pm10: i.pm10Value !== "-" ? (parseInt(String(i.pm10Value)) || null) : null,
      pm25: i.pm25Value !== "-" ? (parseInt(String(i.pm25Value)) || null) : null,
      o3: i.o3Value !== "-" ? (parseFloat(String(i.o3Value)) || null) : null,
      grade: i.khaiGrade === "1" ? "좋음" : i.khaiGrade === "2" ? "보통" : i.khaiGrade === "3" ? "나쁨" : i.khaiGrade === "4" ? "매우나쁨" : null,
    });
  }
  return out;
}

/**
 * 단지별 최근접 측정소 매칭
 *
 * ## `stationDist` 는 **m** 단위다 (세션556 신설)
 *
 * `haversine`(= `haversineKm`)은 **km** 를 준다. 이 저장소의 다른 거리 컬럼
 * (`police_dist`·`noxious_dist`·`subway_dist` …)은 전부 **m** 이고, 자매 레포
 * `naver-estate-web` 의 `MbEnvironmentSection.tsx:137` 도 `infra.air_station_dist` 를
 * **`(…m)` 으로 표시**한다. 그래서 여기서 곱해 m 로 맞춘다.
 *
 * ⚠️ 이 값이 없던 동안 `infra.air_station_dist` 에는 **km 숫자가 m 로 표시**되고 있었다 —
 * 제주 단지가 실제 503km 인데 자매 화면에 `(503m)` = "바로 옆 관측소" 로 보였다
 * (세션556 실측: 값 있는 2,602곳 중 **1,347곳이 50km 초과**, 중앙값 52.6km).
 * 그 값이 어느 경로로 들어갔는지는 코드에 남아 있지 않다(이 수집기는 `apartments.air_quality`
 * JSON 만 쓰고 `infra` 는 안 건드렸다) — 옛 일회성 스크립트의 잔재로 보인다.
 *
 * @param {AirQualityAptRow} apt
 * @param {StationData[]} stations
 */
export function matchNearestStation(apt, stations) {
  /** @type {StationData | null} */
  let nearest = null;
  let minDist = Infinity;
  for (const s of stations) {
    const dist = haversine(Number(apt.lat), Number(apt.lng), s.lat, s.lng);
    if (dist < minDist) { minDist = dist; nearest = s; }
  }
  if (!nearest) return null;
  return {
    pm10: nearest.pm10, pm25: nearest.pm25, o3: nearest.o3,
    grade: nearest.grade, station: nearest.station,
    // km → m. 다른 거리 컬럼·자매 화면과 같은 단위로 맞춘다(위 주석).
    stationDist: Number.isFinite(minDist) ? Math.round(minDist * 1000) : null,
    collected_at: today(), // KST 고정
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
    } catch (err) { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, `${sido}: ${msg}`); }
  }
  log(PHASE, `측정소 ${allStations.length}건 조회 완료 (API ${apiCalls}회)`);

  // 2. 단지 목록 조회 — selectAll 공유 헬퍼(고유키 id 커서 페이지네이션)
  // ⚠️ `air_quality` 도 함께 읽는다 — 이 수집기는 그 JSON 을 **통째로 교체**하므로, 다른
  //    수집기가 넣어 둔 키(`annual` = 3년 평균, 세션560)를 보존하려면 기존 값이 필요하다.
  const apts = await selectAll(
    (s) => s.from("apartments").select("id, name, lat, lng, air_quality"),
    sb,
    "id"
  );
  const targets = apts.filter(a => a.lat && a.lng);
  log(PHASE, `대상: ${targets.length}건`);

  // 3. 단지별 매칭 + DB 저장
  const rpt = createReporter(PHASE);
  for (let i = 0; i < targets.length; i++) {
    if (rpt.interrupted()) break;
    const apt = targets[i];
    try {
      const aq = matchNearestStation(apt, allStations);
      if (!aq) { rpt.skip(1); continue; }
      if (dryRun) {
        log(PHASE, `  [DRY] ${apt.name}: PM2.5=${aq.pm25} PM10=${aq.pm10} ${aq.grade} (${aq.station} ${aq.stationDist ?? "?"}m)`);
        rpt.success(1);
        continue;
      }
      // ⚠️ **행 덮어쓰기 금지** — 바로 아래 `infra` 와 같은 원칙이다(세션560).
      //    이 수집기가 소유한 건 실시간 키(pm25/pm10/o3/grade/station/stationDist/collected_at)뿐이고,
      //    `annual`(3년 평균, `air-annual-attach.mjs` 소유)은 **채점에 쓰이는 값**이라 날리면
      //    다음 재계산에서 전 단지가 조용히 중립 폴백으로 떨어진다(에러도 경보도 안 난다).
      const prevAq = /** @type {Record<string, unknown> | null} */ (apt.air_quality);
      const merged = prevAq?.annual != null ? { ...aq, annual: prevAq.annual } : aq;
      const { error: uErr } = await sb.from("apartments").update({ air_quality: merged }).eq("id", apt.id);
      if (uErr) { logError(PHASE, `${apt.name}: ${uErr.message}`); rpt.fail(1); continue; }
      // `infra.air_station_name`·`air_station_dist` 도 함께 맞춘다 — **자매 레포가 읽는 자리**다
      // (`naver-estate-web` `MbEnvironmentSection.tsx:132·137`). 이 수집기가 `apartments.air_quality`
      // JSON 만 쓰던 동안 그 두 컬럼은 옛 값(km 숫자)이 m 로 표시되고 있었다(세션556).
      // ⚠️ `infra` 는 5개 수집기가 컬럼을 나눠 쓰는 행이라 **소유한 두 칸만** 갱신한다(행 덮어쓰기 금지).
      const { error: iErr } = await sb
        .from("infra")
        .update({ air_station_name: aq.station, air_station_dist: aq.stationDist })
        .eq("apartment_id", apt.id);
      if (iErr) { logError(PHASE, `${apt.name} infra: ${iErr.message}`); rpt.fail(1); }
      else rpt.success(1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `${apt.name}: ${msg}`);
      rpt.fail(1);
    }
    if ((i + 1) % 100 === 0) log(PHASE, `진행: ${i + 1}/${targets.length}`);
  }

  await recordApiQuota(PHASE, "data.go.kr/airkorea", apiCalls);
  const result = rpt.summary();
  await recordCollectorRun(PHASE, result);
  if (result.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });
