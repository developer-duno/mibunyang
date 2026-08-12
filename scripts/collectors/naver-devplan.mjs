// @ts-check
/**
 * 개발계획/개발축 수집기 — 네이버 부동산(도로/철도/역/지구) + V-WORLD(산업단지/LH사업지구)
 *
 * ⚠️ 네이버 축은 한국 IP 필수(데이터센터 IP 차단) — 로컬 전용, GitHub Actions 금지.
 *   (scripts/CLAUDE.md "네이버 수집 — 로컬 자동화" 절 참조. 실행 환경 배선은 이 파일 소관이
 *    아니다 — run-naver-local.sh/.bat 은 건드리지 않았다.)
 * V-WORLD 축은 IP 제한 없음(오케스트레이터 확인) — 다만 이 파일에 한 CLI 로 묶여 있어
 * `--source=vworld` 로 좁혀 GitHub Actions 에서 돌리는 것도 이론상 가능하나, 이번 세션에서는
 * 실행 환경 배선(워크플로/스케줄러 등록)을 하지 않았다 — 그건 별건.
 *
 * 파일명은 여전히 naver-devplan 이지만(transport-tago.mjs 가 TAGO 를 버리고도 이름을 유지한
 * 선례 답습 — collector_runs.collector 이름·ALLOWLIST 참조가 얽혀 있음), 이제 두 출처를
 * `source` 컬럼(naver/vworld)으로 구분해 같은 dev_plans 테이블 하나에 담는다.
 *
 * kind 종류:
 *   naver:  road(도로) · rail(철도) · station(역) · jigu(지구)
 *   vworld: industrial_complex(산업단지, LT_C_DAMDAN) · lh_zone(LH사업지구, LT_C_LHZONE)
 *
 * apartments 의 transit_dev/city_dev/industry_dev 점수 컬럼은 이 수집기가 **건드리지 않는다**
 * — 배선은 경계 재설계 후 별건("경계 먼저, 데이터 나중").
 *
 * JWT(네이버): naver-listings.mjs(같은 new.land.naver.com 도메인)의 ensureJwt() 를 그대로
 * 답습했다 — /complexes/{id} HTML 페이지에서 `"token":"eyJ..."` 정규식 추출, 50분 캐시.
 *
 * 타일링(네이버): 전국을 무식하게 격자로 덮지 않고, apartments 좌표가 실제로 있는 0.30° 격자
 * 셀만 타일로 만든다(apartmentTileCells). 각 타일 bbox 는 격자 폭(0.30°) + 양쪽 마진(0.02°)
 * = 0.34° — 실측 안전선(NAVER_BBOX_SAFE_MAX_DEG=0.38°, 0.40°부터 조용히 빈 배열) 아래.
 *
 * 조회 방식(V-WORLD): 타일 순회 대신 **단지별 개별 반경조회**(geomFilter=POINT+buffer). 산업
 * 단지·LH지구는 면적이 넓은 폴리곤이라 타일 방식은 "그 타일 안에 뭐가 있다"만 알려주고 "어느
 * 단지에서 몇 m"는 별도 거리계산 단계가 또 필요하다. 반경조회는 버퍼 자체가 이미 "이 단지에서
 * 그만큼 안"이라는 의미를 담고 있어 후속 매칭 단계가 필요 없다(자세한 요청수 비교는 이 파일
 * 하단 fetchVworldFeatures 주석 참조).
 *
 * 429 대응(네이버): fetchNaverJson 이 429 전용 백오프(30s/60s/120s, 일반 5xx 백오프와 분리)로
 * 재시도하고, 그래도 연속 NAVER_MAX_CONSECUTIVE_429 회 실패하면 그 회차 네이버 수집을 즉시
 * 중단해 partial 로 기록한다(무한 재시도로 쿨다운을 악화시키지 않는다).
 *
 * 좌표축 가드: 네이버 xPos/yPos → lng/lat, V-WORLD GeoJSON coordinates → [lng, lat](RFC 7946,
 * 세션511 WebFetch 로 재확인) 모두 **한반도 범위(lat 33~39, lng 124~132) 밖이면 저장하지 않고
 * 실패로 집계**한다(isWithinKoreaBounds). 축을 뒤바꿔 읽는 실수를 조용히 저장하지 않기 위함.
 *
 * 계약: null=이번 요청 실패 / []=성공·0건 (이 레포의 기존 계약, transport-tago.mjs 답습).
 *
 * 사용법:
 *   node scripts/collectors/naver-devplan.mjs --dry-run                          (양쪽 다, DB 쓰기 없음)
 *   node scripts/collectors/naver-devplan.mjs --dry-run --source=vworld --limit-apts=3   (V-WORLD 스모크)
 *   node scripts/collectors/naver-devplan.mjs --dry-run --source=naver --region=서울 --limit-tiles=2  (네이버 스모크)
 *   node scripts/collectors/naver-devplan.mjs                                    (전량 수집 + DB upsert)
 *
 * 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY, VWORLD_KEY(없으면 V-WORLD 축 자동 건너뜀)
 */
import {
  loadEnv, getSupabase, log, logError, fetchWithRetry, sleep,
  createReporter, recordCollectorRun, selectAll, upsertBatch,
} from "./_shared.mjs";

/**
 * @typedef {"naver" | "vworld"} DevPlanSource
 * @typedef {"road" | "rail" | "station" | "jigu" | "industrial_complex" | "lh_zone"} DevPlanKind
 * @typedef {{ latIdx: number, lngIdx: number }} TileCell
 * @typedef {{ leftLon: number, rightLon: number, topLat: number, bottomLat: number }} BBox
 * @typedef {TileCell & BBox} Tile
 * @typedef {{ id: string, lat: number | null, lng: number | null, region?: string | null }} AptForTiling
 * @typedef {Record<string, unknown>} RawDevPlanItem
 * @typedef {{ ok: boolean, status: number, json: () => Promise<unknown> }} FetchLikeResponse
 * @typedef {{
 *   source: DevPlanSource, kind: DevPlanKind, source_id: string, gid: string | null, name: string | null,
 *   lat: number | null, lng: number | null, progression_step: string | null,
 *   eta: string | null, raw: RawDevPlanItem, fetched_at: string,
 * }} DevPlanRow
 * @typedef {{ type?: string, coordinates?: unknown }} GeoJsonGeometry
 * @typedef {{ id?: string | number, type?: string, geometry?: GeoJsonGeometry | null, properties?: Record<string, unknown> }} VworldFeature
 */

loadEnv();

const PHASE = "naver-devplan";
const NAVER_BASE = "https://new.land.naver.com";

// ── 한반도 좌표 범위 가드 (네이버·V-WORLD 공용) ─────────────────────────
/**
 * 대략적인 한반도 좌표 범위. 제주 남단(약 33.1°N)부터 최북단 접경(약 38.6°N)까지, 서해부터
 * 동해 독도(약 131.9°E)까지 여유를 두고 잡았다. 네이버 xPos/yPos·V-WORLD GeoJSON 좌표가 이
 * 범위를 벗어나면 위경도 축을 뒤바꿔 읽었거나 원본 자체가 이상한 것으로 간주해 저장하지 않는다.
 */
export const KOREA_LAT_MIN = 33;
export const KOREA_LAT_MAX = 39;
export const KOREA_LNG_MIN = 124;
export const KOREA_LNG_MAX = 132;

/**
 * @param {number | null | undefined} lat
 * @param {number | null | undefined} lng
 * @returns {boolean}
 */
export function isWithinKoreaBounds(lat, lng) {
  return (
    typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= KOREA_LAT_MIN && lat <= KOREA_LAT_MAX &&
    lng >= KOREA_LNG_MIN && lng <= KOREA_LNG_MAX
  );
}

// ── JWT (naver-listings.mjs 답습 — 같은 new.land.naver.com 도메인) ─────────
const JWT_TOKEN_PATTERN = /"token":"(eyJ[A-Za-z0-9._-]+)"/;
const JWT_LIFETIME = 3000 * 1000; // 50분

const HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};

/** @type {string | null} */
let jwtToken = null;
let jwtTokenTime = 0;

/**
 * JWT 토큰 추출 — naver-listings.mjs ensureJwt() 답습(같은 도메인, 같은 페이지 소스 패턴).
 * 새로 설계하지 않는다: 이미 검증된 이 레포의 방식을 그대로 쓴다.
 * @returns {Promise<string>}
 */
export async function ensureJwt() {
  if (jwtToken && (Date.now() - jwtTokenTime) < JWT_LIFETIME) return jwtToken;

  const url = `${NAVER_BASE}/complexes/217`; // 기본 단지 ID(은마아파트) — naver-listings.mjs 답습
  const res = await fetchWithRetry(url, { headers: { ...HEADERS, Accept: "text/html" } });
  const html = await res.text();
  const match = html.match(JWT_TOKEN_PATTERN);
  if (!match) throw new Error("JWT 토큰 추출 실패 — HTML에서 토큰을 찾을 수 없음");

  jwtToken = match[1];
  jwtTokenTime = Date.now();
  log(PHASE, `JWT 토큰 획득 (${jwtToken.slice(0, 20)}...)`);
  return jwtToken;
}

// ── 429 전용 재시도 (네이버 devplan 엔드포인트 — 세션511) ──────────────
/**
 * 429 전용 백오프. 일반 5xx 백오프((attempt+1)^2 초, fetchNaverJson 내부)와 **의도적으로
 * 분리**한다 — 429 는 "이 IP 가 지금 막혔다"는 신호라 몇 초가 아니라 수십 초 단위로 쉬어야
 * 한다(2026-08-11 오전 스모크는 8회 전부 429, 같은 날 아침 조사 직후라 일시 쿨다운으로 추정).
 */
export const NAVER_429_BACKOFF_MS = [30000, 60000, 120000];

/**
 * 연속 429 가 이 횟수에 도달하면 그 회차 네이버 수집을 즉시 중단한다(partial 기록). 무한
 * 재시도로 쿨다운을 더 악화시키지 않기 위함 — 사장님 지시.
 */
export const NAVER_MAX_CONSECUTIVE_429 = 3;

/**
 * 네이버 devplan 엔드포인트 호출 — 429 전용 백오프 + 일반 5xx 백오프를 자체 처리한다.
 * fetchWithRetry(_shared.mjs) 를 재사용하지 않은 이유: 그쪽은 429/5xx 를 한 백오프 계열로
 * 섞어 재시도한다. 네이버는 429 에 훨씬 더 긴 대기가 필요해 별도 함수로 분리했다.
 *
 * fetchFn/sleepFn 을 주입 가능하게 해 네트워크·실제 대기 없이 단위 테스트한다.
 *
 * @param {string} url
 * @param {RequestInit} opts
 * @param {(url: string, opts: RequestInit) => Promise<FetchLikeResponse>} [fetchFn]
 * @param {(ms: number) => Promise<void>} [sleepFn]
 * @returns {Promise<{ ok: true, data: unknown } | { ok: false, rateLimited: boolean, message: string }>}
 */
export async function fetchNaverJson(url, opts, fetchFn = /** @type {any} */ (fetch), sleepFn = sleep) {
  for (let attempt = 0; attempt <= NAVER_429_BACKOFF_MS.length; attempt++) {
    /** @type {FetchLikeResponse} */
    let res;
    try {
      res = await fetchFn(url, opts);
    } catch (err) {
      return { ok: false, rateLimited: false, message: err instanceof Error ? err.message : String(err) };
    }

    if (res.status === 429) {
      if (attempt < NAVER_429_BACKOFF_MS.length) {
        const waitMs = NAVER_429_BACKOFF_MS[attempt];
        log(PHASE, `429(rate limit) — 쿨다운 의심, 시간을 두고 재시도(${waitMs / 1000}초 대기, ${attempt + 1}/${NAVER_429_BACKOFF_MS.length})`);
        await sleepFn(waitMs);
        continue;
      }
      return { ok: false, rateLimited: true, message: "429 재시도 소진 — 쿨다운 의심, 시간을 두고 재시도할 것" };
    }

    if (!res.ok) {
      if ((res.status === 500 || res.status === 503) && attempt < NAVER_429_BACKOFF_MS.length) {
        const waitMs = (attempt + 1) ** 2 * 1000;
        log(PHASE, `HTTP ${res.status} — ${waitMs}ms 대기 후 재시도(${attempt + 1}/${NAVER_429_BACKOFF_MS.length})`);
        await sleepFn(waitMs);
        continue;
      }
      return { ok: false, rateLimited: false, message: `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { ok: true, data };
  }
  return { ok: false, rateLimited: true, message: "429 재시도 소진" };
}

// ── 타일링 (네이버 전용) ──────────────────────────────────────────────
/**
 * 격자 셀 크기(도). apartments 좌표를 이 크기로 나눠 셀 인덱스를 만든다.
 * 0.30 은 실측 안전 구간(0.30°→38건 성공)의 하한이자, 서울 전역(위경도 폭 약 0.25°)이
 * 여유 있게 한 타일에 들어가는 크기다.
 */
export const TILE_STEP_DEG = 0.30;

/**
 * 타일 bbox 마진(도) — 격자 경계 양쪽으로 이만큼 더 넓혀 조회한다. 이게 곧 인접 타일과의
 * 겹침(overlap)이라, 정확히 격자 경계선 위에 있는 개발계획이 어느 쪽에서도 안 잡히는
 * 사각을 없앤다.
 */
export const TILE_MARGIN_DEG = 0.02;

/**
 * 네이버 개발계획 API bbox 크기 안전선(도, 정사각 한 변 기준). 실측(오케스트레이터 사전 조사):
 * 0.30→38건 / 0.32→41 / 0.36→48 / 0.38→49 (전부 정상), 0.40→HTTP 200 인데 빈 배열([]) —
 * 이 값부터 "에러가 아니라 조용히 0건"을 준다. TILE_STEP_DEG + TILE_MARGIN_DEG*2 가 이 값
 * 이상이면 cellToBBox 가 즉시 throw 해 조용한 실패를 build 타임에 막는다(런타임에 빈 배열을
 * 받고서야 의심하는 것보다 먼저).
 */
export const NAVER_BBOX_SAFE_MAX_DEG = 0.38;

/**
 * apartments 좌표가 실제로 존재하는 0.30° 격자 셀만 뽑는다(전국을 무식하게 격자로 덮지 않음).
 * 좌표가 없거나 숫자가 아닌 행은 건너뛴다.
 *
 * @param {AptForTiling[]} apartments
 * @param {number} [tileStepDeg]
 * @returns {TileCell[]}
 */
export function apartmentTileCells(apartments, tileStepDeg = TILE_STEP_DEG) {
  /** @type {Map<string, TileCell>} */
  const cells = new Map();
  for (const apt of apartments) {
    if (!Number.isFinite(apt.lat) || !Number.isFinite(apt.lng)) continue;
    const lat = /** @type {number} */ (apt.lat);
    const lng = /** @type {number} */ (apt.lng);
    const latIdx = Math.floor(lat / tileStepDeg);
    const lngIdx = Math.floor(lng / tileStepDeg);
    const key = `${latIdx}_${lngIdx}`;
    if (!cells.has(key)) cells.set(key, { latIdx, lngIdx });
  }
  return [...cells.values()];
}

/**
 * 격자 셀 인덱스 → bbox 변환. 안전선(NAVER_BBOX_SAFE_MAX_DEG) 이상이면 조용한 실패를
 * 만들 수 있는 요청을 아예 만들지 않도록 즉시 throw — 실행 전 build 타임 가드.
 *
 * @param {TileCell} cell
 * @param {number} [tileStepDeg]
 * @param {number} [marginDeg]
 * @returns {BBox}
 */
export function cellToBBox(cell, tileStepDeg = TILE_STEP_DEG, marginDeg = TILE_MARGIN_DEG) {
  const width = tileStepDeg + marginDeg * 2;
  if (width >= NAVER_BBOX_SAFE_MAX_DEG) {
    throw new Error(
      `타일 bbox 폭 ${width.toFixed(2)}° 가 안전선 ${NAVER_BBOX_SAFE_MAX_DEG}° 이상 — ` +
      `0.40°부터 네이버가 HTTP 200 인 채 빈 배열을 조용히 반환한다(실측 확인). tileStepDeg/marginDeg 를 줄일 것.`
    );
  }
  const { latIdx, lngIdx } = cell;
  return {
    bottomLat: latIdx * tileStepDeg - marginDeg,
    topLat: (latIdx + 1) * tileStepDeg + marginDeg,
    leftLon: lngIdx * tileStepDeg - marginDeg,
    rightLon: (lngIdx + 1) * tileStepDeg + marginDeg,
  };
}

/**
 * apartments 좌표 기준 타일 목록(bbox 포함)을 만든다.
 * @param {AptForTiling[]} apartments
 * @param {{ tileStepDeg?: number, marginDeg?: number }} [opts]
 * @returns {Tile[]}
 */
export function buildTiles(apartments, opts = {}) {
  const tileStepDeg = opts.tileStepDeg ?? TILE_STEP_DEG;
  const marginDeg = opts.marginDeg ?? TILE_MARGIN_DEG;
  const cells = apartmentTileCells(apartments, tileStepDeg);
  return cells.map((cell) => ({ ...cell, ...cellToBBox(cell, tileStepDeg, marginDeg) }));
}

// ── 네이버 API ────────────────────────────────────────────────────────
export const DEV_PLAN_KINDS = /** @type {DevPlanKind[]} */ (["road", "rail", "station", "jigu"]);

/**
 * @param {DevPlanKind} kind
 * @param {BBox} bbox
 * @param {number} [zoom]
 * @returns {string}
 */
export function buildDevPlanUrl(kind, bbox, zoom = 14) {
  const params = new URLSearchParams({
    zoom: String(zoom),
    leftLon: String(bbox.leftLon),
    rightLon: String(bbox.rightLon),
    topLat: String(bbox.topLat),
    bottomLat: String(bbox.bottomLat),
  });
  return `${NAVER_BASE}/api/developmentplan/${kind}/list?${params.toString()}`;
}

/**
 * 응답 바디에서 개발계획 항목 배열을 뽑는다. 실측된 형태는 배열을 바로 반환하는 것이지만,
 * 방어적으로 {list:[...]}/{result:[...]} 래핑도 허용한다. 알 수 없는 모양이면 빈 배열
 * (요청 자체는 성공했으므로 null 이 아니라 [] — null/[] 계약은 네트워크 실패 여부로만 가른다).
 * @param {unknown} json
 * @returns {RawDevPlanItem[]}
 */
export function parseDevPlanResponse(json) {
  if (Array.isArray(json)) return /** @type {RawDevPlanItem[]} */ (json);
  const obj = /** @type {Record<string, unknown>} */ (json ?? {});
  if (Array.isArray(obj.list)) return /** @type {RawDevPlanItem[]} */ (obj.list);
  if (Array.isArray(obj.result)) return /** @type {RawDevPlanItem[]} */ (obj.result);
  return [];
}

/** kind 별 원본 필드 이름 매핑 */
const KIND_FIELD_MAP = /** @type {Record<string, { detailKey: string, idKey: string, nameKey: string }>} */ ({
  road: { detailKey: "developmentPlanRoad", idKey: "roadId", nameKey: "roadName" },
  rail: { detailKey: "developmentPlanRail", idKey: "railId", nameKey: "railName" },
  station: { detailKey: "developmentPlanStation", idKey: "stationId", nameKey: "stationName" },
  jigu: { detailKey: "developmentPlanJigu", idKey: "jiguId", nameKey: "jiguName" },
});

/** @param {unknown[]} vals @returns {string | null} 첫 truthy 값을 문자열로 */
function firstTruthyStr(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return null;
}

/**
 * 원본 네이버 API 항목 하나를 DB 행으로 정규화한다(순수 함수).
 * source_id(원본 kind 별 id, 없으면 gid 폴백)가 없거나, 좌표가 한반도 범위 밖이면(축을
 * 뒤바꿔 읽은 실수 의심) 저장 불가 판정 → null(호출부가 실패로 집계).
 *
 * @param {DevPlanKind} kind
 * @param {RawDevPlanItem} raw
 * @param {() => string} [nowFn] 테스트 주입용 (fetched_at)
 * @returns {DevPlanRow | null}
 */
export function normalizeDevPlanItem(kind, raw, nowFn = () => new Date().toISOString()) {
  const { detailKey, idKey, nameKey } = KIND_FIELD_MAP[kind];
  const detail = /** @type {Record<string, unknown>} */ (raw[detailKey] ?? {});

  const sourceId = firstTruthyStr(detail[idKey], raw.gid);
  if (!sourceId) return null;

  const latRaw = raw.yPos != null ? Number(raw.yPos) : NaN;
  const lngRaw = raw.xPos != null ? Number(raw.xPos) : NaN;
  const lat = Number.isFinite(latRaw) ? latRaw : null;
  const lng = Number.isFinite(lngRaw) ? lngRaw : null;
  // 좌표를 받긴 했는데 한반도 밖이면(축 실수 의심) 저장하지 않는다. 좌표 자체가 없는 경우(null)는
  // 별개 — "모른다"와 "잘못 읽었다"를 구분한다(모른다는 그대로 null 로 통과시킨다).
  if (lat != null && lng != null && !isWithinKoreaBounds(lat, lng)) return null;

  return {
    source: "naver",
    kind,
    source_id: sourceId,
    gid: raw.gid != null ? String(raw.gid) : null,
    name: firstTruthyStr(detail[nameKey], raw[nameKey]),
    lat,
    lng,
    // rail/road = detail.progressionStep, jigu = detail.jiguStep, station = 원본에 없음(null)
    progression_step: firstTruthyStr(detail.progressionStep, detail.jiguStep, raw.progressionStep),
    // rail/road = 공사기간, station = 개통예정일. jigu 는 별도 ETA 필드가 없음(null)
    eta: firstTruthyStr(detail.constructionPeriod, detail.openDate),
    raw,
    fetched_at: nowFn(),
  };
}

/**
 * 타일 하나 + kind 하나를 조회한다. 실패(네트워크·HTTP·파싱 이상)면 null, 성공이면
 * 배열(0건 포함)을 반환한다 — 세션98 이래의 null(실패)/[](성공·0건) 계약(transport-tago.mjs 답습).
 *
 * fetchFn 을 주입 가능하게 해 네트워크 없이 단위 테스트한다. onFailure 는 실패 시(특히 429
 * 여부) 호출부에 알려 연속 429 서킷브레이커를 셀 수 있게 한다.
 *
 * @param {DevPlanKind} kind
 * @param {BBox} bbox
 * @param {string} jwt
 * @param {(url: string, opts: RequestInit) => Promise<FetchLikeResponse>} [fetchFn]
 * @param {(info: { rateLimited: boolean, message: string }) => void} [onFailure]
 * @returns {Promise<RawDevPlanItem[] | null>}
 */
export async function fetchDevPlanTile(kind, bbox, jwt, fetchFn = /** @type {any} */ (fetch), onFailure) {
  const url = buildDevPlanUrl(kind, bbox);
  const result = await fetchNaverJson(url, { headers: { ...HEADERS, Authorization: `Bearer ${jwt}` } }, fetchFn);
  if (!result.ok) {
    logError(PHASE, `타일 조회 실패 [${kind}] ${JSON.stringify(bbox)}: ${result.message}`);
    if (onFailure) onFailure({ rateLimited: result.rateLimited, message: result.message });
    return null;
  }
  return parseDevPlanResponse(result.data);
}

// ── dedup (네이버·V-WORLD 공용) ──────────────────────────────────────
/**
 * 여러 타일/조회에서 모은 행을 (source, kind, source_id) 기준으로 중복 제거한다.
 * 네이버는 타일이 겹치므로(TILE_MARGIN_DEG), V-WORLD 는 이웃한 단지들의 반경이 겹치므로
 * 같은 개발계획이 여러 번 잡히는 것이 정상 — 이 함수가 그것을 흡수한다.
 * source 를 키에 포함하는 이유: kind 값이 서로 다른 출처에서 우연히 같은 문자열일 수 있고
 * (예: 없음, 현재는 아니지만) source_id 네임스페이스가 출처마다 독립적이라 섞이면 안 된다.
 * 먼저 들어온 행을 유지(같은 원본이라 값 차이는 없음).
 *
 * @param {DevPlanRow[]} rows
 * @returns {DevPlanRow[]}
 */
export function dedupDevPlanRows(rows) {
  /** @type {Map<string, DevPlanRow>} */
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.source}:${row.kind}:${row.source_id}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

// ── V-WORLD API (산업단지·LH사업지구) ────────────────────────────────
const VWORLD_BASE = "https://api.vworld.kr/req/data";
const VWORLD_KEY = process.env.VWORLD_KEY || null;

/**
 * 수집 반경(m). 산업단지·LH사업지구는 면적이 넓은 시설이라 "발전 축에 영향을 주는 범위"가
 * 점 시설(지하철역 등)보다 훨씬 넓다. 5km 는 **수집 창(collection window)** 이지 나중에
 * 점수화할 때 쓸 "유의미한 거리" 기준이 아니다 — 그 기준은 경계 재설계·점수 배선 단계에서
 * 따로 정해야 한다(이 수집기는 원본을 넉넉히 모아 두는 역할까지만).
 */
export const VWORLD_BUFFER_M = 5000;

/**
 * V-WORLD 개발키는 **신청 시 등록한 서비스 URL 에서 온 요청인지 Referer 헤더로 검사한다.**
 * 서버에서 부르면 브라우저와 달리 Referer 가 없어 키가 멀쩡해도 거부된다 —
 * `INCORRECT_KEY / 인증키 정보가 올바르지 않습니다`(등록 안 된 키의 `INVALID_KEY` 와 다른 에러다).
 *
 * 2026-08-13 라이브 실측 (같은 키·같은 요청, 헤더만 바꿈):
 *   헤더 없음                → status=ERROR, INCORRECT_KEY
 *   Referer=이 도메인        → status=OK, features=3
 *   Referer=http://localhost → status=OK, features=3
 *
 * ⚠️ 한글 도메인(미분양아파트.com)을 그대로 넣으면 안 된다 — HTTP 헤더는 ByteString 이라
 *   fetch 가 `character ... greater than 255` 로 던진다. **퓨니코드**로 적는다.
 */
export const VWORLD_REFERER = "https://xn--hg3bi2ac4o1ig57cnoa.com/";

/**
 * V-WORLD 레이어별 속성 매핑. lh_zone 은 dan_id 같은 명시적 id 속성이 없다(오케스트레이터가
 * 확인한 응답 속성 목록에 zonename/ag_geom 뿐) — GeoJSON 표준 feature.id 로 폴백한다.
 */
export const VWORLD_LAYERS = /** @type {Record<string, { layerId: string, nameKey: string, idKey: string | null }>} */ ({
  industrial_complex: { layerId: "LT_C_DAMDAN", nameKey: "dan_name", idKey: "dan_id" },
  lh_zone: { layerId: "LT_C_LHZONE", nameKey: "zonename", idKey: null },
});

/**
 * 로그·에러 메시지에 V-WORLD 요청 URL을 남길 때 key 값을 마스킹한다. **키 값을 로그·에러
 * 메시지에 절대 그대로 찍지 않는다** — URL 쿼리에 키가 들어가므로 이 함수 없이 URL 을 그대로
 * 출력하면 로그에 시크릿이 남는다.
 * @param {string} url
 * @returns {string}
 */
export function redactVworldKey(url) {
  return url.replace(/([?&]key=)[^&]+/i, "$1***");
}

/**
 * @param {string} layerId
 * @param {number} lat
 * @param {number} lng
 * @param {number} bufferM
 * @param {string | null} key
 * @param {number} [size]
 * @returns {string}
 */
export function buildVworldUrl(layerId, lat, lng, bufferM, key, size = 1000) {
  const params = new URLSearchParams({
    service: "data",
    request: "GetFeature",
    key: key ?? "",
    data: layerId,
    format: "json",
    size: String(size),
    // POINT(x y) = POINT(lng lat) — GeoJSON/V-WORLD 좌표계 순서와 동일(세션511 WebFetch 확인)
    geomFilter: `POINT(${lng} ${lat})`,
    buffer: String(bufferM),
    crs: "EPSG:4326",
  });
  return `${VWORLD_BASE}?${params.toString()}`;
}

/**
 * V-WORLD 응답에서 feature 배열을 뽑는다. 정상 구조는
 * response.result.featureCollection.features(GeoJSON FeatureCollection, 세션511 WebFetch
 * 확인 — 공식 문서가 로그인 뒤 상세페이지에만 있어 status enum 전체(OK/NOT_FOUND/ERROR 등)를
 * 100% 확정하지 못했다. features 배열이 있으면 그게 진실이므로 그대로 반환하고, 배열이 없을
 * 때만 status 문자열로 "진짜 에러"(ERROR/AUTH/INVALID/LIMIT 류)인지 "결과 없음"인지 가른다.
 * 후자는 성공·0건(`[]`)으로 관대하게 처리 — 라이브 키로 실제 status 값 재확인이 필요하다(⑦).
 * @param {unknown} json
 * @returns {VworldFeature[]}
 */
export function parseVworldResponse(json) {
  const obj = /** @type {Record<string, unknown>} */ (json ?? {});
  const response = /** @type {Record<string, unknown>} */ (obj.response ?? {});
  const result = /** @type {Record<string, unknown>} */ (response.result ?? {});
  const featureCollection = /** @type {Record<string, unknown>} */ (result.featureCollection ?? {});
  const features = featureCollection.features;
  if (Array.isArray(features)) return /** @type {VworldFeature[]} */ (features);

  const status = response.status;
  if (typeof status === "string" && /ERROR|AUTH|INVALID|LIMIT/i.test(status)) {
    throw new Error(`V-WORLD 응답 오류: status=${status}`);
  }
  return [];
}

/**
 * GeoJSON coordinates(임의 중첩 — Point/Polygon/MultiPolygon 등)에서 [lng, lat] 쌍을 전부
 * 모은다.
 * @param {unknown} node
 * @param {[number, number][]} out
 */
function collectCoordPairs(node, out) {
  if (!Array.isArray(node)) return;
  if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
    out.push([node[0], node[1]]);
    return;
  }
  for (const child of node) collectCoordPairs(child, out);
}

/**
 * GeoJSON geometry → 대표점(lat, lng). **폴리곤의 기하학적 중심(centroid) 대신 경계 좌표
 * 전부의 단순 평균**을 쓴다 — 이번 축(단지-개발계획 거리)에 필요한 정밀도를 넘어서는 계산이라
 * 평균으로 충분하다고 판단했다(이 선택은 지시에 명시적으로 허용됨). GeoJSON 좌표는 [lng, lat]
 * 순(RFC 7946, 세션511 WebFetch 재확인) — 우리 DB lat/lng 와 반대라 여기서 뒤집는다.
 *
 * @param {GeoJsonGeometry | null | undefined} geometry
 * @returns {{ lat: number, lng: number } | null}
 */
export function geojsonCentroid(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  /** @type {[number, number][]} */
  const points = [];
  collectCoordPairs(geometry.coordinates, points);
  if (points.length === 0) return null;
  let sumLat = 0, sumLng = 0;
  for (const [lng, lat] of points) { sumLng += lng; sumLat += lat; }
  return { lat: sumLat / points.length, lng: sumLng / points.length };
}

/**
 * V-WORLD GeoJSON feature 하나를 DB 행으로 정규화한다(순수 함수).
 * source_id 가 전혀 없거나(idKey 속성도 feature.id 도 없음), 계산된 대표점이 한반도 범위
 * 밖이면(좌표축 실수 의심) 저장하지 않고 null(호출부가 실패로 집계).
 *
 * @param {string} kind ("industrial_complex" | "lh_zone")
 * @param {VworldFeature} feature
 * @param {() => string} [nowFn] 테스트 주입용 (fetched_at)
 * @returns {DevPlanRow | null}
 */
export function normalizeVworldFeature(kind, feature, nowFn = () => new Date().toISOString()) {
  const meta = VWORLD_LAYERS[kind];
  if (!meta) return null;
  const props = /** @type {Record<string, unknown>} */ (feature.properties ?? {});

  const sourceId = firstTruthyStr(meta.idKey ? props[meta.idKey] : null, feature.id);
  if (!sourceId) return null;

  const centroid = geojsonCentroid(feature.geometry);
  if (centroid && !isWithinKoreaBounds(centroid.lat, centroid.lng)) return null;

  return {
    source: "vworld",
    kind: /** @type {DevPlanKind} */ (kind),
    source_id: sourceId,
    gid: feature.id != null ? String(feature.id) : null,
    name: firstTruthyStr(props[meta.nameKey]),
    lat: centroid?.lat ?? null,
    lng: centroid?.lng ?? null,
    progression_step: null, // V-WORLD 축(경계 데이터)엔 네이버 같은 진행단계 필드가 없음
    eta: null,               // 별도 ETA 필드 없음
    raw: /** @type {RawDevPlanItem} */ (feature),
    fetched_at: nowFn(),
  };
}

/**
 * V-WORLD 레이어 하나를 단지 좌표 기준 반경(geomFilter+buffer)으로 조회한다.
 * null=실패 / []=성공·0건 계약(네이버와 동일).
 *
 * ── 왜 타일이 아니라 단지별 개별 조회인가 (요청 수 비교, 지시 ② 응답) ──
 * · 단지별 개별 조회: apartments 2,696곳 × 레이어 2종 = **5,392회**(1회성 전체 수집 기준).
 * · 타일 순회(네이버와 같은 0.30°+마진 0.02° 격자): 네이버 스모크 실측(서울만 2타일)으로
 *   미루어 전국은 대략 20~40타일 × 레이어 2종 = **약 40~80회**로 표면상 훨씬 적다.
 * 그런데도 개별 조회를 택한 이유:
 *   1. 산업단지·LH지구는 면적이 넓은 폴리곤이라, 타일 결과는 "그 타일 안에 지구가 있다"만
 *      알려준다 — "어느 단지에서 몇 m 거리인가"는 여전히 별도 거리계산 단계가 있어야 한다.
 *      그 매칭기가 아직 없다(세션510 인계 — "거리 매칭기가 아직 없다"). 반경조회는 buffer
 *      자체가 "이 단지에서 그만큼 안"이라는 의미를 이미 담고 있어 그 단계가 필요 없다.
 *   2. V-WORLD 는 이 세션 조사에서 네이버 같은 429/IP 쿨다운 문제가 보고되지 않았다 — 요청
 *      수가 많아도(5,392회) 짧은 스로틀(300ms)이면 약 27분에 끝난다(스모크로 검증 예정).
 *   3. 요청 수 차이(5,392 vs ~60)보다 "매칭기 없이 바로 쓸 수 있는 데이터"의 가치가 크다고
 *      판단 — 다만 이건 판단이지 실측은 아니다. V-WORLD 요청량이 실제로 부담되면(쿼터·속도)
 *      타일 방식 + 후속 거리계산으로 되돌리는 것도 가능(kind 값만 유지하면 재작업 최소).
 *
 * @param {string} kind
 * @param {number} lat
 * @param {number} lng
 * @param {(url: string, opts: RequestInit) => Promise<FetchLikeResponse>} [fetchFn]
 * @returns {Promise<VworldFeature[] | null>}
 */
export async function fetchVworldFeatures(kind, lat, lng, fetchFn = fetchWithRetry) {
  const meta = VWORLD_LAYERS[kind];
  if (!meta) return null;
  const url = buildVworldUrl(meta.layerId, lat, lng, VWORLD_BUFFER_M, VWORLD_KEY);
  try {
    // Referer 필수 — 빠뜨리면 키가 멀쩡해도 INCORRECT_KEY (VWORLD_REFERER 주석의 실측 참조)
    const res = await fetchFn(url, { headers: { Referer: VWORLD_REFERER } });
    const json = await res.json();
    return parseVworldResponse(json);
  } catch (err) {
    logError(PHASE, `V-WORLD 조회 실패 [${kind}] (${redactVworldKey(url)}): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── 메인 ────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    logError(PHASE, "SUPABASE_URL + SUPABASE_SERVICE_KEY 환경변수 필요");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const regionArg = args.find((a) => a.startsWith("--region="));
  const regionFilter = regionArg ? regionArg.replace("--region=", "") : null;
  const limitTilesArg = args.find((a) => a.startsWith("--limit-tiles="));
  const limitTiles = limitTilesArg ? parseInt(limitTilesArg.replace("--limit-tiles=", ""), 10) : 0;
  const limitAptsArg = args.find((a) => a.startsWith("--limit-apts="));
  const limitApts = limitAptsArg ? parseInt(limitAptsArg.replace("--limit-apts=", ""), 10) : 0;
  const sourceArg = args.find((a) => a.startsWith("--source="));
  const sourceFilter = sourceArg ? sourceArg.replace("--source=", "") : "both";
  const runNaver = sourceFilter === "both" || sourceFilter === "naver";
  const runVworld = sourceFilter === "both" || sourceFilter === "vworld";

  if (dryRun) log(PHASE, "=== DRY-RUN 모드 (DB 쓰기 없음) ===");

  const sb = getSupabase();
  /** @type {AptForTiling[]} */
  const apartments = await selectAll(
    (s) => s.from("apartments").select("id, lat, lng, region").not("lat", "is", null).not("lng", "is", null),
    sb,
  );
  const targets = regionFilter ? apartments.filter((a) => a.region === regionFilter) : apartments;
  log(PHASE, `apartments ${apartments.length}건 중 대상 ${targets.length}건${regionFilter ? ` (region=${regionFilter})` : ""}`);

  const rpt = createReporter(PHASE);
  /** @type {DevPlanRow[]} */
  const allRows = [];
  let rejectedCount = 0; // 정규화는 됐으나 한반도 밖 좌표/식별자 없음으로 저장 거부된 건수

  // ── V-WORLD 먼저 (네이버가 429 쿨다운 중일 수 있어 우선 시도 — 지시) ──────
  let vworldSkippedNoKey = false;
  if (runVworld) {
    if (!VWORLD_KEY) {
      vworldSkippedNoKey = true;
      log(PHASE, "VWORLD_KEY 미설정 — V-WORLD 축 건너뜀(네이버만 수집)");
    } else {
      const vTargets = limitApts > 0 ? targets.slice(0, limitApts) : targets;
      const vKinds = Object.keys(VWORLD_LAYERS);
      log(PHASE, `V-WORLD 대상 ${vTargets.length}단지 × 레이어 ${vKinds.length}종(${vKinds.join(",")})`);
      for (const apt of vTargets) {
        if (rpt.interrupted()) break; // graceful shutdown
        if (apt.lat == null || apt.lng == null) continue;
        for (const kind of vKinds) {
          const features = await fetchVworldFeatures(kind, apt.lat, apt.lng);
          if (features === null) { rpt.fail(); continue; }
          for (const feature of features) {
            const row = normalizeVworldFeature(kind, feature);
            if (row) allRows.push(row); else rejectedCount++;
          }
          rpt.success();
          await sleep(300); // V-WORLD 는 명시된 rate limit 규정이 없어 보수적으로 짧게만
        }
      }
    }
  }

  // ── 네이버 (타일 순회) ─────────────────────────────────────────────
  let naverCircuitBroken = false;
  let naverTileFailCount = 0;
  /** @type {Record<string, number>} */
  const naverCountsByKind = { road: 0, rail: 0, station: 0, jigu: 0 };
  if (runNaver) {
    let tiles = buildTiles(targets);
    if (limitTiles > 0) tiles = tiles.slice(0, limitTiles);
    log(PHASE, `네이버 타일 ${tiles.length}개 생성 (격자 ${TILE_STEP_DEG}° + 마진 ${TILE_MARGIN_DEG}° = 폭 ${(TILE_STEP_DEG + TILE_MARGIN_DEG * 2).toFixed(2)}°, 안전선 ${NAVER_BBOX_SAFE_MAX_DEG}° 미만)`);

    if (tiles.length === 0) {
      log(PHASE, "네이버: 타일 0개 — 대상 없음");
    } else {
      const jwt = await ensureJwt();
      let consecutive429 = 0;

      naverLoop:
      for (let i = 0; i < tiles.length; i++) {
        if (rpt.interrupted()) break; // graceful shutdown (세션 344 답습)
        const tile = tiles[i];

        for (const kind of DEV_PLAN_KINDS) {
          const items = await fetchDevPlanTile(kind, tile, jwt, /** @type {any} */ (fetch), ({ rateLimited }) => {
            consecutive429 = rateLimited ? consecutive429 + 1 : 0;
          });
          if (items === null) {
            naverTileFailCount++;
            rpt.fail();
            if (consecutive429 >= NAVER_MAX_CONSECUTIVE_429) {
              logError(PHASE, `네이버: 연속 429 ${consecutive429}회 — 쿨다운 의심, 이번 회차 네이버 수집 중단(시간을 두고 재시도할 것)`);
              naverCircuitBroken = true;
              break naverLoop;
            }
            continue;
          }
          consecutive429 = 0;
          for (const raw of items) {
            const row = normalizeDevPlanItem(kind, raw);
            if (row) { allRows.push(row); naverCountsByKind[kind]++; } else rejectedCount++;
          }
          rpt.success();
          await sleep(5000); // 네이버 5초 스로틀 (이 레포의 관습, scripts/CLAUDE.md API Rate Limit 표)
        }

        if ((i + 1) % 10 === 0) log(PHASE, `네이버 진행: ${i + 1}/${tiles.length} 타일`);
      }
    }
  }

  const deduped = dedupDevPlanRows(allRows);
  log(PHASE, `수집 결과: 네이버(road=${naverCountsByKind.road} rail=${naverCountsByKind.rail} station=${naverCountsByKind.station} jigu=${naverCountsByKind.jigu}, 타일실패 ${naverTileFailCount}건) — 원본 ${allRows.length}건(거부 ${rejectedCount}건) → dedup 후 ${deduped.length}건`);

  if (dryRun) {
    if (deduped.length > 0) log(PHASE, `샘플: ${JSON.stringify(deduped[0])}`);
    log(PHASE, "dry-run — DB 쓰기 생략");
  } else {
    await upsertBatch("dev_plans", deduped, "source,kind,source_id", 500, sb);
  }

  const result = rpt.summary();
  if (naverCircuitBroken) result.status = "partial";
  if (vworldSkippedNoKey) {
    /** @type {any} */ (result).errorMessage = "VWORLD_KEY 미설정 — V-WORLD 축 건너뜀(네이버만 수집)";
  }
  await recordCollectorRun(PHASE, result);
  if (result.fail > 0) process.exit(1);
}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((err) => { logError(PHASE, err instanceof Error ? err.message : String(err)); process.exit(1); });
