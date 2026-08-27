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
 * 배경 3 (세션525, 2026-08-27): apis.data.go.kr 의 **국립중앙의료원(B552657)** 응급의료기관
 * 서비스도 같은 차단이다 — GH 8/02·8/04 연속 failure 로그가 `fetch failed`(HTTP 코드 없음)인데
 * 로컬 한국 IP + 같은 키는 `resultCode=00 NORMAL SERVICE`. `collect-emergency.yml` 삭제 + 편입.
 *
 * 실행 = 본 러너 + Windows 작업 스케줄러(매일 05:30 KST, 작업명 "MibunyangKosisLocal").
 *
 * 일자 매핑 = 기존 UTC cron 이 실제 발화하던 KST 날짜 보존 (UTC 20~22시 = KST 익일 새벽):
 *   2일 housing-supply / 3일 emergency / 6일 market-stats·molit-units·trades / 7일 migration / 9일 unsold /
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
 *   node scripts/kosis-local-runner.mjs --no-catchup       놓친 날 보충 없이 오늘만
 *
 * 놓친 날 보충 (세션521): 스케줄러가 `StartWhenAvailable=true` 라 PC 가 꺼져 있던 날의 발화를
 * 나중에 실행하는데, 러너는 **실행된 날짜**로만 판단해서 놓친 날의 수집기를 영영 건너뛴다.
 * 실측 사고 — 8/13 05:30 발화가 통째로 빠졌고 8/14 03:28 에 뒤늦게 돈 실행은 "8/14" 로 판단해
 * 14일분만 돌렸다. 그 결과 `avg-income` 이 **39일** 밀린 채 monitor ⑤ 가 잡을 때까지 잠복했다.
 * → `.kosis-local-runner-state.json` 에 마지막 처리일을 남기고, 다음 실행에서 빠진 날을 메운다.
 * ⚠️ **한 번에 하루치만** 메운다(`MAX_CATCHUP_PER_RUN`). 5일치를 한꺼번에 돌리면 maintenance
 * 같은 대용량 수집기가 data.go.kr 일일 10,000 한도를 그 자리에서 넘긴다 — 매일 하루씩 따라잡는다.
 *
 * 실패 처리: 하나라도 exit!=0 이면 텔레그램 best-effort 알림 + exit 1 (silent fail 금지).
 * 수집기 자체가 collector_runs 를 기록하므로 모니터의 데이터0건·외부API stale 감시 유지.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv, log, logError } from "./collectors/_shared.mjs";
import { sendTelegram } from "./notify-telegram.mjs";

const PHASE = "kosis-local-runner";
const COLLECTORS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "collectors");

/** 마지막으로 처리한 날짜를 남기는 자리(gitignore). 유실돼도 사고가 아니다 — 소급만 못 할 뿐이다. */
const STATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".kosis-local-runner-state.json");

/**
 * 한 번 실행에서 메울 수 있는 **놓친 날의 최대 개수**.
 * 1 인 이유 = 쿼터. 15~19일 maintenance 는 회차당 약 3,600 회를 쓰는데 5일치를 한꺼번에 돌리면
 * data.go.kr 일일 10,000 한도를 그 자리에서 넘긴다. 매일 하루씩 따라잡으면 며칠 걸려도 안전하다.
 */
const MAX_CATCHUP_PER_RUN = 1;

/** 이만큼보다 더 벌어지면 조용히 메우지 않고 **로그로 알린다**(사람이 판단할 자리). */
const CATCHUP_STALE_WARN_DAYS = 10;

/** `Date` → KST 기준 `"YYYY-MM-DD"`. `toISOString()` 은 UTC 라 05:30 실행 시 전일이 된다. */
export function ymd(/** @type {Date} */ date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * 이번 실행에서 처리할 날짜 목록 — **오래된 것부터**, 마지막이 오늘.
 *
 * 상태 파일이 없거나(첫 실행) 형식이 깨졌거나 미래·같은 날이면 오늘 하나만 돌려준다.
 * 놓친 날이 여럿이면 `maxCatchup` 개만 **가장 오래된 쪽부터** 집는다 — 오래 밀린 것을 먼저 푸는
 * 편이 데이터 공백을 줄인다.
 *
 * @param {string | null | undefined} lastProcessed `"YYYY-MM-DD"` 또는 없음
 * @param {Date} today
 * @param {number} [maxCatchup]
 * @returns {string[]} 처리할 날짜 — 항상 마지막 원소가 오늘
 */
export function datesToProcess(lastProcessed, today, maxCatchup = MAX_CATCHUP_PER_RUN) {
  const todayStr = ymd(today);
  if (!lastProcessed || !/^\d{4}-\d{2}-\d{2}$/.test(lastProcessed)) return [todayStr];

  const cur = new Date(`${lastProcessed}T00:00:00`);
  if (Number.isNaN(cur.getTime())) return [todayStr];

  /** @type {string[]} */
  const missed = [];
  cur.setDate(cur.getDate() + 1);
  // 오늘 **전날**까지가 놓친 날 — 오늘은 아래에서 따로 붙인다(중복 방지).
  while (ymd(cur) < todayStr) {
    missed.push(ymd(cur));
    cur.setDate(cur.getDate() + 1);
    if (missed.length > 400) break; // 상태 파일이 망가져도 무한 루프는 없다
  }
  return [...missed.slice(0, Math.max(0, maxCatchup)), todayStr];
}

/** `"YYYY-MM-DD"` 두 날 사이 일수. 상태 파일이 깨졌으면 0(=경고 안 함). */
export function daysBetween(/** @type {string} */ fromStr, /** @type {string} */ toStr) {
  const a = new Date(`${fromStr}T00:00:00`);
  const b = new Date(`${toStr}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** 놓친 날이 이만큼 넘게 쌓였는지 — 참이면 조용히 메우지 말고 사람에게 알린다. */
export function isCatchupStale(/** @type {number} */ missedCount, warnDays = CATCHUP_STALE_WARN_DAYS) {
  return missedCount > warnDays;
}

/** 상태 파일에서 마지막 처리일 읽기. 깨져 있으면 없는 셈 친다(소급만 못 할 뿐). */
export function readLastProcessed(statePath = STATE_PATH) {
  try {
    if (!existsSync(statePath)) return null;
    const j = JSON.parse(readFileSync(statePath, "utf8"));
    return typeof j?.lastProcessed === "string" ? j.lastProcessed : null;
  } catch {
    return null;
  }
}

/** 마지막 처리일 기록. 실패해도 러너를 죽이지 않는다 — 다음 실행이 소급을 못 할 뿐이다. */
export function writeLastProcessed(/** @type {string} */ dateStr, statePath = STATE_PATH) {
  try {
    writeFileSync(statePath, JSON.stringify({ lastProcessed: dateStr }, null, 2), "utf8");
    return true;
  } catch (e) {
    logError(PHASE, `상태 파일 기록 실패(${statePath}): ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/**
 * 일자(KST) → 수집기.
 *   day              매월 이 날짜(KST)에 실행. `dow` 와 **둘 중 하나만** 쓴다
 *   dow              매주 이 요일(0=일..6=토, KST)에 실행 — 주간 cron 이식용(세션519)
 *   months           있으면 해당 월에만 (분기 cron 이식)
 *   args             수집기에 넘길 고정 인자 (GH yml 이 넘기던 것 보존)
 *   skipIfDow        그 날의 요일(0=일..6=토)이면 건너뜀
 *   onlyIfPrevDayDow 전날 요일이 이 값일 때만 실행 (skipIfDow 로 미룬 회차의 보충)
 *
 * ⚠️ **GH cron 을 이식할 땐 UTC→KST(+9h) 로 날짜·요일을 다시 계산한다.** 러너는 KST 05:30 에
 * 도는데 이 표도 KST 기준이라, cron 의 숫자를 그대로 베끼면 하루/한 요일이 밀린다.
 * 실례(세션519): `0 22 16 * *`(UTC 16일 22시)는 **KST 17일** 07시고,
 * `0 15 * * 1`(UTC 월 15시)은 **KST 화요일** 00시다.
 * @type {Array<{ day?: number, dow?: number, script: string, months?: number[], args?: string[], skipIfDow?: number, onlyIfPrevDayDow?: number }>}
 */
export const DAY_TABLE = [
  { day: 2, script: "collect-housing-supply-ratio.mjs" },
  // 세션525(본 세션): apis.data.go.kr **B552657**(국립중앙의료원 응급의료기관)도 해외 IP 를 막는다.
  // 8/02·8/04 GH 연속 failure 로그가 `[emergency] ERROR: fetch failed`(HTTP 코드 없음)인데,
  // 같은 요청을 로컬 한국 IP + 같은 키로 던지니 `resultCode=00 NORMAL SERVICE` 였다.
  // 세션515(1613000 5종)·세션519(www.data.go.kr·B552584 2종)와 같은 처방 —
  // `collect-emergency.yml` 삭제 + 러너 편입. B552657 은 이 저장소에서 처음 막힌 서비스다.
  // ⚠️ **UTC→KST 재계산**: 옛 cron `0 16 2 * *` 은 UTC 2일 16:00 = **KST 3일** 01:00 이다.
  //    숫자를 그대로 베껴 2일에 두면 하루 당겨지고, 같은 날 housing-supply-ratio 와 겹친다.
  { day: 3, script: "collect-emergency.mjs" },
  { day: 6, script: "collect-market-stats.mjs" },
  // 세션 515: MOLIT(1613000) 해외 IP 차단 → GH collect-molit-units.yml·collect-trades.yml 삭제.
  // trades 는 가장 오래 걸려(실측 74~120분) 같은 날 마지막에 둔다.
  { day: 6, script: "molit-units.mjs" },
  { day: 6, script: "collect-trades.mjs" },
  { day: 7, script: "migration.mjs" },
  // 세션521: 외부 API 를 안 쓰는 유일한 등재분(data/crime-safety-index.csv 파싱).
  // 옛 판단은 "CSV 가 연 1회 갱신이라 자동화할 대상이 없다" 였는데, 채우는 대상인
  // **regions 에는 매월 새 recorded_at 행이 생긴다** — CSV 가 그대로여도 돌릴 이유가 있다.
  // 실측: 2026-04·05·06월 행이 통째로 NULL(수집기 마지막 실행이 3월경)이라 NULL 비율이
  // 계속 올라 monitor 경보가 영구화되고 있었다. 8일 = 행 생성자(population 5일·
  // market-stats 6일) **뒤**여야 새 행을 덮는다([[regions-multicollector-recorded-at-lag]]).
  { day: 8, script: "collect-crime-safety.mjs" },
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
  // 세션519: www.data.go.kr 도 해외 IP 를 막는다 — GH 는 7/16·8/16 연속 `fetch failed`(HTTP 코드
  // 없음)인데 같은 URL 이 로컬 한국 IP 에선 166ms 200 OK. 옛 cron `0 22 16 * *`(UTC)는 **KST 17일**.
  { day: 17, script: "collect-housing-price.mjs" },
  { day: 18, script: "collect-maintenance.mjs", args: ["--limit=600"] },
  { day: 18, script: "collect-jeonse-price-index.mjs" },
  { day: 19, script: "collect-maintenance.mjs", args: ["--limit=600"] },
  // 세션 517: naver-devplan 크론 편입. 20일 = 15~19일 maintenance 배치 직후 빈 슬롯이고,
  // 네이버 소스라 data.go.kr 일일 쿼터를 0 쓴다(다른 항목과 쿼터 충돌 없음).
  // --kinds 를 넘기면 V-WORLD 축(전량 ~7.5h·중간 체크포인트 없음)은 자동 스킵된다 —
  // 전량 수집은 체크포인트 설계 후 별도 트랙. 네이버 4종만 ≈30분.
  { day: 20, script: "naver-devplan.mjs", args: ["--kinds=road,rail,station,jigu"] },
  // 세션522: 택지정보시스템(openapi.jigu.go.kr) 지구단계정보 → dev_plans.progression_step(lh_zone).
  // 21일 = 20일 naver-devplan **다음날**. 순서에 뜻이 있다 — 네이버/V-WORLD 축이 먼저 지구 목록을
  // 새로 긁고, 이 수집기가 그 위에 정부 장부의 조성 단계를 덮는다(신규 지구도 같은 달에 채워진다).
  // 원본이 월간 갱신(고시월 단위)이고 외부 API 키가 없어 data.go.kr 일일 쿼터를 0 쓴다.
  { day: 21, script: "lhzone-status.mjs" },
  // 세션519: apis.data.go.kr/B552584(에어코리아)도 같은 차단 — GH 8회 중 2회만 성공(25%,
  // 러너 IP 복불복)인데 로컬은 92ms 200 OK. 옛 cron `0 15 * * 1`(UTC 월)은 **KST 화요일**.
  { dow: 2, script: "collect-air-quality.mjs" },
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
      // 주간 항목(dow)과 월간 항목(day)은 배타 — dow 가 있으면 그것만 본다(세션519).
      (e.dow !== undefined ? e.dow === dow : e.day === day) &&
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
  const when = e.dow !== undefined ? `매주 ${DOW_LABEL[e.dow]}요일` : `매월 ${e.day}일`;
  return `${when}${gate}: ${e.script}${args}`;
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

  // 놓친 날 보충 — `--date=` 강제나 `--no-catchup` 이면 그 날 하나만 본다.
  // (세션521: 스케줄러가 놓친 발화를 뒤늦게 실행하면 러너가 "오늘" 로만 판단해 그 날을 영영 건너뛴다)
  const noCatchup = process.argv.includes("--no-catchup") || Boolean(dateArg);
  const lastProcessed = noCatchup ? null : readLastProcessed();
  const targets = noCatchup ? [ymd(date)] : datesToProcess(lastProcessed, date);
  const missedCount = targets.length - 1;
  if (missedCount > 0) {
    log(PHASE, `놓친 날 보충: ${targets.slice(0, -1).join(", ")} (마지막 처리 ${lastProcessed})`);
  }
  if (lastProcessed && isCatchupStale(daysBetween(lastProcessed, ymd(date)))) {
    // 조용히 몰아서 돌리지 않는다 — 쿼터도 위험하고, 이만큼 밀렸으면 원인부터 봐야 한다.
    logError(
      PHASE,
      `마지막 처리(${lastProcessed}) 이후 ${daysBetween(lastProcessed, ymd(date))}일 경과 — ` +
        `하루에 ${MAX_CATCHUP_PER_RUN}일씩만 메웁니다. 급하면 --date=YYYY-MM-DD 로 직접 보충하세요.`,
    );
  }

  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const ranAll = [];

  for (const targetStr of targets) {
    const targetDate = new Date(`${targetStr}T00:00:00`);
    const dueEntries = entriesDueOn(targetDate);
    const due = dueEntries.map((e) => e.script);
    if (due.length === 0) {
      log(PHASE, `${targetStr}: due 수집기 없음`);
      continue;
    }
    log(PHASE, `${targetStr}: ${due.length}개 실행 — ${due.join(", ")}${dryRun ? " (dry-run)" : ""}`);
    ranAll.push(...due);
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
  }

  const dateStr = targets[targets.length - 1];
  // 실패해도 기록한다 — 안 그러면 같은 날을 매일 재시도해 쿼터만 태운다. 실패는 아래 텔레그램이 알린다.
  if (!dryRun && !dateArg) writeLastProcessed(dateStr);

  if (ranAll.length === 0) {
    log(PHASE, `${dateStr}: due 수집기 없음 — 종료`);
    return;
  }
  const due = ranAll;

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
