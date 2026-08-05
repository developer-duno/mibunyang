// @ts-check
/**
 * 혐오시설 수집기 — Kakao 키워드 검색 기반
 *
 * 사용법:
 *   node scripts/collectors/noxious.mjs              (Supabase 업데이트)
 *   node scripts/collectors/noxious.mjs --dry-run    (미리보기만)
 *   node scripts/collectors/noxious.mjs --json       (apartments.json 직접 업데이트)
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { spawnSync } from "node:child_process";
import {
  loadEnv,
  getSupabase,
  log,
  logError,
  fetchWithRetry,
  sleep,
  ROOT,
  haversineMeters,
  createReporter,
  recordCollectorRun,
} from "./_shared.mjs";

const PHASE = "noxious";

loadEnv();

// ── 혐오시설 카테고리 및 키워드 ─────────────────────────────
const NOXIOUS_KEYWORDS = [
  { keyword: "소각장", category: "소각장" },
  { keyword: "하수처리장", category: "하수처리장" },
  { keyword: "폐수처리장", category: "폐수처리장" },
  { keyword: "쓰레기매립지", category: "매립지" },
  { keyword: "장례식장", category: "장례식장" },
  { keyword: "화장장", category: "화장장" },
  { keyword: "교도소", category: "교도소" },
  { keyword: "변전소", category: "고압선" },
  { keyword: "축산농장", category: "축산시설" },
  { keyword: "가축시장", category: "축산시설" },
  { keyword: "공장단지", category: "공장" },
];

const SEARCH_RADIUS = 2000; // 2km 반경 검색

/**
 * @typedef {Object} KakaoPlaceItem
 * @property {string} place_name
 * @property {string} y
 * @property {string} x
 * @property {string} [distance]
 */

/**
 * @typedef {Object} NoxiousPlace
 * @property {string} name
 * @property {number} lat
 * @property {number} lng
 * @property {number} dist
 */

/**
 * @typedef {Object} NoxiousAptRow
 * @property {string} id
 * @property {string} [name]
 * @property {number|null} [lat]
 * @property {number|null} [lng]
 * @property {string[]|null} [noxious]
 * @property {number|null} [noxious_dist]
 */

// ── Haversine 거리 (m) ──────────────────────────────────────
const haversineM = haversineMeters;

// ── Kakao 키워드 검색 ───────────────────────────────────────
/**
 * @param {number} lat
 * @param {number} lng
 * @param {string} keyword
 * @returns {Promise<NoxiousPlace[]>}
 */
async function searchNearby(lat, lng, keyword) {
  const kakaoKey = process.env.KAKAO_KEY;
  if (!kakaoKey) throw new Error("KAKAO_KEY 필요");

  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&x=${lng}&y=${lat}&radius=${SEARCH_RADIUS}&sort=distance&size=5`;
  const res = await fetchWithRetry(url, {
    headers: { Authorization: `KakaoAK ${kakaoKey}` },
  });
  const data = /** @type {{ documents?: KakaoPlaceItem[] }} */ (await res.json());
  return (data.documents || []).map((/** @type {KakaoPlaceItem} */ d) => ({
    name: d.place_name,
    lat: Number(d.y),
    lng: Number(d.x),
    dist: Number(d.distance) || haversineM(lat, lng, Number(d.y), Number(d.x)),
  }));
}

// ── 순수 함수 (세션 491 — 회귀 가드용으로 main 에서 분리) ──────────

/**
 * 증분 수집 대상 추림.
 *
 * `noxious == null` 만 미조회로 본다. 빈 배열(`[]`)은 "조회했고 없음"이라 건너뛴다.
 * ⚠️ `=== null` 로 좁히면 `undefined` 가 새어나가 매번 재조회된다 — `== null` 이 맞다.
 *
 * @param {NoxiousAptRow[]} withCoords 좌표가 있는 단지 목록
 * @param {boolean} [force] true 면 전량 재수집 (--force)
 * @returns {NoxiousAptRow[]}
 */
export function selectNoxiousTargets(withCoords, force = false) {
  if (force) return withCoords;
  return withCoords.filter((a) => a.noxious == null);
}

/**
 * 저장할 행을 만든다.
 *
 * 발견 0건도 빈 배열로 기록해 "조회했고 없음"과 "아직 안 함"을 구분한다 —
 * 이게 있어야 다음 회차에 건너뛸 수 있다.
 *
 * @param {string} id 단지 id
 * @param {string[]} found 발견된 혐오시설 카테고리
 * @param {number} minDist 최근접 거리(m). 발견 0건이면 Infinity 가 들어온다.
 * @returns {{id: string, noxious: string[], noxious_dist: number | null}}
 */
export function buildNoxiousRow(id, found, minDist) {
  const hasFinding = found.length > 0 && Number.isFinite(minDist);
  return {
    id,
    noxious: found,
    noxious_dist: hasFinding ? Math.round(minDist) : null,
  };
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const jsonMode = process.argv.includes("--json");
  const force = process.argv.includes("--force");

  // 세션 491: 루프 이전에 등록해야 SIGTERM 핸들러가 붙는다 (loop 뒤에 만들면 graceful 효과 0).
  const rpt = createReporter(PHASE);

  if (!process.env.KAKAO_KEY) {
    logError("noxious", "KAKAO_KEY 환경변수가 필요합니다");
    process.exit(1);
  }

  // 1. 아파트 데이터 로드
  /** @type {NoxiousAptRow[]} */
  let apartments;
  /** @type {Record<string, unknown> | null} */
  let rawWrapper = null;
  if (jsonMode) {
    const jsonPath = resolve(ROOT, "public/data/apartments.json");
    const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
    rawWrapper = raw;
    apartments = Array.isArray(raw.data) ? raw.data : (Array.isArray(raw) ? raw : []);
    log("load", `apartments.json: ${apartments.length}건`);
  } else {
    const sb = getSupabase();
    const PAGE_SIZE = 1000;
    /** @type {NoxiousAptRow[]} */
    const acc = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await sb.from("apartments").select("id, name, lat, lng, noxious, noxious_dist").range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`Supabase 조회 실패: ${error.message}`);
      if (!data || data.length === 0) break;
      acc.push(.../** @type {NoxiousAptRow[]} */ (/** @type {unknown} */ (data)));
      if (data.length < PAGE_SIZE) break;
    }
    apartments = acc;
    log("load", `Supabase apartments: ${apartments.length}건`);
  }

  const withCoords = apartments.filter((/** @type {NoxiousAptRow} */ a) => a.lat && a.lng);
  log("filter", `좌표 있는 아파트: ${withCoords.length}/${apartments.length}건`);

  // 세션 491 — 증분 수집. 이전에는 매번 전 단지(2,165건)를 다시 조회했다.
  // 단지당 키워드 11개 × (검색 + 0.1초 쉼) ≈ 2.9초 → 전수 105분인데 워크플로 제한은 60분이라
  // **매 실행이 60분을 태우고 저장 직전에 SIGKILL** 됐다(3개월 연속 쓰기 0건).
  // noxious == null = 아직 한 번도 조회 안 함. 빈 배열([]) = 조회했고 없음(아래에서 기록).
  // 혐오시설(소각장·장례식장·변전소)은 달 단위로 바뀌지 않아 재조회 가치가 없다.
  const targets = selectNoxiousTargets(withCoords, force);
  const skippedCount = withCoords.length - targets.length;
  if (skippedCount > 0) {
    rpt.skip(skippedCount);
    log("filter", `조회 대상 ${targets.length}건 (이미 조회한 ${skippedCount}건 건너뜀 — 전량 재수집은 --force)`);
  }

  // 2. 각 아파트 주변 혐오시설 검색 (단지 1건 처리할 때마다 즉시 저장)
  /** @type {{id: string, noxious: string[], noxious_dist: number | null}[]} */
  const updates = [];
  // 세션 491: 루프 안에서 바로 쓰기 위해 클라이언트를 미리 잡는다.
  // jsonMode 는 파일 전체를 마지막에 한 번 쓰므로 즉시 저장 대상이 아니다.
  const sbWrite = jsonMode || dryRun ? null : getSupabase();
  let searched = 0;

  for (const apt of targets) {
    // 세션 491: SIGTERM(수동 취소) 시 다음 단지로 넘어가지 않고 여기서 끊는다.
    // 이미 처리한 단지는 아래 즉시 저장으로 이미 DB 에 들어가 있다.
    if (rpt.interrupted()) break;

    /** @type {string[]} */
    const found = [];
    let minDist = Infinity;

    for (const { keyword, category } of NOXIOUS_KEYWORDS) {
      try {
        const results = await searchNearby(Number(apt.lat), Number(apt.lng), keyword);
        for (const r of results) {
          if (!found.includes(category)) found.push(category);
          if (r.dist < minDist) minDist = r.dist;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError("search", `${apt.name} "${keyword}": ${msg}`);
      }
      await sleep(100); // API rate limit 보호
    }

    searched++;
    if (searched % 50 === 0) {
      log("progress", `${searched}/${targets.length}건 검색 완료`);
    }

    // 세션 491: 발견 0건도 빈 배열로 기록한다 — "조회했고 없음"과 "아직 안 함"을 구분해야
    // 다음 회차에 건너뛸 수 있다. 점수(scoreLocation.ts:116)·화면(AptCard.tsx:98) 모두
    // `(noxious || [])` 로 읽으므로 null → [] 로 바뀌어도 표시·점수 영향은 0 (실측 확인).
    const row = buildNoxiousRow(apt.id, found, minDist);
    updates.push(row);

    // 세션 491: 단지 1건마다 즉시 저장. 루프를 다 돌아야 저장하던 구조는
    // timeout SIGKILL(유예 0)에 걸려 매 실행이 전량 손실이었다.
    if (sbWrite) {
      const { error } = await sbWrite
        .from("apartments")
        .update({ noxious: row.noxious, noxious_dist: row.noxious_dist })
        .eq("id", apt.id);
      if (error) {
        logError("upsert", `${apt.id}: ${error.message}`);
        rpt.fail();
      } else {
        rpt.success();
      }
    }
  }

  const foundCount = updates.filter((u) => u.noxious.length > 0).length;
  log("result", `혐오시설 발견 ${foundCount}건 / 조회 완료 ${updates.length}건`);

  if (dryRun) {
    log("dry-run", "미리보기 모드 — 업데이트 생략");
    const withFinding = updates.filter((u) => u.noxious.length > 0);
    for (const u of withFinding.slice(0, 30)) {
      const apt = apartments.find((/** @type {NoxiousAptRow} */ a) => a.id === u.id);
      console.log(`  ${apt?.name || u.id}: ${u.noxious.join(", ")} (최근접 ${u.noxious_dist}m)`);
    }
    if (withFinding.length > 30) console.log(`  ... 외 ${withFinding.length - 30}건`);
  } else if (jsonMode) {
    const aptMap = new Map(apartments.map((/** @type {NoxiousAptRow} */ a) => [a.id, a]));
    for (const u of updates) {
      const apt = aptMap.get(u.id);
      if (!apt) continue;
      apt.noxious = u.noxious;
      /** @type {Record<string, unknown>} */ (apt).noxiousDist = u.noxious_dist;
    }
    const jsonPath = resolve(ROOT, "public/data/apartments.json");
    const updatedData = [...aptMap.values()];
    writeFileSync(jsonPath, JSON.stringify({ ...rawWrapper, data: updatedData, count: updatedData.length }, null, 2), "utf8");
    log("json", `apartments.json 업데이트 완료 (${updates.length}건)`);

    // split-apartments-json 자동 호출 — prebuild.mjs L11 답습 (ROOT=repo 루트라 scripts/ 명시, 세션 468)
    const splitScript = resolve(ROOT, "scripts", "split-apartments-json.mjs");
    const splitResult = spawnSync(process.execPath, [splitScript], { stdio: "inherit", env: process.env });
    if (splitResult.status !== 0) logError("split", "split-apartments-json 실패 — apartments-list.json 수동 갱신 필요");
    rpt.success(updates.length);
  }
  // 세션 491: Supabase 모드는 위 루프에서 단지마다 이미 저장했다.
  // (이전에는 여기서 일괄 저장했고, 그래서 timeout 시 전량 손실됐다.)

  const result = rpt.summary();
  await recordCollectorRun(PHASE, result);
}

// CLI 직접 실행 시에만 main() 호출 (테스트 환경 보호)
const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });

// 테스트용 순수 함수 export
export { haversineM };
