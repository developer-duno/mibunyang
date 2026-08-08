// @ts-check
/**
 * KOSIS 수집기 10종 로컬(집서버) 디스패처 — 세션 288 (2026-06-10)
 *
 * 배경: kosis.kr 이 해외 클라우드 IP 를 차단해 (6/8 밤 성공 → 6/9 밤부터 4연속
 * "fetch failed" 네트워크 레벨 실패, 로컬 동일 키 0.5s 200 OK 실측) GitHub Actions
 * 러너(해외 Azure)에서 KOSIS 호출 수집기 10종이 전부 죽었다. 본 러너 + Windows
 * 작업 스케줄러(매일 05:30 KST, 작업명 "MibunyangKosisLocal")로 이전.
 * 같은 PR 에서 GH collect-*.yml 10개 삭제 + monitor 목록 제거(stale 오탐 차단)
 * + EXTERNAL_API_COLLECTORS 등재(collector_runs 기반 "안 돌면 알림" 보존).
 *
 * 일자 매핑 = 기존 UTC cron 이 실제 발화하던 KST 날짜 보존 (UTC 20~22시 = KST 익일 새벽):
 *   2일 housing-supply / 6일 market-stats / 7일 migration / 9일 unsold /
 *   10일 fertility / 12일 regional-economy / 13일 avg-income / 14일 medical-access /
 *   17일 sale-price(1·4·7·10월만) / 18일 jeonse
 *
 * 사용법:
 *   node scripts/kosis-local-runner.mjs                    오늘 due 수집기 실행
 *   node scripts/kosis-local-runner.mjs --date=2026-06-12  날짜 강제 (테스트)
 *   node scripts/kosis-local-runner.mjs --dry-run          수집기에 --dry-run 전달
 *   node scripts/kosis-local-runner.mjs --list             매핑표 출력만
 *
 * 실패 처리: 하나라도 exit!=0 이면 텔레그램 best-effort 알림 + exit 1 (silent fail 금지).
 * 수집기 자체가 collector_runs 를 기록하므로 모니터의 데이터0건·외부API stale 감시 유지.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv, log, logError } from "./collectors/_shared.mjs";
import { sendTelegram } from "./notify-telegram.mjs";

const PHASE = "kosis-local-runner";
const COLLECTORS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "collectors");

/**
 * 일자(KST) → 수집기. months 가 있으면 해당 월에만 (분기 cron 이식).
 * @type {Array<{ day: number, script: string, months?: number[] }>}
 */
export const DAY_TABLE = [
  { day: 2, script: "collect-housing-supply-ratio.mjs" },
  { day: 6, script: "collect-market-stats.mjs" },
  { day: 7, script: "migration.mjs" },
  { day: 9, script: "collect-unsold-kosis.mjs" },
  { day: 10, script: "collect-fertility-rate.mjs" },
  { day: 11, script: "housing-permits.mjs" }, // 세션 501: MOLIT 폐기 → KOSIS DT_MLTM_666 이전

  { day: 12, script: "collect-regional-economy.mjs" },
  { day: 13, script: "collect-avg-income.mjs" },
  { day: 14, script: "collect-medical-access.mjs" },
  { day: 17, script: "collect-sale-price-index.mjs", months: [1, 4, 7, 10] },
  { day: 18, script: "collect-jeonse-price-index.mjs" },
];

/**
 * 주어진 날짜에 due 인 수집기 스크립트 파일명 목록.
 * @param {Date} date
 * @returns {string[]}
 */
export function collectorsDueOn(date) {
  const day = date.getDate();
  const month = date.getMonth() + 1;
  return DAY_TABLE.filter((e) => e.day === day && (!e.months || e.months.includes(month))).map(
    (e) => e.script,
  );
}

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const dateArg = process.argv.find((a) => a.startsWith("--date="));
  const date = dateArg ? new Date(dateArg.slice(7)) : new Date();

  if (process.argv.includes("--list")) {
    for (const e of DAY_TABLE) {
      log(PHASE, `매월 ${e.day}일${e.months ? ` (${e.months.join("·")}월만)` : ""}: ${e.script}`);
    }
    return;
  }

  const due = collectorsDueOn(date);
  // KST 로컬 날짜 — toISOString() 은 UTC 라 05:30 KST 실행 시 전일로 표기됨 (디스패치 getDate() 와 통일)
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (due.length === 0) {
    log(PHASE, `${dateStr}: due 수집기 없음 — 종료`);
    return;
  }

  log(PHASE, `${dateStr}: ${due.length}개 실행 — ${due.join(", ")}${dryRun ? " (dry-run)" : ""}`);

  /** @type {string[]} */
  const failures = [];
  for (const script of due) {
    const scriptPath = path.join(COLLECTORS_DIR, script);
    const args = [scriptPath, ...(dryRun ? ["--dry-run"] : [])];
    log(PHASE, `▶ ${script}`);
    const res = spawnSync(process.execPath, args, { stdio: "inherit" });
    if (res.status !== 0) {
      failures.push(script);
      logError(PHASE, `${script} 실패 (exit ${res.status})`);
    }
  }

  if (failures.length > 0) {
    // 알림 실패가 러너를 죽이면 안 됨 (notify-telegram 철학) — best-effort.
    // sendTelegram 은 throw 하지 않고 {sent,reason} 반환 — 미전송(키 미설정 등)을 로그로 남겨 무음 차단.
    try {
      const res = await sendTelegram(
        `🔴 [kosis-local-runner] ${dateStr} 실패 ${failures.length}/${due.length}: ${failures.join(", ")}\n집서버 F:\\mibunyang 로그 확인 필요`,
      );
      if (!res.sent) logError(PHASE, `텔레그램 미전송: ${res.reason ?? "unknown"}`);
    } catch {
      /* best-effort */
    }
    process.exit(1);
  }

  log(PHASE, `완료: ${due.length}개 전부 성공`);
}

const argv1 = process.argv[1];
const isCLI =
  !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((/** @type {unknown} */ err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
