// @ts-check
// 일회성: apartments.energy_grade 오염값 NULL 정리 (세션 358)
/**
 * apartments.energy_grade 오염값 NULL 정리
 *
 * 사고: molit-building-info.mjs 가 국토부 공동주택 상세 API 의 kaptdEcnt/kaptdEcntp
 * (= 승강기 대수) 를 에너지효율등급(1~7)으로 오인해, 우연히 1~7대인 단지 358건의
 * "승강기 대수" 를 energy_grade 로 오저장. raw API 실측으로 확정 (값 0/5/8/21 = 등급 불가).
 * 주거용 아파트 에너지효율등급은 공공 data.go.kr API 미제공 (정상 소스 부재).
 *
 * 수집기 버그는 동일 세션에서 제거 완료 (extractBuildingInfo energy_grade 추출 삭제).
 * 본 스크립트는 이미 오저장된 DB 값만 정리. cron 은 NULL 을 덮어쓰지 않으므로 명시 UPDATE 필요.
 *
 * 사용법:
 *   node scripts/cleanup-energy-grade.mjs --dry-run   (대상만 확인)
 *   node scripts/cleanup-energy-grade.mjs             (실제 NULL UPDATE)
 */
import { loadEnv, getSupabase, log } from "./collectors/_shared.mjs";

const PHASE = "cleanup-energy-grade";

async function main() {
  loadEnv();
  const sb = getSupabase();
  const dryRun = process.argv.includes("--dry-run");

  // 1. 정리 대상 확인
  const { count: before, error: e0 } = await sb
    .from("apartments")
    .select("id", { count: "exact", head: true })
    .not("energy_grade", "is", null);
  if (e0) throw new Error(`대상 조회 실패: ${e0.message}`);
  log(PHASE, `정리 대상 (energy_grade non-null): ${before}건`);

  if (!before) {
    log(PHASE, "정리 대상 0건 — 이미 정리됨. 종료.");
    return;
  }

  if (dryRun) {
    log(PHASE, `[DRY-RUN] ${before}건을 energy_grade=NULL 로 UPDATE 예정 (실행 안 함)`);
    return;
  }

  // 2. NULL UPDATE — non-null 인 행만 대상 (PostgREST 는 전체 행 UPDATE 시 필터 필요)
  const { error } = await sb
    .from("apartments")
    .update({ energy_grade: null })
    .not("energy_grade", "is", null);
  if (error) throw new Error(`UPDATE 실패: ${error.message}`);

  // 3. 검증 — 0건이어야 함
  const { count: after, error: e1 } = await sb
    .from("apartments")
    .select("id", { count: "exact", head: true })
    .not("energy_grade", "is", null);
  if (e1) throw new Error(`검증 조회 실패: ${e1.message}`);

  log(PHASE, `정리 완료: ${before}건 → energy_grade=NULL. 잔여 non-null: ${after}건`);
  if (after !== 0) throw new Error(`정리 미완 — 잔여 ${after}건 (재실행 필요)`);
}

main().catch((err) => {
  console.error(`[${PHASE}] ERROR:`, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
