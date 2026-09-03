// @ts-check
/**
 * 자리표시용(placeholder) 주소로 좌표가 어긋난 단지 일괄 정정 — `fix-sosa-coordinates.mjs` 일반화 (세션540)
 *
 * ## 무엇을 찾나
 *
 * 소사역 프라힐스(세션539, 15곳·651m)와 같은 종류의 문제 — **서로 다른 실제 프로젝트가 같은
 * `address` 문자열을 공유**하는 경우(대개 정확한 지번이 확정되기 전 대략적인 주소를 쓰다가
 * 다른 단지의 주소를 그대로 복사한 경우). 이런 그룹은 `naver_nearby_median` 같은 좌표 파생값이
 * 그룹 전체에서 하나로 통일되는 특징이 있다(같은 좌표를 공유하기 때문).
 *
 * ## 방법론 (2026-09-03 실측·검증)
 *
 * 1. `address` 를 2곳 이상이 공유하는 그룹을 찾는다 (base 1,811곳 / 467그룹 — 노이즈 큼,
 *    같은 프로젝트의 무순위/임의공급 회차가 정당하게 같은 주소를 쓰는 경우가 다수 섞여 있다).
 * 2. 각 후보를 `complexes`(네이버 실단지) 테이블과 **이름 유사도 ≥0.75**로 매칭한다.
 *    ⚠️ **지역 필터가 필수다** — 지역 필터 없이 매칭했더니 "힐스테이트"·"두산위브더제니스" 같은
 *    전국 공용 브랜드명이 수백km 떨어진 별개 단지와 매칭돼 큰 오탐(330km!)이 났다. 시도 단위
 *    필터도 부족했다(경기도 안에서도 55km 오탐) — **address 에서 뽑은 시/군 단위**로 좁혀야
 *    안전했다(오탐 소멸, 검증된 결과 107건이 세션539 가 별도로 추정한 109건과 거의 일치).
 * 3. `complexes` 매칭점과 300m 초과 떨어져 있으면 "정정 대상"(진짜 다른 좌표), 300m 이내면
 *    "이미 정상"(건드리지 않음).
 * 4. 매칭이 안 되는 나머지(1,400여곳)는 이 방법으로 못 잡는다 — 다른 방법(직접 지오코딩 등)이
 *    필요하다. 이 스크립트는 그 곳들은 건드리지 않는다(대상에서 제외될 뿐, 삭제/변경 없음).
 *
 * ## infra 테이블 컬럼 소유권 (세션539 사고 정정 — 절대 행 전체 삭제 금지)
 *
 * `infra` 테이블은 5개 수집기가 컬럼을 나눠 쓴다:
 *   - `collect-childcare.mjs`  → childcare, childcare_dist       (스킵 로직 없음 — 매 실행 전량 재계산, **자동 회복**)
 *   - `collect-police.mjs`    → police, police_dist              (스킵 로직 없음 — **자동 회복**)
 *   - `collect-emergency.mjs` → emergency, emergency_dist, emergency_name, emergency_type (**자동 회복**)
 *   - `infra-kakao.mjs`       → hospital,mart,conv,cafe,culture,bank,pharmacy,park,subway_dist
 *                                (30일 신선도 + 완결성 스킵 — **자동 회복 안 됨**, 컬럼만 null 처리해야 재수집)
 *   - `transport-tago.mjs`    → apartment_id 존재만 보장(ignoreDuplicates), 값 기록은 `transport` 테이블
 *
 * → 행을 통째로 지우면 childcare/police/emergency 는 다음 실행 때 다시 채워지지만, 그 사이
 *   화면에 "없음"으로 잠깐 노출된다(불필요한 위험). **infra-kakao 컬럼만 null 로 갱신**하고
 *   나머지 컬럼은 그대로 둔다.
 *
 * `transport`·`schools` 테이블은 단일 소유(각각 transport-tago, schools-neis 계열)라 행을
 * 지워도 다른 수집기 데이터가 딸려가지 않는다 — 안전하게 DELETE 가능.
 *
 * ## 타이밍 (purge-to-recollect-timing.md 답습 — 절대 규칙)
 *
 * 화면 정적 JSON 은 `daily-deploy.yml`(매일 KST 03:00)이 재생성하고, `transport`/`infra-kakao`/
 * `schools-neis` 재수집은 `collect-naver-listings-incremental.yml`(매일 KST 05:30)이 담당한다.
 * **파생값을 null/삭제하는 시점은 반드시 03:00~05:30 KST 창 안이어야 한다** — 그 밖에 지우면
 * "지하철 없음·병원 0개" 같은 거짓이 최대 하루 화면에 노출된다. `--purge-derived` 는 이 창
 * 밖에서 실행하면 경고 후 확인을 요구한다.
 *
 * ## 사용법
 *
 *   node scripts/fix-placeholder-addresses.mjs                          # 미리보기 (기본)
 *   node scripts/fix-placeholder-addresses.mjs --apply                  # 주소·좌표만 정정
 *   node scripts/fix-placeholder-addresses.mjs --apply --purge-derived  # + 파생 컬럼/행 정리(재수집 유도, 시간창 확인)
 *
 * ⚠️ 파이프(`| tail`)를 붙이지 마라 — SIGPIPE 로 중간에 죽는다. 파일로 리다이렉트할 것.
 */
import { loadEnv, getSupabase, selectAll, stringSimilarity, haversineMeters, log, logError } from "./collectors/_shared.mjs";

loadEnv();
const PHASE = "fix-placeholder";

const SIM_THRESHOLD = 0.75;
const WRONG_DIST_M = 300;

/** infra-kakao 가 소유한 컬럼 — purge 시 이 컬럼만 null 처리(행 삭제 금지). */
const INFRA_KAKAO_COLUMNS = ["hospital", "mart", "conv", "cafe", "culture", "bank", "pharmacy", "park", "subway_dist"];
/** 단일 소유 테이블 — purge 시 행 삭제 가능. */
const SOLE_OWNER_TABLES = ["transport", "schools"];

/**
 * address 문자열에서 시/군 토큰 추출. 예: "경기도 부천시 오정구 원종동" → "부천시"
 * @param {unknown} addr
 * @returns {string | null}
 */
function cityToken(addr) {
  const m = String(addr || "").match(/(\S+?시|\S+?군)(?=\s|$)/);
  return m ? m[1] : null;
}
/**
 * complexes.sigungu 에서 시/군 단위만 취함(예: "용인시 처인구" → "용인시").
 * @param {unknown} s
 * @returns {string}
 */
function sigunguCity(s) {
  const m = String(s || "").match(/^(\S+?시|\S+?군)/);
  return m ? m[1] : String(s || "");
}

/**
 * 정정 대상 목록을 계산한다(읽기 전용 — DB 변경 없음).
 * @param {any[]} apts
 * @param {any[]} complexes
 */
export function findFixCandidates(apts, complexes) {
  const byAddr = new Map();
  for (const a of apts) {
    if (!a.address) continue;
    if (!byAddr.has(a.address)) byAddr.set(a.address, []);
    byAddr.get(a.address).push(a);
  }
  const groups = [...byAddr.entries()].filter(([, l]) => l.length >= 2);
  const candidates = groups.flatMap(([, l]) => l);

  const byCity = new Map();
  for (const c of complexes) {
    const key = sigunguCity(c.sigungu);
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key).push(c);
  }

  const fixList = [];
  const okList = [];
  for (const apt of candidates) {
    if (apt.lat == null || apt.lng == null) continue;
    const city = cityToken(apt.address);
    if (!city) continue;
    const pool = byCity.get(city) || [];
    let best = null;
    let bestSim = 0;
    for (const c of pool) {
      const sim = stringSimilarity(apt.name, c.complex_name);
      if (sim > bestSim) { bestSim = sim; best = c; }
    }
    if (!best || bestSim < SIM_THRESHOLD || best.latitude == null || best.longitude == null) continue;
    const dist = haversineMeters(apt.lat, apt.lng, best.latitude, best.longitude);
    if (dist > WRONG_DIST_M) {
      fixList.push({ apt, complex: best, sim: bestSim, dist: Math.round(dist) });
    } else {
      okList.push({ apt, complex: best, sim: bestSim, dist: Math.round(dist) });
    }
  }
  return { fixList, okList, candidateCount: candidates.length, groupCount: groups.length };
}

/** 안전한 KST 시간창(03:00~05:30) 안인지. */
function inSafeWindow(now = new Date()) {
  const kstH = (now.getUTCHours() + 9) % 24;
  const kstM = now.getUTCMinutes();
  const minutes = kstH * 60 + kstM;
  return minutes >= 3 * 60 && minutes <= 5 * 60 + 30;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const purge = process.argv.includes("--purge-derived");
  const forceTiming = process.argv.includes("--force-timing");
  log(PHASE, apply ? "=== 실제 반영 모드 (--apply) ===" : "=== 미리보기 — 반영하려면 --apply ===");
  if (purge && !apply) {
    logError(PHASE, "--purge-derived 는 --apply 와 함께만 쓴다");
    process.exit(1);
  }
  if (purge && !inSafeWindow() && !forceTiming) {
    logError(PHASE, "지금은 안전 시간창(KST 03:00~05:30) 밖이다 — 지금 지우면 화면에 빈칸이 노출될 수 있다.");
    logError(PHASE, "그래도 강행하려면 --force-timing 을 추가하라(권장하지 않음).");
    process.exit(1);
  }

  const sb = getSupabase();
  const apts = /** @type {any[]} */ (
    await selectAll((s) => s.from("apartments").select("id, name, address, road_address, lat, lng"), sb, "id")
  );
  const complexes = /** @type {any[]} */ (
    await selectAll(
      (s) => s.from("complexes").select("complex_no, complex_name, latitude, longitude, address, road_address, sigungu"),
      sb,
      "complex_no",
    )
  );
  log(PHASE, `apartments ${apts.length}행, complexes ${complexes.length}행`);

  const { fixList, okList, candidateCount, groupCount } = findFixCandidates(apts, complexes);
  log(PHASE, `주소 공유 그룹 ${groupCount}개(${candidateCount}곳) 중 — 정정대상 ${fixList.length} · 이미정상 ${okList.length}`);

  log(PHASE, `\n=== 정정 대상 (거리순) ===`);
  for (const f of fixList.sort((a, b) => b.dist - a.dist)) {
    log(
      PHASE,
      `  ${f.apt.id.padEnd(14)} ${String(f.apt.name).slice(0, 30).padEnd(32)} → ${String(f.complex.complex_name).slice(0, 20).padEnd(22)} sim=${f.sim.toFixed(2)} dist=${f.dist}m`,
    );
  }

  if (fixList.length === 0) {
    log(PHASE, "정정할 것이 없다.");
    return;
  }

  const ids = fixList.map((f) => f.apt.id);
  for (const table of SOLE_OWNER_TABLES) {
    const { count, error } = await sb.from(table).select("*", { count: "exact", head: true }).in("apartment_id", ids);
    if (error) { logError(PHASE, `${table} 조회 실패: ${error.message}`); continue; }
    log(PHASE, `  파생 ${table.padEnd(10)} ${count ?? 0}행 — ${purge ? "삭제 예정" : "그대로 둠"}`);
  }
  const { count: infraCount, error: infraErr } = await sb.from("infra").select("*", { count: "exact", head: true }).in("apartment_id", ids);
  if (infraErr) logError(PHASE, `infra 조회 실패: ${infraErr.message}`);
  else log(PHASE, `  파생 infra      ${infraCount ?? 0}행 — ${purge ? `${INFRA_KAKAO_COLUMNS.join(",")} 컬럼만 null 처리 예정(행 유지)` : "그대로 둠"}`);

  if (!apply) {
    log(PHASE, `\n=== 미리보기 종료 — 반영하려면 --apply ===`);
    return;
  }

  let ok = 0, fail = 0;
  for (const f of fixList) {
    const { error } = await sb
      .from("apartments")
      .update({
        address: f.complex.road_address || f.complex.address,
        road_address: f.complex.road_address ?? null,
        lat: f.complex.latitude,
        lng: f.complex.longitude,
        updated_at: new Date().toISOString(),
      })
      .eq("id", f.apt.id);
    if (error) { logError(PHASE, `${f.apt.id}: ${error.message}`); fail++; }
    else ok++;
  }
  log(PHASE, `\n좌표·주소 정정: 성공 ${ok} · 실패 ${fail}`);

  if (purge) {
    for (const table of SOLE_OWNER_TABLES) {
      const { error } = await sb.from(table).delete().in("apartment_id", ids);
      if (error) logError(PHASE, `${table} 삭제 실패: ${error.message}`);
      else log(PHASE, `파생 ${table} 삭제 완료`);
    }
    const nullPayload = Object.fromEntries(INFRA_KAKAO_COLUMNS.map((c) => [c, null]));
    const { error: infraUpdErr } = await sb.from("infra").update(nullPayload).in("apartment_id", ids);
    if (infraUpdErr) logError(PHASE, `infra 컬럼 null 처리 실패: ${infraUpdErr.message}`);
    else log(PHASE, `infra 의 kakao 소유 컬럼(${INFRA_KAKAO_COLUMNS.length}개) null 처리 완료 — childcare/police/emergency 컬럼은 그대로 둠`);
  }

  log(PHASE, `\n=== 완료 ===`);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
