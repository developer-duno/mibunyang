// @ts-check
/**
 * `notification_logs` 표가 운영 DB 에 적용됐는지 확인한다 — 세션556.
 *
 * ## 왜 필요한가
 *
 * 마이그(`supabase/migrations/20260703000000_create_notification_logs.sql`)는 레포에 있지만
 * **Dashboard 에서 사람이 실행해야** 적용된다(`supabase/CLAUDE.md` 수동 실행 절).
 * 적용 전에는 `notify-subscribers.mjs:413` 의 upsert 가 던지고, 그 시점은 **첫 구독자가
 * 생기는 날**이라 조용히 잠복한다(세션544 발견, 세션556 재확인: subscribers 0행).
 *
 * ## 판정법 — `head: true` 로는 표 부재를 못 잡는다
 *
 * `select("*", { count: "exact", head: true })` 는 **존재하지 않는 표에도** `error=none`·
 * `count=null` 을 돌려준다(세션544 실측). 그래서 실제 `select().limit(1)` 의 에러 코드로 판정하고,
 * **음성 대조군**(없는 것이 확실한 표)을 함께 조회해 그 코드가 "표 없음"의 신호가 맞는지 확인한다
 * ([[probe-must-be-self-verified]] §4-1).
 *
 *   node scripts/check-notification-logs.mjs
 *
 * 필요 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, logError } from "./collectors/_shared.mjs";

const PHASE = "check-notification-logs";
/** 존재하지 않는 것이 확실한 표 — "표 없음" 에러 코드의 대조군. */
const NEGATIVE_CONTROL = "definitely_not_a_table_xyz";

/**
 * 표 하나를 실제 select 로 두드려 본다.
 * @param {any} sb
 * @param {string} table
 * @returns {Promise<{ exists: boolean, code: string, rows: number | null }>}
 */
export async function probeTable(sb, table) {
  const { data, error } = await sb.from(table).select("*").limit(1);
  return {
    exists: !error,
    code: error?.code ?? "none",
    rows: data?.length ?? null,
  };
}

async function main() {
  loadEnv();
  const sb = getSupabase();

  const control = await probeTable(sb, NEGATIVE_CONTROL);
  const target = await probeTable(sb, "notification_logs");
  const subs = await probeTable(sb, "subscribers");

  log(PHASE, `음성 대조군(${NEGATIVE_CONTROL}): ${control.code}  ← "표 없음" 의 신호`);
  log(PHASE, `subscribers: ${subs.code}`);
  log(PHASE, `notification_logs: ${target.code}`);

  if (control.exists) {
    logError(PHASE, "대조군 표가 존재한다고 나온다 — 이 판정법을 믿을 수 없다. 중단.");
    process.exit(2);
  }

  if (!target.exists) {
    if (target.code !== control.code) {
      logError(PHASE, `표가 없는 것과 다른 에러다(${target.code} ≠ ${control.code}) — 권한·연결 문제일 수 있다.`);
      process.exit(2);
    }
    logError(PHASE, "");
    logError(PHASE, "notification_logs 표가 **아직 없습니다** ❌");
    logError(PHASE, "  → artifacts/notification-logs-적용안내.md 의 순서대로 Dashboard 에서 실행해 주세요.");
    logError(PHASE, "  ⚠️ 그 파일이 말하듯 `NOTIFY pgrst` 줄은 넣지 마세요(SQL Editor 미지원, 42601).");
    process.exit(1);
  }

  // 존재한다 — 행 수와 쓰기 차단(RLS) 여부를 함께 본다.
  const { count } = await sb.from("notification_logs").select("*", { count: "exact", head: true });
  log(PHASE, "");
  log(PHASE, `notification_logs 표 존재 ✅ · 행 ${count ?? 0}개`);

  // service_role 로는 RLS 를 우회하므로 여기서 "잠겼는지" 는 확인할 수 없다.
  // 마이그가 ENABLE ROW LEVEL SECURITY 를 포함하고 정책이 0개라는 사실이 근거다.
  log(PHASE, "RLS 는 마이그가 켠다(정책 0개 = 외부 전면 차단) — service_role 경유라 여기서는 검증 불가");
  log(PHASE, "");
  log(PHASE, "=== 적용 완료 ===");
}

const argv1 = process.argv[1];
const isCLI =
  !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(2);
  });
}
