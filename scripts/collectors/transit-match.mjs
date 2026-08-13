// @ts-check
/**
 * 교통·도시개발 → 아파트 매칭
 *
 * 사용법:
 *   node scripts/collectors/transit-match.mjs          (Supabase 업데이트)
 *   node scripts/collectors/transit-match.mjs --dry-run (미리보기만)
 *   node scripts/collectors/transit-match.mjs --json    (apartments.json 직접 업데이트)
 *
 * 출처:
 *   - 교통(`transit_dev`·`dev_dist`) = 시드 `public/data/transit-dev.json` (14노선 55역)
 *   - 도시(`city_dev`) = **`dev_plans` `kind='lh_zone'`** (V-WORLD LH 사업지구경계 1,174건)
 *     ← 세션511 교체. 옛 시드 `city-dev.json`(27건, 2026-03-14 동결)은 수도권 편중이라
 *       비수도권 단지가 구조적으로 0점이었다.
 *
 * 출력 형식:
 *   - `transit_dev = "{노선} {역}역 {상태}"` → `scoreFuture` 의 `TRANSIT_DEV_PATTERN`
 *   - `city_dev    = "{지구명} {거리}km"`    → `scoreFuture` 의 `CITY_DEV_PATTERN`
 * ⚠️ 형식과 패턴은 **한 쌍**이다. 한쪽만 바꾸면 점수가 조용히 0이 된다(에러가 아니라 침묵).
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { spawnSync } from "node:child_process";
import { loadEnv, getSupabase, log, logError, ROOT, haversineKm, createReporter, recordCollectorRun } from "./_shared.mjs";

// 세션 511: 이 수집기를 실행하는 워크플로가 2026-03-14 이후 0건이었다(audit-orphan-collectors
// 사각지대). collector_runs 행도 없어 아무 감시도 안 걸렸다 — industry-match.mjs 배선 답습.
const PHASE = "transit-match";

/** 도시개발(LH 사업지구) 매칭 반경(km). 채점 등급 마지막 칸이 3km 라 그 밖은 어차피 0점이다. */
const CITY_MATCH_RADIUS_KM = 5;

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

  // 4. 도시개발 목록 — 손으로 적은 시드(`city-dev.json` 27건, 2026-03-14 동결) 대신
  //    **dev_plans**(V-WORLD LT_C_LHZONE = LH 사업지구경계, 1,174건).
  //    시드는 수도권 편중이라 비수도권 단지가 구조적으로 0점이었다.
  const sbCity = getSupabase();
  /** @type {Array<{ name: string | null, lat: number, lng: number }>} */
  const devs = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sbCity
      .from("dev_plans")
      .select("name, lat, lng")
      .eq("kind", "lh_zone")
      .not("lat", "is", null)
      .range(offset, offset + 999);
    if (error) throw new Error(`dev_plans 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    devs.push(.../** @type {any} */ (data));
    if (data.length < 1000) break;
  }
  if (devs.length === 0) {
    // 0건을 성공으로 넘기면 전 단지의 city_dev 가 조용히 안 바뀐다(세션504 답습).
    logError("city", "dev_plans 에 LH 사업지구(lh_zone)가 0건 — naver-devplan 수집기를 먼저 돌리세요");
    process.exit(1);
  }
  log("city", `dev_plans LH 사업지구 ${devs.length}건 로드`);

  // 5. 각 아파트에 대해 매칭
  const updates = [];
  let matchedTransit = 0, matchedCity = 0;
  let cleared = 0; // 매칭 안 됐는데 옛 값이 남아 있어 지운 건수

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

    // 도시개발 매칭 — 5km 이내 가장 가까운 LH 사업지구
    // (옛 시드는 지구마다 radius 를 따로 들었는데, 그러면 "왜 이 지구는 8km 도 잡히고 저 지구는
    //  4km 에서 잘리나"를 설명할 수 없다. 채점 등급 마지막 칸이 3km 라 5km 밖은 어차피 0점.)
    let bestDev = null;
    let bestDevDist = Infinity;
    for (const dev of devs) {
      // 사각 프리필터 — 전수 곱셈(2,696 × 1,174) 회피
      if (Math.abs(dev.lat - lat) > 0.09 || Math.abs(dev.lng - lng) > 0.115) continue;
      const dist = haversine(lat, lng, dev.lat, dev.lng);
      if (dist < bestDevDist && dist <= CITY_MATCH_RADIUS_KM) {
        bestDevDist = dist;
        bestDev = dev;
      }
    }

    const transitDev = bestStation ? `${bestStation.project} ${bestStation.name}역 ${bestStation.status}` : null;
    const devDist = bestStation ? Math.round(bestDist * 10) / 10 : null;
    // **{지구명} {거리}km** — `scoreFuture` 의 `CITY_DEV_PATTERN` 이 파싱하는 형식.
    // 옛 형식 `{이름} ({종류})` 는 거리가 없어 채점이 이진으로만 쓸 수 있었다(값 보유 111곳이 전부 80점).
    const cityDev = bestDev ? `${bestDev.name ?? "개발지구"} ${Math.round(bestDevDist * 10) / 10}km` : null;

    if (transitDev) matchedTransit++;
    if (cityDev) matchedCity++;

    // ⚠️ 매칭이 안 됐는데 옛 값이 남아 있으면 **지운다.**
    // 안 그러면 화면엔 값이 보이는데 점수는 0 인 상태가 남는다 — 손님이 보는 거짓이다.
    // (industry-match 에서 실제로 55곳이 그 상태였다: 옛 시드가 10km 까지 잡던 값이 남아 있었다.)
    const staleTransit = !transitDev && (apt.transit_dev || apt.transitDev);
    const staleCity = !cityDev && (apt.city_dev || apt.cityDev);

    if (transitDev || cityDev || staleTransit || staleCity) {
      const id = apt.id;
      /** @type {{id: string, transit_dev?: string|null, dev_dist?: number|null, city_dev?: string|null}} */
      const update = { id };
      if (transitDev) {
        update.transit_dev = transitDev;
        update.dev_dist = devDist;
      } else if (staleTransit) {
        update.transit_dev = null;
        update.dev_dist = null;
        cleared++;
      }
      if (cityDev) {
        update.city_dev = cityDev;
      } else if (staleCity) {
        update.city_dev = null;
        cleared++;
      }
      updates.push(update);
    }
  }

  log(
    "match",
    `교통 매칭: ${matchedTransit}/${apartments.length}건, 도시개발 매칭: ${matchedCity}/${apartments.length}건` +
      (cleared ? ` · 옛 값 정리 ${cleared}건` : ""),
  );

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
      // ⚠️ truthy 검사(`if (u.transit_dev)`)로 쓰면 **정리용 null 이 통째로 버려진다** —
      // 옛 값을 지우려고 담은 null 이 조용히 무시돼 "정리 N건" 로그만 남고 실제로는 0건이 된다.
      // 키 존재 여부로 판별해야 null 도 통과한다.
      if ("transit_dev" in u) { apt.transitDev = u.transit_dev; apt.devDist = u.dev_dist ?? null; }
      if ("city_dev" in u) apt.cityDev = u.city_dev;
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
      // ⚠️ truthy 검사면 **정리용 null 이 버려진다** — "정리 N건" 로그만 남고 실제 0건이 된다.
      if ("transit_dev" in u) { row.transit_dev = u.transit_dev; row.dev_dist = u.dev_dist ?? null; }
      if ("city_dev" in u) row.city_dev = u.city_dev;
      if (Object.keys(row).length === 0) continue; // 빈 update 로 행을 건드리지 않는다
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
