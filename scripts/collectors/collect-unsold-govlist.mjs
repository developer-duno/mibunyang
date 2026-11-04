// @ts-check
/**
 * 지자체 단지별 미분양 명단 수집기(대구·충남 — 시험판, PR-2). 설계서 `docs/superpowers/plans/2026-11-01-govlist-unsold-source.md` v2.1.
 *
 * 순서(data-changing-run-approval): 조회 → 계획 → impact 저장(항상) → 차단기 → 바꾸기 전 사본·역계획 → 쓰기.
 *   node scripts/collectors/collect-unsold-govlist.mjs --dry-run --impact-out=<경로> [--source=daegu|chungnam] [--file=<source>:<xlsx 경로>]
 *   node scripts/collectors/collect-unsold-govlist.mjs --apply --apply-from=<승인한 impact> [--absent-zero]
 *   node scripts/collectors/collect-unsold-govlist.mjs --apply --source=daegu        (평시 — 러너 매월 8일, PR-4b)
 *
 * - dry-run 은 미등재→0 꺼짐·켬 **두 계획을 같이** impact 에 싣는다(사장님 Q5 재료). DB·collector_runs 에 아무것도 안 쓴다.
 * - `--apply --apply-from` = 승인 반영 — 다시 세운 계획이 승인 impact 의 같은 모드(꺼짐/켬) 계획과
 *   쓰는 행의 id·행동·이전 값·새 값까지 같을 때만 쓴다(다르면 쓰기 0 · failure `GOVLIST_PLAN_MISMATCH`). 차단기를 넘는 회차도
 *   승인 계획 일치가 곧 승인이다.
 * - `--apply`(승인 파일 없음) = 평시 반영(PR-4b · 👤 11/04 「자동 반영 + 차단기」) — impact 는 늘 먼저 저장하고, 다음이면 쓰기 0 · failure:
 *   ① 이번에 쓸 출처에 이미 반영된 **완성** batch 가 하나도 없음(첫 회차는 승인 파일로만) — `GOVLIST_FIRST_NEEDS_APPROVAL <출처>` · exit 2
 *   ② 차단기(`breaker()` — 출처별 **값이 바뀌는** 묶음 > 기준(대구·충남 10 임시 · 경기 50) · 명단 행 < 전 회차 × 0.5)
 *      — 표식을 맨 앞에 `GOVLIST_BREAKER 승인 필요 — dry-run 뒤 --apply-from · <이유>` · exit 1
 *   ③ DB CHECK 위반 행(승인 반영과 같은 `GOVLIST_WRITE check_violation`) · exit 1. `--absent-zero`·`--resume` 은 승인 파일과만(👤 Q5 꺼짐).
 *   그 밖엔 꺼짐 계획의 쓰는 행 전부를 사본·역계획 뒤에 쓴다. 일부 행 실패·경합으로 failure 면 exit 1(러너 텔레그램).
 *   성공하면 출처마다 `GOVLIST_APPLIED <출처> 단지 N 행 M {값 변화 꼴:수,…}`(승인 반영도 같다).
 * - 쓰기 = ① `unsold_gov_list` 새 batch 넣기 → 행 수 = batch_rows 확인 → 같은 (출처, 기준일)의 옛 batch 지우기 ② apartments 6칸 조건부 갱신
 *   (이전 값이 그대로인 행만). ① 이 실패하면 ② 를 하지 않는다.
 * - 표식(`collector_runs.error_message`): `GOVLIST_SKIP <source> <이유>`(fetch · header · rows0 · not_newer) · `GOVLIST_BREAKER …` ·
 *   `GOVLIST_PLAN_MISMATCH …` · `GOVLIST_WRITE …`.
 * - 외부 호출: 출처마다 3회(목록·글·첨부). 공공데이터 API·카카오 0. DB 는 읽기(apartments·applyhome_unit_supply·presale_schedule_official·unsold_gov_list).
 * - 반영 잠금 `GOVLIST_APPLY_ENABLED` — **PR-4b 에서 풀림(true)**. PR-4(KOSIS 가 govlist 를 존중 · 시계열 건너뜀 · #861)를 합치기 전에
 *   쓰면 9일 KOSIS 회차가 이 값을 다시 덮어 매달 오락가락했다(세션687 PR-2 검사 B🔴1). 다시 잠그면 `--apply` 는 쓰기 0 · exit 2 ·
 *   표식 `GOVLIST_APPLY_LOCKED`(시험은 `applyEnabled:false` 주입으로 계속 확인한다).
 *   반영 순서 = PR-1 운영 적용 → PR-3(화면) → PR-4(규칙) → PR-4b(이 상수 · 러너 8일) → 첫 `--apply --apply-from` → 평시 `--apply`.
 * - 매칭 표식(실행마다 · 출처마다): `GOVLIST_MATCH <출처> 판정필요 <N>{시군구:수,…} 충돌 <M>` — 판정 필요 = weak·none 단지,
 *   충돌 = 한 명단 단지 ↔ 두 묶음 이상(conflict) + 한 묶음을 두 명단 단지가 집음. 감시 ㉔-c 가 읽는다(PR-4b · 설계서 §7 「매칭」).
 * - 끊긴 반영 이어 쓰기 = `--apply --apply-from=<같은 승인 impact> --resume`: 출처마다 같은 기준일의 **완성** batch 가 이미 있어야 한다
 *   (없으면 쓰기 0 · exit 2 · `GOVLIST_RESUME_NO_BATCH` — 명단 표도 새로 넣지 않는다). 있으면 명단 표는 안 쓰고,
 *   승인 계획의 쓰는 행마다 지금 값이 이전 값이면 씀 · 새 값이면 이미 씀(건너뜀) · 그 밖이면 전부 멈춤(feedback_oneoff_fix_script_resumable 꼴).
 *   그다음 다시 세운 계획과도 맞댄다(`resumeComparePlans` — 승인 행마다 새 값이 같아야 하고 이미 쓴 행은 unchanged · 남은 행은 같은 write_*,
 *   다르면 쓰기 0 · `GOVLIST_PLAN_MISMATCH resume …`). 다시 세운 계획의 원천 = 이번에 누리집에서 **새로 받은 원문**(명단 표 batch 가 아니다).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { ROOT, loadEnv, getSupabase, selectAll, log, logError, createReporter, recordCollectorRun } from "./_shared.mjs";
import { fetchLatestGovlist, SOURCE_REGION, GovlistFetchError } from "./_govlist-fetch.mjs";
import { parseGovlistWorkbook, GovlistParseError } from "./_govlist-parse.mjs";
import { buildBundles, matchComplexes, parseMatchDecisions } from "./_govlist-match.mjs";
import { planSource, summarize, breaker, comparePlans, buildBackup, buildListRows, isWrite, rowCheckViolations, sameSix, sixOf, changeClass, VALUE_KEYS, RESTORE_EXPECT_KEYS } from "./_govlist-plan.mjs";

/** @typedef {import("./_govlist-fetch.mjs").GovlistSource} GovlistSource */
/** @typedef {import("./_govlist-plan.mjs").PlanRow} PlanRow */
/** @typedef {import("./_govlist-match.mjs").AptRow} AptRow */

export const PHASE = "unsold-govlist";
export const SOURCES = /** @type {const} */ (["daegu", "chungnam"]);
export const DECISIONS_PATH = resolve(ROOT, "docs/audits/govlist-match-decisions.json");
export const LIST_TABLE = "unsold_gov_list";
/** 반영 잠금(머리말 참고) — PR-4(#861)를 합친 뒤 PR-4b 에서 풀었다(true). 다시 잠글 일이 생기면 false 로. */
export const GOVLIST_APPLY_ENABLED = true;
/** 반영 잠금으로 막았을 때의 종료 코드. */
export const EXIT_APPLY_LOCKED = 2;
/** `--resume` 인데 같은 기준일 완성 batch 가 없어 거부했을 때의 종료 코드. */
export const EXIT_RESUME_NO_BATCH = 2;
/** 평시 `--apply` 인데 쓸 출처에 반영된 완성 batch 가 하나도 없어(첫 회차) 거부했을 때의 종료 코드 — 첫 회차는 승인 파일로만. */
export const EXIT_FIRST_NEEDS_APPROVAL = 2;
/** 평시 `--apply` 에서 차단기가 걸려 쓰기 0 으로 멈췄을 때의 종료 코드(data-changing-run-approval §2 — 실제 실행 발동 = exit 1). */
export const EXIT_BREAKER = 1;
/** 평시 `--apply` 가 CHECK 위반·일부 행 실패·경합으로 failure 를 남겼을 때의 종료 코드 — 러너 텔레그램을 타게(세션693 보완 B3). */
export const EXIT_WRITE_FAILURE = 1;
/** 양성 대조군(설계서 §4) — dry-run 로그·impact 에 결과를 찍는다. */
export const CONTROLS = Object.freeze([
  { label: "두류 센트레빌 더파크(대구 9월 → 등재·비공개 기대)", source: "daegu", re: /두류\s*센트레빌/ },
  { label: "호반써밋 포레센트(충남 6월 → 미등재 기대)", source: "chungnam", re: /포레센트/ },
]);

/**
 * 인자 — 허용 목록(모르는 인자는 던진다 · data-changing-run-approval §2).
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const known = ["--dry-run", "--apply", "--absent-zero", "--resume"];
  const withValue = ["--impact-out=", "--apply-from=", "--source=", "--file="];
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    if (!known.includes(a) && !withValue.some((p) => a.startsWith(p))) throw new Error(`모르는 인자: ${a}`);
  }
  const one = (/** @type {string} */ p) => {
    const xs = argv.filter((a) => a.startsWith(p));
    if (xs.length > 1) throw new Error(`${p} 가 두 번 나왔습니다`);
    const v = xs[0]?.slice(p.length) ?? null;
    if (xs.length && !v) throw new Error(`${p} 에 값이 없습니다`);
    return v;
  };
  const dryRun = argv.includes("--dry-run");
  const apply = argv.includes("--apply");
  if (dryRun === apply) throw new Error("--dry-run 과 --apply 중 정확히 하나를 줍니다");
  const impactOut = one("--impact-out=");
  const applyFrom = one("--apply-from=");
  if (dryRun && !impactOut) throw new Error("--dry-run 은 --impact-out=<경로> 가 필요합니다(전이표 재료)");
  if (dryRun && applyFrom) throw new Error("--apply-from 은 --apply 와만 씁니다");
  // 평시 반영(--apply 만)은 꺼짐 계획·새 batch 만 — 미등재→0(👤 Q5 꺼짐)·이어 쓰기는 승인 파일과만
  if (apply && !applyFrom && argv.includes("--absent-zero")) throw new Error("--absent-zero 는 --apply-from=<승인한 impact> 와만 씁니다(평시 반영은 꺼짐 계획만 — 👤 Q5)");
  if (apply && !applyFrom && argv.includes("--resume")) throw new Error("--resume 은 --apply --apply-from 과만 씁니다(끊긴 반영 이어 쓰기)");
  if (impactOut && applyFrom && resolve(impactOut) === resolve(applyFrom)) throw new Error("--apply-from 과 --impact-out 이 같은 파일입니다");
  const src = one("--source=");
  if (src && !SOURCES.includes(/** @type {any} */ (src))) throw new Error(`--source 는 ${SOURCES.join("|")}`);
  /** @type {Map<string, string>} */ const files = new Map();
  for (const a of argv.filter((x) => x.startsWith("--file="))) {
    const m = /^--file=(daegu|chungnam):(.+)$/.exec(a);
    if (!m) throw new Error(`--file=<daegu|chungnam>:<xlsx 경로> 형식: ${a}`);
    if (files.has(m[1])) throw new Error(`--file 이 ${m[1]} 에 두 번`);
    files.set(m[1], m[2]);
  }
  if (apply && files.size) throw new Error("--file 은 미리보기(시험) 전용입니다 — 쓰기는 누리집에서 받은 파일로만");
  if (dryRun && argv.includes("--resume")) throw new Error("--resume 은 --apply --apply-from 과만 씁니다(끊긴 반영 이어 쓰기)");
  return {
    dryRun, apply, absentZero: argv.includes("--absent-zero"), resume: argv.includes("--resume"), impactOut, applyFrom,
    sources: /** @type {GovlistSource[]} */ (src ? [src] : [...SOURCES]), files,
  };
}

/** @param {any} e */
const isMissingTable = (e) => e?.code === "PGRST205" || /Could not find the table|does not exist/.test(String(e?.message ?? ""));
/** @param {unknown} e */
const isMissingColumn = (e) => /column .* does not exist|42703|unsold_listed/.test(String(e instanceof Error ? e.message : e));

/**
 * @param {any} sb @param {string} region
 * @returns {Promise<{ rows: AptRow[]; listedCols: boolean }>}
 */
async function loadApartments(sb, region) {
  // select 칸은 글자 그대로 적는다 — 커서 열쇠 정적 가드(`_selectall-keycol-coverage`)가 "id" 를 리터럴에서 찾는다.
  try {
    return {
      rows: await selectAll((q) => q.from("apartments").select("id,name,region,gu,dong,address,road_address,builder,units,unit_source,unsold,unsold_rate,unsold_source,unsold_as_of,presale_type,complex_key,naver_presale_no,competition_supply,completion,updated_at,unsold_listed_as_of,unsold_listed_total").eq("region", region), sb, "id"),
      listedCols: true,
    };
  } catch (e) {
    if (!isMissingColumn(e)) throw e;
    log(PHASE, `apartments.unsold_listed_* 칸 없음(PR-1 마이그 전) — 두 칸을 빈칸으로 보고 계획한다`);
    const rows = await selectAll((q) => q.from("apartments").select("id,name,region,gu,dong,address,road_address,builder,units,unit_source,unsold,unsold_rate,unsold_source,unsold_as_of,presale_type,complex_key,naver_presale_no,competition_supply,completion,updated_at").eq("region", region), sb, "id");
    return { rows: rows.map((/** @type {any} */ r) => ({ ...r, unsold_listed_as_of: null, unsold_listed_total: null })), listedCols: false };
  }
}

/** 공고 재료(행 id 50개씩 · 각 묶음은 id 커서라 1,000행 상한에 안 잘린다). @param {any} sb @param {string[]} ids */
async function loadNotices(sb, ids) {
  /** @type {any[]} */ const supplies = [];
  /** @type {any[]} */ const schedules = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    supplies.push(...await selectAll((q) => q.from("applyhome_unit_supply").select("id,apartment_id,house_manage_no,model_no,general_supply,special_supply,source").in("apartment_id", chunk), sb, "id"));
    schedules.push(...await selectAll((q) => q.from("presale_schedule_official").select("id,apartment_id,house_manage_no,recruit_date").in("apartment_id", chunk), sb, "id"));
  }
  return { supplies, schedules };
}

/**
 * 그 출처의 가장 새 **완성** batch(실제 행 수 = batch_rows) — 반쯤 쓰인 batch 는 건너뛴다(그것을 「전 회차」로 집으면 같은 달이
 * 영구 not_newer 가 된다 — 세션687 PR-2 검사 A🟠3). 표가 아직 없으면(PR-1 전) "no-table".
 * @param {any} sb @param {string} source
 * @returns {Promise<{ asOf: string; rows: number; batchId: string; skippedIncomplete: string[] } | null | "no-table">}
 */
export async function loadPrevBatch(sb, source) {
  /** @type {string[]} */ const seen = [];
  for (let i = 0; i < 8; i++) {
    let q = sb.from(LIST_TABLE).select("as_of,batch_id,batch_rows,fetched_at").eq("source", source);
    for (const b of seen) q = q.neq("batch_id", b);
    const { data, error } = await q.order("as_of", { ascending: false }).order("fetched_at", { ascending: false }).limit(1);
    if (error) {
      if (isMissingTable(error)) return "no-table";
      throw new Error(`${LIST_TABLE} 조회 실패: ${error.message}`);
    }
    const r = data?.[0];
    if (!r) return null;
    const c = await sb.from(LIST_TABLE).select("id", { count: "exact", head: true }).eq("source", source).eq("batch_id", r.batch_id);
    if (c.error) throw new Error(`${LIST_TABLE} 행 수 조회 실패: ${c.error.message}`);
    if (c.count === Number(r.batch_rows)) return { asOf: r.as_of, rows: Number(r.batch_rows), batchId: r.batch_id, skippedIncomplete: [...seen] };
    seen.push(r.batch_id);
  }
  return null;
}

/**
 * 명단 표 쓰기 — 새 batch 먼저 넣고 행 수 = batch_rows 확인 뒤 같은 (출처, 기준일)의 옛 batch 를 지운다(`trade_deals` 꼴).
 * 넣기가 중간에 실패하거나 행 수가 안 맞으면 **넣은 새 batch 를 지우고** 실패를 돌려준다(반쯤 쓰인 batch 를 남기지 않는다 — A🟠3).
 * @param {any} sb @param {ReturnType<typeof buildListRows>} rows
 * @returns {Promise<{ ok: boolean; inserted: number; deletedOld: number; error?: string }>}
 */
export async function writeListBatch(sb, rows) {
  if (!rows.length) return { ok: false, inserted: 0, deletedOld: 0, error: "행 0" };
  const { source, as_of: asOf, batch_id: batchId } = rows[0];
  const dropNew = () => sb.from(LIST_TABLE).delete().eq("source", source).eq("as_of", asOf).eq("batch_id", batchId);
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from(LIST_TABLE).insert(rows.slice(i, i + 200));
    if (error) {
      const d = await dropNew();
      return { ok: false, inserted, deletedOld: 0, error: `insert: ${error.message} — 새 batch ${d?.error ? `지우기도 실패(${d.error.message})` : "를 지웠다"}` };
    }
    inserted += Math.min(200, rows.length - i);
  }
  const c = await sb.from(LIST_TABLE).select("id", { count: "exact", head: true }).eq("source", source).eq("as_of", asOf).eq("batch_id", batchId);
  if (c.error || c.count !== rows.length) {
    await dropNew();
    return { ok: false, inserted, deletedOld: 0, error: `행 수 확인 실패(${c.error?.message ?? `${c.count} ≠ ${rows.length}`}) — 새 batch 를 지웠다` };
  }
  const d = await sb.from(LIST_TABLE).delete({ count: "exact" }).eq("source", source).eq("as_of", asOf).neq("batch_id", batchId);
  if (d.error) return { ok: false, inserted, deletedOld: 0, error: `옛 batch 지우기: ${d.error.message}` };
  return { ok: true, inserted, deletedOld: d.count ?? 0 };
}

/**
 * apartments 한 행 조건부 갱신 — 이전 값(4칸 + 새 2칸이 있으면 6칸)이 그대로일 때만.
 * @param {any} sb @param {{ id: string; before: import("./_govlist-plan.mjs").Six; after: import("./_govlist-plan.mjs").Six | null }} r @param {boolean} listedCols
 * @returns {Promise<"ok" | "race" | "fail">}
 */
export async function updateApartment(sb, r, listedCols) {
  const keys = listedCols ? VALUE_KEYS : RESTORE_EXPECT_KEYS;
  const set = Object.fromEntries(keys.map((k) => [k, r.after?.[k] ?? null]));
  let q = sb.from("apartments").update(set).eq("id", r.id);
  for (const k of keys) { const v = r.before[k]; q = v == null ? q.is(k, null) : q.eq(k, v); }
  const { data, error } = await q.select("id");
  if (error) return "fail";
  return (data?.length ?? 0) === 1 ? "ok" : "race";
}

/**
 * 이어 쓰기 분류 — 승인 계획의 쓰는 행마다 지금 DB 값이 이전 값이면 todo · 새 값이면 done · 그 밖이면 other(하나라도 있으면 전부 멈춤).
 * @param {PlanRow[]} approved @param {Map<string, import("./_govlist-plan.mjs").Six>} current
 */
export function resumeClassify(approved, current) {
  /** @type {PlanRow[]} */ const todo = [];
  /** @type {string[]} */ const done = [];
  /** @type {string[]} */ const other = [];
  for (const r of approved.filter(isWrite)) {
    const cur = current.get(r.id);
    if (cur && sameSix(cur, r.before)) todo.push(r);
    else if (cur && sameSix(cur, r.after)) done.push(r.id);
    else other.push(r.id);
  }
  return { todo, done, other };
}

/**
 * 이어 쓰기 대조 — 다시 세운 계획(새로 받은 원문 + 지금 DB)과 승인 계획을 맞댄다. 승인 쓰는 행마다 같은 id 행이 있어야 하고 새 값이 같아야 하며,
 * 이미 쓴 행은 `unchanged`, 남은 행은 승인과 같은 행동·이전 값의 write_* 여야 한다. 승인에 없는 쓰는 행이 생겨도 다름.
 * @param {PlanRow[]} rebuilt @param {PlanRow[]} approved
 */
export function resumeComparePlans(rebuilt, approved) {
  const cur = new Map(rebuilt.map((r) => [r.id, r]));
  const aprW = approved.filter(isWrite);
  const aprIds = new Set(aprW.map((r) => r.id));
  /** @type {string[]} */ const missing = [];
  /** @type {string[]} */ const changed = [];
  for (const a of aprW) {
    const c = cur.get(a.id);
    if (!c) { missing.push(a.id); continue; }
    const okAfter = sameSix(c.after, a.after);
    const okDone = c.action === "unchanged";
    const okTodo = isWrite(c) && c.action === a.action && sameSix(c.before, a.before);
    if (!okAfter || !(okDone || okTodo)) changed.push(a.id);
  }
  const extra = rebuilt.filter((r) => isWrite(r) && !aprIds.has(r.id)).map((r) => r.id);
  return { same: !missing.length && !changed.length && !extra.length, missing, changed, extra };
}

/** "YYYYMMDD-HHmmss"(KST). @param {Date} d */
const stamp = (d) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

/**
 * (d) 하나로만 막힌 켬 계획 행 — 판정 파일로 그 시군구를 해소하면 0 이 될 수 있는 상한(Q5 재료, G6①).
 * @param {PlanRow[]} planOn
 */
export function dOnlyRows(planOn) {
  return planOn.filter((r) => r.action === "not_listed" && r.reasons.length > 0 && r.reasons.every((x) => x.startsWith("d_")));
}

/**
 * 매칭 표식(설계서 §7 「매칭」 · PR-4b (e)) — `GOVLIST_MATCH <출처> 판정필요 <N>{<시군구>:<수>,…} 충돌 <M>`.
 * 판정 필요 = weak·none(사람 판정 파일로 풀어야 하는 명단 단지 — §5-③(d) 「해소」 잣대) · 충돌 = 한 명단 단지 ↔ 두 묶음(`two_bundles`)
 * + 두 명단 단지 ↔ 한 묶음(`bundle_shared`). 시군구 이름의 빈칸은 뗀다(「천안시 동남구」 → 「천안시동남구」 — 감시가 `\S+` 로 자른다).
 * 감시 ㉔-c `parseGovlistMatch`(monitor-collectors.mjs)가 같은 꼴로 읽는다.
 * @param {string} source @param {Array<{ sgg: string | null; state: string; reasons: string[] }>} matches
 */
export function matchMarker(source, matches) {
  /** @type {Record<string, number>} */ const bySgg = {};
  let total = 0, conflicts = 0;
  for (const m of matches) {
    if (m.reasons.includes("two_bundles") || m.reasons.includes("bundle_shared")) conflicts++;
    if (m.state !== "weak" && m.state !== "none") continue;
    total++;
    const k = String(m.sgg ?? "?").replace(/[\s:,{}]+/g, "") || "?";
    bySgg[k] = (bySgg[k] ?? 0) + 1;
  }
  const list = Object.keys(bySgg).sort().map((k) => `${k}:${bySgg[k]}`).join(",");
  return `GOVLIST_MATCH ${source} 판정필요 ${total}{${list}} 충돌 ${conflicts}`;
}

/**
 * 반영 요약 표식(세션693 보완 B4 · blind🟡5) — `GOVLIST_APPLIED <출처> 단지 <N> 행 <M> {<값 변화 꼴>:<수>,…}`.
 * 단지 = 쓴 묶음 수 · 행 = 쓴 행 수 · 꼴 = `changeClass`(값>0→빈칸·빈칸→값·값→다른 값·값>0→0·빈칸→비공개(새 등재)·
 * 값 같음·출처·비율 바뀜·값 같음·칸만 바뀜 …) 이름순.
 * @param {string} source @param {PlanRow[]} rows 이번에 쓴 행(그 출처)
 */
export function appliedMarker(source, rows) {
  /** @type {Record<string, number>} */ const by = {};
  for (const r of rows) { const c = changeClass(r); by[c] = (by[c] ?? 0) + 1; }
  const bundles = new Set(rows.map((r) => r.bundle_key)).size;
  return `GOVLIST_APPLIED ${source} 단지 ${bundles} 행 ${rows.length} {${Object.keys(by).sort().map((k) => `${k}:${by[k]}`).join(",")}}`;
}

/**
 * @param {{ argv?: string[]; sb?: any; fetchImpl?: typeof fetch; now?: Date; decisionsPath?: string; artifactsRoot?: string; applyEnabled?: boolean;
 *   loadGrids?: (buf: Buffer) => Promise<import("./_govlist-parse.mjs").Grid[]> }} [deps]
 * @returns {Promise<{ impact?: any; impactPath?: string; wrote: number; exitCode?: number }>}
 */
export async function main(deps = {}) {
  const argv = deps.argv ?? process.argv.slice(2);
  const args = parseArgs(argv);
  const now = deps.now ?? new Date();
  const startedAt = now.toISOString();
  const rpt = createReporter(PHASE);
  /** @type {string[]} */ const markers = [];
  /** 매칭 표식(`GOVLIST_MATCH …`) — impact.markers(건너뜀·실패 표식)와 섞지 않고 기록할 때만 뒤에 붙인다. @type {string[]} */ const matchMarkers = [];
  /** 읽은 명단 원문 행 수(출처 합 · 머리줄·행 0 으로 건너뛴 출처는 0) — `collector_runs.skip_count` 로 남긴다(PR-4b A4). @type {{ listRows: number }} */
  const tally = { listRows: 0 };
  let recorded = false;
  /**
   * ok = apartments 실제 갱신 행 수 · skip = 읽은 명단 원문 행 수 — 감시 ⑤-a(빈 성공 3연속)는 ok 0 **이고** skip 0 일 때만 울리므로,
   * 바뀜 0 인 정상 달(명단은 읽음)은 침묵하고 명단을 못 읽은 달만 운다(👤 11/04 세션693 「B 안」). ⑬ 실패 비율(ok·fail)은 그대로.
   * @param {string} status @param {number} ok @param {number} fail
   */
  const finish = async (status, ok, fail) => {
    recorded = true;
    const s = rpt.summary();
    const all = [...markers, ...matchMarkers].join(" · ");
    await recordCollectorRun(PHASE, { ...s, status, ok, fail, skip: tally.listRows, startedAt, errorMessage: all ? all.slice(0, 1800) : null }, deps.sb ?? null);
  };
  if (!deps.sb) loadEnv();
  const sb = deps.sb ?? getSupabase();
  // ⛔ 반영 잠금 — 쓰기 전에 거부(dry-run 은 그대로)
  if (args.apply && !(deps.applyEnabled ?? GOVLIST_APPLY_ENABLED)) {
    markers.push("GOVLIST_APPLY_LOCKED PR-4(KOSIS govlist 존중·시계열 건너뜀) 합친 뒤에만 켠다");
    logError(PHASE, `[잠금] --apply 거부 — ${markers[0]} · 쓰기 0`);
    await finish("failure", 0, 1);
    return { wrote: 0, exitCode: EXIT_APPLY_LOCKED };
  }
  try {
    return await run(args, deps, { now, rpt, markers, matchMarkers, tally, sb, finish });
  } catch (e) {
    // 반영 중 예외(조회 실패·사본 파일 wx 충돌 등)도 실패 기록을 남긴다(data-changing-run-approval §2 — G7⑤)
    if (args.apply && !recorded) {
      markers.push(`GOVLIST_ERROR ${e instanceof Error ? e.message : String(e)}`.slice(0, 400));
      await finish("failure", 0, 1);
    }
    throw e;
  }
}

/**
 * @param {ReturnType<typeof parseArgs>} args
 * @param {NonNullable<Parameters<typeof main>[0]>} deps
 * @param {{ now: Date; rpt: ReturnType<typeof createReporter>; markers: string[]; matchMarkers: string[]; tally: { listRows: number }; sb: any; finish: (s: string, ok: number, fail: number) => Promise<void> }} ctx
 */
async function run(args, deps, { now, rpt, markers, matchMarkers, tally, sb, finish }) {
  // 엑셀 읽기 모듈은 쓸 때만 불러온다(시험은 격자를 직접 넣는다 — exceljs 없이도 본체 시험이 돈다).
  const loadGrids = deps.loadGrids ?? (async (/** @type {Buffer} */ buf) => (await import("./_govlist-xlsx.mjs")).workbookToGrids(buf));
  const artifactsRoot = deps.artifactsRoot ?? resolve(ROOT, ".omc/artifacts/govlist");
  // 판정 파일이 깨졌으면 누리집·DB 를 부르기 전에 멈춘다.
  const decisions = parseMatchDecisions(JSON.parse(readFileSync(deps.decisionsPath ?? DECISIONS_PATH, "utf8")));
  log(PHASE, `=== ${args.dryRun ? "미리보기(dry-run — 쓰기 0)" : `반영(--apply${args.resume ? " --resume" : ""})`} · 출처 ${args.sources.join(",")} · 미등재→0 ${args.absentZero ? "켬" : "꺼짐"} ===`);

  /** @type {any[]} */ const sourceReports = [];
  /** @type {PlanRow[]} */ const planOff = [];
  /** @type {PlanRow[]} */ const planOn = [];
  /** @type {Array<{ source: string; asOf: string; listRows: ReturnType<typeof buildListRows>; prevRows: number | null; listAlready: boolean }>} */ const writes = [];
  /** @type {Map<string, import("./_govlist-plan.mjs").Six>} */ const current = new Map();
  let listedColsAll = true;
  let calls = 0;

  for (const source of args.sources) {
    if (rpt.interrupted()) break;
    const region = SOURCE_REGION[source];
    /** @type {any} */ const rep = { source, region, markers: [] };
    sourceReports.push(rep);
    const skip = (/** @type {string} */ why) => { const m = `GOVLIST_SKIP ${source} ${why}`; rep.markers.push(m); markers.push(m); log(PHASE, `[건너뜀] ${m}`); };
    // ── 받기 ──
    /** @type {{ buffer: Buffer; titleAsOf: string | null; title: string | null; fileUrl: string; fileName: string }} */ let file;
    try {
      const local = args.files.get(source);
      if (local) file = { buffer: readFileSync(local), titleAsOf: null, title: null, fileUrl: `file:${local}`, fileName: local };
      else { const f = await fetchLatestGovlist(source, { fetchImpl: deps.fetchImpl }); calls += f.calls; file = f; }
    } catch (e) {
      skip(`fetch(${e instanceof Error ? e.message : String(e)})`);
      if (!(e instanceof GovlistFetchError)) logError(PHASE, String(e));
      continue;
    }
    rep.file = { url: file.fileUrl, name: file.fileName, bytes: file.buffer.length, title: file.title };
    // ── 읽기 ──
    let parsed;
    try {
      parsed = parseGovlistWorkbook(await loadGrids(file.buffer), { source });
    } catch (e) {
      if (e instanceof GovlistParseError) { skip(`header(${e.message})`); continue; }
      throw e;
    }
    if (file.titleAsOf && file.titleAsOf !== parsed.asOf) { skip(`header(글 제목 기준일 ${file.titleAsOf} ≠ 파일 본문 ${parsed.asOf})`); continue; }
    Object.assign(rep, { asOf: parsed.asOf, sheet: parsed.sheet, rows: parsed.rows.length, complexes: parsed.complexes.length, hidden: parsed.complexes.filter((c) => c.hidden).length, checks: parsed.checks, sggTotals: parsed.sggTotals, columns: parsed.columns.map((c) => c.key) });
    if (!parsed.rows.length) { skip("rows0"); continue; }
    tally.listRows += parsed.rows.length; // not_newer 달도 명단은 읽었다 — ⑤-a 가 「외부 원천 정상 · 바뀜만 0」으로 보게(A4)
    log(PHASE, `[${source}] ${parsed.asOf} 명단 — 면적대 줄 ${parsed.rows.length} · 단지 ${parsed.complexes.length}(비공개 ${rep.hidden}) · 소계 어긋남 ${parsed.checks.subtotalMismatch.length} · 합계 어긋남 ${parsed.checks.sectionMismatch.length}(원본 수식 — 경고) · 미분양>총분양 ${parsed.checks.unsoldOverTotal.length}`);
    // ── 전 회차(완성 batch 만) ──
    const prev = await loadPrevBatch(sb, source);
    rep.prev = prev;
    const prevRows = prev && prev !== "no-table" ? prev.rows : null;
    let notNewer = false;
    let listAlready = false;
    if (prev === "no-table") log(PHASE, `[${source}] ${LIST_TABLE} 표 없음(PR-1 마이그 전) — 전 회차 없음으로 계획`);
    else if (prev && args.resume && parsed.asOf === prev.asOf) { listAlready = true; log(PHASE, `[${source}] --resume: 같은 기준일 ${prev.asOf} 완성 batch 있음 — 명단 표는 안 쓰고 apartments 남은 행만`); }
    else if (prev && parsed.asOf <= prev.asOf) { notNewer = true; skip(`not_newer(파일 ${parsed.asOf} ≤ 저장된 ${prev.asOf})`); }
    if (prev && prev !== "no-table" && prev.skippedIncomplete.length) log(PHASE, `[${source}] 반쯤 쓰인 batch ${prev.skippedIncomplete.length}개 건너뜀(전 회차로 안 셈): ${prev.skippedIncomplete.join(", ")}`);
    // ── 우리 단지 · 매칭 ──
    const { rows: apts, listedCols } = await loadApartments(sb, region);
    listedColsAll &&= listedCols;
    for (const a of apts) current.set(a.id, sixOf(a));
    const { supplies, schedules } = await loadNotices(sb, apts.map((a) => a.id));
    const bundles = buildBundles(apts, supplies, schedules);
    const results = matchComplexes(parsed.complexes, bundles, decisions);
    /** @type {Record<string, number>} */ const counts = {};
    for (const r of results) counts[r.state] = (counts[r.state] ?? 0) + 1;
    rep.match = { apartments: apts.length, bundles: bundles.length, counts };
    rep.matches = results.map((r) => {
      const cx = parsed.complexes[r.complex_no - 1];
      return { complex_no: r.complex_no, list_key: r.list_key, sgg: cx.sgg, names: cx.name_candidates, total: cx.total_units, unsold: cx.unsold_units, hidden: cx.hidden,
        state: r.state, method: r.method, bundle_key: r.bundle_key, apartment_id: r.apartment_id, best: r.best, reasons: r.reasons };
    });
    // 해소에 필요한 판정 단지(weak·none) — 시군구별(Q5 재료, G6①)
    /** @type {Record<string, number>} */ const unresolvedBySgg = {};
    for (const m of rep.matches) if (m.state === "weak" || m.state === "none") unresolvedBySgg[m.sgg ?? "?"] = (unresolvedBySgg[m.sgg ?? "?"] ?? 0) + 1;
    rep.unresolved = { total: Object.values(unresolvedBySgg).reduce((a, b) => a + b, 0), bySgg: unresolvedBySgg };
    rep.matchMarker = matchMarker(source, rep.matches);
    matchMarkers.push(rep.matchMarker);
    log(PHASE, `[${source}] 매칭 — 우리 행 ${apts.length} · 묶음 ${bundles.length} · ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ")} · 판정 필요(weak·none) ${rep.unresolved.total}`);
    // ── 계획(꺼짐·켬) ──
    const common = { source, asOf: parsed.asOf, now, complexes: parsed.complexes, results, bundles, sggUniverse: parsed.sggUniverse, sggTotals: parsed.sggTotals, listRowCount: parsed.rows.length, prevRowCount: prevRows };
    const off = notNewer ? [] : planSource({ ...common, absentZero: false });
    const on = notNewer ? [] : planSource({ ...common, absentZero: true });
    planOff.push(...off); planOn.push(...on);
    // 대조군
    rep.controls = CONTROLS.filter((c) => c.source === source).map((c) => ({
      label: c.label,
      list: rep.matches.filter((/** @type {any} */ m) => m.names.some((/** @type {string} */ n) => c.re.test(n))).map((/** @type {any} */ m) => ({ state: m.state, bundle_key: m.bundle_key, total: m.total, hidden: m.hidden, best: m.best })),
      plan_off: off.filter((r) => c.re.test(String(r.name))).map((r) => ({ id: r.id, action: r.action, before: r.before, after: r.after })),
      plan_on: on.filter((r) => c.re.test(String(r.name))).map((r) => ({ id: r.id, action: r.action, reasons: r.reasons })),
    }));
    for (const c of rep.controls) log(PHASE, `[대조군] ${c.label}: 명단 ${c.list.map((/** @type {any} */ l) => l.state).join(",") || "없음"} · 꺼짐 ${c.plan_off.map((/** @type {any} */ p) => `${p.id}=${p.action}`).join(", ")} · 켬 ${c.plan_on.map((/** @type {any} */ p) => `${p.id}=${p.action}`).join(", ")}`);
    if (!notNewer) {
      const batchId = `${parsed.asOf}-${stamp(now)}`;
      writes.push({ source, asOf: parsed.asOf, prevRows, listAlready, listRows: buildListRows({ source, asOf: parsed.asOf, batchId, fileUrl: file.fileUrl, fetchedAt: now.toISOString(), rows: parsed.rows, results }) });
    }
  }

  // ── 전이표 · 차단기 · CHECK 사전 검사 ──
  const lists = writes.map((w) => ({ source: w.source, rows: w.listRows.length, prevRows: w.prevRows }));
  const sumOff = summarize(planOff), sumOn = summarize(planOn);
  const brOff = breaker({ valueChangedBySource: sumOff.valueChangedBySource, lists }), brOn = breaker({ valueChangedBySource: sumOn.valueChangedBySource, lists });
  const violationsOf = (/** @type {PlanRow[]} */ p) => p.filter((r) => isWrite(r) && r.after && rowCheckViolations(r.after).length).map((r) => ({ id: r.id, action: r.action, violations: rowCheckViolations(/** @type {any} */ (r.after)) }));
  const dOnly = dOnlyRows(planOn);
  /** @type {Record<string, number>} */ const dOnlyByRegion = {};
  for (const r of dOnly) dOnlyByRegion[r.region ?? "?"] = (dOnlyByRegion[r.region ?? "?"] ?? 0) + 1;
  const impact = {
    generatedAt: now.toISOString(), phase: PHASE, mode: args.dryRun ? "dry-run" : "apply", externalCalls: calls, listedCols: listedColsAll,
    sources: sourceReports, markers,
    modes: {
      off: { summary: sumOff, breaker: brOff, checkViolations: violationsOf(planOff), plan: planOff },
      on: {
        summary: sumOn, breaker: brOn, checkViolations: violationsOf(planOn),
        // 켬 최대 상한 — (d) 하나로만 막힌 행(판정 파일로 그 시군구를 해소하면 0 이 될 수 있다)
        dOnly: { total: dOnly.length, byRegion: dOnlyByRegion, rows: dOnly.map((r) => ({ id: r.id, name: r.name, region: r.region, gu: r.gu, unsold: r.before.unsold, reasons: r.reasons })) },
        plan: planOn,
      },
    },
  };
  for (const [k, s, b] of /** @type {const} */ ([["꺼짐", sumOff, brOff], ["켬", sumOn, brOn]])) {
    log(PHASE, `[전이표 ${k}] 쓰는 행 ${s.writeRows} · 바뀔 단지 ${s.changedBundles}(값 바뀜 ${JSON.stringify(s.valueChangedBySource)}) · 값 변화 ${JSON.stringify(s.byChange)} · 출처 ${JSON.stringify(s.sourceShift)}${b.tripped ? ` · 차단기 ${b.reasons.join(" / ")}` : ""}`);
  }
  log(PHASE, `[켬 상한] (d) 하나로만 막힌 행 ${dOnly.length}(${JSON.stringify(dOnlyByRegion)}) · CHECK 위반 꺼짐 ${impact.modes.off.checkViolations.length} · 켬 ${impact.modes.on.checkViolations.length}`);
  const impactPath = args.impactOut ?? resolve(artifactsRoot, `impact-${stamp(now)}.json`);
  mkdirSync(dirname(impactPath), { recursive: true });
  writeFileSync(impactPath, JSON.stringify(impact, null, 2), "utf8");
  log(PHASE, `[IMPACT] ${impactPath}`);

  if (args.dryRun) {
    log(PHASE, `=== 미리보기 끝 — DB·collector_runs 쓰기 0 · 누리집 호출 ${calls}회 ===`);
    return { impact, impactPath, wrote: 0 };
  }

  // ── 반영(--apply --apply-from [--resume] · 또는 평시 --apply) ──
  const mode = args.absentZero ? "on" : "off";
  const plan = mode === "on" ? planOn : planOff;
  const br = mode === "on" ? brOn : brOff;
  /** @type {PlanRow[]} */ let toWrite;
  /** 승인 계획(--apply-from 일 때만 — 평시 반영은 빈 배열로 두고 쓰지 않는다). @type {PlanRow[]} */ let approved = [];
  if (!args.applyFrom) {
    // 평시 반영(PR-4b · 👤 11/04 「자동 반영 + 차단기」) — parseArgs 가 --absent-zero·--resume 을 이미 막았다(꺼짐 계획만).
    // ① 첫 회차는 승인 파일로만: 이번에 쓸 출처에 반영된 완성 batch(전 회차)가 없으면 쓰기 0(러너 8일이 첫 반영보다 먼저 와도 안전)
    const first = writes.filter((w) => w.prevRows == null).map((w) => w.source);
    if (first.length) {
      const m = `GOVLIST_FIRST_NEEDS_APPROVAL ${first.join(",")} — 반영된 완성 batch 없음(첫 회차는 --apply --apply-from=<승인한 impact> 로만)`;
      markers.push(m); logError(PHASE, `[차단] ${m} — 쓰기 0`);
      await finish("failure", 0, 1);
      return { impact, impactPath, wrote: 0, exitCode: EXIT_FIRST_NEEDS_APPROVAL };
    }
    // ② 차단기 — 승인 파일이 없으니 넘는 회차는 쓰지 않는다(넘는 달은 dry-run → 전이표 승인 → --apply-from)
    if (br.tripped) {
      // 맨 앞에 둔다 — 감시 ⑬ 이 error_message 앞 80자만 보여 준다(세션693 검사 blind🟠1: 텔레그램에 「승인 필요」가 없었다)
      const m = `GOVLIST_BREAKER 승인 필요 — dry-run 뒤 --apply-from · ${br.reasons.join(" / ")}`;
      markers.unshift(m); logError(PHASE, `[차단기] ${m} — 쓰기 0 (impact ${impactPath} 로 전이표를 만들어 승인 뒤 --apply-from)`);
      await finish("failure", 0, 1);
      return { impact, impactPath, wrote: 0, exitCode: EXIT_BREAKER };
    }
    toWrite = plan.filter(isWrite);
    log(PHASE, `[평시 반영] 차단기 통과 — 쓰는 행 ${toWrite.length} · 바뀔 단지 ${(mode === "on" ? sumOn : sumOff).changedBundles} · 값 바뀜 ${JSON.stringify((mode === "on" ? sumOn : sumOff).valueChangedBySource)}`);
  } else {
    const ap = /** @type {any} */ (JSON.parse(readFileSync(args.applyFrom, "utf8")))?.modes?.[mode]?.plan;
    if (!Array.isArray(ap)) {
      markers.push(`GOVLIST_PLAN_MISMATCH 승인 파일에 modes.${mode}.plan 없음`);
      await finish("failure", 0, 1);
      return { impact, impactPath, wrote: 0 };
    }
    approved = ap;
    if (args.resume) {
      // 이어 쓰기는 출처마다 같은 기준일의 완성 batch 가 이미 있을 때만(없으면 명단 표를 새로 넣게 되어 승인과 다른 원문이 들어갈 수 있다 — 재검사 🟠)
      const noBatch = args.sources.filter((s) => !writes.some((w) => w.source === s && w.listAlready));
      if (noBatch.length) {
        markers.push(`GOVLIST_RESUME_NO_BATCH ${noBatch.join(",")} — 같은 기준일 완성 batch 없음(--resume 없이 다시 승인받는다)`);
        logError(PHASE, `[차단] --resume 인데 같은 기준일 완성 batch 가 없는 출처 ${noBatch.join(",")} — 쓰기 0`);
        await finish("failure", 0, 1);
        return { impact, impactPath, wrote: 0, exitCode: EXIT_RESUME_NO_BATCH };
      }
      const rc = resumeClassify(approved, current);
      log(PHASE, `[--resume] 승인 쓰는 행 — 남음 ${rc.todo.length} · 이미 씀 ${rc.done.length} · 그 밖 ${rc.other.length}`);
      if (rc.other.length) {
        markers.push(`GOVLIST_PLAN_MISMATCH resume 그 밖 ${rc.other.length}(${rc.other.slice(0, 10).join(",")})`);
        logError(PHASE, `[차단] 지금 값이 승인 계획의 이전 값도 새 값도 아닌 행 ${rc.other.length} — 쓰기 0`);
        await finish("failure", 0, 1);
        return { impact, impactPath, wrote: 0 };
      }
      toWrite = rc.todo;
    } else {
      const cmp = comparePlans(plan, approved);
      if (!cmp.same) {
        const m = `GOVLIST_PLAN_MISMATCH 이번에만 ${cmp.onlyCurrent.length} · 승인에만 ${cmp.onlyApproved.length} · 값 다름 ${cmp.changed.length}`;
        markers.push(m); logError(PHASE, `[차단] ${m} — 쓰기 0`);
        await finish("failure", 0, 1);
        return { impact, impactPath, wrote: 0 };
      }
      toWrite = plan.filter(isWrite);
    }
  }
  // DB CHECK 가 거부할 행이 하나라도 있으면 아무것도 안 쓴다(부분 반영 방지 — G1③)
  const bad = toWrite.filter((r) => r.after && rowCheckViolations(r.after).length);
  if (bad.length) {
    markers.push(`GOVLIST_WRITE check_violation ${bad.length}(${bad.slice(0, 5).map((r) => r.id).join(",")})`);
    await finish("failure", 0, 1);
    return { impact, impactPath, wrote: 0, ...(!args.applyFrom ? { exitCode: EXIT_WRITE_FAILURE } : {}) };
  }
  // 이어 쓰기도 다시 세운 계획과 맞댄다(승인 파일의 새 값을 그대로 믿지 않는다 — 재검사 🟠). CHECK 사전 검사 뒤에 두는 것은 G1③ 표식을 지키려는 순서일 뿐(둘 다 쓰기 0).
  if (args.resume) {
    const rcmp = resumeComparePlans(plan, approved);
    if (!rcmp.same) {
      const m = `GOVLIST_PLAN_MISMATCH resume 없음 ${rcmp.missing.length} · 값 다름 ${rcmp.changed.length} · 이번에만 ${rcmp.extra.length}(${[...rcmp.missing, ...rcmp.changed, ...rcmp.extra].slice(0, 10).join(",")})`;
      markers.push(m); logError(PHASE, `[차단] ${m} — 쓰기 0`);
      await finish("failure", 0, 1);
      return { impact, impactPath, wrote: 0 };
    }
  }
  if (br.tripped) log(PHASE, `[차단기] ${br.reasons.join(" / ")} — 승인한 계획과 행마다 같아 통과(승인 = 이 명단)`);
  // 바꾸기 전 사본·역계획(출처·기준일별 · 새 파일로만 · 이번에 실제로 쓸 행만)
  for (const w of writes) {
    const rows = toWrite.filter((r) => r.source === w.source);
    if (!rows.length) continue;
    const dir = resolve(artifactsRoot, w.asOf);
    mkdirSync(dir, { recursive: true });
    const bk = buildBackup(rows, { asOf: w.asOf, source: w.source, generatedAt: now.toISOString() });
    const ts = stamp(now);
    writeFileSync(resolve(dir, `before-${w.source}-${ts}.json`), JSON.stringify(bk.before, null, 2), { encoding: "utf8", flag: "wx" });
    writeFileSync(resolve(dir, `restore-${w.source}-${ts}.json`), JSON.stringify(bk.restore, null, 2), { encoding: "utf8", flag: "wx" });
    log(PHASE, `[사본] ${dir} before/restore-${w.source}-${ts}.json`);
  }
  let ok = 0, fail = 0, race = 0;
  for (const w of writes) {
    if (rpt.interrupted()) break;
    if (!w.listAlready) {
      const lr = await writeListBatch(sb, w.listRows);
      if (!lr.ok) {
        markers.push(`GOVLIST_WRITE ${w.source} list_table(${lr.error})`); fail++;
        logError(PHASE, `[${w.source}] 명단 표 쓰기 실패 — 이 출처의 apartments 는 쓰지 않는다: ${lr.error}`);
        continue;
      }
      log(PHASE, `[${w.source}] 명단 표 ${lr.inserted}행 넣음 · 옛 batch ${lr.deletedOld}행 지움`);
    }
    for (const r of toWrite.filter((x) => x.source === w.source)) {
      if (rpt.interrupted()) break;
      const res = await updateApartment(sb, r, listedColsAll);
      if (res === "ok") ok++; else if (res === "race") race++; else fail++;
    }
  }
  const interrupted = rpt.interrupted();
  if (race) markers.push(`GOVLIST_WRITE race ${race}`);
  // 이어 쓰기 안내(세션693 보완 B6) — 같은 달 재실행은 not_newer 로 쓰기 0 이라 남은 행은 --resume 으로만 메운다
  //   출처가 하나면 --source 도 — 빼면 다른 출처에 같은 기준일 batch 가 없어 GOVLIST_RESUME_NO_BATCH 로 막힌다(2차 보완 C3)
  if (fail) markers.push(`GOVLIST_WRITE fail ${fail} — 이어 쓰기: --apply --apply-from=${args.applyFrom ?? impactPath} --resume${args.sources.length === 1 ? ` --source=${args.sources[0]}` : ""}`);
  if (interrupted) markers.push("GOVLIST_WRITE interrupted — --resume 으로 이어 쓴다");
  log(PHASE, `=== 반영 끝 — apartments ${ok}행 · 경합 ${race} · 실패 ${fail}${interrupted ? " · 도중 끊김(partial)" : ""} ===`);
  const status = interrupted ? "partial" : fail || race ? "failure" : "success";
  // 반영 요약(세션693 보완 B4) — 매달 무엇이 바뀌었는지 collector_runs 에 남긴다(status 그대로 · 실패 표식 없을 때만)
  if (status === "success") {
    for (const w of writes) {
      const rows = toWrite.filter((r) => r.source === w.source);
      if (!rows.length) continue;
      markers.push(appliedMarker(w.source, rows));
    }
  }
  await finish(status, ok, fail + race);
  // 평시 반영(사람이 안 보는 자동 회차)의 실패는 exit 1 — 러너 텔레그램을 타게(세션693 보완 B3)
  return { impact, impactPath, wrote: ok, ...(status === "failure" && !args.applyFrom ? { exitCode: EXIT_WRITE_FAILURE } : {}) };
}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().then((r) => { if (r.exitCode) process.exitCode = r.exitCode; }).catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
