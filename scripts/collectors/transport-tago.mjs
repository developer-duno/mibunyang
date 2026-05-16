// @ts-check
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
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep, recordApiQuota, recordCollectorRun, createReporter } from "./_shared.mjs";

/**
 * @typedef {{ place_name?: string, category_name?: string, distance?: string|number, x?: string|number, y?: string|number }} KakaoDoc
 * @typedef {{ documents?: KakaoDoc[] }} KakaoSearchResponse
 * @typedef {{ nodenm?: string, [k: string]: unknown }} TagoBusStop
 * @typedef {{ response?: { body?: { items?: { item?: TagoBusStop|TagoBusStop[]|"" } } } }} TagoResponse
 */

loadEnv();

const PHASE = "transport";
const KAKAO_KEY = process.env.KAKAO_KEY;
const TAGO_KEY = process.env.TAGO_KEY;

const RADIUS = { SUBWAY: 10000, IC: 30000, KTX: 80000 };
const DEFAULT_SUBWAY_DIST = 9999;
const DEFAULT_IC_DIST = 99;
const DEFAULT_KTX_DIST = 99;

/**
 * @param {number} lat
 * @param {number} lng
 * @param {string} keyword
 * @param {number} radius
 * @returns {Promise<KakaoDoc[]>}
 */
async function searchKakao(lat, lng, keyword, radius) {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=15`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  const data = /** @type {KakaoSearchResponse} */ (await res.json());
  return data.documents || [];
}

/**
 * @param {number} lat
 * @param {number} lng
 * @param {string} categoryCode
 * @param {number} radius
 * @returns {Promise<KakaoDoc[]>}
 */
async function searchKakaoCategory(lat, lng, categoryCode, radius) {
  const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=${categoryCode}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=15`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  const data = /** @type {KakaoSearchResponse} */ (await res.json());
  return data.documents || [];
}

/**
 * TAGO API: 좌표 기반 근처 버스 정류장 조회
 *
 * 세션98: 수집 성공/실패 신호를 명시적으로 구분한다.
 *   - null  = 호출 실패 (키 없음/HTTP 실패/JSON 실패/body 비정상)
 *   - []    = 호출 성공, 근처 0건 (실제 0노선 동네)
 *   - [...] = 호출 성공, N건
 *
 * 실패와 실제 0건이 같게 저장되던 유령값 문제를 DB 레벨에서 분리한다.
 */
/**
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<TagoBusStop[] | null>}
 */
async function searchBusStopsTago(lat, lng) {
  if (!TAGO_KEY) return null;
  const url = `https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList?serviceKey=${encodeURIComponent(TAGO_KEY)}&gpsLati=${lat}&gpsLong=${lng}&_type=json&numOfRows=15`;
  try {
    const res = await fetchWithRetry(url, { signal: AbortSignal.timeout(15000) }, 3);
    if (!res.ok) return null;
    const data = /** @type {TagoResponse} */ (await res.json());
    // 정상 구조 검증: response.body.items 가 있어야 성공. item 없으면 성공·0건.
    const body = data?.response?.body;
    if (!body || !("items" in body)) return null;
    const items = body.items?.item;
    if (items == null || items === "") return [];
    return Array.isArray(items) ? items : [items];
  } catch {
    return null;
  }
}

/**
 * transport 테이블 upsert row 조립 (순수 함수, 테스트용 export)
 *
 * 세션98: busStops 가 null 이면 수집 실패 → bus_routes + bus_stop_names 둘 다 NULL.
 * 빈 배열이면 성공·0건 → bus_routes=0, bus_stop_names=null (현행 유지).
 */
/**
 * @param {{ apartmentId: string, subways: KakaoDoc[], busStops: TagoBusStop[]|null, validICs: KakaoDoc[], validKTX: KakaoDoc[] }} args
 */
export function buildTransportRow({ apartmentId, subways, busStops, validICs, validKTX }) {
  const subwayDist = subways.length > 0 ? Math.round(Number(subways[0].distance)) : DEFAULT_SUBWAY_DIST;
  const subwayName = extractSubwayName(subways[0]);
  const subwayLines = extractSubwayLines(subways, subwayName);

  // 수집 실패(null)와 실제 0건([]) 구분
  const busStopNames = busStops === null
    ? null
    : [...new Set(busStops.map((/** @type {TagoBusStop} */ d) => d.nodenm).filter(Boolean))];
  const busRoutes = busStopNames === null ? null : busStopNames.length;
  const busStopNamesStr = (busStopNames && busStopNames.length > 0) ? busStopNames.join(",") : null;

  const icDist = validICs.length > 0 ? Math.round(Number(validICs[0].distance) / 1000 * 10) / 10 : DEFAULT_IC_DIST;
  const ktxDist = validKTX.length > 0 ? Math.round(Number(validKTX[0].distance) / 1000 * 10) / 10 : DEFAULT_KTX_DIST;

  return {
    apartment_id: apartmentId,
    subway_dist: subwayDist,
    subway_name: subwayName,
    subway_lines: subwayLines,
    bus_routes: busRoutes,
    bus_stop_names: busStopNamesStr,
    ic_dist: icDist,
    ktx_dist: ktxDist,
    updated_at: new Date().toISOString(),
  };
}

/**
 * KTX역 결과 필터
 * @param {KakaoDoc} doc
 * @returns {boolean}
 */
export function isValidStation(doc) {
  const name = doc.place_name || "";
  const cat = doc.category_name || "";
  return name.endsWith("역") || cat.includes("기차") || cat.includes("철도");
}

/**
 * IC 결과 필터
 * @param {KakaoDoc} doc
 * @returns {boolean}
 */
export function isValidIC(doc) {
  const name = doc.place_name || "";
  return name.includes("IC") || name.includes("나들목") || name.includes("인터체인지");
}

/**
 * 가장 가까운 지하철역의 역명 추출
 * @param {KakaoDoc | undefined} doc
 * @returns {string | null}
 */
export function extractSubwayName(doc) {
  if (!doc) return null;
  const name = doc.place_name || "";
  const match = name.match(/^(.+?역)/);
  return match ? match[1] : name;
}

/**
 * 지하철 결과에서 가장 가까운 역의 노선 추출
 * @param {KakaoDoc[]} subways
 * @param {string | null} stationName
 * @returns {string | null}
 */
export function extractSubwayLines(subways, stationName) {
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
  if (!KAKAO_KEY) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }
  if (!TAGO_KEY) log(PHASE, "⚠️ TAGO_KEY 없음 — 버스 정류장 수집 건너뜀");

  const dryRun = process.argv.includes("--dry-run");
  const forceAll = process.argv.includes("--force");
  const maxTago = Number(process.argv.find(a => a.startsWith("--limit="))?.split("=")[1]) || 10000;
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const { data: apts, error } = await sb.from("apartments").select("id, name, lat, lng").limit(10000);
  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);

  const withCoords = (apts || []).filter(a => a.lat && a.lng);

  let targets = withCoords;
  if (!forceAll) {
    const { data: collected } = await sb.from("transport").select("apartment_id").not("subway_name", "is", null).limit(10000);
    const doneSet = new Set((collected || []).map(r => r.apartment_id));
    targets = withCoords.filter(a => !doneSet.has(a.id));
    log(PHASE, `전체 ${withCoords.length}건 중 수집완료 ${doneSet.size}건 → 미수집 ${targets.length}건`);
  }
  log(PHASE, `대상: ${targets.length}건, TAGO 일일 상한: ${maxTago}건`);

  const rpt = createReporter(PHASE);
  let tagoCallCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const apt = targets[i];
    try {
      // busStops 초기값 null = "TAGO 호출 미수행/실패" 로 취급
      /** @type {KakaoDoc[]} */
      let subways = [];
      /** @type {TagoBusStop[] | null} */
      let busStops = null;
      /** @type {KakaoDoc[]} */
      let validICs = [];
      /** @type {KakaoDoc[]} */
      let validKTX = [];

      // 지하철역 (Kakao SW8 카테고리)
      try {
        subways = await searchKakaoCategory(apt.lat, apt.lng, "SW8", RADIUS.SUBWAY);
      } catch (e) { /* 빈 배열 유지 */ }
      await sleep(100);

      // 버스 정류장 (TAGO 좌표기반 API — 일일 상한 제어)
      // 성공: 배열(0건 포함), 실패/상한초과: null
      try {
        if (tagoCallCount < maxTago) {
          busStops = await searchBusStopsTago(apt.lat, apt.lng);
          tagoCallCount++;
        } else if (tagoCallCount === maxTago) {
          log(PHASE, `⚠️ TAGO 일일 상한 ${maxTago}건 도달 — 버스 수집 중단`);
          tagoCallCount++;
        }
      } catch (e) { busStops = null; }
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

      const row = buildTransportRow({ apartmentId: apt.id, subways, busStops, validICs, validKTX });

      if (dryRun) {
        const busLabel = row.bus_routes === null
          ? "버스수집실패"
          : `버스${row.bus_routes}(${(row.bus_stop_names || "").split(",").slice(0, 3).join("·")})`;
        log(PHASE, `  [DRY] ${apt.name}: 지하철${row.subway_dist}m(${row.subway_name || "없음"},${row.subway_lines || "?"}) ${busLabel} IC${row.ic_dist}km KTX${row.ktx_dist}km`);
        rpt.success();
        continue;
      }

      const { error: uErr } = await sb.from("infra").upsert([{ apartment_id: apt.id }], { onConflict: "apartment_id", ignoreDuplicates: true });
      const { error: tErr } = await sb.from("transport").upsert([row], { onConflict: "apartment_id" });
      if (tErr) { logError(PHASE, `${apt.name}: ${tErr.message}`); rpt.fail(); }
      else rpt.success();
    } catch (err) {
      logError(PHASE, `${apt.name}: ${err instanceof Error ? err.message : String(err)}`);
      rpt.fail();
    }

    if ((i + 1) % 30 === 0) log(PHASE, `진행: ${i + 1}/${targets.length}`);
  }

  const actualTagoCalls = Math.min(tagoCallCount, maxTago);
  const result = rpt.summary();
  log(PHASE, `TAGO API 호출: ${actualTagoCalls}회`);

  if (!dryRun) await recordApiQuota("transport-tago", "TAGO_KEY", actualTagoCalls);
  await recordCollectorRun("transport-tago", result);
  if (result.fail > 0) process.exit(1);
}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch(err => { logError(PHASE, err instanceof Error ? err.message : String(err)); process.exit(1); });
