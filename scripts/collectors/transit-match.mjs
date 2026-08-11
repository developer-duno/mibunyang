// @ts-check
/**
 * 교통/도시개발 시드 데이터 → 아파트 매칭
 *
 * 사용법:
 *   node scripts/collectors/transit-match.mjs          (Supabase 업데이트)
 *   node scripts/collectors/transit-match.mjs --dry-run (미리보기만)
 *   node scripts/collectors/transit-match.mjs --json    (apartments.json 직접 업데이트)
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { spawnSync } from "node:child_process";
import { loadEnv, getSupabase, log, logError, ROOT, haversineKm, createReporter, recordCollectorRun } from "./_shared.mjs";

// 세션 511: 이 수집기를 실행하는 워크플로가 2026-03-14 이후 0건이었다(audit-orphan-collectors
// 사각지대). collector_runs 행도 없어 아무 감시도 안 걸렸다 — industry-match.mjs 배선 답습.
const PHASE = "transit-match";

loadEnv();

export const haversine = haversineKm;

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  // 리포터는 반드시 루프 이전에 — 루프 뒤에 만들면 SIGTERM 등록이 0회라 무효(infra-kakao 선례).
  const rpt = createReporter(PHASE);
  const dryRun = process.argv.includes("--dry-run");
  const jsonMode = process.argv.includes("--json");

  // 1. 시드 데이터 로드
  const transitData = JSON.parse(readFileSync(resolve(ROOT, "public/data/transit-dev.json"), "utf8"));
  const cityData = JSON.parse(readFileSync(resolve(ROOT, "public/data/city-dev.json"), "utf8"));

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
      const { data, error } = await sb.from("apartments").select("id, name, lat, lng, region, gu, transit_dev, dev_dist, city_dev, industry_dev").range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`Supabase 조회 실패: ${error.message}`);
      if (!data || data.length === 0) break;
      acc.push(...data);
      if (data.length < PAGE_SIZE) break;
    }
    apartments = acc;
    log("load", `Supabase apartments: ${apartments.length}건`);
  }

  // 3. 교통 역사 목록 평탄화
  const stations = [];
  for (const proj of transitData.projects) {
    for (const st of proj.stations) {
      stations.push({ ...st, project: proj.name, type: proj.type, status: proj.status });
    }
  }
  log("transit", `${stations.length}개 역사 로드 (${transitData.projects.length}개 노선)`);

  // 4. 도시개발 목록
  const devs = cityData.developments;
  log("city", `${devs.length}개 개발 프로젝트 로드`);

  // 5. 각 아파트에 대해 매칭
  const updates = [];
  let matchedTransit = 0, matchedCity = 0;

  for (const apt of apartments) {
    const lat = jsonMode ? apt.lat : apt.lat;
    const lng = jsonMode ? apt.lng : apt.lng;
    if (!lat || !lng) continue;

    // 교통 매칭 — 5km 이내 가장 가까운 역
    let bestStation = null;
    let bestDist = Infinity;
    for (const st of stations) {
      const dist = haversine(lat, lng, st.lat, st.lng);
      if (dist < bestDist && dist <= 5) {
        bestDist = dist;
        bestStation = st;
      }
    }

    // 도시개발 매칭 — radius 이내 가장 가까운 프로젝트
    let bestDev = null;
    let bestDevDist = Infinity;
    for (const dev of devs) {
      const dist = haversine(lat, lng, dev.lat, dev.lng);
      const radius = dev.radius || 5;
      if (dist < bestDevDist && dist <= radius) {
        bestDevDist = dist;
        bestDev = dev;
      }
    }

    const transitDev = bestStation ? `${bestStation.project} ${bestStation.name}역 ${bestStation.status}` : null;
    const devDist = bestStation ? Math.round(bestDist * 10) / 10 : null;
    const cityDev = bestDev ? `${bestDev.name} (${bestDev.type})` : null;

    if (transitDev) matchedTransit++;
    if (cityDev) matchedCity++;

    if (transitDev || cityDev) {
      const id = jsonMode ? apt.id : apt.id;
      /** @type {{id: string, transit_dev?: string, dev_dist?: number|null, city_dev?: string}} */
      const update = { id };
      if (transitDev) {
        update.transit_dev = transitDev;
        update.dev_dist = devDist;
      }
      if (cityDev) {
        update.city_dev = cityDev;
      }
      updates.push(update);
    }
  }

  log("match", `교통 매칭: ${matchedTransit}/${apartments.length}건, 도시개발 매칭: ${matchedCity}/${apartments.length}건`);

  if (dryRun) {
    log("dry-run", "미리보기 모드 — 업데이트 생략");
    for (const u of updates.slice(0, 20)) {
      const apt = apartments.find((/** @type {{id: string, name?: string}} */ a) => a.id === u.id);
      console.log(`  ${apt?.name || u.id}: transit=${u.transit_dev || "-"}, dist=${u.dev_dist || "-"}km, city=${u.city_dev || "-"}`);
    }
    if (updates.length > 20) console.log(`  ... 외 ${updates.length - 20}건`);
    await recordCollectorRun(PHASE, rpt.summary()); // --dry-run 이면 내부에서 skip
    return;
  }

  // 6. 업데이트
  if (jsonMode) {
    // apartments.json 직접 업데이트
    const aptMap = new Map(apartments.map((/** @type {{id: string}} */ a) => [a.id, a]));
    for (const u of updates) {
      /** @type {Record<string, unknown>} */
      const apt = aptMap.get(u.id);
      if (!apt) continue;
      if (u.transit_dev) { apt.transitDev = u.transit_dev; apt.devDist = u.dev_dist; }
      if (u.city_dev) apt.cityDev = u.city_dev;
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
    // Supabase 배치 업데이트
    const sb = getSupabase();
    let ok = 0;
    for (const u of updates) {
      if (rpt.interrupted()) break;
      /** @type {Record<string, unknown>} */
      const row = {};
      if (u.transit_dev) { row.transit_dev = u.transit_dev; row.dev_dist = u.dev_dist; }
      if (u.city_dev) row.city_dev = u.city_dev;
      const { error } = await sb.from("apartments").update(row).eq("id", u.id);
      if (error) { logError("upsert", `${u.id}: ${error.message}`); rpt.fail(); }
      else { ok++; rpt.success(); }
    }
    log("supabase", `${ok}/${updates.length}건 업데이트`);
  }

  // 0건이어도 기록한다 — 기록이 없으면 "매칭될 게 없어서 0건" 과 "전부 실패해서 0건" 이
  // 구분되지 않는다(collect-trades 2개월 공백 사고, industry-match 답습).
  const summary = rpt.summary();
  await recordCollectorRun(PHASE, summary);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });
