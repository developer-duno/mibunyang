// @ts-check
/**
 * 인프라 시설 수집기 — Kakao Places 기반
 *
 * 병원, 마트, 편의점, 카페, 문화시설, 은행, 약국, 공원, 지하철 거리
 *
 * 사용법:
 *   node scripts/collectors/infra-kakao.mjs              (Supabase UPDATE)
 *   node scripts/collectors/infra-kakao.mjs --dry-run    (미리보기만)
 *   node scripts/collectors/infra-kakao.mjs --force      (신선도 무시하고 전량 재수집)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep, createReporter, recordCollectorRun, createSemaphore, selectAll } from "./_shared.mjs";

loadEnv();

const PHASE = "infra";
const KAKAO_KEY = process.env.KAKAO_KEY;
if (!KAKAO_KEY) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }

// re-export for backward compat (infra-kakao.test.mjs에서 import)
export { createSemaphore };
const sem = createSemaphore(5); // 동시 5건 (Kakao 초당 50건 중 안전 마진)

/**
 * @typedef {{ x: string; y: string; distance: string; place_name?: string }} KakaoPlaceItem
 * @typedef {{ total_count?: number, pageable_count?: number, is_end?: boolean }} KakaoPlacesMeta
 * @typedef {{ documents: KakaoPlaceItem[], meta?: KakaoPlacesMeta }} KakaoPlacesResponse
 * @typedef {{ id: string; name: string | null; lat: number | null; lng: number | null }} InfraAptRow
 */

const CATEGORIES = /** @type {const} */ ([
  { key: "hospital", keyword: "병원", radius: 1000 },
  { key: "mart", keyword: "대형마트", radius: 1000 },
  { key: "conv", keyword: "편의점", radius: 500 },
  { key: "cafe", keyword: "카페", radius: 500 },
  { key: "culture", keyword: "문화시설", radius: 1000 },
  { key: "bank", keyword: "은행", radius: 1000 },
  { key: "pharmacy", keyword: "약국", radius: 500 },
  { key: "park", keyword: "공원", radius: 1000 },
]);

// ── 신선도 건너뛰기 (세션 490) ────────────────────────────────
// 이전에는 매일 좌표 있는 단지 전량(2,170건)을 무조건 재수집해 23분/일을 태웠다. 인프라(병원·마트·
// 편의점…)는 하루 단위로 바뀌지 않으므로 "완결 + 최근" 이면 건너뛴다. 하루 ~1/30 만 돌아 회차당 ~1분.
// ⚠️ 시간만 보면 안 된다 — 값이 비어 있는 행이 신선하다는 이유로 영구 미보강으로 남는다
//    (schools-neis buildEnrichedIds, 세션 338 답습). 완결성 + 신선도 둘 다 만족해야 건너뛴다.
export const FRESH_DAYS = 30;

/** 완결 판정 키 — 이 수집기가 채우는 컬럼 전부가 non-null 이어야 "완결" */
export const REQUIRED_KEYS = [...CATEGORIES.map((c) => c.key), "subway_dist"];

/**
 * 건너뛸(=이미 완결 + 최근 갱신) apartment_id 집합.
 * @param {Record<string, unknown>[]} rows infra 행 (apartment_id, updated_at, 카테고리 컬럼)
 * @param {number} [nowMs]
 * @param {number} [days]
 * @returns {Set<string>}
 */
export function buildFreshIds(rows, nowMs = Date.now(), days = FRESH_DAYS) {
  const cutoff = nowMs - days * 86400000;
  /** @type {Set<string>} */
  const fresh = new Set();
  for (const r of rows || []) {
    const id = r?.apartment_id;
    if (typeof id !== "string" || !id) continue;
    const ts = r.updated_at ? Date.parse(String(r.updated_at)) : NaN;
    if (isNaN(ts) || ts < cutoff) continue;             // 오래됨 → 재수집
    if (REQUIRED_KEYS.some((k) => r[k] == null)) continue; // 미완성 → 재수집
    fresh.add(id);
  }
  return fresh;
}

/**
 * 단지 처리 오류 중 "실패"로 셀 수를 정한다(세션599). 옛 판은 카카오 오류·upsert 오류를 skip 칸에 넣어
 * 카카오가 하루 종일 고장이어도 조용히 success 였다. 한두 번 일시 오류로 경보가 울리지 않게 비율로 판정한다:
 * 시도(갱신 성공+오류) 중 오류가 절반 이상이고 오류 ≥1 이면 오류 수 전부를 실패로, 아니면 0(옛 동작대로 skip).
 * calc-school-walk `lookupErrorFailCount` 와 같은 경계.
 * @param {{ ok: number, err: number }} counts
 * @returns {number} rpt.fail 에 넘길 수(0 이면 오류 수를 rpt.skip 으로)
 */
export function errorFailCount({ ok, err }) {
  const attempted = ok + err;
  if (attempted === 0 || err < 1) return 0;
  return err * 2 >= attempted ? err : 0;
}

/**
 * 반경 안 개수 + 최근접 1건을 돌려준다.
 *
 * ⚠️ **개수는 `documents.length` 가 아니라 `meta.total_count` 다.** 예전에는 `size=5` 로 받아
 * 배열 길이를 셌는데, 그러면 반경 안에 몇 개가 있든 **최대 5로 잘린다.** 그런데 채점 만점 기준은
 * 편의점 10 · 카페 20 이라(`INFRA_CONFIG`) 그 두 항목은 **어떤 단지도 만점에 도달할 수 없었다.**
 * 세션498 이 버스 정류장에서 똑같은 사고를 겪었다 — "수집 상한 < 만점 기준" 은 배점을 조용히 죽인다.
 *
 * `meta.total_count` 는 radius 필터가 적용된 값이다(2026-08-13 실측: 같은 좌표에서 반경만 바꾸니
 * 200m→51 · 500m→212 · 1km→551 · 2km→1,534 로 변했다). `pageable_count`(최대 45)와 달리
 * 상한이 없다. 공식 문서: developers.kakao.com/docs/ko/local/dev-guide
 *
 * `sort=distance` 라 첫 건이 최근접이므로 거리는 `size=1` 로도 그대로 얻는다.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {string} keyword
 * @param {number} radius
 * @returns {Promise<{ count: number, nearest: KakaoPlaceItem | null }>}
 */
export async function searchKakao(lat, lng, keyword, radius) {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=1`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  const data = /** @type {KakaoPlacesResponse} */ (await res.json());
  const docs = data.documents || [];
  return { count: data.meta?.total_count ?? docs.length, nearest: docs[0] ?? null };
}

/**
 * @param {number} lat
 * @param {number} lng
 * @param {string} categoryCode
 * @param {number} radius
 * @returns {Promise<KakaoPlaceItem[]>}
 */
async function searchKakaoCategory(lat, lng, categoryCode, radius) {
  const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=${categoryCode}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=5`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  const data = /** @type {KakaoPlacesResponse} */ (await res.json());
  return data.documents || [];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const forceAll = process.argv.includes("--force");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  // 세션534: 무정렬 OFFSET → 고유키(id) 커서 (unordered-pagination-loses-rows.md §1).
  const apts = /** @type {InfraAptRow[]} */ (/** @type {unknown} */ (
    await selectAll((s) => s.from("apartments").select("id, name, lat, lng"), sb, "id")
  ));

  const withCoords = apts.filter(a => a.lat && a.lng);
  let targets = withCoords;
  let freshCount = 0;
  if (!forceAll) {
    const infraRows = /** @type {Record<string, unknown>[]} */ (
      await selectAll((s) => s.from("infra").select(
        ["apartment_id", "updated_at", "subway_dist", ...CATEGORIES.map((c) => c.key)].join(", "),
      ), sb, "apartment_id") // infra 는 apartment_id 가 PK
    );
    const freshIds = buildFreshIds(infraRows);
    freshCount = freshIds.size;
    targets = withCoords.filter(a => !freshIds.has(a.id));
    log(PHASE, `전체 ${withCoords.length}건 중 ${freshCount}건 최신(${FRESH_DAYS}일 이내·완결) 건너뜀`);
  }
  log(PHASE, `대상: ${targets.length}건 (좌표 있음)`);

  const rpt = createReporter(PHASE);  // 세션 327: SIGTERM 핸들러 등록을 loop 이전으로 이동 (이전에는 loop 끝난 뒤 호출되어 등록 0회)
  // 신선도로 건너뛴 건을 skip 으로 기록 — 전량 최신인 날 ok=0 이어도 monitor ② 의
  // "success 인데 ok=0 && skip=0" 빈성공 오탐이 안 나게 한다 (notify-subscribers 선례 답습).
  if (freshCount > 0) rpt.skip(freshCount);
  // 세션599: 오류(카카오·upsert)는 skip 이 아니라 errored 로 따로 센다 — 끝에서 비율로 fail/skip 을 가른다.
  let updated = 0, errored = 0;

  /**
   * @param {InfraAptRow} apt
   * @param {number} i
   */
  const processApt = async (apt, i) => sem(async () => {
    try {
      /** @type {Record<string, unknown>} */
      const row = { apartment_id: apt.id, updated_at: new Date().toISOString() };

      for (const cat of CATEGORIES) {
        const { count, nearest } = await searchKakao(Number(apt.lat), Number(apt.lng), cat.keyword, cat.radius);
        row[cat.key] = count;
        row[`${cat.key}_dist`] = nearest ? Math.round(Number(nearest.distance)) : null;
        await sleep(120);
      }

      // 지하철역 검색 (SW8 카테고리, 반경 10km)
      const subways = await searchKakaoCategory(Number(apt.lat), Number(apt.lng), "SW8", 10000);
      const firstSubway = subways[0];
      row.subway_dist = firstSubway ? Math.round(Number(firstSubway.distance)) : 9999;
      await sleep(120);

      if (dryRun) {
        log(PHASE, `  [DRY] ${apt.name}: 병원${row.hospital} 마트${row.mart} 편의점${row.conv} 지하철${row.subway_dist}m`);
        updated++;
        return;
      }

      const { error: uErr } = await sb.from("infra").upsert([row], { onConflict: "apartment_id" });
      if (uErr) { logError(PHASE, `${apt.name}: ${uErr.message}`); errored++; }
      else updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `${apt.name}: ${msg}`);
      errored++;
    }

    if ((i + 1) % 30 === 0) log(PHASE, `진행: ${i + 1}/${targets.length} (갱신 ${updated})`);
  });

  // 배치 단위 병렬 실행 (동시 5건)
  const BATCH = 30;
  for (let b = 0; b < targets.length; b += BATCH) {
    if (rpt.interrupted()) break;  // 세션 327: graceful shutdown (SIGTERM 받으면 다음 배치 전 중단)
    const batch = targets.slice(b, b + BATCH);
    await Promise.all(batch.map((apt, j) => processApt(apt, b + j)));
  }

  rpt.success(updated);
  // 오류가 시도의 절반 이상이면 실패로 센다(→ status failure · exit 1). 그 아래는 옛 동작대로 skip(세션599).
  const errFailN = errorFailCount({ ok: updated, err: errored });
  if (errFailN > 0) rpt.fail(errFailN);
  else rpt.skip(errored);
  log(PHASE, `갱신 ${updated} · 오류 ${errored} (${errFailN > 0 ? "실패" : "skip"}로 셈)`);
  const result = rpt.summary();
  await recordCollectorRun(PHASE, result);
  if (result.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });
