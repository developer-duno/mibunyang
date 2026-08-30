// @ts-check
/**
 * 교통 접근성 수집기 — Kakao Places + 버스정류장 정적 파일(data.go.kr)
 *
 * 지하철(Kakao SW8, 10km), 버스(data.go.kr #15067528 전국 버스정류장 위치정보,
 *   반경 500m·최근접 15개 raw→정류장명 dedup — 세션497 실측 확정, 아래 §버스 정류장 참조),
 * 고속도로IC(Kakao, 30km), KTX(Kakao, 80km)
 *
 * ⚠️ 세션497: TAGO 실시간 API(`getCrdntPrxmtSttnList`)를 폐기했다. 같은 게이트웨이의
 * 다른 서비스(collect-maintenance)는 정상 수집되는데 TAGO 만 간헐적으로 완전 무응답이었고
 * (원인 미확정), 결정적으로 **서울 단지 391곳(62%)의 "버스 0개"가 거짓으로 확인**됐다 —
 * 서울은 TOPIS(자체 BIS)를 쓰고 TAGO(지자체 BIS 연계)는 서울을 커버하지 않는다. 정적 파일은
 * 서울을 포함한 전국 정류장(연 1회 갱신)을 담고 있어 이 결측을 해소한다.
 * (`docs/superpowers/specs/2026-08-07-transport-busstop-file-gate-verification.md`,
 *  `2026-08-07-transport-busstop-reversal-and-implementation.md` 답습)
 *
 * 사용법:
 *   node scripts/collectors/transport-tago.mjs                     (Supabase UPDATE)
 *   node scripts/collectors/transport-tago.mjs --dry-run           (미리보기만)
 *   node scripts/collectors/transport-tago.mjs --budget-min=180    (벽시계 예산 분 — 기본 180, 0=무제한)
 */
import { parse } from "csv-parse/sync";
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep, recordCollectorRun, createReporter, selectAll, budgetExceeded, haversineKm } from "./_shared.mjs";

/**
 * @typedef {{ place_name?: string, category_name?: string, distance?: string|number, x?: string|number, y?: string|number }} KakaoDoc
 * @typedef {{ documents?: KakaoDoc[], meta?: { is_end?: boolean } }} KakaoSearchResponse
 * @typedef {{ nodenm?: string, [k: string]: unknown }} TagoBusStop
 * @typedef {{ name: string, lat: number, lng: number }} BusStopRecord
 */

loadEnv();

const PHASE = "transport";
const KAKAO_KEY = process.env.KAKAO_KEY;

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
 * 가 센티널 99 로 굳었다.
 *
 * 20000 으로 낮춰도 점수는 한 점도 잃지 않는다: scoreLocation 의 IC_DIST_TIERS 는 10km,
 * KTX_DIST_TIERS 는 15km 를 넘으면 0점이라 20km 밖은 센티널 99 와 결과가 같다.
 */
export const RADIUS = { SUBWAY: 10000, IC: 20000, KTX: 20000 };

/**
 * 키워드 검색은 size=15 가 상한이라, 이름만 비슷한 잡음(편의점·주유소·다리)이 앞자리를 채우면
 * 정작 찾으려는 시설이 1페이지 밖으로 밀린다. 전 단지 표본 실측 = 1페이지만 보면 IC 3.0%·
 * KTX 4.8% 를 놓친다. 3페이지까지 넘기면 IC 98.5%·KTX 89.0% 회수(나머지는 20km 안에 실재 안 함).
 */
const SEARCH_MAX_PAGES = 3;

/**
 * 오염 필터 교체 시각(백필 커트라인). 이 시각 **이전**에 수집된 transport 행은 이름 기반
 * 필터가 만든 `ic_dist`/`ktx_dist` 를 갖고 있으므로 미완료로 간주해 다시 수집한다.
 * 자세한 이유는 `fetchCollectedApartmentIds` 주석 참조.
 */
export const FILTER_FIX_AT = "2026-08-07T00:00:00.000Z";

const DEFAULT_SUBWAY_DIST = 9999;
const DEFAULT_IC_DIST = 99;
const DEFAULT_KTX_DIST = 99;

// ── 버스 정류장 정적 파일 (data.go.kr #15067528) ──────────────────
// 세션497 게이트1(N=30, 15개 지역) 실측 확정: 반경 500m.
//
// ⚠️ 상한은 **고유 정류장 기준**이다(세션498 정정). 국토부 전국 파일은 정류장 기둥 하나를
// 방향별·지자체체계별로 여러 행에 나눠 담는다 — 서울 실측 16,980행인데 고유 이름은 9,057개,
// 모든 행이 서로 다른 좌표, "같은 이름 2회"가 3,914건으로 최다(전형적 상·하행 분리).
// 서울시 TOPIS 공식 집계는 11,231건이라 국가 파일이 51% 부풀어 있다(시점 차이로는 설명 불가 —
// 서울분 정보수집일이 전부 2025-10 한 달).
//
// 이전 구현은 dedup **전에** 15개로 잘라서, 중복이 촘촘한 도심일수록 15칸이 같은 정류장의
// 중복 행으로 채워져 고유 정류장 수가 과소 계상됐다. 전 단지 2,635곳 재계산 실측:
//   · 1,449곳(55%)이 실제보다 적게 계산 — 평균 2.54개(= 교통 원점수 5.08점) 손실
//   · 15개 만점 버킷 0곳 (아무도 만점을 못 받는 상태)
//   · 지역 편향: 대구 -10.05점 · 서울 -9.47점 · 부산 -8.60점 vs 제주 -0.40점 · 대전 -0.60점
// 그래서 **dedup 을 먼저, 자르기를 나중에** 한다. 옛 순서의 근거였던 "게이트2 재현율 64%"는
// 옛 TAGO DB 값과의 일치율인데, 그 옛 값이 서울에서 통째로 거짓이었다는 게 이 PR 의 출발점이라
// 잣대 자체가 무효다(같은 문서 §(b) 가 그렇게 결론지었다).
const BUS_RADIUS_M = 500;
// 고유 정류장 상한. src/constants/scoringTiers.ts 의 FULL_BUS_ROUTES(만점 기준)와 같은 값이어야
// 만점 도달이 가능하다 — 둘의 동기화는 transport-tago.test.mjs 가 가드한다.
const BUS_UNIQUE_CAP = 20;
const BUS_GRID_CELL_DEG = 0.01; // ≈1.1km — 반경 500m 조회 시 자기 셀+인접 8셀로 충분
const BUS_STOPS_PUBLIC_DATA_PK = "15067528";
const BUS_STOPS_PUBLIC_DATA_DETAIL_PK = "uddi:f74b9799-9db1-4754-a5d0-b66e2ae705f3";

/**
 * @param {number} lat
 * @param {number} lng
 * @param {string} keyword
 * @param {number} radius
 * @param {number} [page]
 * @returns {Promise<KakaoSearchResponse>}
 */
async function searchKakao(lat, lng, keyword, radius, page = 1) {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=15&page=${page}`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  const data = /** @type {KakaoSearchResponse} */ (await res.json());
  return data;
}

/**
 * 필터를 통과하는 가장 가까운 결과 1건을 찾을 때까지 페이지를 넘긴다.
 *
 * `sort=distance` 라 페이지는 거리 오름차순이므로, 먼저 통과한 것이 곧 최근접이다.
 * 잡음이 1페이지 15칸을 채워 진짜 시설을 밀어내는 문제(IC 3.0%·KTX 4.8%)를 해소한다.
 * 결과가 없으면 `is_end` 또는 빈 페이지에서 조기 종료해 불필요한 호출을 안 만든다.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {string} keyword
 * @param {number} radius
 * @param {(d: KakaoDoc) => boolean} filter
 * @returns {Promise<KakaoDoc[]>} 통과한 것들(최근접 우선). 없으면 빈 배열.
 */
export async function searchKakaoUntilMatch(lat, lng, keyword, radius, filter) {
  for (let page = 1; page <= SEARCH_MAX_PAGES; page++) {
    const data = await searchKakao(lat, lng, keyword, radius, page);
    const docs = data.documents || [];
    const hits = docs.filter(filter);
    if (hits.length > 0) return hits;
    if (docs.length === 0 || data.meta?.is_end) return [];
  }
  return [];
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
 * data.go.kr 파일 다운로드 흐름 — atchFileId 는 연 1회 갱신될 때 바뀌므로 절대 하드코딩하지
 * 않고 매 실행 시 resolve 한다(collect-housing-price.mjs 의 알려진 함정 답습 — 세션497 지시).
 *
 * 1) POST selectFileDataDownload.do 로 최신 atchFileId 를 얻는다.
 * 2) GET fileDownload.do 로 실제 CSV(EUC-KR) 를 받는다.
 *
 * @returns {Promise<{ atchFileId: string, fileDetailSn: string }>}
 */
export async function resolveBusStopsAtchFileId() {
  const res = await fetchWithRetry(
    "https://www.data.go.kr/tcs/dss/selectFileDataDownload.do",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0" },
      body: new URLSearchParams({
        publicDataPk: BUS_STOPS_PUBLIC_DATA_PK,
        publicDataDetailPk: BUS_STOPS_PUBLIC_DATA_DETAIL_PK,
        atchFileId: "",
        fileDetailSn: "1",
        publicDataTyCode: "PR0051",
      }),
      signal: AbortSignal.timeout(20000),
    },
    3,
  );
  const json = await res.json();
  if (!json?.status || !json?.atchFileId) {
    throw new Error(`atchFileId resolve 응답 이상: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return { atchFileId: json.atchFileId, fileDetailSn: String(json.fileDetailSn ?? "1") };
}

/**
 * @param {{ atchFileId: string, fileDetailSn: string }} ref
 * @returns {Promise<Buffer>}
 */
export async function downloadBusStopsCsv({ atchFileId, fileDetailSn }) {
  const url = `https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=${encodeURIComponent(atchFileId)}&fileDetailSn=${encodeURIComponent(fileDetailSn)}&insertDataPrcus=N`;
  const res = await fetchWithRetry(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(60000) }, 3);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("버스정류장 파일 다운로드 결과가 비어 있음");
  return buf;
}

/**
 * CSV 텍스트(정류장번호,정류장명,위도,경도,정보수집일,모바일단축번호,도시코드,도시명,관리도시명)
 * → { name, lat, lng }[]. RFC4180 인용부호(정류장명에 콤마 포함 케이스 존재) 대응을 위해
 * csv-parse(MIT) 사용 — naive split(",") 은 세션497 조사에서 미확정 정정을 낳았다(oss-first 답습).
 *
 * EUC-KR 디코딩은 호출부(`loadBusStopGrid`) 책임 — 이 함수는 이미 디코딩된 텍스트만 받는다
 * (IO 와 순수 파싱 로직을 분리해 EUC-KR 인코더 없이도 단위 테스트 가능하게 한다).
 *
 * @param {string} text
 * @returns {BusStopRecord[]}
 */
export function parseBusStopsCsv(text) {
  const records = parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true, trim: true });
  /** @type {BusStopRecord[]} */
  const stops = [];
  for (const r of /** @type {Record<string, string>[]} */ (records)) {
    const lat = parseFloat(r["위도"]);
    const lng = parseFloat(r["경도"]);
    const name = r["정류장명"];
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !name) continue;
    stops.push({ name, lat, lng });
  }
  return stops;
}

/**
 * 정류장 배열 → 위경도 그리드 인덱스(Map). 반경 500m 조회 시 자기 셀+인접 8셀만 훑으면 되므로
 * O(N) 전처리 + O(1) 근사 조회로 227,000+ 건도 아파트당 밀리초 단위로 매칭한다.
 *
 * @param {BusStopRecord[]} stops
 * @returns {Map<string, BusStopRecord[]>}
 */
export function buildBusStopGrid(stops) {
  /** @type {Map<string, BusStopRecord[]>} */
  const grid = new Map();
  for (const s of stops) {
    const key = `${Math.floor(s.lat / BUS_GRID_CELL_DEG)}_${Math.floor(s.lng / BUS_GRID_CELL_DEG)}`;
    const arr = grid.get(key);
    if (arr) arr.push(s);
    else grid.set(key, [s]);
  }
  return grid;
}

/**
 * 반경 500m 이내 정류장을 거리순으로 정렬해 **가까운 순 고유 정류장 최대 20개**를 돌려준다.
 *
 * ⚠️ 순서가 핵심이다 — **이름 dedup 이 먼저, 자르기가 나중**이다(세션498 정정). 반대로 하면
 * 중복 등재가 촘촘한 도심에서 상한 칸이 같은 정류장의 중복 행으로 채워져 고유 정류장 수가
 * 과소 계상된다(위 BUS_UNIQUE_CAP 주석의 전 단지 실측 참조).
 *
 * 반환 모양(`{nodenm}[]`)은 그대로라 `buildTransportRow` 는 손대지 않는다. 거기서 한 번 더 도는
 * `Set(nodenm)` dedup 은 이 함수가 이미 고유만 넘기므로 통과값이 같다(중복 방어로 남겨둔다).
 *
 * @param {Map<string, BusStopRecord[]>} grid
 * @param {number} lat
 * @param {number} lng
 * @returns {TagoBusStop[]}
 */
export function matchNearbyBusStops(grid, lat, lng) {
  const latCell = Math.floor(lat / BUS_GRID_CELL_DEG);
  const lngCell = Math.floor(lng / BUS_GRID_CELL_DEG);
  /** @type {BusStopRecord[]} */
  const candidates = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const arr = grid.get(`${latCell + dy}_${lngCell + dx}`);
      if (arr) candidates.push(...arr);
    }
  }
  const sorted = candidates
    .map((s) => ({ name: s.name, dist: haversineKm(lat, lng, s.lat, s.lng) * 1000 }))
    .filter((s) => s.dist <= BUS_RADIUS_M)
    .sort((a, b) => a.dist - b.dist);

  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {TagoBusStop[]} */
  const out = [];
  for (const s of sorted) {
    if (seen.has(s.name)) continue; // 같은 정류장의 방향별·체계별 중복 행
    seen.add(s.name);
    out.push({ nodenm: s.name });
    if (out.length >= BUS_UNIQUE_CAP) break;
  }
  return out;
}

/**
 * 버스정류장 파일을 resolve→다운로드→파싱→그리드 구축까지 1회 수행한다(수집기 실행당 1번,
 * 아파트마다가 아니다 — 네트워크 호출은 여기서만 발생하고 이후 매칭은 전부 인메모리다).
 *
 * 실패(네트워크·파싱 이상) 시 null 을 반환 — 호출부는 이번 회차 전체를 "버스 수집 실패"로
 * 취급해 세션98 이래의 null(실패)/[](성공·0건) 구분 계약을 그대로 유지한다.
 *
 * @returns {Promise<Map<string, BusStopRecord[]> | null>}
 */
export async function loadBusStopGrid() {
  try {
    const ref = await resolveBusStopsAtchFileId();
    log(PHASE, `버스정류장 파일 resolve: atchFileId=${ref.atchFileId}`);
    const buf = await downloadBusStopsCsv(ref);
    log(PHASE, `버스정류장 파일 다운로드: ${(buf.length / 1024 / 1024).toFixed(1)}MB`);
    const text = new TextDecoder("euc-kr").decode(buf);
    const stops = parseBusStopsCsv(text);
    if (stops.length === 0) throw new Error("파싱된 정류장 0건");
    const grid = buildBusStopGrid(stops);
    log(PHASE, `버스정류장 ${stops.length}건 → 그리드 ${grid.size}셀 구축 완료`);
    return grid;
  } catch (err) {
    logError(PHASE, `버스정류장 파일 로드 실패: ${err instanceof Error ? err.message : String(err)}`);
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

/** 카테고리 경로 비교용 정규화 — 카카오가 `A > B > C` 로 주는 공백을 제거한다. */
const normCat = (/** @type {string|undefined} */ c) => (c || "").replace(/\s+/g, "");

/**
 * KTX 정차역 필터 — **카테고리로만** 판정한다.
 *
 * 세션 497: 옛 판정은 `이름이 "역"으로 끝남 || 카테고리에 "기차"/"철도"` 였다. 이름 조건이
 * 느슨해 `롯데렌터카 픽업존 부전KTX역`·`KB국민은행 KTX광명역` 같은 상점이 통과했다(전 단지
 * 대조 1.4% 오염). 더 중요한 건 **이름이 "역"으로 끝나기만 하면 지하철역도 통과**한다는 점 —
 * 지하철은 이미 SW8 카테고리로 따로 재므로 같은 시설을 두 지표에 겹쳐 넣는 통로였다.
 *
 * 카카오가 정차역을 `교통,수송 > 기차,철도 > 기차역 > KTX정차역`(또는 `KTX,SRT정차역`)으로
 * 이미 분류해 주므로 그것만 받는다.
 *
 * @param {KakaoDoc} doc
 * @returns {boolean}
 */
export function isValidStation(doc) {
  const cat = normCat(doc.category_name);
  return cat.includes("기차역") && cat.includes("KTX");
}

/**
 * 고속도로 IC 필터 — **카테고리로만** 판정한다.
 *
 * 세션 497: 옛 판정은 `이름에 "IC"/"나들목"/"인터체인지" 포함` 이었다. 전 단지 대조 결과
 * **75.3% 가 틀린 값**이었고(오차 중앙 1.3km·최대 18.2km, 전부 과소평가) 실제로 잡히던 것들:
 *   청춘나들목(문화시설)·나들목식당(한식)·타이어월드 용인IC점·CU 평택어연IC점·
 *   IC모바일 화곡역점(휴대폰)·가락IC육교(교량)·아이씨…(IT회사, "아이씨"로 읽히는 이름)
 *
 * 카카오 카테고리 전수 집계(표본 250단지·질의 3종)로 진짜 IC 는 두 갈래뿐임을 확정:
 *   `교통,수송 > 도로시설 > IC > 고속도로IC`  4,234회
 *   `교통,수송 > 도로시설 > IC`                 657회
 * 나머지 `도로시설 > 교량,다리`(1,270회)·`도로시설 > 교차로`(326회)·`입출구`(378회)는 IC 가 아니다.
 * 따라서 조건은 `도로시설 > IC` 포함 하나로 충분하다.
 *
 * @param {KakaoDoc} doc
 * @returns {boolean}
 */
export function isValidIC(doc) {
  return normCat(doc.category_name).includes("도로시설>IC");
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
    { label: "버스(정류장파일)", count: fails.bus },
    { label: "IC", count: fails.ic },
    { label: "KTX", count: fails.ktx },
  ];
  return entries
    .map((e) => ({ ...e, rate: e.count / attempted }))
    .filter((e) => e.rate > threshold);
}

/**
 * transport 테이블에서 "버스정류장 매칭이 실제로 성공한" apartment_id 집합 (완료 판정).
 *
 * ⚠️ 완료 판정 기준 = `bus_routes IS NOT NULL` (subway_name 아님, 세션 496 정정).
 *    세션98 설계(현재는 `matchNearbyBusStops`/`loadBusStopGrid`, 세션497부터 TAGO 실시간 API
 *    대신 정적 파일 매칭)가 이미 성공/실패를 명확히 구분해 뒀다:
 *      null = 이번 회차 버스정류장 파일 로드 실패 / [] → bus_routes=0 = 매칭 성공·반경 내 0건 /
 *      [...] = 매칭 성공·N건.
 *    `bus_routes IS NOT NULL` 은 곧 "버스정류장 매칭이 실제로 성공했다"는 뜻이라 이 기준 하나로
 *    두 결함을 동시에 푼다:
 *      1) 지방 단지(지하철 없음, subway_name 영구 null)가 매일 재수집 대상으로 남는 "헛돌이"
 *         — 버스는 지하철 유무와 무관하게 잡히므로 done 판정됨.
 *      2) 지하철은 성공했는데 버스(정류장 매칭)만 실패한 단지가 subway_name 기준으로는 이미 done
 *         처리돼 다시는 재시도되지 않는 "동결" — bus_routes null 이면 미완료로 남아 다음
 *         회차가 자동 재시도한다.
 *    subway_name 기준을 "추가"(AND)하지 말 것 — 지방 단지 헛돌이가 되살아난다. 반드시 교체.
 *
 * ⚠️ `.limit(N)` 금지 — PostgREST max_rows=1000 이라 N 을 아무리 크게 줘도 **최대 1000행**만
 *    돌아온다. 그러면 1000건만 "수집완료"로 인식해 나머지를 매일 재수집한다(세션 490 실측:
 *    진짜 미수집 324건인데 매일 1170건 재수집 = 하루 46분 낭비 = $10 예산 대부분 소진).
 *    전량 조회는 selectAll 페이지네이션으로만. 같은 사고 선례 = 커밋 01d0dd4(세션 295).
 *
 * ⚠️ **완료 판정에 `updated_at >= FILTER_FIX_AT` 조건이 함께 걸린다**(세션 497). 그 이전에
 *    수집된 행의 `ic_dist`/`ktx_dist` 는 오염된 이름 기반 필터가 만든 값이라(IC 75.3% 오답)
 *    필터만 고치면 **이미 값이 박힌 단지는 영원히 재수집되지 않는다** — 증분 경로가 여기서
 *    통째로 건너뛰기 때문이다. 값을 지우는 방식(`SET bus_routes = NULL`)은 그동안 버스 점수가
 *    통째로 빠지므로 쓰지 않고, 커트라인만 올려 **기존 값을 유지한 채** 며칠에 걸쳐 자연히
 *    덮어쓰게 한다. `orderTargets` 가 신규 우선 정렬을 하므로 예산에 잘려도 다음 회차가 이어받는다.
 *    백필이 끝나면 이 상수는 남겨둬도 무해하다(모든 행이 커트라인 이후가 되어 조건이 항상 참).
 *
 * @param {any} sb
 * @returns {Promise<Set<string>>}
 */
export async function fetchCollectedApartmentIds(sb) {
  const rows = /** @type {{ apartment_id: string }[]} */ (
    await selectAll(
      (s) =>
        s
          .from("transport")
          .select("apartment_id")
          .not("bus_routes", "is", null)
          .gte("updated_at", FILTER_FIX_AT),
      sb,
    )
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

  const dryRun = process.argv.includes("--dry-run");
  const forceAll = process.argv.includes("--force");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  // 세션534: 무정렬 OFFSET → 고유키(id) 커서 (unordered-pagination-loses-rows.md §1).
  const apts = await selectAll((s) => s.from("apartments").select("id, name, lat, lng"), sb, "id");

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
  log(PHASE, `대상: ${targets.length}건`);

  // 버스정류장 파일: 수집기 실행당 1회만 resolve→다운로드→파싱→그리드 구축 (세션497).
  // 대상이 0건이어도(전량 수집완료) 매일 재다운로드는 낭비이므로 대상 있을 때만 로드.
  const busGrid = targets.length > 0 ? await loadBusStopGrid() : null;
  if (targets.length > 0 && !busGrid) {
    logError(PHASE, "버스정류장 파일 로드 실패 — 이번 회차는 버스 없이(지하철/IC/KTX만) 진행, 다음 회차가 재시도");
  }

  const rpt = createReporter(PHASE);
  // 이미 수집된 건을 skip 으로 기록 — 전량 수집 완료 후 대상 0건이 되어도 monitor ②/⑤-a 의
  // "success 인데 ok=0 && skip=0" 빈성공 오탐이 안 나게 한다 (notify-subscribers 선례 답습).
  if (doneCount > 0) rpt.skip(doneCount);

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
      // busStops 초기값 null = "버스정류장 파일 매칭 미수행/실패" 로 취급
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

      // 버스 정류장 (파일 매칭 — 네트워크 호출 없음, 인메모리 그리드 조회만).
      // busGrid 가 null 이면(이번 회차 파일 로드 실패) 전량 "실패"로 취급 — 세션98 이래의
      // null(실패)/[](성공·0건) 계약을 그대로 유지한다.
      if (busGrid) {
        busStops = matchNearbyBusStops(busGrid, apt.lat, apt.lng);
      } else {
        busStops = null;
        busFailCount++;
      }

      // 고속도로 IC (Kakao 키워드)
      try {
        validICs = await searchKakaoUntilMatch(apt.lat, apt.lng, "IC 나들목", RADIUS.IC, isValidIC);
      } catch (e) { icFailCount++; /* 빈 배열 유지 */ }
      await sleep(100);

      // KTX역 (Kakao 키워드)
      try {
        validKTX = await searchKakaoUntilMatch(apt.lat, apt.lng, "KTX역", RADIUS.KTX, isValidStation);
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

  const result = rpt.summary();

  await recordCollectorRun("transport-tago", result);
  if (result.fail > 0) process.exit(1);
}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch(err => { logError(PHASE, err instanceof Error ? err.message : String(err)); process.exit(1); });
