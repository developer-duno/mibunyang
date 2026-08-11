// @ts-check
/**
 * 네이버 부동산 개발계획 수집기 — new.land.naver.com/api/developmentplan/{road|rail|station|jigu}/list
 *
 * ⚠️ 한국 IP 필수 (네이버 부동산 데이터센터 IP 차단) — 로컬 전용, GitHub Actions 금지.
 *   (scripts/CLAUDE.md "네이버 수집 — 로컬 자동화" 절 참조. 실행 환경 배선은 이 파일 소관이
 *    아니다 — run-naver-local.sh/.bat 은 이 세션에서 건드리지 않았다.)
 *
 * 4종류(도로/철도/역/지구)를 한 테이블(dev_plans)에 kind 로 구분해 담는다. apartments 의
 * transit_dev/city_dev/industry_dev 점수 컬럼은 이 수집기가 **건드리지 않는다** — 배선은
 * 경계 재설계 후 별건("경계 먼저, 데이터 나중").
 *
 * JWT: naver-listings.mjs(같은 new.land.naver.com 도메인)의 ensureJwt() 를 그대로 답습했다
 * — /complexes/{id} HTML 페이지에서 `"token":"eyJ..."` 정규식 추출, 50분 캐시.
 *
 * 타일링: 전국을 무식하게 격자로 덮지 않고, apartments 좌표가 실제로 있는 0.30° 격자
 * 셀만 타일로 만든다(apartmentTileCells). 각 타일 bbox 는 격자 폭(0.30°) + 양쪽 마진(0.02°)
 * = 0.34° — 실측 안전선(NAVER_BBOX_SAFE_MAX_DEG=0.38°, 0.40°부터 조용히 빈 배열) 아래.
 * 마진이 곧 타일 간 겹침(overlap)이라 경계에 걸친 개발계획이 누락되지 않는다.
 *
 * 계약: null=이번 타일 수집 실패 / []=성공·0건 (이 레포의 기존 계약, transport-tago.mjs 답습).
 *
 * 사용법:
 *   node scripts/collectors/naver-devplan.mjs --dry-run                    (DB 쓰기 없이 미리보기)
 *   node scripts/collectors/naver-devplan.mjs --dry-run --region=서울      (지역 필터 스모크)
 *   node scripts/collectors/naver-devplan.mjs --dry-run --limit-tiles=3    (타일 수 제한 스모크)
 *   node scripts/collectors/naver-devplan.mjs                              (전량 수집 + DB upsert)
 *
 * 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import {
  loadEnv, getSupabase, log, logError, fetchWithRetry, sleep,
  createReporter, recordCollectorRun, selectAll, upsertBatch,
} from "./_shared.mjs";

/**
 * @typedef {"road" | "rail" | "station" | "jigu"} DevPlanKind
 * @typedef {{ latIdx: number, lngIdx: number }} TileCell
 * @typedef {{ leftLon: number, rightLon: number, topLat: number, bottomLat: number }} BBox
 * @typedef {TileCell & BBox} Tile
 * @typedef {{ id: string, lat: number | null, lng: number | null, region?: string | null }} AptForTiling
 * @typedef {Record<string, unknown>} RawDevPlanItem
 * @typedef {{
 *   kind: DevPlanKind, source_id: string, gid: string | null, name: string | null,
 *   lat: number | null, lng: number | null, progression_step: string | null,
 *   eta: string | null, raw: RawDevPlanItem, fetched_at: string,
 * }} DevPlanRow
 */

loadEnv();

const PHASE = "naver-devplan";
const NAVER_BASE = "https://new.land.naver.com";

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

// ── 타일링 ──────────────────────────────────────────────────────────────
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

// ── API 호출 ────────────────────────────────────────────────────────────
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
const KIND_FIELD_MAP = /** @type {Record<DevPlanKind, { detailKey: string, idKey: string, nameKey: string }>} */ ({
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
 * 원본 API 항목 하나를 DB 행으로 정규화한다(순수 함수).
 * source_id(원본 kind 별 id, 없으면 gid 폴백)가 전혀 없으면 저장 불가 판정 → null.
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

  const lat = raw.yPos != null ? Number(raw.yPos) : NaN;
  const lng = raw.xPos != null ? Number(raw.xPos) : NaN;

  return {
    kind,
    source_id: sourceId,
    gid: raw.gid != null ? String(raw.gid) : null,
    name: firstTruthyStr(detail[nameKey], raw[nameKey]),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    // rail/road = detail.progressionStep, jigu = detail.jiguStep, station = 원본에 없음(null)
    progression_step: firstTruthyStr(detail.progressionStep, detail.jiguStep, raw.progressionStep),
    // rail/road = 공사기간, station = 개통예정일. jigu 는 별도 ETA 필드가 없음(null)
    eta: firstTruthyStr(detail.constructionPeriod, detail.openDate),
    raw,
    fetched_at: nowFn(),
  };
}

/**
 * 여러 타일에서 모은 행을 (kind, source_id) 기준으로 중복 제거한다.
 * 타일이 겹치므로(TILE_MARGIN_DEG) 같은 개발계획이 여러 타일에서 잡히는 것이 정상 —
 * 이 함수가 그것을 흡수한다. 먼저 들어온 행을 유지(같은 원본이라 값 차이는 없음).
 *
 * @param {DevPlanRow[]} rows
 * @returns {DevPlanRow[]}
 */
export function dedupDevPlanRows(rows) {
  /** @type {Map<string, DevPlanRow>} */
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.kind}:${row.source_id}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

/**
 * 타일 하나 + kind 하나를 조회한다. 실패(네트워크·HTTP·파싱 이상)면 null, 성공이면
 * 배열(0건 포함)을 반환한다 — 세션98 이래의 null(실패)/[](성공·0건) 계약(transport-tago.mjs 답습).
 *
 * fetchFn 을 주입 가능하게 해 네트워크 없이 단위 테스트한다.
 *
 * @param {DevPlanKind} kind
 * @param {BBox} bbox
 * @param {string} jwt
 * @param {(url: string, opts: RequestInit) => Promise<{ json: () => Promise<unknown> }>} [fetchFn]
 * @returns {Promise<RawDevPlanItem[] | null>}
 */
export async function fetchDevPlanTile(kind, bbox, jwt, fetchFn = fetchWithRetry) {
  try {
    const url = buildDevPlanUrl(kind, bbox);
    const res = await fetchFn(url, { headers: { ...HEADERS, Authorization: `Bearer ${jwt}` } });
    const json = await res.json();
    return parseDevPlanResponse(json);
  } catch (err) {
    logError(PHASE, `타일 조회 실패 [${kind}] ${JSON.stringify(bbox)}: ${err instanceof Error ? err.message : String(err)}`);
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

  if (dryRun) log(PHASE, "=== DRY-RUN 모드 (DB 쓰기 없음) ===");

  const sb = getSupabase();
  /** @type {AptForTiling[]} */
  const apartments = await selectAll(
    (s) => s.from("apartments").select("id, lat, lng, region").not("lat", "is", null).not("lng", "is", null),
    sb,
  );
  const targets = regionFilter ? apartments.filter((a) => a.region === regionFilter) : apartments;
  log(PHASE, `apartments ${apartments.length}건 중 타일링 대상 ${targets.length}건${regionFilter ? ` (region=${regionFilter})` : ""}`);

  let tiles = buildTiles(targets);
  if (limitTiles > 0) tiles = tiles.slice(0, limitTiles);
  log(PHASE, `타일 ${tiles.length}개 생성 (격자 ${TILE_STEP_DEG}° + 마진 ${TILE_MARGIN_DEG}° = 폭 ${(TILE_STEP_DEG + TILE_MARGIN_DEG * 2).toFixed(2)}°, 안전선 ${NAVER_BBOX_SAFE_MAX_DEG}° 미만)`);

  if (tiles.length === 0) {
    log(PHASE, "타일 0개 — 대상 없음, 종료");
    return;
  }

  const jwt = await ensureJwt();

  const rpt = createReporter(PHASE);
  /** @type {DevPlanRow[]} */
  const allRows = [];
  /** @type {Record<DevPlanKind, number>} */
  const countsByKind = { road: 0, rail: 0, station: 0, jigu: 0 };
  let tileFailCount = 0;

  for (let i = 0; i < tiles.length; i++) {
    if (rpt.interrupted()) break; // graceful shutdown (세션 344 답습)
    const tile = tiles[i];

    for (const kind of DEV_PLAN_KINDS) {
      const items = await fetchDevPlanTile(kind, tile, jwt);
      if (items === null) {
        tileFailCount++;
        rpt.fail();
        continue;
      }
      for (const raw of items) {
        const row = normalizeDevPlanItem(kind, raw);
        if (row) { allRows.push(row); countsByKind[kind]++; }
      }
      rpt.success();
      await sleep(5000); // 네이버 5초 스로틀 (이 레포의 관습, scripts/CLAUDE.md API Rate Limit 표)
    }

    if ((i + 1) % 10 === 0) log(PHASE, `진행: ${i + 1}/${tiles.length} 타일`);
  }

  const deduped = dedupDevPlanRows(allRows);
  log(PHASE, `수집 결과: road=${countsByKind.road} rail=${countsByKind.rail} station=${countsByKind.station} jigu=${countsByKind.jigu} (원본 ${allRows.length}건 → dedup 후 ${deduped.length}건, 타일 실패 ${tileFailCount}건)`);

  if (dryRun) {
    if (deduped.length > 0) log(PHASE, `샘플: ${JSON.stringify(deduped[0])}`);
    log(PHASE, "dry-run — DB 쓰기 생략");
  } else {
    await upsertBatch("dev_plans", deduped, "kind,source_id", 500, sb);
  }

  const result = rpt.summary();
  await recordCollectorRun(PHASE, result);
  if (result.fail > 0) process.exit(1);
}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((err) => { logError(PHASE, err instanceof Error ? err.message : String(err)); process.exit(1); });
