/**
 * 초등학교 도보거리 계산기
 *
 * schools.nearby_schools JSON에서 가장 가까운 초등학교까지의
 * 도보 시간(분)을 계산하여 apartments.naver_school_walk_min에 저장
 *
 * 사용법:
 *   node scripts/collectors/calc-school-walk.mjs              (Supabase UPDATE)
 *   node scripts/collectors/calc-school-walk.mjs --dry-run    (미리보기만)
 *
 * 필요 환경변수:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, logError, createReporter } from "./_shared.mjs";

loadEnv();

const PHASE = "school-walk";
const WALK_SPEED = 70; // m/분 (어린이 도보 속도)

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const rpt = createReporter(PHASE);

  // 1. schools 테이블 조회 (nearby_schools JSON 포함)
  const { data: schools, error: sErr } = await sb
    .from("schools")
    .select("apartment_id, nearby_schools");

  if (sErr) throw new Error(`schools 조회 실패: ${sErr.message}`);
  log(PHASE, `schools 테이블: ${schools.length}건`);

  // 2. 각 아파트의 최근접 초등학교 도보 시간 계산
  const updates = [];

  for (const row of schools) {
    const nearby = row.nearby_schools;
    if (!Array.isArray(nearby) || nearby.length === 0) continue;

    // type이 "초"인 학교만 필터
    const elementary = nearby.filter(s => s.type === "초" && s.distance > 0);
    if (elementary.length === 0) continue;

    // 최소 거리
    const minDist = Math.min(...elementary.map(s => s.distance));
    const walkMin = Math.ceil(minDist / WALK_SPEED);

    updates.push({ id: row.apartment_id, walkMin, minDist });
  }

  log(PHASE, `초등학교 도보거리 계산: ${updates.length}건`);

  if (dryRun) {
    const sample = updates.slice(0, 10);
    for (const u of sample) {
      log(PHASE, `  [DRY-RUN] apt ${u.id}: ${u.minDist}m → ${u.walkMin}분`);
    }
    log(PHASE, `  ... 외 ${updates.length - sample.length}건`);
    rpt.success(updates.length);
  } else {
    for (const u of updates) {
      const { error } = await sb.from("apartments").update({
        naver_school_walk_min: u.walkMin,
      }).eq("id", u.id);

      if (error) { logError(PHASE, `  ${u.id} UPDATE 실패: ${error.message}`); rpt.fail(1); }
      else rpt.success(1);
    }
  }

  const result = rpt.summary();
  log(PHASE, "\n=== 완료 ===");
  if (result.fail > 0) process.exit(1);
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
