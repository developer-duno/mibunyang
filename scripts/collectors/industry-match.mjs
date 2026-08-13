// @ts-check
/**
 * 산업단지 매칭 — **dev_plans**(V-WORLD LT_C_DAMDAN) 기반 최근접 거리 매칭
 *
 * 사용법:
 *   node scripts/collectors/industry-match.mjs              (Supabase 업데이트)
 *   node scripts/collectors/industry-match.mjs --dry-run    (미리보기만)
 *   node scripts/collectors/industry-match.mjs --json       (apartments.json 직접 업데이트)
 *
 * 출처 (세션511 교체): 손으로 적은 시드 `public/data/industry-dev.json`(24건, 2026-03-14 동결)
 * → `dev_plans` 테이블 `kind='industrial_complex'`(618건, V-WORLD 전국 수집).
 * 시드는 수도권에 몰려 있어 **비수도권 단지가 구조적으로 0점**이었다.
 *
 * 출력 형식: `industry_dev = "{단지명} {거리}km"` (최근접 1개).
 * ⚠️ `scoreFuture` 의 `INDUSTRY_DEV_PATTERN` 이 이 형식을 파싱한다 — **바꾸면 양쪽을 같이 고쳐야
 * 한다.** 형식이 어긋나면 점수가 조용히 0이 된다(에러가 아니라 침묵).
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { spawnSync } from "node:child_process";
import { loadEnv, getSupabase, log, logError, ROOT, haversineKm, createReporter, recordCollectorRun } from "./_shared.mjs";

// 세션 504: 매월 도는데 collector_runs 행이 0개라 감시 사각이었다.
const PHASE = "industry-match";

/**
 * 매칭 반경(km). 채점 등급(`INDUSTRY_DIST_TIERS`)의 마지막 칸이 5km 라 그 밖은 어차피 0점이다.
 * 옛 시드는 단지마다 `radius` 를 따로 들고 있었는데(기본 10km), 그러면 "왜 이 단지는 8km 도
 * 잡히고 저 단지는 6km 에서 잘리나"를 설명할 수 없다 — 하나의 반경으로 통일한다.
 */
const MATCH_RADIUS_KM = 5;

loadEnv();

export const haversine = haversineKm;

/**
 * @typedef {{ name: string; type: string; lat: number; lng: number; radius?: number }} IndustryComplex
 * @typedef {{ id: string; name: string | null; lat: number | null; lng: number | null; industry_dev?: string | null; industryDev?: string | null }} IndustryApt
 */

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  // 리포터는 반드시 루프 이전에 — 루프 뒤에 만들면 SIGTERM 등록이 0회라 무효(infra-kakao 선례).
  const rpt = createReporter(PHASE);
  const dryRun = process.argv.includes("--dry-run");
  const jsonMode = process.argv.includes("--json");

  // 1. 산업단지 로드 — 손으로 적은 시드(24건, 2026-03-14 동결) 대신 **dev_plans**(V-WORLD
  //    LT_C_DAMDAN, 618건). 시드는 수도권에 몰려 있어 비수도권 단지가 구조적으로 0점이었다.
  const sbSrc = getSupabase();
  /** @type {Array<{ name: string | null, lat: number, lng: number }>} */
  const complexes = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sbSrc
      .from("dev_plans")
      .select("name, lat, lng")
      .eq("kind", "industrial_complex")
      .not("lat", "is", null)
      .range(offset, offset + 999);
    if (error) throw new Error(`dev_plans 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    complexes.push(.../** @type {any} */ (data));
    if (data.length < 1000) break;
  }
  if (complexes.length === 0) {
    // 0건을 성공으로 넘기면 전 단지의 industry_dev 가 조용히 안 바뀐다(세션504 답습).
    logError("load", "dev_plans 에 산업단지(industrial_complex)가 0건 — naver-devplan 수집기를 먼저 돌리세요");
    process.exit(1);
  }
  log("seed", `dev_plans 산업단지 ${complexes.length}건 로드`);

  // 2. 아파트 데이터 로드
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
    const acc = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await sb.from("apartments").select("id, name, lat, lng, industry_dev").range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`Supabase 조회 실패: ${error.message}`);
      if (!data || data.length === 0) break;
      acc.push(...data);
      if (data.length < PAGE_SIZE) break;
    }
    apartments = acc;
    log("load", `Supabase apartments: ${apartments.length}건`);
  }

  /** @type {IndustryApt[]} */
  const aptList = apartments;
  const withCoords = aptList.filter(/** @param {IndustryApt} a */ a => a.lat && a.lng);
  log("filter", `좌표 있는 아파트: ${withCoords.length}/${aptList.length}건`);

  // 3. 각 아파트에 대해 반경 내 산업단지 매칭
  /** @type {Array<{ id: string; industry_dev: string }>} */
  const updates = [];
  let matched = 0;
  let cleared = 0; // 매칭 안 됐는데 옛 값이 남아 있어 지운 건수

  for (const apt of withCoords) {
    /** @type {Array<{ name: string; type: string; dist: number }>} */
    const nearby = [];

    for (const cpx of complexes) {
      // 사각 프리필터 — 위경도 0.09°/0.115° 밖이면 5km 를 넘는다(전수 곱셈 회피)
      if (Math.abs(cpx.lat - Number(apt.lat)) > 0.09 || Math.abs(cpx.lng - Number(apt.lng)) > 0.115) continue;
      const dist = haversine(Number(apt.lat), Number(apt.lng), cpx.lat, cpx.lng);
      if (dist <= MATCH_RADIUS_KM) {
        nearby.push({ name: cpx.name ?? "산업단지", type: "", dist: Math.round(dist * 10) / 10 });
      }
    }

    if (nearby.length > 0) {
      // **최근접 1개 + 거리**. 옛 형식(상위 3개를 `이름(종류)` 로 나열)은 거리가 없어 채점이
      // "있다/없다" 이진으로만 쓸 수 있었다(값 보유 239곳 중 206곳이 같은 35점).
      // `scoreFuture` 가 `INDUSTRY_DEV_PATTERN` 으로 파싱하는 형식과 **정확히 같아야 한다.**
      nearby.sort((a, b) => a.dist - b.dist);
      const best = nearby[0];
      updates.push({ id: apt.id, industry_dev: `${best.name} ${best.dist}km` });
      matched++;
    } else if (apt.industry_dev || apt.industryDev) {
      // ⚠️ 매칭이 안 됐는데 옛 값이 남아 있으면 **지운다.**
      // 옛 시드는 단지마다 radius(기본 10km)를 따로 들어서 지금보다 멀리까지 잡았다. 그 값을
      // 그대로 두면 화면엔 "여수산단(국가)" 가 보이는데 점수는 0 인 상태가 된다 — 손님이 보는
      // 거짓이다. 실제로 55곳이 그 상태였다(최근접이 7.3km 로 수집 반경 5km 밖).
      updates.push({ id: apt.id, industry_dev: /** @type {any} */ (null) });
      cleared++;
    }
  }

  log(
    "result",
    `산업단지 매칭: ${matched}/${withCoords.length}건` + (cleared ? ` · 옛 값 정리 ${cleared}건` : ""),
  );

  if (dryRun) {
    log("dry-run", "미리보기 모드 — 업데이트 생략");
    for (const u of updates.slice(0, 30)) {
      const apt = aptList.find(/** @param {IndustryApt} a */ a => a.id === u.id);
      console.log(`  ${apt?.name || u.id}: ${u.industry_dev}`);
    }
    if (updates.length > 30) console.log(`  ... 외 ${updates.length - 30}건`);
    await recordCollectorRun(PHASE, rpt.summary()); // --dry-run 이면 내부에서 skip
    return;
  }

  // 4. 업데이트
  if (jsonMode) {
    /** @type {Map<string, IndustryApt>} */
    const aptMap = new Map(aptList.map(/** @param {IndustryApt} a */ a => [a.id, a]));
    for (const u of updates) {
      const apt = aptMap.get(u.id);
      if (!apt) continue;
      apt.industryDev = u.industry_dev;
    }
    const jsonPath = resolve(ROOT, "public/data/apartments.json");
    const updatedData = [...aptMap.values()];
    writeFileSync(jsonPath, JSON.stringify({ ...rawWrapper, data: updatedData, count: updatedData.length }, null, 2), "utf8");
    log("json", `apartments.json 업데이트 완료 (${updates.length}건)`);
    rpt.success(updates.length);

    // split-apartments-json 자동 호출 — prebuild.mjs L11 답습 (ROOT=repo 루트라 scripts/ 명시, 세션 468)
    const splitScript = resolve(ROOT, "scripts", "split-apartments-json.mjs");
    const splitResult = spawnSync(process.execPath, [splitScript], { stdio: "inherit", env: process.env });
    if (splitResult.status !== 0) logError("split", "split-apartments-json 실패 — apartments-list.json 수동 갱신 필요");
  } else {
    const sb = getSupabase();
    let ok = 0;
    for (const u of updates) {
      if (rpt.interrupted()) break;
      const { error } = await sb.from("apartments")
        .update({ industry_dev: u.industry_dev })
        .eq("id", u.id);
      if (error) { logError("upsert", `${u.id}: ${error.message}`); rpt.fail(); }
      else { ok++; rpt.success(); }
    }
    log("supabase", `${ok}/${updates.length}건 업데이트`);
  }

  // 0건이어도 기록한다 — 기록이 없으면 "매칭될 게 없어서 0건" 과 "전부 실패해서 0건" 이
  // 구분되지 않는다(collect-trades 2개월 공백 사고, 세션 503).
  const summary = rpt.summary();
  await recordCollectorRun(PHASE, summary);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });
