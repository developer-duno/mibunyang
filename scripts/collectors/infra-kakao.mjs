// @ts-check
/**
 * 인프라 시설 수집기 — Kakao Places 기반
 *
 * 병원, 마트, 편의점, 카페, 문화시설, 은행, 약국, 공원, 지하철 거리
 *
 * 사용법:
 *   node scripts/collectors/infra-kakao.mjs              (Supabase UPDATE)
 *   node scripts/collectors/infra-kakao.mjs --dry-run    (DB 에 안 씀 — ⚠️ 카카오는 실제로 부른다: 회차당 최대 800×9 = 7,200콜.
 *                                                         시계를 안 쓰므로 다시 돌리면 같은 800곳을 또 잰다)
 *   node scripts/collectors/infra-kakao.mjs --max-apts=N (한 회차 최대 N단지, kakao_updated_at 오래된 순 · 기본 800 — 세션679)
 *   node scripts/collectors/infra-kakao.mjs --force --max-apts=N (신선도 무시하고 오래된 순 N단지 재수집)
 *     --force 는 --max-apts 와 함께만 — 단독이면 시작에서 던진다(전량 약 31,000콜 방지 · 세션681)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep, createReporter, recordCollectorRun, createSemaphore, selectAll, joinRunMessage } from "./_shared.mjs";

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
 * 시계 = `kakao_updated_at`(이 수집기만 씀 · 세션681). `updated_at` 은 police·childcare·emergency·air-quality·2u 가
 * 올리는 공유 시계(DB 트리거)라 판정에 쓰지 않는다 — 쓰면 남이 찍은 시각으로 「최신」이 되어 재확인이 꺼진다.
 * @param {Record<string, unknown>[]} rows infra 행 (apartment_id, kakao_updated_at, 카테고리 컬럼)
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
    const ts = r.kakao_updated_at ? Date.parse(String(r.kakao_updated_at)) : NaN; // NULL = 잰 적 없음
    if (isNaN(ts) || ts < cutoff) continue;             // 오래됨 → 재수집
    if (REQUIRED_KEYS.some((k) => r[k] == null)) continue; // 미완성 → 재수집
    fresh.add(id);
  }
  return fresh;
}

// ── 한 회차 상한 (세션679 — 사장님 결정 10/31 「한 회차 상한 두기」) ────────────────
// 왜: infra.updated_at 은 공유 시계(DB 트리거가 모든 UPDATE 에 now())라 남의 일괄 UPDATE 한 번에 행들이 같은 초로
//   묶인다. 2026-10-31 실측 3,440행 중 3,255행이 2026-10-18T13:59:24Z — 30일 뒤 정기 회차(KST 11/20 05:30) 한 번에
//   3,264단지 × 9콜 ≈ 29,376 카카오 콜이 몰리고, 그 뒤로도 30일마다 같은 몰림이 되풀이된다.
// N = 800 근거(.omc/artifacts/session679/transition-b2.md ②-b):
//   - 회차 = 화·금 KST 05:30(collect-naver-listings-incremental.yml, 주 2회) · 단지당 9콜 · 단지당 약 0.7초(동시 5,
//     10/29 run 86단지 60초) → 800단지 ≈ 9~10분 · 7,200콜. 같은 job(240분)을 transport·schools(최근 101~140분)와 나눠 쓴다.
//   - 몰림 3,264곳 → 800·800·800·800·64 = 5회차 ≈ 2.5주에 흩어짐(「2~3주」).
//   - 평시 처리량: 30일에 회차 약 8.6번 × 800 = 약 6,880단지 — 지금 3,440단지의 두 배라 밀림이 쌓이지 않는다.
// 고르는 순서: ① 한 번도 못 채운 행(infra 행 없음·REQUIRED_KEYS 중 빈칸) ② kakao_updated_at 오래된 순(NULL = 맨 앞) ③ id.
//   처리한 행은 kakao_updated_at 이 지금으로 바뀌어 뒤로 가므로, 이번에 못 고른 행은 다음 회차 맨 앞에 온다(굶주림 없음).
//   updated_at 은 police·childcare·emergency·air-quality·2u 가 올리는 공유 시계라 쓰지 않는다(세션681 · 마이그 20261101000000).
// --force(신선도 무시)는 --max-apts 와 함께만 — 단독이면 resolveMaxApts 가 던진다(전량 약 31,000콜 방지 · 세션681).
export const DEFAULT_MAX_APTS = 800;
/** 이번 회차에 상한으로 다음 회차로 넘긴 단지 수 — collector_runs.error_message 표식(status 는 그대로) */
export const INFRA_DEFERRED_MARKER = "INFRA_DEFERRED=";

/**
 * `--max-apts=<N>` 을 읽는다. 없으면 null. 양의 정수가 아니면 던진다(오타로 상한이 조용히 풀리지 않게).
 * @param {string[]} argv
 * @returns {number | null}
 */
export function parseMaxApts(argv) {
  const hits = argv.filter((a) => a === "--max-apts" || a.startsWith("--max-apts="));
  if (hits.length === 0) return null;
  if (hits.length > 1) throw new Error("--max-apts 는 한 번만 줄 수 있다");
  const raw = hits[0].slice("--max-apts=".length);
  if (hits[0] === "--max-apts" || !/^[1-9]\d*$/.test(raw)) throw new Error(`--max-apts=<양의 정수> 형식이어야 한다: ${hits[0]}`);
  return Number(raw);
}

/**
 * 이번 회차 상한을 정한다. `--max-apts` 없으면 DEFAULT_MAX_APTS. `--force` 는 `--max-apts` 와 함께만
 * (단독이면 던진다 — 운영자가 `--force` 만 쳐서 상한 없이 전량이 나가는 길을 닫는다 · 세션681).
 * @param {string[]} argv
 * @returns {{ force: boolean, maxApts: number }}
 */
export function resolveMaxApts(argv) {
  const force = argv.includes("--force");
  const maxArg = parseMaxApts(argv);
  if (force && maxArg == null) throw new Error("--force 는 --max-apts=<N> 과 함께만(전량 31,000콜 방지)");
  return { force, maxApts: maxArg ?? DEFAULT_MAX_APTS };
}

/**
 * 이번 회차에 카카오로 잴 단지를 고른다(순수 함수).
 * @param {InfraAptRow[]} withCoords 좌표 있는 단지
 * @param {Record<string, unknown>[]} infraRows infra 행 (apartment_id, kakao_updated_at, REQUIRED_KEYS)
 * @param {{ nowMs?: number, maxApts?: number | null, force?: boolean }} [opts] maxApts null = 상한 없음
 * @returns {{ targets: InfraAptRow[], freshCount: number, deferred: number }}
 */
export function selectInfraTargets(withCoords, infraRows, opts = {}) {
  const { nowMs = Date.now(), maxApts = null, force = false } = opts;
  const freshIds = force ? new Set() : buildFreshIds(infraRows, nowMs);
  /** @type {Map<string, Record<string, unknown>>} */
  const rowById = new Map();
  for (const r of infraRows || []) if (typeof r?.apartment_id === "string") rowById.set(r.apartment_id, r);
  /** @param {InfraAptRow} a */
  const rank = (a) => {
    const r = rowById.get(a.id);
    return !r || REQUIRED_KEYS.some((k) => r[k] == null) ? 0 : 1;
  };
  /** @param {InfraAptRow} a */
  const tsOf = (a) => {
    const v = rowById.get(a.id)?.kakao_updated_at; // 공유 시계 updated_at 이 아니라 카카오 시계(세션681)
    const t = v ? Date.parse(String(v)) : NaN;
    return isNaN(t) ? -Infinity : t;
  };
  const cands = withCoords.filter((a) => !freshIds.has(a.id));
  cands.sort((a, b) => rank(a) - rank(b) || tsOf(a) - tsOf(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const targets = maxApts == null ? cands : cands.slice(0, maxApts);
  return { targets, freshCount: freshIds.size, deferred: cands.length - targets.length };
}

/**
 * 관찰용 시계 통계(세션681 · 로그만): 공유 시계 updated_at 이 days 안인 행 수 · kakao_updated_at 이 NULL 인 행 수.
 * 남이 updated_at 을 얼마나 자주 덮어쓰는지 보려는 것 — 판정·정렬엔 안 쓴다.
 * @param {Record<string, unknown>[]} rows
 * @param {number} [nowMs]
 * @param {number} [days]
 * @returns {{ sharedFresh: number, kakaoNull: number }}
 */
export function countClockStats(rows, nowMs = Date.now(), days = FRESH_DAYS) {
  const cutoff = nowMs - days * 86400000;
  let sharedFresh = 0, kakaoNull = 0;
  for (const r of rows || []) {
    const t = r?.updated_at ? Date.parse(String(r.updated_at)) : NaN;
    if (!isNaN(t) && t >= cutoff) sharedFresh++;
    if (r?.kakao_updated_at == null) kakaoNull++;
  }
  return { sharedFresh, kakaoNull };
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
  const data = assertKakaoShape(await res.json(), keyword);
  const docs = data.documents;
  return { count: data.meta?.total_count ?? docs.length, nearest: docs[0] ?? null };
}

/**
 * 카카오 응답 모양 검사(세션681). `meta` 가 객체가 아니거나 `documents` 가 배열이 아니면 던진다 —
 * 모양이 깨진 응답(한도·장애 의심)을 「0건」으로 덮어쓰지 않게(그 단지는 errored → 옛 값 유지).
 * 정상 0건(`documents: []`, `meta.total_count: 0`)은 그대로 통과.
 * @param {unknown} data
 * @param {string} what 오류 문구에 넣을 질의(키워드·카테고리 코드)
 * @returns {KakaoPlacesResponse}
 */
export function assertKakaoShape(data, what) {
  const d = /** @type {Record<string, unknown> | null} */ (data && typeof data === "object" ? data : null);
  if (!d || !d.meta || typeof d.meta !== "object" || Array.isArray(d.meta) || !Array.isArray(d.documents)) {
    throw new Error(`카카오 응답 모양 깨짐 (${what}): meta·documents 없음 — 한도·장애 의심`);
  }
  return /** @type {KakaoPlacesResponse} */ (/** @type {unknown} */ (d));
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
  return assertKakaoShape(await res.json(), categoryCode).documents;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  // 세션679: 한 회차 상한 — 인자 없으면 기본 DEFAULT_MAX_APTS · 세션681: --force 는 --max-apts 와 함께만(단독이면 던짐)
  const { force: forceAll, maxApts } = resolveMaxApts(process.argv);
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  // 세션534: 무정렬 OFFSET → 고유키(id) 커서 (unordered-pagination-loses-rows.md §1).
  const apts = /** @type {InfraAptRow[]} */ (/** @type {unknown} */ (
    await selectAll((s) => s.from("apartments").select("id, name, lat, lng"), sb, "id")
  ));

  const withCoords = apts.filter(a => a.lat && a.lng);
  // 세션679: --force 여도 읽는다 — 상한을 걸면 오래된 순으로 골라야 해서
  // 세션681: 판정·정렬 시계 = kakao_updated_at. updated_at 은 남의 시계 관찰 로그용으로만 읽는다(판정·정렬엔 안 씀).
  const infraRows = /** @type {Record<string, unknown>[]} */ (
    await selectAll((s) => s.from("infra").select(
      ["apartment_id", "updated_at", "kakao_updated_at", "subway_dist", ...CATEGORIES.map((c) => c.key)].join(", "),
    ), sb, "apartment_id") // infra 는 apartment_id 가 PK
  );
  const { targets, freshCount, deferred } = selectInfraTargets(withCoords, infraRows, { maxApts, force: forceAll });
  if (!forceAll) log(PHASE, `전체 ${withCoords.length}건 중 ${freshCount}건 최신(${FRESH_DAYS}일 이내·완결) 건너뜀`);
  log(PHASE, `대상: ${targets.length}건 (좌표 있음 · 오래된 순) · 이번 상한 ${maxApts ?? "무제한"} · 다음 회차로 넘김 ${deferred}건`);
  const clock = countClockStats(infraRows);
  log(PHASE, `남의 시계(updated_at) 최신 ${FRESH_DAYS}일 안 ${clock.sharedFresh}행 / kakao 시계 NULL ${clock.kakaoNull}행 (관찰용)`);

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
      // updated_at 직접 쓰기는 효과 없음(INSERT 는 DEFAULT NOW · UPDATE 는 트리거) — ownership 기준선 유지용 · 시계는 kakao_updated_at
      const now = new Date().toISOString();
      /** @type {Record<string, unknown>} */
      const row = { apartment_id: apt.id, updated_at: now, kakao_updated_at: now };

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
  const summary = rpt.summary();
  // 세션679: 상한으로 넘긴 수는 조용히 버리지 않고 기록에 남긴다(data-changing-run-approval §4 — skip 칸이 아니라 표식)
  const result = deferred > 0
    ? { ...summary, errorMessage: joinRunMessage(undefined, `${INFRA_DEFERRED_MARKER}${deferred}`) }
    : summary;
  await recordCollectorRun(PHASE, result);
  if (result.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
// 세션681: 시작도 못 한 회차(select 실패·칸 없음·인자 오류)도 collector_runs 에 failure 1행을 남긴다 → 감시 ⑬ 이 다음 날 잡는다.
//   기록 실패는 다시 던지지 않는다(recordCollectorRun 이 안에서 로그만 남김 · 그래도 던지면 삼킨다).
if (isCLI) main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  logError(PHASE, msg);
  try { await recordCollectorRun(PHASE, { ok: 0, fail: 1, skip: 0, errorMessage: msg }); }
  catch (e) { logError(PHASE, `실패 기록도 실패: ${e instanceof Error ? e.message : String(e)}`); }
  process.exit(1);
});
