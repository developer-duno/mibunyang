// @ts-check
/**
 * 소사역 프라힐스 15곳 — 남의 주소가 박혀 좌표가 651m 어긋난 것 정정 (세션539)
 *
 * ## 무엇이 틀렸나
 *
 * `현대 프라힐스 소사역 더프라임` 1~9차 15곳의 `address` 가 **부천 소사 현진에버빌(별개 단지)의
 * 주소**(`경기 부천시 소사구 소사본동 148-30`)로 박혀 있다. 좌표는 그 주소를 지오코딩한 값이라
 * 실제 단지에서 **651m** 떨어져 있다. 같은 단지의 `임의공급 10차`(`ah-2024910166`) 한 곳만
 * 올바른 주소(`소사본동 70-6`)를 갖고 있고, 그 좌표가 네이버 실단지 `149270`
 * (`현대프라힐스소사역더프라임(주상복합)`·아파트·160세대·준공 20240628)와 **13m** 거리다.
 *
 * ## 피해 (2026-09-02 실측 — 오염 15곳 vs 정상 10차)
 *
 * | 항목 | 오염 | 정상 |
 * |---|---|---|
 * | 지하철 거리 | **784m** | **153m** |
 * | 학교 도보 | 4분 | 7분 |
 * | 인근 시세 | 34,000 | 36,000 |
 * | 병원 수 | 67 | 113 |
 * | 교통 점수 | 54 | 72 |
 * | 학군 점수 | 81 | 66 |
 *
 * ⚠️ **점수만 보면 멀쩡해 보인다** — 교통 -18 과 학군 +15 가 상쇄돼 입지 총점은 77 vs 79(2점차)다.
 * 틀린 것은 **손님이 읽는 사실 쪽**이다(지하철 153m 를 784m 라고 적는다).
 *
 * ## 정정 후 회복 경로
 *
 * - `naver_nearby_median`·`naver_nearby_count` → **자동 회복**.
 *   `sync-naver-complex.mjs:695-715` 가 매 실행마다 **모든** 단지를 좌표에서 다시 계산한다
 *   (수집완료 skip 없음). 다음 네이버 파이프라인(월/목 08:00 KST)에 반영된다.
 * - `transport`(지하철·버스)·`schools`·`infra` → **자동 회복 안 된다.**
 *   `transport-tago.mjs:551-558` 등이 "이미 수집된 단지"를 건너뛴다(`--force` 없으면).
 *   그 15곳의 파생 행을 지워 **미수집 상태로 되돌려야** 다음 정기 수집이 올바른 좌표로 채운다.
 *   → `--purge-derived` 는 **별도 플래그**로 분리했다(삭제는 되돌릴 수 없으므로 사람 확인 후).
 *
 * ## 알려진 부작용 (실행 전 반드시 읽을 것)
 *
 * `collect-applyhome-seed.mjs` 의 `findDuplicate` 는 **이름 유사도(≥0.85) + 거리(≤500m)** 로 중복을
 * 판정한다(`:52-54`). 지금은 15곳이 `148-30` 자리에 있어, 청약홈이 같은 주소로 새 회차를 보내면
 * 0m 로 겹쳐 **skip** 된다. 좌표를 651m 옮기면 그 후보가 **500m 밖**이 되어 **새 행으로 삽입**될 수 있다.
 * 프라힐스 소사역은 10차까지 나와 추가 회차 가능성이 낮지만, 새 행이 생기면 이 스크립트로 다시
 * 정정하면 된다(중복 자체는 화면에 두 줄로 보이므로 조용한 사고는 아니다).
 *
 * `geocode-missing.mjs:108` 은 `lat.is.null,lng.is.null` 만 대상이라 **여기서 고친 좌표를 덮어쓰지 않는다**(확인 완료).
 *
 * ## 사용법
 *
 *   node scripts/fix-sosa-coordinates.mjs                    # 미리보기 (기본)
 *   node scripts/fix-sosa-coordinates.mjs --apply            # 주소·좌표 정정
 *   node scripts/fix-sosa-coordinates.mjs --apply --purge-derived   # + 파생 행 삭제(재수집 유도)
 *
 * ⚠️ 파이프(`| tail`)를 붙이지 마라 — SIGPIPE 로 중간에 죽는다
 *    (`.claude/rules/collectors/pipe-kills-collector.md`). 파일로 리다이렉트한 뒤 읽을 것.
 */
import { loadEnv, getSupabase, selectAll, haversineMeters, log, logError } from "./collectors/_shared.mjs";

loadEnv();

const PHASE = "fix-sosa";

/** 네이버 실단지 149270 좌표 — 판정 기준점(우리가 쓰는 값 아님). */
const NAVER_LAT = 37.481863;
const NAVER_LNG = 126.794159;

/** 올바른 값의 출처 — 같은 단지의 `임의공급 10차`. 네이버 149270 과 13m. */
const TRUTH_ID = "ah-2024910166";

/** 이 거리를 넘으면 "남의 좌표가 박힌 것"으로 본다. 실측 오염분은 651m, 정상분은 13m 라 여유가 크다. */
const WRONG_DIST_M = 300;

/** 좌표에서 파생돼 자동 회복되지 않는 표 — 행을 지워야 다음 수집이 다시 채운다. */
const DERIVED_TABLES = ["transport", "schools", "infra"];

/**
 * 정정 대상인가 — 이름이 프라힐스 소사역 계열이고, 기준점에서 WRONG_DIST_M 이상 떨어져 있는가.
 * 현진에버빌(별개 단지)은 이름 조건에서 걸러진다 — 그 좌표는 그 단지의 진짜 좌표다.
 * @param {{ name: string | null, lat: number | null, lng: number | null }} apt
 * @returns {boolean}
 */
export function isWrongCoordRow(apt) {
  const name = String(apt.name ?? "");
  if (!/프라힐스/.test(name) || !/소사/.test(name)) return false;
  if (apt.lat == null || apt.lng == null) return false;
  return haversineMeters(apt.lat, apt.lng, NAVER_LAT, NAVER_LNG) > WRONG_DIST_M;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const purge = process.argv.includes("--purge-derived");
  log(PHASE, apply ? "=== 실제 반영 모드 (--apply) ===" : "=== 미리보기 — 반영하려면 --apply ===");
  if (purge && !apply) {
    logError(PHASE, "--purge-derived 는 --apply 와 함께만 쓴다");
    process.exit(1);
  }

  const sb = getSupabase();
  const apts = /** @type {any[]} */ (
    await selectAll((s) => s.from("apartments").select("id, name, address, road_address, lat, lng"), sb, "id")
  );
  log(PHASE, `apartments ${apts.length}행 조회`);

  const truth = apts.find((a) => a.id === TRUTH_ID);
  if (!truth || truth.lat == null || truth.lng == null) {
    logError(PHASE, `기준 행 ${TRUTH_ID} 을 못 찾았거나 좌표가 없다 — 중단`);
    process.exit(1);
  }
  const truthDist = Math.round(haversineMeters(truth.lat, truth.lng, NAVER_LAT, NAVER_LNG));
  log(PHASE, `기준 행: ${truth.name} | ${truth.address} | (${truth.lat}, ${truth.lng}) — 네이버 149270 과 ${truthDist}m`);
  if (truthDist > WRONG_DIST_M) {
    logError(PHASE, `기준 행 자체가 네이버 단지와 ${truthDist}m 떨어져 있다 — 전제가 깨졌으니 중단`);
    process.exit(1);
  }

  const targets = apts.filter(isWrongCoordRow);
  log(PHASE, `\n정정 대상 ${targets.length}건`);
  for (const t of targets) {
    const d = Math.round(haversineMeters(t.lat, t.lng, NAVER_LAT, NAVER_LNG));
    log(PHASE, `  ${t.id.padEnd(15)} ${String(t.name).slice(0, 34).padEnd(36)} ${String(d).padStart(4)}m | ${t.address}`);
  }
  if (targets.length === 0) {
    log(PHASE, "정정할 것이 없다 — 이미 반영됐거나 대상이 사라졌다");
    return;
  }

  log(PHASE, `\n바꿀 값 (${TRUTH_ID} 에서 가져옴)`);
  log(PHASE, `  address      → ${truth.address}`);
  log(PHASE, `  road_address → ${truth.road_address ?? "null (기준 행에도 없음 — 추측하지 않고 비운다)"}`);
  log(PHASE, `  lat, lng     → ${truth.lat}, ${truth.lng}`);

  // 파생 행 현황은 미리보기에서도 보여준다 — 몇 건이 재수집 대상이 되는지 알고 결정하라고.
  const ids = targets.map((t) => t.id);
  for (const table of DERIVED_TABLES) {
    const { count, error } = await sb
      .from(table)
      .select("*", { count: "exact", head: true })
      .in("apartment_id", ids);
    if (error) { logError(PHASE, `${table} 조회 실패: ${error.message}`); continue; }
    log(PHASE, `  파생 ${table.padEnd(10)} ${count ?? 0}행 — ${purge ? "삭제 예정" : "그대로 둠(자동 회복 안 됨)"}`);
  }

  if (!apply) {
    log(PHASE, `\n=== 미리보기 종료 — 반영하려면 --apply (파생 행까지 지우려면 --apply --purge-derived) ===`);
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const t of targets) {
    const { error } = await sb
      .from("apartments")
      .update({
        address: truth.address,
        road_address: truth.road_address ?? null,
        lat: truth.lat,
        lng: truth.lng,
        updated_at: new Date().toISOString(),
      })
      .eq("id", t.id);
    if (error) { logError(PHASE, `${t.id}: ${error.message}`); fail++; }
    else ok++;
  }
  log(PHASE, `\n좌표·주소 정정: 성공 ${ok} · 실패 ${fail}`);

  if (purge) {
    for (const table of DERIVED_TABLES) {
      const { error } = await sb.from(table).delete().in("apartment_id", ids);
      if (error) logError(PHASE, `${table} 삭제 실패: ${error.message}`);
      else log(PHASE, `파생 ${table} 삭제 완료 — 다음 정기 수집이 올바른 좌표로 다시 채운다`);
    }
  }

  log(PHASE, `\n=== 완료 ===`);
  log(PHASE, `다음 확인: 네이버 파이프라인(월/목 08:00 KST) 후 naver_nearby_median 이 36,000 근방인지`);
  log(PHASE, `           transport 재수집 후 subway_dist 가 784 → 153 근방인지`);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
