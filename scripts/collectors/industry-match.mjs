// @ts-check
/**
 * 산업단지 매칭 — 시드 데이터 기반 좌표 매칭
 *
 * 사용법:
 *   node scripts/collectors/industry-match.mjs              (Supabase 업데이트)
 *   node scripts/collectors/industry-match.mjs --dry-run    (미리보기만)
 *   node scripts/collectors/industry-match.mjs --json       (apartments.json 직접 업데이트)
 *
 * 시드 데이터: public/data/industry-dev.json
 * 형식: { "complexes": [{ "name": "반월시화산단", "type": "국가", "lat": 37.31, "lng": 126.73, "radius": 10 }, ...] }
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { loadEnv, getSupabase, log, logError, ROOT, haversineKm } from "./_shared.mjs";

loadEnv();

export const haversine = haversineKm;

/**
 * @typedef {{ name: string; type: string; lat: number; lng: number; radius?: number }} IndustryComplex
 * @typedef {{ id: string; name: string | null; lat: number | null; lng: number | null; industry_dev?: string | null; industryDev?: string | null }} IndustryApt
 */

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const jsonMode = process.argv.includes("--json");

  // 1. 시드 데이터 로드
  const seedPath = resolve(ROOT, "public/data/industry-dev.json");
  if (!existsSync(seedPath)) {
    logError("load", `시드 파일 없음: ${seedPath}`);
    logError("load", "public/data/industry-dev.json 파일을 먼저 생성하세요");
    logError("load", '형식: { "complexes": [{ "name": "...", "type": "국가|일반|도시첨단|농공", "lat": 0, "lng": 0, "radius": 10 }] }');
    process.exit(1);
  }
  const seedData = JSON.parse(readFileSync(seedPath, "utf8"));
  const complexes = seedData.complexes || [];
  log("seed", `${complexes.length}개 산업단지 로드`);

  // 2. 아파트 데이터 로드
  let apartments;
  if (jsonMode) {
    const jsonPath = resolve(ROOT, "public/data/apartments.json");
    apartments = JSON.parse(readFileSync(jsonPath, "utf8"));
    log("load", `apartments.json: ${apartments.length}건`);
  } else {
    const sb = getSupabase();
    const { data, error } = await sb.from("apartments").select("id, name, lat, lng, industry_dev").limit(10000);
    if (error) throw new Error(`Supabase 조회 실패: ${error.message}`);
    apartments = data;
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

  for (const apt of withCoords) {
    /** @type {Array<{ name: string; type: string; dist: number }>} */
    const nearby = [];

    for (const cpx of /** @type {IndustryComplex[]} */ (complexes)) {
      const dist = haversine(Number(apt.lat), Number(apt.lng), cpx.lat, cpx.lng);
      const radius = cpx.radius || 10; // 기본 10km
      if (dist <= radius) {
        nearby.push({ name: cpx.name, type: cpx.type, dist: Math.round(dist * 10) / 10 });
      }
    }

    if (nearby.length > 0) {
      // 가장 가까운 순 정렬, 상위 3개
      nearby.sort((a, b) => a.dist - b.dist);
      const top = nearby.slice(0, 3);
      const industryDev = top.map(n => `${n.name}(${n.type})`).join(", ");
      updates.push({ id: apt.id, industry_dev: industryDev });
      matched++;
    }
  }

  log("result", `산업단지 매칭: ${matched}/${withCoords.length}건`);

  if (dryRun) {
    log("dry-run", "미리보기 모드 — 업데이트 생략");
    for (const u of updates.slice(0, 30)) {
      const apt = aptList.find(/** @param {IndustryApt} a */ a => a.id === u.id);
      console.log(`  ${apt?.name || u.id}: ${u.industry_dev}`);
    }
    if (updates.length > 30) console.log(`  ... 외 ${updates.length - 30}건`);
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
    writeFileSync(jsonPath, JSON.stringify([...aptMap.values()], null, 2), "utf8");
    log("json", `apartments.json 업데이트 완료 (${updates.length}건)`);
  } else {
    const sb = getSupabase();
    let ok = 0;
    for (const u of updates) {
      const { error } = await sb.from("apartments")
        .update({ industry_dev: u.industry_dev })
        .eq("id", u.id);
      if (error) logError("upsert", `${u.id}: ${error.message}`);
      else ok++;
    }
    log("supabase", `${ok}/${updates.length}건 업데이트`);
  }
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });
