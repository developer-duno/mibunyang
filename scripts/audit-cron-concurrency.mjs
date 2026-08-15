// @ts-check
// ⚠️ shebang(`#!/usr/bin/env node`)을 넣지 말 것 — 이 저장소의 다른 audit 3종도 없다.
// vite(vitest) 의 shebang 처리가 CR 을 못 다뤄, 윈도우에서 git 이 이 파일을 CRLF 로
// 체크아웃하면 이 모듈을 import 하는 테스트가 `SyntaxError: Invalid or unexpected token`
// 으로 통째로 죽는다(세션 500 실측: shebang+LF 통과 / shebang+CRLF 실패 / shebang없음 통과).
// 리눅스 러너는 LF 로 받아 CI 는 초록이라 **윈도우 로컬에서만 깨지는** 유형이다.
// 실행은 `node scripts/audit-cron-concurrency.mjs` 라 shebang 은 어차피 쓰이지 않는다.
/**
 * concurrency 그룹 안 "조용한 취소" 차단 감사 (세션 500)
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────────────
 * GitHub 공식 규칙(docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency):
 *   "When a concurrent job or workflow is queued, if another job or workflow using the same
 *    concurrency group in the repository is in progress, the queued job or workflow will be `pending`."
 *   "By default, any existing `pending` job or workflow in the same concurrency group will be
 *    canceled and the new queued job or workflow will take its place."
 *
 * → 한 그룹은 **실행 1개 + 대기 1개**까지만 유지한다. 어떤 회차가 그룹을 잡고 있는 동안
 *   다른 회차가 **2개 이상** 도착하면, 먼저 대기하던 쪽이 조용히 취소된다.
 *
 * 이 취소는 job 이 시작조차 안 하므로 `steps: []` 로 끝나고 `collector_runs` 행도 남지 않는다.
 * 즉 **monitor-collectors 가 못 잡는 사각**이다. 사람이 달력을 손으로 대조하지 않으면 안 보인다.
 *
 * ── 실사고 ────────────────────────────────────────────────────────────────
 * 2026-08-06 에 이 모양(job=cancelled·steps=0)으로 4개 회차가 죽었다. 그리고 정정 전
 * `collect-maintenance.yml`(cron `0 3 15-19 * *`, 창 120분)은 15~19일 중 **월요일**이 오면
 * 주간 청약홈 체인 2개(applyhome-detail `30 3 * * 1`, applyhome-remndr `30 4 * * 1`)를
 * 실행창 안에 받아 그 중 하나를 조용히 취소시켰다(2026-08-17 이 그 날이었다).
 * ⚠️ 그 `collect-maintenance.yml` 은 세션 515 에 삭제됐다 — MOLIT(1613000) 해외 IP 차단으로
 *    집서버 로컬 러너(`kosis-local-runner.mjs`, 매일 15~19일)로 옮겼다. 사고 기록은 이 감사가
 *    왜 있는지의 근거라 남긴다. 검사 로직은 남은 yml 들에 그대로 유효하다.
 *
 * ── 겹침 자체는 정상이다 ───────────────────────────────────────────────────
 * `data-collection` 그룹은 설계상 붐빈다(cron 23개). 단순 "겹치면 경고"는 35쌍을 뱉는 소음이라
 * 가드가 못 된다. 도착이 **1개면 그냥 대기 후 실행**되므로 무해하고, **2개 이상**일 때만 손실이
 * 생긴다 — 이 감사는 정확히 그 조건만 본다.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const WORKFLOW_DIR = ".github/workflows";

/** timeout-minutes 미지정 시 GitHub 기본 상한 */
const GH_DEFAULT_TIMEOUT_MIN = 360;

/** @typedef {{ min: string, hour: string, dom: string, month: string, dow: string }} CronParts */
/** @typedef {{ file: string, raw: string, cron: CronParts, windowMin: number, hasTimeout: boolean }} WfMember */

/**
 * 알려진 예외 — 항목마다 "왜 괜찮은가"를 적는다. 이유 없이 넣지 말 것.
 * @type {Map<string, string>}
 */
export const ALLOWLIST = new Map();
// 현재 비어 있다. `collect-molit-units.yml` 이 유일한 항목이었는데 세션 500 에 창을
// (timeout-minutes: 45) 명시해 근본 해소했다 — 예외로 봐주는 대신 원인을 없앤 쪽이다.
// 새로 추가할 땐 "왜 괜찮은가"를 반드시 적는다(사유 없는 항목은 테스트가 red).

/**
 * cron 5필드 = `분 시 일(月중) 월 요일`.
 * ⚠️ 요일은 p[4] 다. p[3] 은 **월** — 이 저장소 워크플로는 대부분 월이 `*` 이라
 * p[3] 을 요일로 잘못 읽으면 모든 요일이 `*` 로 뭉개져 "아무 날이나 겹친다"가 되고
 * 오탐이 폭발한다(작성 중 실제로 낸 버그).
 * @param {string} expr
 * @returns {{min:string,hour:string,dom:string,month:string,dow:string}|null}
 */
export function parseCron(expr) {
  const p = String(expr).trim().split(/\s+/);
  if (p.length !== 5) return null;
  return { min: p[0], hour: p[1], dom: p[2], month: p[3], dow: p[4] };
}

/**
 * cron 필드를 값 집합으로 펼친다. `*` 는 "제한 없음"이라 null 을 준다(전체와 구분하지 않음).
 * @param {string} field
 * @param {number} lo
 * @param {number} hi
 * @returns {Set<number>|null}
 */
export function expandField(field, lo, hi) {
  if (field === "*") return null;
  /** @type {Set<number>} */
  const out = new Set();
  for (const part of field.split(",")) {
    const [rangeRaw, stepRaw] = part.split("/");
    const inc = stepRaw ? Number(stepRaw) : 1;
    let a, b;
    if (rangeRaw === "*") { a = lo; b = hi; }
    else if (rangeRaw.includes("-")) {
      const [x, y] = rangeRaw.split("-");
      a = Number(x); b = Number(y);
    } else { a = Number(rangeRaw); b = Number(rangeRaw); }
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    for (let v = a; v <= b; v += inc) out.add(v);
  }
  return out;
}

/**
 * null(제한 없음)은 무엇과도 겹친다
 * @type {(x: Set<number>|null, y: Set<number>|null) => boolean}
 */
const setsOverlap = (x, y) =>
  x === null || y === null || [...x].some(v => y.has(v));

/**
 * 두 cron 이 같은 달력 날짜에 발화할 수 있는가.
 *
 * ⚠️ 근사다. cron 은 일(月중)과 요일이 **둘 다** 제한되면 OR 로 해석되는데, 이 저장소는
 * 한쪽만 제한하는 형태만 쓴다. "한쪽은 날짜 제한 · 다른쪽은 요일 제한" 조합은 어떤 달엔
 * 반드시 겹치는 날이 생기므로(예: 15~19일 중 월요일) true 로 본다 — 보수적으로 잡는 쪽.
 * @param {CronParts} a
 * @param {CronParts} b
 * @returns {boolean}
 */
export function canShareDay(a, b) {
  const aDom = expandField(a.dom, 1, 31), aDow = expandField(a.dow, 0, 6), aMon = expandField(a.month, 1, 12);
  const bDom = expandField(b.dom, 1, 31), bDow = expandField(b.dow, 0, 6), bMon = expandField(b.month, 1, 12);
  if (!setsOverlap(aMon, bMon)) return false;
  if (aDom && !aDow && !bDom && bDow) return true;
  if (bDom && !bDow && !aDom && aDow) return true;
  return setsOverlap(aDom, bDom) && setsOverlap(aDow, bDow);
}

/**
 * 하루 중 발화 시각(자정 기준 분) 목록.
 * @param {CronParts} cron
 * @returns {number[]}
 */
export function minutesOfDay(cron) {
  const h = expandField(cron.hour, 0, 23);
  const m = expandField(cron.min, 0, 59);
  const hours = h ? [...h] : Array.from({ length: 24 }, (_, i) => i);
  const mins = m ? [...m] : Array.from({ length: 60 }, (_, i) => i);
  /** @type {number[]} */
  const out = [];
  for (const hh of hours) for (const mm of mins) out.push(hh * 60 + mm);
  return out.sort((x, y) => x - y);
}

/**
 * 워크플로 디렉토리를 읽어 concurrency 그룹별 cron 보유 멤버를 모은다.
 * `${{ ... }}` 가 든 그룹 이름은 회차마다 값이 갈려 워크플로 간 경합이 없으므로 제외한다.
 * @param {string} dir
 */
export function collectGroups(dir) {
  /** @type {Record<string, Array<{file:string,raw:string,cron:any,windowMin:number,hasTimeout:boolean}>>} */
  const groups = {};
  for (const file of readdirSync(dir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"))) {
    /** @type {any} */
    let doc;
    try {
      doc = yaml.load(readFileSync(path.join(dir, file), "utf8"), { schema: yaml.FAILSAFE_SCHEMA });
    } catch { continue; }
    const group = doc?.concurrency?.group;
    if (typeof group !== "string" || group.includes("${{")) continue;

    // YAML 1.1 은 `on` 을 boolean 으로 읽을 수 있다 — FAILSAFE_SCHEMA 는 문자열 유지지만 폴백 둔다.
    const schedule = doc?.on?.schedule ?? doc?.true?.schedule ?? [];
    const crons = (Array.isArray(schedule) ? schedule : []).map(s => s?.cron).filter(Boolean);
    if (!crons.length) continue;

    let timeout = null;
    for (const job of Object.values(doc?.jobs ?? {})) {
      const t = Number(job?.["timeout-minutes"]);
      if (Number.isFinite(t)) timeout = Math.max(timeout ?? 0, t);
    }

    for (const raw of crons) {
      const cron = parseCron(raw);
      if (!cron) continue;
      (groups[group] ??= []).push({
        file, raw, cron,
        windowMin: timeout ?? GH_DEFAULT_TIMEOUT_MIN,
        hasTimeout: timeout !== null,
      });
    }
  }
  return groups;
}

/**
 * 조용한 취소가 가능한 조합을 찾는다.
 * 조건: holder 실행창 안에 다른 회차가 2개 이상 도착 + 그 두 도착이 **서로도** 같은 날 발화 가능.
 * (서로 다른 날에만 뜨는 둘은 한 날에 1개씩만 오므로 무해 — 이걸 안 보면 오탐이 난다)
 * @param {Record<string, WfMember[]>} groups
 * @returns {Array<{group:string,holder:string,raw:string,windowMin:number,startMin:number,arrivals:Array<{file:string,offset:number}>}>}
 */
export function findSilentCancelRisks(groups) {
  const found = [];
  for (const [group, members] of Object.entries(groups)) {
    for (const holder of members) {
      for (const start of minutesOfDay(holder.cron)) {
        /** @type {Array<{file:string,offset:number,cron:any}>} */
        const arrivals = [];
        for (const other of members) {
          if (other.file === holder.file) continue;
          if (!canShareDay(holder.cron, other.cron)) continue;
          const t = minutesOfDay(other.cron).find(x => x > start && x <= start + holder.windowMin);
          if (t !== undefined) arrivals.push({ file: other.file, offset: t - start, cron: other.cron });
        }
        // 실제 손실 조건 = 도착 2개 이상 **그리고** 그 둘이 서로도 같은 날 발화 가능.
        // 아래 쌍 검사가 "2개 이상"을 논리적으로 포함한다(1개로는 쌍이 안 만들어진다) — 그래서
        // 별도 length 검사를 두지 않는다. 뒀더니 지워도 동작이 같아(뮤테이션 실측) "지켜지고
        // 있다"는 착각만 남았다.
        const hasCoFiringPair = arrivals.some((a, i) =>
          arrivals.slice(i + 1).some(b => canShareDay(a.cron, b.cron)),
        );
        if (!hasCoFiringPair) continue;
        found.push({
          group, holder: holder.file, raw: holder.raw, windowMin: holder.windowMin,
          startMin: start,
          arrivals: arrivals.map(({ file, offset }) => ({ file, offset })),
        });
      }
    }
  }
  return found;
}

/** @type {(min: number) => string} */
const fmtTime = min =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

function main() {
  const groups = collectGroups(WORKFLOW_DIR);
  const risks = findSilentCancelRisks(groups);

  const violations = risks.filter(r => !ALLOWLIST.has(r.holder));
  const allowed = risks.filter(r => ALLOWLIST.has(r.holder));

  // 묵음 상한 금지 — 통과시킨 것도 반드시 드러낸다
  for (const r of allowed) {
    console.log(
      `[allowlist] ${r.holder} (${r.raw}) — 도착 ${r.arrivals.length}개. 사유: ${ALLOWLIST.get(r.holder)}`,
    );
  }

  if (!violations.length) {
    console.log(
      `✅ concurrency 조용한 취소 위험 0건 (그룹 ${Object.keys(groups).length}개 / allowlist ${allowed.length}건)`,
    );
    return 0;
  }

  console.error("\n❌ concurrency 그룹에서 조용한 취소가 발생할 수 있습니다.\n");
  for (const r of violations) {
    console.error(`  [${r.group}] ${r.holder}`);
    console.error(`     cron=${r.raw}  실행창=${r.windowMin}분  (UTC ${fmtTime(r.startMin)} 시작)`);
    console.error(
      `     실행창 안 도착 ${r.arrivals.length}개: ` +
        r.arrivals.map(a => `${a.file}@+${a.offset}분`).join(", "),
    );
    console.error(
      "     → 대기 자리는 1개뿐이라 2번째 도착이 첫 대기자를 취소시킵니다.",
    );
    console.error(
      "        취소된 회차는 steps 가 비어 collector_runs 행도 남지 않아 monitor 가 못 잡습니다.\n",
    );
  }
  console.error("정정법: cron 시각을 그룹의 빈 시간대로 옮기거나, 별도 concurrency 그룹으로 분리하세요.");
  return 1;
}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "",
);
if (isCLI) process.exit(main());
