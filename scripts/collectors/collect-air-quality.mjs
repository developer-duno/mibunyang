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
 * 오늘 실시간 값으로 갈아끼우되 **`annual`(3년 평균)은 보존**한다 (세션560).
 *
 * ⚠️ 이 함수가 없으면 조용한 데이터 유실이 난다. 이 수집기는 `air_quality` JSON 을 **통째로
 * 교체**하는데(`update({ air_quality: ... })`), `annual` 은 다른 도구(`air-annual-attach.mjs`)가
 * 넣는 **채점용** 값이다. 그냥 덮으면 매일 새벽에 전 단지의 3년 평균이 사라지고, 점수는
 * 중립 폴백(14점)으로 조용히 떨어진다 — **에러도 경보도 안 난다.**
 *
 * 같은 파일의 `infra` 갱신이 이미 쓰는 원칙과 같다: **소유한 칸만 건드린다.**
 *
 * @param {Record<string, unknown> | null | undefined} prev 기존 air_quality
 * @param {Record<string, unknown>} next 오늘 측정값
 * @returns {Record<string, unknown>}
 */
export function mergeKeepingAnnual(prev, next) {
  return prev?.annual != null ? { ...next, annual: prev.annual } : next;
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

/**
 * `infra` 에 쓸 대기질 6칸 패치 생성 (세션559 의도 재적용, 세션565)
 *
 * `air_updated_at` 은 **측정값(pm10·pm25·o3)이 하나라도 있을 때만** 찍는다 — 자매 레포가
 * 세션280에 세운 규칙을 그대로 승계한 것이다(자매 `env_air.py`: "측정값 있을 때만 updated_at
 * 갱신"). 에어코리아는 점검·통신장애 때 측정값을 `"-"` 로 주고 이 수집기는 그걸 null 로
 * 바꾸는데(`fetchSidoData`), 전부 null 인데도 시각을 찍으면 자매 화면 `FreshnessTag`
 * (`MbEnvironmentSection.tsx:108`)가 "방금 갱신됨"으로 보여 준다 — 숫자는 빈칸인데. 그 거짓말을 막는다.
 *
 * 측정소 이름·거리는 측정값 유무와 무관하게 늘 쓴다(어느 측정소를 봤는지는 사실이므로).
 * 등급(`air_grade`)은 측정값과 함께 움직인다 — 측정값이 없으면 등급도 옛 값을 남기지 않는다.
 *
 * @param {{ station: string; stationDist: number | null; pm10: number | null; pm25: number | null; o3: number | null; grade: string | null }} aq
 * @param {() => string} [nowIso] 테스트 주입용 시각 생성기
 * @returns {Record<string, unknown>}
 */
export function buildInfraPatch(aq, nowIso = () => new Date().toISOString()) {
  /** @type {Record<string, unknown>} */
  const patch = {
    air_station_name: aq.station,
    air_station_dist: aq.stationDist,
  };
  // `!= null` — undefined(필드 누락)도 "측정값 없음"으로 본다.
  const hasMeasure = aq.pm10 != null || aq.pm25 != null || aq.o3 != null;
  if (hasMeasure) {
    patch.air_pm10 = aq.pm10;
    patch.air_pm25 = aq.pm25;
    patch.air_o3 = aq.o3;
    patch.air_grade = aq.grade;
    patch.air_updated_at = nowIso();
  }
  return patch;
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
      const merged = mergeKeepingAnnual(/** @type {Record<string, unknown> | null} */ (apt.air_quality), aq);
      const { error: uErr } = await sb.from("apartments").update({ air_quality: merged }).eq("id", apt.id);
      if (uErr) { logError(PHASE, `${apt.name}: ${uErr.message}`); rpt.fail(1); continue; }
      // `infra` 대기질 6칸을 전부 맞춘다 — **자매 레포가 읽는 자리**다
      // (`naver-estate-web` `MbEnvironmentSection.tsx:106~137` · `MbCompareRadarChart.tsx:41`).
      //
      // ## 수치 4칸을 여기서 쓰는 이유 (세션559 의도, 세션565 재적용)
      // 예전엔 자매 `env_air.py` 가 수치를 채웠다. 그쪽은 **단지마다 API 1콜**이라 하루 100곳씩
      // 돌아가며 채우고(전 단지 한 바퀴 ≈30일), 2026-09-22 실측으로 3,068곳 중 **2,560곳(83%)만**
      // 수치가 있었다. 이 수집기는 **매주 화요일**(로컬 러너 `kosis-local-runner.mjs` dow:2,
      // 약 05:30 KST) 시도별 조회 약 18콜로 전국 측정소를 한 번에 받아 **로컬에서** 거리를 재므로
      // (`matchNearestStation`) 전 단지를 매주 갱신하면서도 호출은 주 18콜 안팎이다(자매 방식
      // 주 700콜의 약 1/40). 측정소 이름·거리 두 칸은 원래부터 이 수집기가 매주 전량 덮어쓰고
      // 있었다 — 두 수집기가 같은 칸을 번갈아 쓰던 셈이다. 그래서 수치까지 여기서 책임지고,
      // 자매 `env_air.py` 는 이 변경의 라이브 반영을 확인한 뒤 폐지한다(별도 PR).
      // TM 좌표변환이 없으므로 자매 PR #556 이 고친 종류의 사고(전국이 제주 관측소로 몰림)가
      // 구조적으로 불가능하다.
      //
      // ⚠️ `air_updated_at` 은 **측정값이 하나라도 있을 때만** 찍는다(자매 세션280 규칙 승계,
      //   `buildInfraPatch` 참조). 전부 null 인데 시각을 찍으면 화면은 "방금 갱신됨"인데
      //   숫자는 빈칸인 거짓말이 된다.
      // ⚠️ `infra` 는 5개 수집기가 컬럼을 나눠 쓰는 행이라 **소유한 칸만** 갱신한다(행 덮어쓰기 금지).
      const { data: iRows, error: iErr } = await sb
        .from("infra")
        .update(buildInfraPatch(aq))
        .eq("apartment_id", apt.id)
        .select("apartment_id");
      if (iErr) { logError(PHASE, `${apt.name} infra: ${iErr.message}`); rpt.fail(1); continue; }
      // 행이 없으면 update 는 조용히 0건을 돌려준다(#552 의 "돌아온 결과에서 센다" 원칙과 같은
      // 결). 행을 만들어 주던 자매 `env_air.py` 가 폐지되면, 새 단지가 조용히 빈 채로 남는 걸
      // 막으려면 여기서 드러나야 한다.
      if (!iRows || iRows.length === 0) { logError(PHASE, `${apt.name}: infra 행 없음 — 대기질 미반영`); rpt.fail(1); continue; }
      rpt.success(1);
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
