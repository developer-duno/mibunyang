// @ts-check
/**
 * 교통 접근성 수집기 — Kakao Places + TAGO 대중교통 API
 *
 * 지하철(Kakao SW8, 10km), 버스(TAGO 좌표기반, 1km),
 * 고속도로IC(Kakao, 20km), KTX(Kakao, 20km)
 *
 * 사용법:
 *   node scripts/collectors/transport-tago.mjs                     (Supabase UPDATE)
 *   node scripts/collectors/transport-tago.mjs --dry-run           (미리보기만)
 *   node scripts/collectors/transport-tago.mjs --budget-min=180    (벽시계 예산 분 — 기본 180, 0=무제한)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep, recordApiQuota, recordCollectorRun, createReporter, selectAll, budgetExceeded } from "./_shared.mjs";

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

/**
 * Kakao Local API 반경 상한 — 공식 문서상 radius 는 0~20000(m)이고, 넘기면 검색 자체가
 * HTTP 400 ValidationError(`query.radius should be at most 20000`)로 거절된다.
 * https://developers.kakao.com/docs/ko/local/dev-guide
 */
export const KAKAO_MAX_RADIUS_M = 20000;

/**
 * 검색 반경(m). 전부 KAKAO_MAX_RADIUS_M 이하여야 한다 — 회귀 가드 = transport-tago.test.mjs.
 *
 * 세션 497: IC 가 30000, KTX 가 80000 이라 이 수집기가 도입된 2026-03-19 이래 두 검색이
 * **매 호출 400 으로 실패**했다. 호출부가 예외를 삼켜 ic/ktxFailCount 로만 세는 탓에
 * collector_runs 는 계속 success 였고, DB 는 ktx_dist 2,526행 전부(100%)·ic_dist 96.6%
 * 가 센티널 99 로 굳어 화면에 "IC 원거리"·"반경 밖"이 거짓으로 표시됐다.
 *
 * 20000 으로 낮춰도 점수는 한 점도 잃지 않는다: scoreLocation 의 IC_DIST_TIERS 는 10km,
 * KTX_DIST_TIERS 는 15km 를 넘으면 0점이라 20km 밖은 센티널 99 와 결과가 같다. 실측(17개
 * 지역 51개 단지 표본)에서도 IC 는 96.1% 를 찾고 그 전부가 10km 이내였으며, 20km 안에서
 * 찾았는데 점수가 0점인 IC 는 0건이었다. 그래서 나눠 검색·카테고리코드 전환은 불필요하다.
 */
export const RADIUS = { SUBWAY: 10000, IC: 20000, KTX: 20000 };
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

/**
 * 호출 실패율이 임계를 넘는 신호를 찾는다 (순수 함수, 테스트용 export).
 *
 * 세션 496: 4개 외부 호출(지하철/버스/IC/KTX)이 전부 try/catch 로 실패를 삼켜 8-06 TAGO
 * 100% 장애 때도 collector_runs 는 정상 기록됐다. main() 은 이 함수로 판정만 위임하고
 * 로그 출력은 호출부가 담당 — 판정 로직을 main() 밖으로 빼서 단위 테스트 가능하게 한다.
 *
 * @param {{ subway: number, bus: number, ic: number, ktx: number }} fails 신호별 실패 건수
 * @param {number} attempted 이번 회차에 실제로 시도한 단지 수
 * @param {number} [threshold] 경고 임계 (0~1), 기본 0.5
 * @returns {{ label: string, count: number, rate: number }[]} 임계를 넘은 신호만
 */
export function findHighFailureRates(fails, attempted, threshold = 0.5) {
  if (attempted <= 0) return [];
  const entries = [
    { label: "지하철", count: fails.subway },
    { label: "버스(TAGO)", count: fails.bus },
    { label: "IC", count: fails.ic },
    { label: "KTX", count: fails.ktx },
  ];
  return entries
    .map((e) => ({ ...e, rate: e.count / attempted }))
    .filter((e) => e.rate > threshold);
}

/**
 * transport 테이블에서 "TAGO 버스 수집이 실제로 성공한" apartment_id 집합 (완료 판정).
 *
 * ⚠️ 완료 판정 기준 = `bus_routes IS NOT NULL` (subway_name 아님, 세션 496 정정).
 *    세션98 설계(위 searchBusStopsTago 주석)가 이미 성공/실패를 명확히 구분해 뒀다:
 *      null = TAGO 호출 실패 / [] → bus_routes=0 = 성공·0건 / [...] = 성공·N건.
 *    `bus_routes IS NOT NULL` 은 곧 "TAGO 호출이 실제로 성공했다"는 뜻이라 이 기준 하나로
 *    두 결함을 동시에 푼다:
 *      1) 지방 단지(지하철 없음, subway_name 영구 null)가 매일 재수집 대상으로 남는 "헛돌이"
 *         — 버스는 지하철 유무와 무관하게 잡히므로 done 판정됨.
 *      2) 지하철은 성공했는데 버스(TAGO)만 실패한 단지가 subway_name 기준으로는 이미 done
 *         처리돼 다시는 재시도되지 않는 "동결" — bus_routes null 이면 미완료로 남아 다음
 *         회차가 자동 재시도한다.
 *    subway_name 기준을 "추가"(AND)하지 말 것 — 지방 단지 헛돌이가 되살아난다. 반드시 교체.
 *
 * ⚠️ `.limit(N)` 금지 — PostgREST max_rows=1000 이라 N 을 아무리 크게 줘도 **최대 1000행**만
 *    돌아온다. 그러면 1000건만 "수집완료"로 인식해 나머지를 매일 재수집한다(세션 490 실측:
 *    진짜 미수집 324건인데 매일 1170건 재수집 = 하루 46분 낭비 = $10 예산 대부분 소진).
 *    전량 조회는 selectAll 페이지네이션으로만. 같은 사고 선례 = 커밋 01d0dd4(세션 295).
 *
 * @param {any} sb
 * @returns {Promise<Set<string>>}
 */
export async function fetchCollectedApartmentIds(sb) {
  const rows = /** @type {{ apartment_id: string }[]} */ (
    await selectAll((s) => s.from("transport").select("apartment_id").not("bus_routes", "is", null), sb)
  );
  return new Set(rows.map((r) => r.apartment_id).filter(Boolean));
}

/**
 * 미수집 대상을 신규(transport 행 없음) 우선으로 정렬한다 (순수 함수, 테스트용 export).
 *
 * 벽시계 예산(budgetExceeded)으로 대상이 도중에 잘려도 신규 단지가 재시도 대상(행은
 * 있으나 bus_routes null)보다 뒤로 밀리지 않게 한다 (세션 496).
 *
 * @template {{ id: string }} T
 * @param {T[]} withCoords 좌표 있는 전체 apartments
 * @param {Set<string>} doneSet fetchCollectedApartmentIds 결과 (bus_routes IS NOT NULL)
 * @param {Set<string>} existingSet fetchExistingApartmentIds 결과 (transport 행 존재)
 * @returns {{ targets: T[], newCount: number, retryCount: number }}
 */
export function orderTargets(withCoords, doneSet, existingSet) {
  const pending = withCoords.filter((a) => !doneSet.has(a.id));
  const newTargets = pending.filter((a) => !existingSet.has(a.id));
  const retryTargets = pending.filter((a) => existingSet.has(a.id));
  return { targets: [...newTargets, ...retryTargets], newCount: newTargets.length, retryCount: retryTargets.length };
}

/**
 * transport 테이블에 행이 이미 존재하는(성공 여부 무관) apartment_id 집합.
 *
 * 신규 단지(행 자체가 없는 단지)와 재시도 대상(행은 있으나 bus_routes 가 null)을 구분해
 * 신규를 항상 먼저 처리하기 위한 보조 조회 — 벽시계 예산 초과로 대상이 잘려도 신규 단지가
 * 뒤로 밀리지 않게 한다 (세션 496).
 *
 * @param {any} sb
 * @returns {Promise<Set<string>>}
 */
export async function fetchExistingApartmentIds(sb) {
  const rows = /** @type {{ apartment_id: string }[]} */ (
    await selectAll((s) => s.from("transport").select("apartment_id"), sb)
  );
  return new Set(rows.map((r) => r.apartment_id).filter(Boolean));
}

async function main() {
  if (!KAKAO_KEY) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }
  if (!TAGO_KEY) log(PHASE, "⚠️ TAGO_KEY 없음 — 버스 정류장 수집 건너뜀");

  const dryRun = process.argv.includes("--dry-run");
  const forceAll = process.argv.includes("--force");
  const maxTago = Number(process.argv.find(a => a.startsWith("--limit="))?.split("=")[1]) || 10000;
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const PAGE_SIZE = 1000;
  const apts = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb.from("apartments").select("id, name, lat, lng").range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`apartments 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    apts.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  const withCoords = apts.filter(a => a.lat && a.lng);

  let targets = withCoords;
  let doneCount = 0;
  if (!forceAll) {
    const doneSet = await fetchCollectedApartmentIds(sb);
    doneCount = doneSet.size;
    // 신규 단지(transport 행 자체가 없음) 우선 처리 — 벽시계 예산으로 대상이 잘려도
    // 신규가 재시도 대상(행은 있으나 bus_routes null) 뒤로 밀리지 않게 한다 (세션 496).
    const existingSet = await fetchExistingApartmentIds(sb);
    const ordered = orderTargets(withCoords, doneSet, existingSet);
    targets = ordered.targets;
    log(PHASE, `전체 ${withCoords.length}건 중 수집완료 ${doneCount}건 → 미수집 ${targets.length}건 (신규 ${ordered.newCount}·재시도 ${ordered.retryCount})`);
  }
  log(PHASE, `대상: ${targets.length}건, TAGO 일일 상한: ${maxTago}건`);

  const rpt = createReporter(PHASE);
  // 이미 수집된 건을 skip 으로 기록 — 전량 수집 완료 후 대상 0건이 되어도 monitor ②/⑤-a 의
  // "success 인데 ok=0 && skip=0" 빈성공 오탐이 안 나게 한다 (notify-subscribers 선례 답습).
  if (doneCount > 0) rpt.skip(doneCount);
  let tagoCallCount = 0;

  // 벽시계 예산 (세션 496): 완료 판정을 bus_routes 기준으로 바꾸면 TAGO 전면 장애 시
  // 매 회차 전량이 대상이 될 수 있다. job timeout(240분, collect-naver-listings-incremental.yml)
  // 은 이 스텝 뒤에 infra-kakao·schools-neis 가 이어 도는 구조라, 예산 안에서 스스로 멈춰
  // 두 스텝에 시간을 남긴다. 이 수집기는 단지마다 즉시 upsert 하므로 budgetExceeded 로
  // 끊어도 그때까지 처리분은 이미 저장돼 있다(collect-trades/collect-maintenance 선례 답습).
  const DEFAULT_BUDGET_MIN = 180; // 240분 job timeout 대비 infra+schools 후속 스텝에 60분 여유
  const startedAt = Date.now();
  const budgetArg = process.argv.find(a => a.startsWith("--budget-min="));
  const budgetMin = budgetArg ? parseInt(budgetArg.replace("--budget-min=", ""), 10) : DEFAULT_BUDGET_MIN;
  let budgetHit = false;
  let subwayFailCount = 0, busFailCount = 0, icFailCount = 0, ktxFailCount = 0;
  let attemptedCount = 0;

  for (let i = 0; i < targets.length; i++) {
    if (rpt.interrupted()) break;  // 세션 327: graceful shutdown (SIGTERM 받으면 다음 단지 처리 전 중단)
    if (budgetExceeded(startedAt, budgetMin)) { budgetHit = true; break; }  // 세션 496
    const apt = targets[i];
    attemptedCount++;
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
      } catch (e) { subwayFailCount++; /* 빈 배열 유지 */ }
      await sleep(100);

      // 버스 정류장 (TAGO 좌표기반 API — 일일 상한 제어)
      // 성공: 배열(0건 포함), 실패/상한초과: null
      try {
        if (tagoCallCount < maxTago) {
          busStops = await searchBusStopsTago(apt.lat, apt.lng);
          tagoCallCount++;
          if (busStops === null) busFailCount++;
        } else if (tagoCallCount === maxTago) {
          log(PHASE, `⚠️ TAGO 일일 상한 ${maxTago}건 도달 — 버스 수집 중단`);
          tagoCallCount++;
        }
      } catch (e) { busStops = null; busFailCount++; }
      await sleep(100);

      // 고속도로 IC (Kakao 키워드)
      try {
        const icResults = await searchKakao(apt.lat, apt.lng, "IC 나들목", RADIUS.IC);
        validICs = icResults.filter(isValidIC);
      } catch (e) { icFailCount++; /* 빈 배열 유지 */ }
      await sleep(100);

      // KTX역 (Kakao 키워드)
      try {
        const ktxResults = await searchKakao(apt.lat, apt.lng, "KTX역", RADIUS.KTX);
        validKTX = ktxResults.filter(isValidStation);
      } catch (e) { ktxFailCount++; /* 빈 배열 유지 */ }
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

  if (budgetHit) {
    log(PHASE, `[budget] ${budgetMin}분 예산 초과 — 여기까지 수집분을 저장하고 종료. 남은 대상(신규 우선)은 다음 회차가 이어받음`);
  }

  // 호출 실패 요약 (세션 496) — 4개 호출이 전부 try/catch 로 실패를 삼켜 8-06 TAGO 100%
  // 장애 때도 collector_runs 는 정상 기록됐다. rpt.fail() 은 바꾸지 않고(부분 실패도 행은
  // 저장되므로 exit code 의미를 지킨다) 요약 로그 1줄 + 임계 초과 시 경고만 추가한다.
  log(PHASE, `호출 실패 요약: 지하철 ${subwayFailCount} · 버스 ${busFailCount} · IC ${icFailCount} · KTX ${ktxFailCount} (총 ${attemptedCount}건 시도)`);
  const highFailures = findHighFailureRates(
    { subway: subwayFailCount, bus: busFailCount, ic: icFailCount, ktx: ktxFailCount },
    attemptedCount,
  );
  for (const { label, count, rate } of highFailures) {
    logError(PHASE, `⚠️ ${label} 실패율 ${(rate * 100).toFixed(1)}% (${count}/${attemptedCount}) — 외부 API 장애 의심 (임계 50% 초과)`);
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
