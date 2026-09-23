// @ts-check
/**
 * 초등학교 도보거리 계산기
 *
 * schools.nearby_schools JSON에서 가장 가까운 초등학교까지의
 * 도보 시간(분)을 계산하여 apartments.naver_school_walk_min에 저장.
 *
 * 세션566 정정 (사장님 결정 2026-09-23):
 *   1) `schools` 를 무정렬 `.select()` 로 읽어 PostgREST 1,000행 컷에 걸렸다(전체 3,068건 중
 *      1,000건만 봄) → 770곳이 실제로 1km 내 초등학교가 있는데도 null(중립 0점) 처리,
 *      324곳은 stale 값. selectAll 커서 페이징으로 정정
 *      (.claude/rules/collectors/unordered-pagination-loses-rows.md §1).
 *   2) `schools-neis.mjs` 의 초등학교 탐색 반경이 1,000m 라 도보분은 ceil(1000/70)=15분이
 *      상한이었고, SCHOOL_WALK_BONUS/FAR_ADJ(scoringTiers.ts) 의 16~20분(-5)·20분초과(-10)
 *      구간이 죽어 있었다. 1km 안에 초등학교가 없는 163곳(라이브 카카오 실측으로 137곳은
 *      2km 안, 26곳은 2.0~3.4km 안에 있음 확인)에 한해 카카오로 더 넓게(5km) 재탐색해
 *      진짜 최근접 초등학교의 실제 도보분을 저장한다. `schools.nearby_schools`(학군 원점수의
 *      재료)와 학군 점수 자체는 건드리지 않는다 — 이 수집기는 naver_school_walk_min 전용.
 *   가짜/센티널 분 값은 절대 저장하지 않는다(화면에 "초등 도보 {N}분"으로 그대로 노출됨,
 *   src/components/detail/SchoolInfo.tsx:99) — 못 찾으면 그 단지는 건너뛴다(skip).
 *
 * 세션567 추가 정정 (사장님 결정 2026-09-23):
 *   3) 카카오 keyword.json "초등학교" 응답의 이름 화이트리스트(isSchoolPlace)는 "…초등학교"로
 *      끝나야 통과하는데, 실제로는 "인천영종초등학교 금산분교장"처럼 **분교장**이 category_name
 *      "교육,학문 > 학교 > 초등학교"로 정상 분류되면서도 이름 끝이 "분교장"이라 버려지고 있었다.
 *      판정을 `isSchoolPlace`(이름) → `isElementarySchoolDoc`(이름+분류, `_school-place.mjs`
 *      공유)로 바꿔 분교장을 포함하되, "미단초중학교 (2028년 3월 예정)"처럼 개교 예정인 곳은
 *      제외한다(사장님 결정 — 아직 없는 학교로 도보분을 매기지 않는다).
 *   4) `apartments.coord_shared = true`(좌표가 남의 단지와 공유돼 부정확함, 세션560) 인 단지는
 *      가짜 좌표에서 잰 도보분을 저장하면 안 되므로, 이번 재계산에서 카카오 조회 자체를
 *      건너뛰고 기존 저장값을 null 로 비운다. 좌표가 정정돼 그 표시가 꺼지면 다음 정기 실행이
 *      자동으로 다시 채운다(별도 백필 불필요 — 이 수집기는 좌표만 보고 대상을 정하므로).
 *
 * 세션 511: transit-match.mjs 와 똑같은 사고 — 이 수집기를 실행하는 워크플로가 0건이라
 * collector_runs 행이 안 생겼다(createReporter 는 있었지만 recordCollectorRun 호출이 없었음).
 * audit-orphan-collectors.mjs 가 잡아 라이브 실측(2026-03 73.9% → 2026-04 이후 0%)까지 확인됨.
 *
 * 사용법:
 *   node scripts/collectors/calc-school-walk.mjs              (Supabase UPDATE)
 *   node scripts/collectors/calc-school-walk.mjs --dry-run    (미리보기만)
 *
 * 필요 환경변수:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, KAKAO_KEY(2km+ lookup 용 — 없으면 direct만 처리)
 */
import {
  loadEnv,
  getSupabase,
  log,
  logError,
  createReporter,
  recordCollectorRun,
  selectAll,
  fetchWithRetry,
  sleep,
  createSemaphore,
} from "./_shared.mjs";
import { isSchoolPlace, isElementarySchoolDoc } from "./_school-place.mjs";
loadEnv();

// 세션567: 학교명 판정은 이제 `_school-place.mjs` 가 진실의 원천이다. 이 파일 안에서
// 계속 쓰기 위해서만이 아니라, 다른 파일이 이 모듈의 `isSchoolPlace` 를 import 하는 경우를
// 위해 재수출한다(세션566까지는 로컬 복제본이었다).
export { isSchoolPlace };

const PHASE = "school-walk";
const WALK_SPEED = 70; // m/분 (어린이 도보 속도)
const KAKAO_KEY = process.env.KAKAO_KEY;
const LOOKUP_RADIUS_M = 5000; // schools-neis.mjs 의 1,000m 보다 넓게 — 진짜 최근접을 찾기 위함
const LOOKUP_SLEEP_MS = 100;

// ── 재척도 거울값 (schools-neis.mjs RESCALE_ANCHORS_MIRROR 관례 답습) ──────────
// `.mjs` 는 `src/constants/scoringTiers.ts` 를 import 할 수 없어 dry-run 표시용으로만 값을
// 복제한다(실제 점수 계산은 하지 않음 — src/scoring/scoreLocation.ts 가 진실의 원천).
// 진실의 원천은 그 파일이고, 여기선 dry-run 가산점 구간 라벨링에만 쓴다.
// ⚠️ 원본과 한 칸이라도 어긋나면 calc-school-walk.test.mjs "거울 사본 동기화" 가 red 를 낸다(세션566).
export const SCHOOL_WALK_BONUS_MIRROR = [
  { max: 5, score: 10 },
  { max: 10, score: 5 },
  { max: 15, score: 0 },
  { max: 20, score: -5 },
];
export const SCHOOL_WALK_FAR_ADJ_MIRROR = -10;

/**
 * 초등학교 필터 + 최소 거리 찾기
 * @param {Array<{ type: string, distance: number }> | null | undefined} nearbySchools
 * @returns {number | null}
 */
export function findNearestElemSchool(nearbySchools) {
  if (!Array.isArray(nearbySchools) || nearbySchools.length === 0) return null;
  const elementary = nearbySchools.filter(s => s.type === "초" && s.distance > 0);
  if (elementary.length === 0) return null;
  return Math.min(...elementary.map(s => s.distance));
}

/**
 * 거리(m) → 도보 시간(분)
 * @param {number | null | undefined} distanceM
 * @param {number} [walkSpeed]
 * @returns {number | null}
 */
export function calcWalkingMinutes(distanceM, walkSpeed = WALK_SPEED) {
  if (!distanceM || distanceM <= 0 || !walkSpeed || walkSpeed <= 0) return null;
  return Math.ceil(distanceM / walkSpeed);
}

/**
 * 카카오 키워드 검색 결과(초등학교) 중 진짜 학교만 걸러 최소 거리를 찾는다.
 * `_school-place.mjs` 의 `isElementarySchoolDoc`(이름+분류, 분교장 포함·개교 예정 제외)을
 * 쓴다 — "행복초등학교앞 정류장" 같은 비학교 POI, 병설유치원 등을 걸러내면서도 세션567부터는
 * "…금산분교장"처럼 이름이 "학교"로 끝나지 않는 분교장을 분류로 구제한다.
 * @param {Array<Record<string, any>>} docs Kakao keyword.json documents
 * @returns {number | null} 최소 거리(m), 없으면 null
 */
export function nearestElemFromKakaoDocs(docs) {
  if (!Array.isArray(docs) || docs.length === 0) return null;
  const valid = docs.filter(d => isElementarySchoolDoc(d) && Number(d?.distance) > 0);
  if (valid.length === 0) return null;
  return Math.min(...valid.map(d => Number(d.distance)));
}

/**
 * schools/apartments 스냅샷을 세 그룹으로 나눈다:
 *   - direct: nearby_schools 안에 이미 초등학교가 있어 즉시 도보분을 계산할 수 있는 단지
 *   - needLookup: nearby_schools 에 초등학교가 없어 카카오로 더 넓게 찾아야 하는 단지
 *     (좌표가 없으면 목록에서 제외 — 조회할 수단이 없음)
 *   - clear: `coord_shared === true`(좌표가 남의 단지와 공유돼 부정확함, 세션560) 인 단지.
 *     가짜 좌표에서 잰 값을 저장하면 안 되므로 카카오 조회 없이 곧바로 null 로 비운다
 *     (세션567, 사장님 결정) — direct/needLookup 판정보다 먼저 걸러낸다.
 *
 * @param {{ apartments: Array<{ id: string, lat: number|null, lng: number|null, coord_shared?: boolean|null }>,
 *           schoolsById: Map<string, Array<Record<string, any>>> }} args
 * @returns {{ direct: Array<{ id: string, walkMin: number, minDist: number }>,
 *             needLookup: Array<{ id: string, lat: number, lng: number }>,
 *             clear: Array<{ id: string }> }}
 */
export function planWalkUpdates({ apartments, schoolsById }) {
  /** @type {Array<{ id: string, walkMin: number, minDist: number }>} */
  const direct = [];
  /** @type {Array<{ id: string, lat: number, lng: number }>} */
  const needLookup = [];
  /** @type {Array<{ id: string }>} */
  const clear = [];

  for (const apt of apartments) {
    if (apt.coord_shared === true) {
      clear.push({ id: apt.id });
      continue;
    }
    const nearbySchools = /** @type {Array<{ type: string, distance: number }> | undefined} */ (schoolsById.get(apt.id));
    const minDist = findNearestElemSchool(nearbySchools);
    if (minDist != null) {
      const walkMin = calcWalkingMinutes(minDist);
      if (walkMin != null) {
        direct.push({ id: apt.id, walkMin, minDist });
        continue;
      }
    }
    // nearby_schools 에 초등학교가 없음 (또는 schools 행 자체가 없음) → 좌표 있으면 재탐색 대상
    if (apt.lat != null && apt.lng != null) {
      needLookup.push({ id: apt.id, lat: apt.lat, lng: apt.lng });
    }
  }

  return { direct, needLookup, clear };
}

/**
 * 좌표 주변 5km 안에서 카카오로 초등학교를 재탐색해 도보분을 구한다.
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<number | null>} 도보분(못 찾으면 null)
 */
async function lookupWalkMinByKakao(lat, lng) {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent("초등학교")}&x=${lng}&y=${lat}&radius=${LOOKUP_RADIUS_M}&sort=distance&size=15`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  const data = await res.json();
  const docs = data?.documents || [];
  const minDist = nearestElemFromKakaoDocs(docs);
  return calcWalkingMinutes(minDist);
}

/** 티어 경계로 도보분의 가산점 구간을 라벨링 (dry-run 분포 표시용)
 * @param {number} min
 * @returns {string}
 */
function bonusLabel(min) {
  for (const t of SCHOOL_WALK_BONUS_MIRROR) if (min <= t.max) return `${t.score >= 0 ? "+" : ""}${t.score}`;
  return `${SCHOOL_WALK_FAR_ADJ_MIRROR}`;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");
  if (!KAKAO_KEY) logError(PHASE, "KAKAO_KEY 미설정 — direct 계산만 수행, 재탐색(needLookup)은 스킵합니다");

  const sb = getSupabase();
  const rpt = createReporter(PHASE);

  // 세션566: 무정렬 OFFSET(최대 1,000행) → 고유키 커서 페이징
  // (unordered-pagination-loses-rows.md §1). schools.apartment_id / apartments.id 는 1행=1단지 고유키.
  const schoolRows = /** @type {Array<{ apartment_id: string, nearby_schools: any }>} */ (
    await selectAll((s) => s.from("schools").select("apartment_id,nearby_schools"), sb, "apartment_id")
  );
  const apts = /** @type {Array<{ id: string, lat: number|null, lng: number|null, naver_school_walk_min: number|null, coord_shared: boolean|null }>} */ (
    await selectAll((s) => s.from("apartments").select("id,lat,lng,naver_school_walk_min,coord_shared"), sb, "id")
  );
  log(PHASE, `schools 테이블: ${schoolRows.length}건, apartments 테이블: ${apts.length}건`);

  const schoolsById = new Map(schoolRows.map(r => [r.apartment_id, r.nearby_schools]));
  const { direct, needLookup, clear } = planWalkUpdates({ apartments: apts, schoolsById });
  log(PHASE, `직접 계산: ${direct.length}건, 재탐색 필요: ${needLookup.length}건, 좌표불명(비움 대상): ${clear.length}건`);

  // ── 재탐색(Kakao) ──────────────────────────────────────────
  /** @type {Array<{ id: string, walkMin: number, minDist: number }>} */
  const lookupResults = [];
  let lookupFound = 0, lookupNone = 0;
  if (KAKAO_KEY) {
    for (const apt of needLookup) {
      if (rpt.interrupted()) break;
      try {
        const walkMin = await lookupWalkMinByKakao(apt.lat, apt.lng);
        if (walkMin != null) {
          lookupResults.push({ id: apt.id, walkMin, minDist: walkMin * WALK_SPEED });
          lookupFound++;
        } else {
          lookupNone++;
        }
      } catch (err) {
        logError(PHASE, `${apt.id} 카카오 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
        lookupNone++;
      }
      await sleep(LOOKUP_SLEEP_MS);
    }
  }
  log(PHASE, `재탐색 결과: 찾음 ${lookupFound}건, 없음 ${lookupNone}건`);

  // ── 변경분만 UPDATE 대상으로 (기존 값과 다른 것만) ──────────
  const curById = new Map(apts.map(a => [a.id, a.naver_school_walk_min]));
  const allComputed = [...direct, ...lookupResults];
  const updates = allComputed.filter(u => curById.get(u.id) !== u.walkMin);
  // coord_shared 단지 중 이미 null 인 것은 UPDATE 할 필요가 없다(세션567).
  const clearUpdates = clear.filter(c => curById.get(c.id) != null);

  if (dryRun) {
    log(PHASE, `변경 대상: ${updates.length}건 (직접 ${direct.length} + 재탐색 ${lookupResults.length} 중 기존값과 다른 것), 좌표불명 비움: ${clearUpdates.length}건`);
    // 가산점 구간 분포 (old→new)
    /** @type {Record<string, number>} */
    const tierDist = {};
    for (const u of updates) {
      const oldMin = curById.get(u.id);
      const oldLabel = oldMin == null ? "null" : bonusLabel(oldMin);
      const newLabel = bonusLabel(u.walkMin);
      const key = `${oldLabel}→${newLabel}`;
      tierDist[key] = (tierDist[key] ?? 0) + 1;
    }
    log(PHASE, `가산점 변화 분포: ${Object.entries(tierDist).map(([k, v]) => `${k}(${v})`).join(" · ")}`);

    const sample = updates.slice(0, 10);
    for (const u of sample) {
      log(PHASE, `  [DRY-RUN] apt ${u.id}: ${u.minDist}m → ${u.walkMin}분 (기존 ${curById.get(u.id) ?? "null"})`);
    }
    if (updates.length > sample.length) log(PHASE, `  ... 외 ${updates.length - sample.length}건`);
    const clearSample = clearUpdates.slice(0, 10);
    for (const c of clearSample) {
      log(PHASE, `  [DRY-RUN] apt ${c.id}: 좌표불명 → null (기존 ${curById.get(c.id)}분)`);
    }
    if (clearUpdates.length > clearSample.length) log(PHASE, `  ... 외 ${clearUpdates.length - clearSample.length}건`);
    rpt.success(updates.length + clearUpdates.length);
  } else {
    const limit = createSemaphore(10);
    const CHUNK = 500;
    let ok = 0, fail = 0;
    for (let i = 0; i < updates.length; i += CHUNK) {
      if (rpt.interrupted()) {
        log(PHASE, `중단 신호 — ${ok}건까지 반영하고 멈춥니다`);
        break;
      }
      const results = await Promise.all(
        updates
          .slice(i, i + CHUNK)
          .map(u => limit(() => /** @type {any} */ (sb.from("apartments").update({ naver_school_walk_min: u.walkMin }).eq("id", u.id))))
      );
      // 보낸 수가 아니라 돌아온 결과에서 센다([[count-results-not-sent]] — 세션560 실사고).
      for (const r of results) {
        const err = /** @type {{ error?: { message?: string } | null }} */ (r)?.error;
        if (err) {
          if (!fail) logError(PHASE, `업데이트 실패 예시: ${err.message}`);
          fail++;
        } else ok++;
      }
    }
    // coord_shared 단지는 null 로 비운다 — 별도 루프(값이 다르므로 위 CHUNK 루프와 합칠 수 없음).
    for (let i = 0; i < clearUpdates.length; i += CHUNK) {
      if (rpt.interrupted()) {
        log(PHASE, `중단 신호 — 좌표불명 비움 ${ok}건까지 반영하고 멈춥니다`);
        break;
      }
      const results = await Promise.all(
        clearUpdates
          .slice(i, i + CHUNK)
          .map(c => limit(() => /** @type {any} */ (sb.from("apartments").update({ naver_school_walk_min: null }).eq("id", c.id))))
      );
      for (const r of results) {
        const err = /** @type {{ error?: { message?: string } | null }} */ (r)?.error;
        if (err) {
          if (!fail) logError(PHASE, `좌표불명 비움 실패 예시: ${err.message}`);
          fail++;
        } else ok++;
      }
    }
    rpt.success(ok);
    if (fail) rpt.fail(fail);
  }

  // 0건이어도 기록한다 — 기록이 없으면 "매칭될 게 없어서 0건" 과 "실행 자체가 없었던
  // 것"이 구분되지 않는다(이 수집기가 5개월간 겪은 사고 그 자체, industry-match 답습).
  const result = rpt.summary();
  await recordCollectorRun(PHASE, result);
  log(PHASE, "\n=== 완료 ===");
  // KAKAO_KEY 미설정으로 재탐색을 통째로 못 했으면(needLookup 존재) 부분 실행임을 알리기 위해
  // 실패로 간주해 종료코드를 비정상으로 남긴다 — 침묵한 채 "정상 종료"로 보이지 않게.
  // 단 --dry-run 은 미리보기일 뿐이라 이 조건으로 exit 1 을 내면 안 된다(미리보기가 실패로
  // 보임) — dry-run 에서는 경고 로그만 남기고 넘어간다. 실제 실행(non-dry-run)만 exit 1.
  const partialNoKey = !KAKAO_KEY && needLookup.length > 0;
  if (dryRun && partialNoKey) {
    log(PHASE, `[DRY-RUN] KAKAO_KEY 없음 — 재탐색 ${needLookup.length}곳은 미리보기에서 빠졌다`);
  }
  if (result.fail > 0 || (!dryRun && partialNoKey)) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  logError(PHASE, msg);
  process.exit(1);
});
