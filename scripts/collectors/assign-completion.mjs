// @ts-check
/**
 * 재공고 행의 준공월(`apartments.completion`)을 같은 묶음의 첫 공고 입주예정월로 되돌린다 — BACKLOG A-19 ①
 * (설계서 docs/superpowers/plans/2026-10-11-a19-completion-and-bjd.md v2 §2·§8 · 틀 = assign-complex-keys.mjs)
 *
 * ## 무엇을 하나
 * 청약홈 seed 는 공고의 "입주예정월"을 처음 넣을 때 준공월로 쓴다. 무순위·계약취소·N차 재공고 행은 원 공고보다 늦은
 * 예정월을 받아 이미 지어진 단지가 1~3년 새것처럼 보인다. 정답은 같은 묶음(`complex_key ?? id`)에 붙은 공고 중
 * **가장 이른 입주예정월**(`presale_schedule_official.move_in_ym`)이고, 실거래 **건축년도**(`trade_deals.build_year`)로 대조한다.
 * 규칙은 순수 함수 `planCompletionUpdates` 한 곳에만 있다(설계서 §2-1 1~7번).
 *
 * ## 왜 매일 도나
 * seed·naver 수집기는 YYYYMM 값을 다시 덮지 않으므로 한 번 고친 값은 되돌아오지 않는다. 그러나 새 재공고가 들어올
 * 때마다 같은 결함이 새 행에 생기므로, 매일 굽기(daily-deploy) 앞 — 묶음 열쇠 단계 바로 뒤 — 에서 돈다.
 *
 * ## 안전장치 (전부 "쓰지 않고 실패로 끝난다" — 쓰기 실행이면 collector_runs 에 failure 1행. 감시 ⑬ 이 실패 기록을 보고,
 *    성공이 36시간 넘게 없으면 감시 ⑭ 가 알린다)
 * - 받은 행 수 ≠ 표의 행 수(apartments · 공고 일정 · 연결 표 — 부분 조회면 묶음 최솟값이 틀어진다) → `CMP_COUNT_MISMATCH`
 * - 매일 자동 실행(`--apply`): 바뀌는 행이 `CHANGE_BREAKER_MAX_ROWS` 넘게 또는 후보가 있는 행의 `CHANGE_BREAKER_RATIO`
 *   넘게 바뀜 → `CMP_BREAKER`. 첫 회차(약 170행)는 사람이 승인한 계획 파일로만 반영한다.
 * - 사람이 승인한 반영(`--apply-from=<계획 파일>`): 다시 계산한 계획이 승인 파일과 **id·이전 값·새 값까지 전부 같을 때만**
 *   쓴다 → 다르면 `CMP_PLAN_MISMATCH`. 계획 파일의 `minGap` 이 이번 실행 값과 다르면 DB 를 보기 전에 던진다.
 * - 쓸 때도 **이전 값이 그대로인 행만** 고친다(`.eq("completion", prev)` — 그 사이 남이 바꾼 행은 0행이 돌아와 실패로 센다).
 * - 사람 판정 파일 `docs/audits/completion-decisions.json` 의 `keep` id 는 제안하지 않는다(`human_keep`).
 * - 미리보기가 기본이다. `--apply` 또는 `--apply-from` 이 있어야 쓴다.
 *
 * ## 사용법
 *   node scripts/collectors/assign-completion.mjs                               # 미리보기(기본 12개월+ 차이만)
 *   node scripts/collectors/assign-completion.mjs --out=<절대경로.json>           # 미리보기 + 계획 파일(전이표 재료)
 *   node scripts/collectors/assign-completion.mjs --apply-from=<절대경로.json>    # 승인한 계획 파일과 같을 때만 반영
 *   node scripts/collectors/assign-completion.mjs --apply                       # 바뀐 행만 UPDATE(매일 굽기 앞 단계)
 *   ... --min-gap=<정수 ≥1>                                                     # 차이 하한(개월, 기본 MIN_GAP_MONTHS)
 * `--min-gap` 은 미리보기와 `--apply-from` 에 같은 값으로 준다(승인 파일 대조는 같은 필터 위에서만 성립 — 설계서 §8 결정 2).
 * `--out` 은 미리보기에서만, 새 이름으로만(있으면 DB 를 보기 전에 던진다). 그 밖 인자는 받지 않는다(`--dry-run` 포함).
 * 쓰다가 일부 행이 실패하면 머리말 `CMP_WRITE`. 예외로 죽은 쓰기 실행은 `CMP_ERROR`. 중단 신호를 받으면 partial 기록.
 */
import { loadEnv, log, logError, getSupabase, selectAll, recordCollectorRun, createReporter, sleep } from "./_shared.mjs";
import { completionMonthIndex } from "./_match-gates.mjs";
import { comparePlanToApproved } from "./assign-complex-keys.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

loadEnv();

const PHASE = "assign-completion";
const __dirname = dirname(fileURLToPath(import.meta.url));
export const DECISIONS_PATH = join(resolve(__dirname, "..", ".."), "docs", "audits", "completion-decisions.json");

/**
 * 지금 값과 후보의 차이 하한(개월). 2026-10-11 사장님 결정(설계서 §8 결정 2): 첫 반영은 12개월+ 먼저(170행),
 * 1~11개월(314행)은 2차 — 매일 `--apply` 도 이 값으로 돌아 1~11개월 행이 매일 차단기에 걸리지 않는다.
 * 2차를 승인하는 날 1 로 내리는 PR 을 따로 낸다(BACKLOG A-19).
 */
export const MIN_GAP_MONTHS = 12;
/** 후보가 있는 ah-* 행 중 이 비율 넘게 바뀌면 쓰지 않는다(표가 작을 때의 한도). */
export const CHANGE_BREAKER_RATIO = 0.1;
/**
 * 바뀌는 행이 이 수 넘게면 쓰지 않는다(평소 한도). 청약홈 seed 회차당 새 ah-* 행 = 0~4(2026-09-05~10-05 8회차 실측
 * `판정: 등록` 1·1·4·1·0·0·2·2 — 세션624) · 한 번 50행(세션586 일괄) → 새 재공고가 하루 10행을 넘는 날은 사람이 본다.
 */
export const CHANGE_BREAKER_MAX_ROWS = 10;
/** 공유 DB 에 한꺼번에 쏘지 않는다 — assign-complex-keys 와 같은 값. 건축년도 조회 동시 수도 이 값. */
export const UPDATE_CONCURRENCY = 5;
export const UPDATE_BATCH_DELAY_MS = 100;
/** 건축년도 조회 — 열쇠마다 몇 줄을 보나(연 단위라 몇 줄이면 충분, 최빈값). */
export const BUILD_YEAR_SAMPLE = 5;

/**
 * YYYYMM 규약이고 달이 1~12 인가(naver-presale.mjs `isCompletionYm` 과 같은 꼴 + 달 범위 — 무거운 모듈이라 import 하지 않는다).
 * @param {unknown} v
 * @returns {v is string}
 */
export function isYm(v) {
  return typeof v === "string" && /^\d{6}$/.test(v) && completionMonthIndex(v) != null;
}

/**
 * KST 기준 이번 달(YYYYMM).
 * @param {Date} d
 */
export function kstYm(d) {
  const k = new Date(d.getTime() + 9 * 3600000);
  return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * 최빈값. 동률이면 value null + tie true. 빈 배열이면 value null + tie false.
 * @param {ReadonlyArray<number>} values
 * @returns {{ value: number | null, tie: boolean }}
 */
export function modeOf(values) {
  /** @type {Map<number, number>} */
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = -1;
  /** @type {number[]} */
  let winners = [];
  for (const [v, c] of counts) {
    if (c > best) { best = c; winners = [v]; } else if (c === best) winners.push(v);
  }
  if (winners.length === 0) return { value: null, tie: false };
  if (winners.length > 1) return { value: null, tie: true };
  return { value: winners[0], tie: false };
}

/**
 * 사람 판정 파일을 검사해 돌려준다. 꼴 `{ note, updatedAt, decisions: [{ id, action: "keep", names, why, approved }] }`.
 * action 은 `keep` 하나만 · id 중복은 던진다(같은 행을 두 번 적으면 어느 판정인지 모른다).
 * @param {unknown} raw JSON.parse 결과
 * @returns {{ note: unknown, updatedAt: unknown, decisions: Array<{ id: string, action: "keep" }> }}
 */
export function parseCompletionDecisions(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("준공월 판정 파일이 객체가 아닙니다");
  const obj = /** @type {{ note?: unknown, updatedAt?: unknown, decisions?: unknown }} */ (raw);
  if (!Array.isArray(obj.decisions)) throw new Error("준공월 판정 파일에 decisions 배열이 없습니다");
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Array<{ id: string, action: "keep" }>} */
  const decisions = [];
  for (const d of obj.decisions) {
    const e = /** @type {{ id?: unknown, action?: unknown }} */ (d ?? {});
    if (typeof e.id !== "string" || e.id === "") throw new Error(`준공월 판정 파일: id 가 빈 줄이 있습니다 ${JSON.stringify(d)}`);
    if (e.action !== "keep") throw new Error(`준공월 판정 파일: action 은 "keep" 만 받습니다 — ${e.id}: ${JSON.stringify(e.action)}`);
    if (seen.has(e.id)) throw new Error(`준공월 판정 파일: id 가 두 번 나왔습니다 — ${e.id}`);
    seen.add(e.id);
    decisions.push({ id: e.id, action: "keep" });
  }
  return { note: obj.note, updatedAt: obj.updatedAt, decisions };
}

/**
 * @typedef {{ id: string, name?: string | null, completion?: string | null, complex_key?: string | null, lot_main?: number | null }} CmpRow
 * @typedef {{ apartment_id: string, house_manage_no?: string | null, move_in_ym?: string | null }} CmpSchedule
 * @typedef {{ apartment_id: string, link_key: string, method?: string | null }} CmpLink
 * @typedef {{ id: string, prev: string, next: string, source: "own_notice" | "bundle_notice", houseManageNo: string | null,
 *   buildYear: number | null, gapMonths: number, flags: string[] }} CmpUpdate
 */

/** @param {CmpRow} r */
const bundleOf = (r) => (r.complex_key != null && r.complex_key !== "" ? r.complex_key : r.id);

/**
 * 행·묶음 짝을 만든다(계획 함수와 건축년도 조회 대상 고르기가 같은 묶음 정의를 쓴다).
 * @param {ReadonlyArray<CmpRow>} rows
 */
function groupBundles(rows) {
  /** @type {Map<string, CmpRow[]>} */
  const byBundle = new Map();
  for (const r of rows) {
    const b = bundleOf(r);
    const list = byBundle.get(b) ?? [];
    list.push(r);
    byBundle.set(b, list);
  }
  return byBundle;
}

/**
 * 건축년도를 읽어야 하는 apt_seq 열쇠 — ah-* 행이 든 묶음의 행에 붙은 active 연결 열쇠만(정렬·중복 없음). DB 접근 없는 순수 함수.
 * @param {ReadonlyArray<CmpRow>} rows
 * @param {ReadonlyArray<CmpLink>} links
 * @returns {string[]}
 */
export function neededAptSeqs(rows, links) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const members of groupBundles(rows).values()) {
    if (members.some((m) => m.id.startsWith("ah-"))) for (const m of members) ids.add(m.id);
  }
  return [...new Set(links.filter((l) => ids.has(l.apartment_id)).map((l) => l.link_key))].sort();
}

/**
 * 고칠 행을 뽑는다. DB 접근 없는 순수 함수(설계서 §2-1).
 * @param {ReadonlyArray<CmpRow>} rows apartments 전체
 * @param {ReadonlyArray<CmpSchedule>} schedules 공고 일정 전체
 * @param {ReadonlyArray<CmpLink>} links 연결 표 active apt_seq 줄
 * @param {ReadonlyMap<string, number | null>} yearsByAptSeq apt_seq → 건축년도(동률이면 null) · 자료 없는 열쇠는 빠짐
 * @param {ReadonlyArray<{ id: string, action: string }>} decisions 사람 판정(`keep`)
 * @param {string} nowYm 이번 달 YYYYMM
 * @param {{ minGap?: number }} [opts]
 * @returns {{ updates: CmpUpdate[], rows: number, candidates: number, changed: number, skipped: Record<string, number> }}
 *   rows = ah-* 행 수 · candidates = 후보가 있는 ah-* 행 수(차단기 분모)
 */
export function planCompletionUpdates(rows, schedules, links, yearsByAptSeq, decisions, nowYm, opts = {}) {
  const minGap = opts.minGap ?? MIN_GAP_MONTHS;
  if (!Number.isInteger(minGap) || minGap < 1) throw new Error(`minGap 은 1 이상 정수여야 합니다: ${minGap}`);
  if (!isYm(nowYm)) throw new Error(`nowYm 이 YYYYMM 이 아닙니다: ${nowYm}`);
  const nowIdx = /** @type {number} */ (completionMonthIndex(nowYm));
  const keep = new Set(decisions.filter((d) => d.action === "keep").map((d) => d.id));
  const byBundle = groupBundles(rows);

  // 행마다 가장 이른 유효 공고(같은 달이면 공고 번호가 작은 쪽 — 결과를 한 가지로 고정)
  /** @type {Map<string, { ym: string, hmn: string | null }>} */
  const ownNotice = new Map();
  for (const s of schedules) {
    if (!isYm(s.move_in_ym)) continue;
    const hmn = s.house_manage_no ?? null;
    const cur = ownNotice.get(s.apartment_id);
    if (!cur || s.move_in_ym < cur.ym || (s.move_in_ym === cur.ym && String(hmn ?? "") < String(cur.hmn ?? ""))) {
      ownNotice.set(s.apartment_id, { ym: s.move_in_ym, hmn });
    }
  }
  /** @type {Map<string, CmpLink[]>} */
  const linksByApt = new Map();
  for (const l of links) {
    const list = linksByApt.get(l.apartment_id) ?? [];
    list.push(l);
    linksByApt.set(l.apartment_id, list);
  }

  /** @type {CmpUpdate[]} */
  const updates = [];
  /** @type {Record<string, number>} */
  const skipped = {};
  const skip = (/** @type {string} */ why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  let ahRows = 0;
  let candidates = 0;

  for (const r of rows) {
    if (!r.id.startsWith("ah-")) continue;
    ahRows++;
    const prev = r.completion;
    if (!isYm(prev)) { skip("not_ym"); continue; }
    if (keep.has(r.id)) { skip("human_keep"); continue; }

    const members = byBundle.get(bundleOf(r)) ?? [r];
    // ⓐ 자기 행에 붙은 공고 → ⓑ 없으면 묶음 모든 행의 공고 중 가장 이른 것
    /** @type {"own_notice" | "bundle_notice"} */
    let source = "own_notice";
    let cand = ownNotice.get(r.id) ?? null;
    if (!cand) {
      source = "bundle_notice";
      for (const m of members) {
        const n = ownNotice.get(m.id);
        if (n && (!cand || n.ym < cand.ym || (n.ym === cand.ym && String(n.hmn ?? "") < String(cand.hmn ?? "")))) cand = n;
      }
    }
    if (!cand) { skip("no_source"); continue; }
    candidates++;

    const prevIdx = /** @type {number} */ (completionMonthIndex(prev));
    const nextIdx = /** @type {number} */ (completionMonthIndex(cand.ym));
    const gap = prevIdx - nextIdx;
    if (!(nextIdx < prevIdx && gap >= minGap)) { skip("not_earlier"); continue; }

    // 건축년도 — 그 행의 active 연결 열쇠(없으면 묶음) · 열쇠 여럿이면 최빈값, 동률이면 판정 못 함
    const ownKeys = (linksByApt.get(r.id) ?? []).map((l) => l.link_key);
    const keys = ownKeys.length > 0 ? ownKeys : members.flatMap((m) => (linksByApt.get(m.id) ?? []).map((l) => l.link_key));
    /** @type {number[]} */
    const years = [];
    let tieKey = false;
    for (const k of new Set(keys)) {
      if (!yearsByAptSeq.has(k)) continue;
      const y = yearsByAptSeq.get(k);
      if (y == null) tieKey = true;
      else years.push(y);
    }
    const ym = modeOf(years);
    if (ym.tie || (years.length === 0 && tieKey)) { skip("year_ambiguous"); continue; }
    const buildYear = ym.value;
    const candYear = Number(cand.ym.slice(0, 4));
    if (buildYear != null && buildYear !== candYear) { skip("year_mismatch"); continue; }
    const yearOk = buildYear != null && buildYear === candYear;

    /** @type {string[]} */
    const flags = [];
    // 다른 건물 보호(묶음 후보일 때만) — 열쇠가 1개여도 지번이 2종이면 다른 건물일 수 있다(검사관 🟠1)
    if (source === "bundle_notice") {
      const bundleKeys = new Set(members.flatMap((m) => (linksByApt.get(m.id) ?? []).filter((l) => l.method !== "bundle").map((l) => l.link_key)));
      const lots = new Set(members.map((m) => m.lot_main).filter((v) => v != null));
      const mixedBuildings = bundleKeys.size >= 2;
      const mixedLots = lots.size >= 2;
      if (mixedBuildings || mixedLots) {
        if (!yearOk) { skip(mixedBuildings ? "mixed_buildings" : "mixed_lots"); continue; }
        flags.push("mixed_but_year_ok");
      }
    }
    // 미래 행 보호 — 아직 안 지은 새 단지는 건축년도가 같을 때만(검사관 🔴1)
    if (prevIdx >= nowIdx && !yearOk) { skip("future_unverified"); continue; }
    if (buildYear == null) flags.push("no_year");

    updates.push({ id: r.id, prev, next: cand.ym, source, houseManageNo: cand.hmn, buildYear, gapMonths: gap, flags });
  }
  return { updates, rows: ahRows, candidates, changed: updates.length, skipped };
}

/**
 * 차단기 판정(매일 자동 실행용). DB 접근 없는 순수 함수. 빈칸 채우기가 아니라 assign-complex-keys 의 `overFill` 은 없다.
 * @param {{ changed: number, candidates: number }} counts
 * @returns {{ tripped: boolean, ratio: number, reason: string | null }}
 */
export function evaluateChangeBreaker({ changed, candidates }) {
  const ratio = candidates > 0 ? changed / candidates : 0;
  const tripped = changed > CHANGE_BREAKER_MAX_ROWS || ratio > CHANGE_BREAKER_RATIO;
  return {
    tripped,
    ratio,
    reason: tripped ? `준공월이 바뀌는 행 ${changed}/${candidates} = ${(ratio * 100).toFixed(1)}% — 한도(${CHANGE_BREAKER_MAX_ROWS}행 또는 ${CHANGE_BREAKER_RATIO * 100}%) 초과` : null,
  };
}

/**
 * 실행 인자를 읽는다. 꼴이 틀리거나 같이 쓸 수 없는 조합이면 throw(DB 를 보기 전에 멈춘다).
 * @param {readonly string[]} argv
 * @returns {{ apply: boolean, applyFrom: string | null, out: string | null, minGap: number }}
 */
export function parseArgs(argv) {
  // 아는 인자만 받는다(허용 목록). `--dry-run` 을 흘려보내면 `recordCollectorRun` 이 기록을 건너뛴다(_shared.mjs).
  let applyFlag = false;
  /** @type {string | null} */
  let applyFrom = null;
  /** @type {string | null} */
  let out = null;
  /** @type {number | null} */
  let minGap = null;
  /** @type {string[]} */
  const unknown = [];
  for (const a of argv.slice(2)) {
    if (a === "--apply") {
      applyFlag = true;
    } else if (a.startsWith("--apply-from")) {
      const m = /^--apply-from=(.+)$/.exec(a);
      if (!m) throw new Error(`--apply-from 에는 계획 파일 경로가 필요합니다: ${a}`);
      if (applyFrom != null) throw new Error("--apply-from 이 두 번 나왔습니다 — 승인한 계획 파일은 하나만 줍니다");
      applyFrom = m[1];
    } else if (a.startsWith("--out")) {
      const m = /^--out=(.+)$/.exec(a);
      if (!m) throw new Error(`--out 에는 저장할 파일 경로가 필요합니다: ${a}`);
      if (out != null) throw new Error("--out 이 두 번 나왔습니다");
      out = m[1];
    } else if (a.startsWith("--min-gap")) {
      const m = /^--min-gap=([1-9]\d*)$/.exec(a);
      if (!m) throw new Error(`--min-gap 에는 1 이상 정수(개월)가 필요합니다: ${a}`);
      if (minGap != null) throw new Error("--min-gap 이 두 번 나왔습니다");
      minGap = Number(m[1]);
    } else {
      unknown.push(a);
    }
  }
  if (unknown.length > 0) {
    throw new Error(`모르는 인자: ${unknown.join(" ")} — 쓸 수 있는 것은 --apply · --apply-from=<승인한 계획 파일> · --out=<파일> · --min-gap=<개월> 뿐입니다(인자 없이 돌리면 미리보기. 한도를 넘는 반영은 --apply-from 으로만)`);
  }
  if (applyFrom != null && out != null) {
    throw new Error("--apply-from 과 --out 은 같이 줄 수 없습니다 — 승인한 계획 파일을 지금 계획으로 덮어쓴 뒤 그것과 맞대게 됩니다");
  }
  if (applyFlag && out != null) {
    throw new Error("--apply 와 --out 은 같이 줄 수 없습니다 — 계획 파일은 미리보기에서만 만듭니다");
  }
  return { apply: applyFlag || applyFrom != null, applyFrom, out, minGap: minGap ?? MIN_GAP_MONTHS };
}

/**
 * 활성 apt_seq 열쇠마다 건축년도를 읽는다(`trade_deals` 약 106만 행 — 창 조회 금지 · `.in` 은 1,000행 상한이라 금지).
 * 열쇠당 `.eq().not(build_year null).limit(BUILD_YEAR_SAMPLE)` 를 동시 `UPDATE_CONCURRENCY` 개씩. 값이 여럿이면 최빈값,
 * 동률이면 null(판정 못 함). 자료가 없는 열쇠는 Map 에 넣지 않는다. 조회 오류는 던진다 — 연도를 모르는 채로 계산하면
 * `no_year` 로 지나가 버린다.
 * @param {any} sb
 * @param {ReadonlyArray<string>} aptSeqs
 * @param {{ interrupted?: () => boolean }} [opts]
 * @returns {Promise<Map<string, number | null>>}
 */
export async function fetchBuildYears(sb, aptSeqs, opts = {}) {
  /** @type {Map<string, number | null>} */
  const out = new Map();
  for (let i = 0; i < aptSeqs.length; i += UPDATE_CONCURRENCY) {
    if (opts.interrupted?.()) throw new Error("중단 신호 — 건축년도 조회를 끝내지 못했습니다");
    const batch = aptSeqs.slice(i, i + UPDATE_CONCURRENCY);
    const results = await Promise.all(
      batch.map((k) => sb.from("trade_deals").select("apt_seq,build_year").eq("apt_seq", k).not("build_year", "is", null).limit(BUILD_YEAR_SAMPLE)),
    );
    results.forEach((r, j) => {
      const res = /** @type {{ data?: Array<{ build_year?: unknown }> | null, error?: { message?: string } | null }} */ (r);
      if (res.error) throw new Error(`trade_deals 건축년도 조회 실패(${batch[j]}): ${res.error.message}`);
      const ys = (res.data ?? []).map((d) => Number(d.build_year)).filter((y) => Number.isInteger(y) && y > 0);
      if (ys.length === 0) return;
      out.set(batch[j], modeOf(ys).value);
    });
  }
  return out;
}

/**
 * @typedef {{ getSupabase: typeof getSupabase, selectAll: typeof selectAll, recordCollectorRun: typeof recordCollectorRun,
 *   fetchBuildYears: typeof fetchBuildYears, now: () => Date, readFileSync: (p: string, enc: "utf8") => string }} CmpDeps
 */
/** @type {CmpDeps} */
export const defaultDeps = {
  getSupabase,
  selectAll,
  recordCollectorRun,
  fetchBuildYears,
  now: () => new Date(),
  readFileSync: (p, enc) => readFileSync(p, enc),
};

/**
 * 표 전체를 고유키 커서로 읽고, 같은 필터의 행 수와 맞댄다. 다르면 null(부분 조회로는 계산하지 않는다).
 * 인자 이름을 selectAll 로 둬야 정적 가드(_selectall-keycol-coverage)가 이 호출의 keyCol 을 본다(세션623).
 * @param {any} sb
 * @param {typeof selectAll} selectAll
 * @returns {Promise<{ rows: any[], schedules: any[], links: any[], mismatch: string | null }>}
 */
async function readInputs(sb, selectAll) {
  const rows = await selectAll(
    (s) => s.from("apartments").select("id,name,region,gu,units,completion,complex_key,lot_main,presale_type"),
    sb,
    "id",
  );
  const schedules = await selectAll(
    (s) => s.from("presale_schedule_official").select("id,apartment_id,house_manage_no,move_in_ym"),
    sb,
    "id",
  );
  const links = await selectAll(
    (s) => s.from("apartment_trade_links").select("id,apartment_id,link_key,method").eq("link_kind", "apt_seq").eq("status", "active"),
    sb,
    "id",
  );
  const counts = await Promise.all([
    sb.from("apartments").select("id", { count: "exact", head: true }),
    sb.from("presale_schedule_official").select("id", { count: "exact", head: true }),
    sb.from("apartment_trade_links").select("id", { count: "exact", head: true }).eq("link_kind", "apt_seq").eq("status", "active"),
  ]);
  const got = [rows.length, schedules.length, links.length];
  const names = ["apartments", "presale_schedule_official", "apartment_trade_links(active apt_seq)"];
  /** @type {string[]} */
  const bad = [];
  counts.forEach((c, i) => {
    const { count, error } = /** @type {{ count?: number | null, error?: { message?: string } | null }} */ (c);
    if (error || count == null || count !== got[i]) bad.push(`${names[i]} 받은 행 ${got[i]} ≠ 표의 행 수 ${count ?? "알 수 없음"}${error ? ` (${error.message})` : ""}`);
  });
  return { rows, schedules, links, mismatch: bad.length > 0 ? `${bad.join(" · ")} — 부분 조회로는 계산하지 않습니다` : null };
}

/**
 * 쓰기 실행의 실패를 기록하고 종료 코드를 1 로 둔다. 미리보기(쓰기 아님)는 기록하지 않는다.
 * @param {CmpDeps} deps
 * @param {boolean} apply
 * @param {string} marker `CMP_…` 머리말
 * @param {string} why
 * @param {number} rowCount
 */
async function failRun(deps, apply, marker, why, rowCount) {
  logError(PHASE, `${why} — 아무것도 쓰지 않았습니다`);
  if (apply) await deps.recordCollectorRun(PHASE, { status: "failure", ok: 0, fail: 0, skip: rowCount, errorMessage: `${marker} ${why}` });
  process.exitCode = 1;
}

/**
 * CLI 는 인자 없이 불러 진짜 함수로 돈다. 시험은 가짜 deps 로 흐름(미리보기 0쓰기·승인 대조·차단기·조건부 쓰기)을 본다.
 * @param {CmpDeps} [deps]
 * @param {readonly string[]} [argv]
 */
export async function main(deps = defaultDeps, argv = process.argv) {
  const args = parseArgs(argv);
  const { apply, applyFrom, minGap } = args;
  const decisions = parseCompletionDecisions(JSON.parse(deps.readFileSync(DECISIONS_PATH, "utf8")));
  // 승인한 계획 파일은 DB 를 보기 전에 읽는다 — 없거나 깨졌거나 다른 minGap 으로 만든 파일이면 여기서 던진다.
  /** @type {unknown} */
  let approvedUpdates = null;
  if (applyFrom != null) {
    const approved = /** @type {{ updates?: unknown, minGap?: unknown }} */ (JSON.parse(deps.readFileSync(applyFrom, "utf8")));
    approvedUpdates = approved?.updates;
    if (!Array.isArray(approvedUpdates)) throw new Error(`승인한 계획 파일에 updates 배열이 없습니다: ${applyFrom}`);
    if (approved.minGap !== minGap) throw new Error(`승인한 계획 파일의 minGap(${JSON.stringify(approved.minGap)}) ≠ 이번 실행 ${minGap} — 같은 --min-gap 으로 주세요`);
  }
  if (args.out != null && existsSync(args.out)) {
    throw new Error(`--out 파일이 이미 있습니다: ${args.out} — 승인했을 수 있는 계획 파일을 덮어쓰지 않는다 — 새 이름으로 다시 주세요`);
  }

  const sb = deps.getSupabase();
  const rpt = createReporter(PHASE);
  const input = await readInputs(sb, deps.selectAll);
  if (input.mismatch != null) {
    await failRun(deps, apply, "CMP_COUNT_MISMATCH", input.mismatch, input.rows.length);
    return;
  }
  const { rows, schedules, links } = input;
  const keys = neededAptSeqs(rows, links);
  const years = await deps.fetchBuildYears(sb, keys, { interrupted: rpt.interrupted });
  const tieKeys = [...years.values()].filter((v) => v == null).length;
  log(PHASE, `건축년도 조회 열쇠 ${keys.length}개 → 값 ${years.size - tieKeys}개 · 동률 ${tieKeys}개 · 자료 없음 ${keys.length - years.size}개`);

  const plan = planCompletionUpdates(rows, schedules, links, years, decisions.decisions, kstYm(deps.now()), { minGap });
  const big = plan.updates.filter((u) => u.gapMonths >= 12).length;
  const bySource = plan.updates.reduce((/** @type {Record<string, number>} */ m, u) => ({ ...m, [u.source]: (m[u.source] ?? 0) + 1 }), {});
  const noYear = plan.updates.filter((u) => u.flags.includes("no_year")).length;
  log(PHASE, `ah-* ${plan.rows}행 · 후보 ${plan.candidates} · 바뀜 ${plan.changed}(12개월+ ${big} · 1~11개월 ${plan.changed - big}) · 출처 ${JSON.stringify(bySource)} · 건축년도 없음 ${noYear} | minGap ${minGap}`);
  log(PHASE, `건너뜀 ${JSON.stringify(plan.skipped)}`);

  /** @type {Map<string, any>} */
  const rowById = new Map(rows.map((r) => [r.id, r]));
  if (args.out != null) {
    // 줄마다 이름·시도·구·세대수·지번·묶음 지번을 덧붙인다 — 검사관은 DB 를 못 보므로 이 파일만으로 읽어야 한다(대조는 id·이전·새 값 세 칸만).
    const byBundle = groupBundles(rows);
    const readable = plan.updates.map((u) => {
      const r = rowById.get(u.id);
      const lots = [...new Set((byBundle.get(bundleOf(r)) ?? []).map((m) => m.lot_main).filter((v) => v != null))].sort((a, b) => Number(a) - Number(b));
      return { ...u, name: r?.name ?? null, region: r?.region ?? null, gu: r?.gu ?? null, units: r?.units ?? null, lotMain: r?.lot_main ?? null, bundleLots: lots };
    });
    writeFileSync(args.out, JSON.stringify({ takenAt: new Date().toISOString(), rows: plan.rows, candidates: plan.candidates, minGap, changed: plan.changed, skipped: plan.skipped, updates: readable }, null, 1) + "\n", { flag: "wx" });
    log(PHASE, `계획 파일 저장: ${args.out}`);
  }

  const breaker = evaluateChangeBreaker(plan);
  for (const u of plan.updates.slice(0, 40)) {
    log(PHASE, `  바뀜 ${u.id} | ${rowById.get(u.id)?.name ?? ""} | ${u.prev} → ${u.next} (${u.gapMonths}개월 · ${u.source}${u.buildYear != null ? ` · 건축 ${u.buildYear}` : ""}${u.flags.length ? ` · ${u.flags.join(",")}` : ""})`);
  }

  if (!apply) {
    if (breaker.tripped) log(PHASE, `⚠ 매일 자동 실행이면 차단기에 걸립니다(${breaker.reason}) — 명단을 확인하고 승인받은 뒤 --apply-from=<이 계획 파일> 로 반영`);
    log(PHASE, "미리보기 종료 — 아무것도 쓰지 않았습니다");
    return;
  }
  if (applyFrom != null) {
    // 사람이 승인한 반영 — 승인한 계획 파일과 내용이 전부 같을 때만 쓴다(같으면 차단기는 보지 않는다. 그 계획이 곧 승인이다).
    const cmp = comparePlanToApproved(plan.updates, approvedUpdates);
    if (!cmp.same) {
      const why = `승인한 계획 파일과 지금 계획이 다릅니다 — 지금만 있는 줄 ${cmp.onlyCurrent.length} · 파일에만 있는 줄 ${cmp.onlyApproved.length}. 미리보기를 다시 떠서 승인받으세요`;
      for (const l of [...cmp.onlyCurrent.slice(0, 10), ...cmp.onlyApproved.slice(0, 10)]) log(PHASE, `  어긋남 ${l}`);
      await failRun(deps, apply, "CMP_PLAN_MISMATCH", why, rows.length);
      return;
    }
    log(PHASE, `승인한 계획 파일과 일치(${plan.updates.length}행) — 반영합니다`);
  } else if (breaker.tripped) {
    await failRun(deps, apply, "CMP_BREAKER", `차단기 발동: ${breaker.reason}`, rows.length);
    return;
  }

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < plan.updates.length; i += UPDATE_CONCURRENCY) {
    if (rpt.interrupted()) {
      log(PHASE, `중단 신호 — ${ok}행까지 반영하고 멈춥니다`);
      break;
    }
    if (i > 0) await sleep(UPDATE_BATCH_DELAY_MS);
    const results = await Promise.all(
      plan.updates.slice(i, i + UPDATE_CONCURRENCY).map((u) =>
        // 이전 값이 그대로인 행만 고친다 — 조회 뒤 남이 바꾼 행은 0행이 돌아와 아래에서 실패로 센다.
        sb.from("apartments").update({ completion: u.next }).eq("id", u.id).eq("completion", u.prev).select("id"),
      ),
    );
    // 보낸 수가 아니라 돌아온 결과에서 센다 — 0행 반환도 실패.
    for (const r of results) {
      const res = /** @type {{ data?: unknown[] | null, error?: { message?: string } | null }} */ (r);
      if (res.error || !res.data || res.data.length === 0) {
        if (!fail) logError(PHASE, `업데이트 실패 예시: ${res.error?.message ?? "0행 반환(행이 없거나 그 사이 값이 바뀜)"}`);
        fail++;
      } else ok++;
    }
  }
  rpt.success(ok);
  if (fail) rpt.fail(fail);
  rpt.skip(plan.candidates - plan.changed);
  const writeNote = fail ? `CMP_WRITE ${fail}행 실패(0행 반환 포함)` : null;
  await deps.recordCollectorRun(PHASE, { ...rpt.summary(), errorMessage: writeNote });
  log(PHASE, `완료 — 반영 ${ok}행${fail ? ` / 실패 ${fail}행` : ""}`);
  if (fail) process.exitCode = 1;
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) {
  main().catch(async (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    logError(PHASE, msg);
    // 쓰기 실행(--apply 또는 --apply-from)이 예외로 죽으면 실패로 기록한다(인자가 틀려 parseArgs 가 던진 경우 포함 — 글자로 판정).
    // process.exit 를 부르지 않는다 — Windows 에서 fetch 뒤 exit 는 libuv 단언으로 127 이 된다(세션579).
    const wantedWrite = process.argv.some((a) => a === "--apply" || a.startsWith("--apply-from"));
    if (wantedWrite) await recordCollectorRun(PHASE, { status: "failure", ok: 0, fail: 1, skip: 0, errorMessage: `CMP_ERROR ${msg}` });
    process.exitCode = 1;
  });
}
