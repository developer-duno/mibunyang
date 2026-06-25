// @ts-check
/**
 * 보존기간(365일) 경과 상담 기록 자동 파기 (PIPA §21 — 보유기간 경과 시 파기, 세션 443 D4)
 *
 * privacy.html "상담 신청 정보는 신청일로부터 1년간 보관 후 파기" 약속 이행.
 * consults.submitted_at < (now - RETENTION_DAYS) 행을 DELETE.
 *
 * - 보존기간: RETENTION_DAYS = 365 (1년). 부동산 상담은 시세·분양 일정에 민감해
 *   1년 지나면 재활용 가치 거의 없음 + 개인정보 최소화 원칙/PIPA 정합.
 * - --dry-run: 삭제 대상 건수만 출력, 실제 DELETE 안 함 (첫 배포 실증용).
 * - 되돌릴 수 없는 삭제이므로 항상 삭제 전 count 로그 + collector_runs 기록.
 *
 * 실행:
 *   node scripts/purge-old-consults.mjs           # 실삭제
 *   node scripts/purge-old-consults.mjs --dry-run # 미리보기만
 */
import { loadEnv, getMibuyangSupabase, recordCollectorRun, log, logError } from "./collectors/_shared.mjs";

export const RETENTION_DAYS = 365;
const PHASE = "purge-consults";

/** 보존기간 컷오프 ISO 시각 — submitted_at 이 이 시각보다 오래면 파기 대상 */
export function cutoffIso(retentionDays = RETENTION_DAYS, now = new Date()) {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * 보존기간 경과 상담 파기 (테스트 가능 — sb 주입).
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {{ dryRun?: boolean, retentionDays?: number, now?: Date }} [opts]
 * @returns {Promise<{ cutoff: string, matched: number, deleted: number, dryRun: boolean }>}
 */
export async function purgeOldConsults(sb, opts = {}) {
  const { dryRun = false, retentionDays = RETENTION_DAYS, now = new Date() } = opts;
  const cutoff = cutoffIso(retentionDays, now);

  // 1. 삭제 대상 건수 먼저 집계 (되돌릴 수 없는 삭제 — 항상 count 로그)
  const { count, error: countErr } = await sb
    .from("consults")
    .select("*", { count: "exact", head: true })
    .lt("submitted_at", cutoff);
  if (countErr) throw new Error(`count 실패: ${countErr.message}`);

  const matched = count ?? 0;
  log(PHASE, `보존기간 ${retentionDays}일 컷오프=${cutoff} — 파기 대상 ${matched}건`);

  if (dryRun) {
    log(PHASE, `[dry-run] 실제 삭제 안 함 (${matched}건 대상)`);
    return { cutoff, matched, deleted: 0, dryRun: true };
  }

  if (matched === 0) {
    log(PHASE, "파기 대상 0건 — 삭제 생략");
    return { cutoff, matched: 0, deleted: 0, dryRun: false };
  }

  // 2. 실제 삭제
  const { error: delErr } = await sb
    .from("consults")
    .delete()
    .lt("submitted_at", cutoff);
  if (delErr) throw new Error(`삭제 실패: ${delErr.message}`);

  log(PHASE, `${matched}건 파기 완료`);
  return { cutoff, matched, deleted: matched, dryRun: false };
}

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const sb = getMibuyangSupabase();

  let result;
  try {
    result = await purgeOldConsults(sb, { dryRun });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(PHASE, msg);
    // recordCollectorRun 은 --dry-run 시 자동 skip (sbOverride 미전달).
    await recordCollectorRun(PHASE, { status: "failure", ok: 0, fail: 1, skip: 0, errorMessage: msg });
    process.exit(1);
  }

  // dry-run 은 recordCollectorRun 이 내부에서 자동 skip (collector_runs 오염 방지).
  await recordCollectorRun(PHASE, { status: "success", ok: result.deleted, fail: 0, skip: 0 });
}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, "/").split("/").pop() ?? ""
);
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
