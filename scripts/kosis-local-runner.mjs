// @ts-check
/**
 * 해외 IP 차단 수집기 로컬(집서버) 디스패처 — KOSIS 11종 + 국토부(MOLIT) 5종 + 네이버 개발계획 1종
 *
 * 배경 1 (세션 288, 2026-06-10): kosis.kr 이 해외 클라우드 IP 를 차단해 (6/8 밤 성공 →
 * 6/9 밤부터 4연속 "fetch failed" 네트워크 레벨 실패, 로컬 동일 키 0.5s 200 OK 실측)
 * GitHub Actions 러너(해외 Azure)에서 KOSIS 호출 수집기 10종이 전부 죽었다.
 * 배경 2 (세션 515, 2026-08-15): apis.data.go.kr 의 **국토부(1613000) 서비스**도 2026-08-06
 * 부터 GH 러너를 복불복 차단한다 (HTTP 코드 없는 `fetch failed` / 로컬 한국 IP 는 156ms
 * 200 OK 실측). 1613000 의존 5종(trades·molit-units·molit-building-info·maintenance·
 * building-hub)을 같은 방식으로 이전 — GH collect-*.yml 5개 삭제 + monitor 목록 제거
 * (stale 오탐 차단) + EXTERNAL_API_COLLECTORS 등재(collector_runs 기반 "안 돌면 알림" 보존).
 *
 * 실행 = 본 러너 + Windows 작업 스케줄러(매일 05:30 KST, 작업명 "MibunyangKosisLocal").
 *
 * 일자 매핑 = 기존 UTC cron 이 실제 발화하던 KST 날짜 보존 (UTC 20~22시 = KST 익일 새벽):
 *   2일 housing-supply / 6일 market-stats·molit-units·trades / 7일 migration / 9일 unsold /
 *   10일 fertility·building-info(토요일이면 11일) / 11일 housing-permits /
 *   12일 regional-economy / 13일 avg-income / 14일 medical-access /
 *   15~19일 maintenance(--limit=600 배치) / 15일 building-hub(1·4·7·10월만) /
 *   17일 sale-price(1·4·7·10월만) / 18일 jeonse
 * 세션 517 추가: 20일 naver-devplan(--kinds=road,rail,station,jigu) — 옛 cron 이 아니라 신규 편입.
 *   네이버 개발계획 API 도 한국 IP 가 필요해 같은 러너에 실었다(data.go.kr 쿼터는 0 소모).
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
 * 일자(KST) → 수집기.
 *   months           있으면 해당 월에만 (분기 cron 이식)
 *   args             수집기에 넘길 고정 인자 (GH yml 이 넘기던 것 보존)
 *   skipIfDow        그 날의 요일(0=일..6=토)이면 건너뜀
 *   onlyIfPrevDayDow 전날 요일이 이 값일 때만 실행 (skipIfDow 로 미룬 회차의 보충)
 * @type {Array<{ day: number, script: string, months?: number[], args?: string[], skipIfDow?: number, onlyIfPrevDayDow?: number }>}
 */
export const DAY_TABLE = [
  { day: 2, script: "collect-housing-supply-ratio.mjs" },
  { day: 6, script: "collect-market-stats.mjs" },
  // 세션 515: MOLIT(1613000) 해외 IP 차단 → GH collect-molit-units.yml·collect-trades.yml 삭제.
  // trades 는 가장 오래 걸려(실측 74~120분) 같은 날 마지막에 둔다.
  { day: 6, script: "molit-units.mjs" },
  { day: 6, script: "collect-trades.mjs" },
  { day: 7, script: "migration.mjs" },
  { day: 9, script: "collect-unsold-kosis.mjs" },
  { day: 10, script: "collect-fertility-rate.mjs" },
  // 세션 515: 옛 collect-building-info.yml 의 "10일 토요일 → 11일 fallback" 이식.
  // 토요일은 자매 레포(naver-estate-web) public_data 가 data.go.kr 쿼터를 ~3,600회 쓰는 날이라
  // building-info(~8,500회)와 같은 날이면 일일 10,000 한도를 넘긴다.
  { day: 10, script: "molit-building-info.mjs", skipIfDow: 6 },
  { day: 11, script: "housing-permits.mjs" }, // 세션 501: MOLIT 폐기 → KOSIS DT_MLTM_666 이전
  { day: 11, script: "molit-building-info.mjs", onlyIfPrevDayDow: 6 },

  { day: 12, script: "collect-regional-economy.mjs" },
  { day: 13, script: "collect-avg-income.mjs" },
  { day: 14, script: "collect-medical-access.mjs" },
  // 세션 515: 옛 collect-maintenance.yml cron '0 6 15-19 * *' 이식. 5일 연속 = 미채움을
  // --limit=600(단지당 ~6회 호출 = 회차당 ~3,600회) 배치로 나눠 채우는 의도된 설계라
  // 일수·인자를 그대로 옮긴다 — 인자를 빼면 전 대상이 한 회차에 몰려 일일 쿼터를 넘긴다.
  { day: 15, script: "collect-maintenance.mjs", args: ["--limit=600"] },
  { day: 15, script: "collect-building-hub.mjs", months: [1, 4, 7, 10] },
  { day: 16, script: "collect-maintenance.mjs", args: ["--limit=600"] },
  { day: 17, script: "collect-maintenance.mjs", args: ["--limit=600"] },
  { day: 17, script: "collect-sale-price-index.mjs", months: [1, 4, 7, 10] },
  { day: 18, script: "collect-maintenance.mjs", args: ["--limit=600"] },
  { day: 18, script: "collect-jeonse-price-index.mjs" },
  { day: 19, script: "collect-maintenance.mjs", args: ["--limit=600"] },
  // 세션 517: naver-devplan 크론 편입. 20일 = 15~19일 maintenance 배치 직후 빈 슬롯이고,
  // 네이버 소스라 data.go.kr 일일 쿼터를 0 쓴다(다른 항목과 쿼터 충돌 없음).
  // --kinds 를 넘기면 V-WORLD 축(전량 ~7.5h·중간 체크포인트 없음)은 자동 스킵된다 —
  // 전량 수집은 체크포인트 설계 후 별도 트랙. 네이버 4종만 ≈30분.
  { day: 20, script: "naver-devplan.mjs", args: ["--kinds=road,rail,station,jigu"] },
];

/**
 * 주어진 날짜에 due 인 매핑표 항목.
 * @param {Date} date
 * @returns {typeof DAY_TABLE}
 */
export function entriesDueOn(date) {
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const dow = date.getDay();
  // 원본 변형 금지 — 호출처가 넘긴 Date 를 그대로 쓰면 하루가 조용히 밀린다.
  const prev = new Date(date.getTime());
  prev.setDate(prev.getDate() - 1);
  const prevDow = prev.getDay();
  return DAY_TABLE.filter(
    (e) =>
      e.day === day &&
      (!e.months || e.months.includes(month)) &&
      e.skipIfDow !== dow &&
      (e.onlyIfPrevDayDow === undefined || e.onlyIfPrevDayDow === prevDow),
  );
}

/**
 * 주어진 날짜에 due 인 수집기 스크립트 파일명 목록.
 * @param {Date} date
 * @returns {string[]}
 */
export function collectorsDueOn(date) {
  return entriesDueOn(date).map((e) => e.script);
}

/** 요일 라벨 (0=일). --list 게이트 표기용. */
const DOW_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * --list 한 줄. 게이트(분기월·요일 조건)를 사람이 읽는 형태로 붙인다.
 * @param {(typeof DAY_TABLE)[number]} e
 * @returns {string}
 */
export function describeEntry(e) {
  /** @type {string[]} */
  const gates = [];
  if (e.months) gates.push(`${e.months.join("·")}월만`);
  if (e.skipIfDow !== undefined) gates.push(`${DOW_LABEL[e.skipIfDow]}요일 제외`);
  if (e.onlyIfPrevDayDow !== undefined)
    gates.push(`전날이 ${DOW_LABEL[e.onlyIfPrevDayDow]}요일일 때만`);
  const gate = gates.length > 0 ? ` (${gates.join(", ")})` : "";
  const args = e.args?.length ? ` ${e.args.join(" ")}` : "";
  return `매월 ${e.day}일${gate}: ${e.script}${args}`;
}

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const dateArg = process.argv.find((a) => a.startsWith("--date="));
  const date = dateArg ? new Date(dateArg.slice(7)) : new Date();

  if (process.argv.includes("--list")) {
    for (const e of DAY_TABLE) log(PHASE, describeEntry(e));
    return;
  }

  const dueEntries = entriesDueOn(date);
  const due = dueEntries.map((e) => e.script);
  // KST 로컬 날짜 — toISOString() 은 UTC 라 05:30 KST 실행 시 전일로 표기됨 (디스패치 getDate() 와 통일)
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (due.length === 0) {
    log(PHASE, `${dateStr}: due 수집기 없음 — 종료`);
    return;
  }

  log(PHASE, `${dateStr}: ${due.length}개 실행 — ${due.join(", ")}${dryRun ? " (dry-run)" : ""}`);

  /** @type {string[]} */
  const failures = [];
  for (const entry of dueEntries) {
    const script = entry.script;
    const scriptPath = path.join(COLLECTORS_DIR, script);
    const args = [scriptPath, ...(entry.args ?? []), ...(dryRun ? ["--dry-run"] : [])];
    log(PHASE, `▶ ${script}${entry.args?.length ? ` ${entry.args.join(" ")}` : ""}`);
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
