// @ts-check
/**
 * 층수 범위 계산 — max_floor → floors 텍스트
 *
 * 사용법:
 *   node scripts/collectors/calc-floors.mjs
 *   node scripts/collectors/calc-floors.mjs --dry-run
 *
 * 필요 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, selectAll, createReporter, recordCollectorRun } from "./_shared.mjs";

loadEnv();
const PHASE = "calc-floors";
const DRY = process.argv.includes("--dry-run");

/**
 * @param {number | null | undefined} maxFloor
 * @returns {string | null}
 */
export function classifyFloors(maxFloor) {
  if (maxFloor == null || maxFloor <= 0) return null;
  if (maxFloor <= 5) return "저층(1~5F)";
  if (maxFloor <= 15) return "중층(6~15F)";
  if (maxFloor <= 25) return "고층(16~25F)";
  return "초고층(26F+)";
}

/**
 * 세션539 F-3: `floors` 는 `classifyFloors(max_floor)` 의 100% 파생값이다. `!a.floors` 만
 * 보면 "빈 것만 채우고" 끝이라, `max_floor` 가 나중에(molit-building-info.mjs 매월) 갱신돼도
 * `floors` 는 옛 값에 멈춰 화석화된다(실측: 화면 207곳(11.4%)·base 314곳 불일치, 극단은
 * "최고 90층인데 중층(6~15F)"). 손님에게는 안 보인다(INTERNAL_ONLY_FIELDS — 세션508, 관리자
 * 표만) — 그래도 파생값이 원본과 어긋난 채 방치되는 건 다음 세션의 오판 소지라 정정한다.
 * @param {Array<{ id: string, max_floor: number | null, floors: string | null }>} apts
 * @returns {Array<{ id: string, max_floor: number | null, floors: string | null }>}
 */
export function selectFloorTargets(apts) {
  return apts.filter((a) => !a.floors || a.floors !== classifyFloors(a.max_floor));
}

async function main() {
  // 세션 504: 이 수집기는 매주 도는데 collector_runs 에 행을 한 번도 남기지 않아
  // "돌았는지·실패했는지" 를 아무도 볼 수 없었다(감시 사각). 리포터를 루프 이전에 만든다
  // — 루프 뒤에 만들면 SIGTERM 핸들러 등록이 0회라 graceful 이 무효가 된다(infra-kakao 선례).
  const rpt = createReporter(PHASE);
  const sb = getSupabase();

  // max_floor가 있고 floors가 없는 단지 조회 — selectAll 공유 헬퍼(1000행/배치 자동 페이지네이션)
  const apts = await selectAll((s) =>
    s.from("apartments")
      .select("id, max_floor, floors")
      .not("max_floor", "is", null)
      .gt("max_floor", 0),
  sb);

  const targets = selectFloorTargets(apts);
  log("calc-floors", `대상: ${targets.length}건 (전체 max_floor 보유: ${apts.length}건)`);

  if (DRY) {
    targets.slice(0, 5).forEach(a =>
      log("dry", `${a.id} → max_floor=${a.max_floor} → "${classifyFloors(a.max_floor)}"`)
    );
    await recordCollectorRun(PHASE, rpt.summary()); // --dry-run 이면 내부에서 기록 skip
    return;
  }

  let updated = 0;
  for (const apt of targets) {
    if (rpt.interrupted()) break;
    const floors = classifyFloors(apt.max_floor);
    if (!floors) { rpt.skip(); continue; }

    const { error: uErr } = await sb
      .from("apartments")
      .update({ floors, updated_at: new Date().toISOString() })
      .eq("id", apt.id);

    if (uErr) {
      log("error", `${apt.id}: ${uErr.message}`);
      rpt.fail();
    } else {
      updated++;
      rpt.success();
    }
  }

  log("calc-floors", `완료: ${updated}건 갱신`);
  // 0건이어도 반드시 기록한다 — "부를 게 없어서 0건" 과 "전부 실패해서 0건" 은
  // 기록이 남아야만 구분된다(collect-trades 2개월 공백 사고, 세션 503).
  const summary = rpt.summary();
  await recordCollectorRun(PHASE, summary);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(e => { console.error(e); process.exit(1); });
