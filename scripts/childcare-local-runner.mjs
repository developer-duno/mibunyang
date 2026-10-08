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
 * childcare 는 고정 배열 3종을 한 번에 실행한다 (detail = 시군구당 1회 ≈260회, 세션606).
 * 세션612: 매일 → **화요일만**(`shouldRunToday`). 작업 스케줄러는 매일 04:30 그대로, 다른 요일은 로그 한 줄 + exit 0.
 *
 * 사용법:
 *   node scripts/childcare-local-runner.mjs            화요일(KST)이면 3종 실행, 아니면 건너뜀
 *   node scripts/childcare-local-runner.mjs --force    요일 무관 3종 실행(보충·손 실행)
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
 * 실행할 childcare 수집기 — 세션612부터 화요일만 (전부 api.childcare.go.kr 평문 HTTP, 해외 IP 차단 대상).
 * Kakao 기반 collect-childcare.mjs / DB 가공 collect-nearby-childcare.mjs 는 GH 에 남아 제외.
 * 세션606: childcare-detail.mjs 복귀 — 시군구당 1회(arcode = GU_LAWD_MAP)로 고쳐 매일 ≈260회, 목록(info) 뒤에 돈다.
 * @type {string[]}
 */
export const CHILDCARE_COLLECTORS = [
  "childcare-info.mjs",
  "childcare-info-jeju.mjs",
  "childcare-detail.mjs",
];

/**
 * 세션612(사장님 결정 ⑨): 3종을 주 1회 — **화요일(KST)만** 돈다. 어린이집 정보는 매일 바뀌지 않는데
 * 매일 3종을 다 부르던 외부 호출을 주 1회로 줄인다. Windows 작업 `MibunyangChildcareLocal` 은 매일 04:30 그대로 두고
 * 러너가 요일로 거른다(작업 재등록 없음). 러너 생존 신호는 kosis 러너의 air-quality(감시 stale 3)가 맡는다.
 * 감시 ⑤ 의 childcare 3종 stale_days 는 주간 14 — 이 값을 바꾸면 그쪽도 같이.
 */
export const CHILDCARE_RUN_DOW = 2;

/**
 * 오늘 3종을 돌릴지. 시각은 밖에서 넣는다(시험 고정용). PC 시간대에 기대지 않게 UTC+9 로 KST 요일을 잰다.
 * @param {Date} now
 * @param {boolean} force `--force` — 요일 무관 실행(놓친 주 보충·손 실행)
 * @returns {boolean}
 */
export function shouldRunToday(now, force) {
  if (force) return true;
  const kstDow = new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCDay();
  return kstDow === CHILDCARE_RUN_DOW;
}

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");

  if (process.argv.includes("--list")) {
    for (const script of CHILDCARE_COLLECTORS) {
      log(PHASE, `매주 화요일: ${script}`);
    }
    return;
  }

  // KST 로컬 날짜 — toISOString() 은 UTC 라 04:30 KST 실행 시 전일로 표기됨.
  const date = new Date();
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  if (!shouldRunToday(date, force)) {
    log(PHASE, `${dateStr}: 오늘은 건너뜀 — 어린이집 3종은 화요일만 돈다(세션612). 보충은 --force`);
    return;
  }

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
