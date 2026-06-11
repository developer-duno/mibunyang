// @ts-check
/**
 * childcare 수집기 3종 로컬(집서버) 디스패처 — 세션 399 (2026-06-11)
 *
 * 배경: api.childcare.go.kr (평문 HTTP) 가 해외 클라우드 IP 를 차단해 (GitHub Actions
 * 러너 = 해외 Azure IP 에서 세종 등 "fetch failed" 연쇄 → childcare-detail 이 매일
 * 60분 timeout cancelled, info/jeju 도 동일 endpoint) KOSIS 와 같은 사고. 로컬(한국 IP)
 * 동일 stcode 직접 호출 = 200 OK 550ms 정상 → 외부 영구장애 아닌 해외 IP 차단.
 * 본 러너 + Windows 작업 스케줄러(매일 04:30 KST, 작업명 "MibunyangChildcareLocal")로 이전.
 * 같은 PR 에서 GH collect-childcare-detail.yml / collect-childcare-jeju.yml 삭제 +
 * collect-childcare.yml 의 info step 제거(Kakao step 보존) + monitor 목록 조정
 * + EXTERNAL_API_COLLECTORS 등재(collector_runs 기반 "안 돌면 알림" 보존).
 *
 * KOSIS 러너(kosis-local-runner.mjs)와 차이: KOSIS 는 월간이라 DAY_TABLE 일자 디스패치이나,
 * childcare 는 매일 3종 전부 실행한다 (detail = DAILY_LIMIT 1000/일 누적 ~23일,
 * info 243건/jeju 2건 = 양 적어 매일 돌려 항상 최신). → 일자 매핑 불필요, 고정 배열.
 *
 * 사용법:
 *   node scripts/childcare-local-runner.mjs            3종 전부 실행
 *   node scripts/childcare-local-runner.mjs --dry-run  수집기에 --dry-run 전달
 *   node scripts/childcare-local-runner.mjs --list      대상 목록 출력만
 *
 * 실패 처리: 하나라도 exit!=0 이면 텔레그램 best-effort 알림 + exit 1 (silent fail 금지).
 * 수집기 자체가 collector_runs 를 기록하므로 모니터의 데이터0건·외부API stale 감시 유지.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv, log, logError } from "./collectors/_shared.mjs";
import { sendTelegram } from "./notify-telegram.mjs";

const PHASE = "childcare-local-runner";
const COLLECTORS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "collectors");

/**
 * 매일 실행할 childcare 수집기 (전부 api.childcare.go.kr 평문 HTTP, 해외 IP 차단 대상).
 * Kakao 기반 collect-childcare.mjs / DB 가공 collect-nearby-childcare.mjs 는 GH 에 남아 제외.
 * @type {string[]}
 */
export const CHILDCARE_COLLECTORS = [
  "childcare-detail.mjs",
  "childcare-info.mjs",
  "childcare-info-jeju.mjs",
];

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");

  if (process.argv.includes("--list")) {
    for (const script of CHILDCARE_COLLECTORS) {
      log(PHASE, `매일: ${script}`);
    }
    return;
  }

  // KST 로컬 날짜 — toISOString() 은 UTC 라 04:30 KST 실행 시 전일로 표기됨.
  const date = new Date();
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  log(
    PHASE,
    `${dateStr}: ${CHILDCARE_COLLECTORS.length}개 실행 — ${CHILDCARE_COLLECTORS.join(", ")}${dryRun ? " (dry-run)" : ""}`,
  );

  /** @type {string[]} */
  const failures = [];
  for (const script of CHILDCARE_COLLECTORS) {
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
        `🔴 [childcare-local-runner] ${dateStr} 실패 ${failures.length}/${CHILDCARE_COLLECTORS.length}: ${failures.join(", ")}\n집서버 F:\\mibunyang 로그 확인 필요`,
      );
      if (!res.sent) logError(PHASE, `텔레그램 미전송: ${res.reason ?? "unknown"}`);
    } catch {
      /* best-effort */
    }
    process.exit(1);
  }

  log(PHASE, `완료: ${CHILDCARE_COLLECTORS.length}개 전부 성공`);
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
