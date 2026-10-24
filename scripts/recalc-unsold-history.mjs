// @ts-check
/**
 * recalc-unsold-history.mjs — 이미 있는 `unsold_history` 줄을 **오늘 셈법**으로 다시 계산해 값이 다른 줄만 고치는 일회성 도구 (세션658).
 *
 * ## 왜
 * 수집기(`collect-unsold-kosis.mjs`)의 시계열은 세션635 부터 "같은 단지 묶음" 단위로 분모·추정치를 낸다. 그 전에 쌓인
 * 줄(≤202606)은 옛 셈법 값이라, 화면 추이 그래프에 202606→202607 사이 계단이 생겼다(세션658 흉내 `step157`).
 * 사장님 결정(2026-10-24 · `.omc/artifacts/session658/decisions.md`): 있는 줄 **전부**를 오늘 셈법으로 다시 계산해
 * 값이 다른 줄만 `unsold_count` 한 칸을 UPDATE 한다. 새 줄 INSERT 없음 · DELETE 없음 · 계산 못 하는 줄과 held(≥50%) 줄은 그대로.
 * 수집기와 `_unsold-bundle.mjs` 는 고치지 않는다(「지금은 일회성 도구만」) — 계산은 수집기 시계열 루프(957~1006줄)를 그대로 옮긴
 * `historyMap` 이고, 필요한 함수는 import 만 한다.
 *
 * ## 사용법 (기본 = 미리보기, `--dry-run` 인자는 받지 않는다 — data-changing-run-approval §2)
 *   node --env-file=.env.local scripts/recalc-unsold-history.mjs --out=<미리보기.json> [--kosis-file=<원응답.json>]
 *   node --env-file=.env.local scripts/recalc-unsold-history.mjs --out=<반영.json> --apply --from=<미리보기.json>
 *   node --env-file=.env.local scripts/recalc-unsold-history.mjs --undo=<사본.json> [--from=<미리보기.json>]
 *
 *   - 미리보기: KOSIS 1회(`startPrdDe=202601` ~ 이번 달, `--kosis-file` 이면 호출 0) · 응답은 `<미리보기>.kosis.json` 으로 저장.
 *     미리보기·저장본은 새 파일로만(`wx`) · `<미리보기>.before.json`(반영 사본)이 이미 있으면 거부 — 반영 뒤 같은 이름 금지, 새 이름으로.
 *   - 반영: KOSIS 를 다시 부르지 않는다. `--from` 미리보기의 rows 만 쓴다 — 저장된 `.kosis.json` 으로 지금 DB 를 다시 계산해
 *     행마다 새 값을 맞대고, 하나라도 다르거나(그 사이 수집으로 분모가 바뀜) 저장본이 없으면 쓰기 0 + exit 1.
 *   - 되돌림: 사본(`<미리보기>.before.json`)의 값으로. 새 값을 알려면 미리보기가 필요하다(`--from` 또는 사본에 적힌 경로).
 *
 * ## 안전장치 (메모리 feedback_oneoff_fix_script_resumable — fix-units-from-plan.mjs 와 같은 꼴)
 *   - 순서 = 조회 → 계획(순수 `planHistoryRecalc`) → 미리보기 저장(--out 항상) → 차단기 → 쓰기.
 *   - 차단기: ① KOSIS 응답 달에 history 의 달이 하나라도 빠짐 ② apartments < 3,000 · history < 9,000 · 읽은 행 수 ≠ count exact
 *     (읽기 잘림 의심) — 미리보기에서는 경고 + 사유를 파일에 적고 exit 0, `--apply` 에서는 쓰기 0 + exit 1
 *     (사유가 적힌 미리보기는 `--apply` 가 거부한다).
 *   - 반영: 행마다 지금 `unsold_count` 를 다시 읽어 이전(=old → 씀) / 새(=new → 건너뜀) / 그 밖(→ 전부 거부, 쓰기 0).
 *   - 되돌림 사본 = 쓰기 전 (id, apartment_id, base_month, unsold_count, recorded_at) — 없을 때만 `wx`, 있으면 old 와 대조 뒤 재사용.
 *     사본이 없는데 "새" 행이 있으면 거부(새 값을 사본에 담게 된다).
 *   - UPDATE 조건 = `id` + `unsold_count = old`(null 이면 `.is`). 돌아온 행이 1이 아니면 실패로 센다. 동시 5개(`createSemaphore`).
 *   - `--undo` 는 행별: 지금 = 사본 → 건너뜀 · 지금 = new 이고 recorded_at = 사본 → 사본 값으로 · 그 밖(recorded_at 이 바뀐
 *     줄 = 수집기가 다시 쓴 줄 포함) → 실패 보고.
 *   - 종료 코드는 process.exitCode.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSemaphore, fetchWithRetry, getSupabase, selectAll } from "./collectors/_shared.mjs";
import { calcProportionalUnsold, kosisPairOf, parseKosisRowsAllMonths, resolveKosisGuKey } from "./collectors/collect-unsold-kosis.mjs";
import { foldForUnsold } from "./collectors/_unsold-bundle.mjs";

/** 수집기 collect-unsold-kosis.mjs:38 의 비공개 상수와 같은 값(export 안 돼 복사 — 바뀌면 같이 바꾼다). */
const UNRELIABLE_RATE_THRESHOLD = 50;
export const MIN_APARTMENTS = 3000;
export const MIN_HISTORY = 9000;
export const KOSIS_START = "202601";
/** 구간 경계 — 이 달 이하 = 옛 셈법 구간, 넘으면 묶음 셈법 뒤(세션635~). */
const SPLIT_MONTH = "202606";
const BATCH = 200;

/**
 * @typedef {{ C1_NM: string; C2_NM: string; PRD_DE: string; DT: string }} KosisRow
 * @typedef {{ id: number; apartment_id: string; base_month: string; unsold_count: number|null; recorded_at?: string|null }} HistRow
 * @typedef {{ id: number; apartment_id: string; name: string|null; region: string|null; gu: string|null; base_month: string; old: number|null; new: number }} PlanRow
 * @typedef {"이전"|"새"|"그 밖"} State
 * @typedef {{ out: string|null; apply: boolean; undo: string|null; from: string|null; kosisFile: string|null; mode: "dry"|"apply"|"undo" }} Args
 * @typedef {{ changed: number; same: number; orphan: number; held: number }} Counts
 */

/** 인자 허용 목록 — 모르는 인자는 던진다. @param {string[]} argv @returns {Args} */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const kv = {};
  let apply = false;
  for (const a of argv) {
    if (a === "--apply") {
      if (apply) throw new Error("--apply 가 두 번");
      apply = true;
      continue;
    }
    const m = /^--(out|undo|from|kosis-file)=(.+)$/.exec(a);
    if (!m) throw new Error(`모르는 인자: ${a}`);
    if (m[1] in kv) throw new Error(`--${m[1]} 가 두 번`);
    kv[m[1]] = m[2];
  }
  const out = kv.out ?? null, undo = kv.undo ?? null, from = kv.from ?? null, kosisFile = kv["kosis-file"] ?? null;
  if (apply && undo) throw new Error("--apply 와 --undo 는 같이 못 준다");
  if (undo) {
    if (out) throw new Error("--undo 는 --out 을 받지 않는다");
    if (kosisFile) throw new Error("--undo 는 --kosis-file 을 받지 않는다");
    return { out, apply, undo, from, kosisFile, mode: "undo" };
  }
  if (!out) throw new Error("--out=<경로> 필수(미리보기·반영 결과 저장)");
  if (apply) {
    if (!from) throw new Error("--apply 는 --from=<미리보기 파일> 필수");
    if (kosisFile) throw new Error("--apply 는 KOSIS 를 다시 읽지 않는다 — --kosis-file 을 받지 않는다");
    for (const p of [from, snapshotPathOf(from), kosisPathOf(from)]) {
      if (samePath(out, p)) throw new Error(`--out 이 ${p} 와 같은 파일 — 미리보기·사본·KOSIS 저장본을 덮어쓴다`);
    }
    return { out, apply, undo, from, kosisFile, mode: "apply" };
  }
  if (from) throw new Error("--from 은 --apply·--undo 와만 쓴다");
  if (kosisFile && (samePath(kosisFile, out) || samePath(kosisFile, kosisPathOf(out)))) throw new Error("--kosis-file 이 --out 또는 그 .kosis.json 과 같은 파일");
  if (samePath(out, snapshotPathOf(out))) throw new Error("--out 경로가 이상하다");
  return { out, apply, undo, from, kosisFile, mode: "dry" };
}

/** 경로 비교 — 절대경로로 풀고 Windows 는 대소문자 무시. @param {string} a @param {string} b */
function samePath(a, b) {
  const x = resolve(a), y = resolve(b);
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/** @param {string} p */
const stem = (p) => p.replace(/\.json$/i, "");
/** 되돌림 사본 경로. @param {string} previewPath */
export const snapshotPathOf = (previewPath) => `${stem(previewPath)}.before.json`;
/** KOSIS 원응답 저장 경로. @param {string} outPath */
export const kosisPathOf = (outPath) => `${stem(outPath)}.kosis.json`;
/** @param {string} text */
export const sha16 = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/**
 * 수집기 시계열 루프(collect-unsold-kosis.mjs 957~1006)를 그대로 옮긴 계산 — step157/sim.mjs `historyMap` 과 같다.
 * @param {any[]} apartments @param {KosisRow[]} kosisRows
 * @returns {Map<string, { estimated: number; unsoldRate: number; held: boolean; gk: string }>} `${apartment_id}|${YYYYMM}` → 값
 */
export function historyMap(apartments, kosisRows) {
  const allMonthsMap = parseKosisRowsAllMonths(kosisRows);
  const historyBundles = foldForUnsold(/** @type {any} */ (apartments), { isRespected: () => false, pairOf: kosisPairOf(allMonthsMap) });
  /** @type {Map<string, string | null>} */
  const historyKeyByBundle = new Map();
  /** @type {Record<string, number>} */
  const unitsByGuForHistory = {};
  for (const b of historyBundles) {
    if (!b.region || !b.units || b.units <= 1) { historyKeyByBundle.set(b.key, null); continue; }
    const monthMap = allMonthsMap[b.region];
    const kosisKey = monthMap ? resolveKosisGuKey(b.region, b.gu, /** @type {any} */ (monthMap)) : null;
    historyKeyByBundle.set(b.key, kosisKey);
    if (!kosisKey || b.lease) continue;
    const denomKey = `${b.region}::${kosisKey}`;
    unitsByGuForHistory[denomKey] = (unitsByGuForHistory[denomKey] || 0) + b.units;
  }
  /** @type {Map<string, { estimated: number; unsoldRate: number; held: boolean; gk: string }>} */
  const map = new Map();
  for (const b of historyBundles) {
    if (!b.region || !b.units || b.units <= 1 || b.lease) continue;
    const monthMap = allMonthsMap[b.region];
    const kosisKey = historyKeyByBundle.get(b.key) ?? null;
    if (!monthMap || !kosisKey) continue;
    const periodMap = /** @type {any} */ (monthMap)[kosisKey];
    if (!periodMap) continue;
    const totalUnitsInGu = unitsByGuForHistory[`${b.region}::${kosisKey}`] || b.units;
    const targets = b.members.filter((m) => m.unsold_source !== "hold").map((m) => m.id);
    for (const [period, guUnsold] of Object.entries(periodMap)) {
      const result = calcProportionalUnsold(/** @type {number} */ (guUnsold), b.units, totalUnitsInGu);
      if (!result) continue;
      const held = result.unsoldRate >= UNRELIABLE_RATE_THRESHOLD;
      for (const apartment_id of targets) {
        map.set(`${apartment_id}|${period}`, { estimated: result.estimated, unsoldRate: result.unsoldRate, held, gk: `${b.region}::${kosisKey}` });
      }
    }
  }
  return map;
}

/** @returns {Counts} */
const zero = () => ({ changed: 0, same: 0, orphan: 0, held: 0 });

/** 차이 구간. @param {number|null} oldV @param {number} newV */
export function diffBucket(oldV, newV) {
  if (oldV == null) return "이전 빈칸";
  const d = Math.abs(newV - oldV);
  return d <= 2 ? "1~2" : d <= 10 ? "3~10" : d <= 50 ? "11~50" : "51+";
}

/**
 * 계획(순수). 새 값 없음 → orphan(그대로) · held(률≥50) → 그대로 · 같음 → same · 다름 → rows.
 * @param {{ apartments: any[]; history: HistRow[]; kosisRows: KosisRow[] }} input
 */
export function planHistoryRecalc({ apartments, history, kosisRows }) {
  const map = historyMap(apartments, kosisRows);
  const aptById = new Map(apartments.map((a) => [a.id, a]));
  /** @type {PlanRow[]} */
  const rows = [];
  const counts = zero();
  /** @type {Record<string, Counts>} */ const byMonth = {};
  /** @type {Record<string, Counts>} */ const byRange = { [`≤${SPLIT_MONTH}`]: zero(), [`>${SPLIT_MONTH}`]: zero() };
  /** @type {Record<string, number>} */ const diffDist = { "1~2": 0, "3~10": 0, "11~50": 0, "51+": 0, "이전 빈칸": 0 };
  const direction = { up: 0, down: 0 };
  for (const h of history) {
    const v = map.get(`${h.apartment_id}|${h.base_month}`);
    /** @type {keyof Counts} */
    const kind = !v ? "orphan" : v.held ? "held" : v.estimated === h.unsold_count ? "same" : "changed";
    counts[kind]++;
    (byMonth[h.base_month] ??= zero())[kind]++;
    byRange[h.base_month <= SPLIT_MONTH ? `≤${SPLIT_MONTH}` : `>${SPLIT_MONTH}`][kind]++;
    if (kind !== "changed" || !v) continue;
    const a = aptById.get(h.apartment_id);
    rows.push({ id: h.id, apartment_id: h.apartment_id, name: a?.name ?? null, region: a?.region ?? null, gu: a?.gu ?? null, base_month: h.base_month, old: h.unsold_count, new: v.estimated });
    diffDist[diffBucket(h.unsold_count, v.estimated)]++;
    if (h.unsold_count != null) direction[v.estimated > h.unsold_count ? "up" : "down"]++;
  }
  rows.sort((x, y) => x.id - y.id);
  return { rows, summary: { total: history.length, counts, byMonth, byRange, diffDist, direction } };
}

/** KOSIS 응답의 달(YYYYMM 만). @param {KosisRow[]} kosisRows */
export const kosisMonthsOf = (kosisRows) => [...new Set(kosisRows.map((r) => r.PRD_DE).filter((p) => /^\d{6}$/.test(p)))].sort();

/**
 * 차단기(쓰기 전). 걸린 사유 목록 — 비면 통과.
 * @param {{ kosisRows: KosisRow[] | null; apartments: any[]; history: HistRow[]; aptCount: number|null; histCount: number|null; minApartments?: number; minHistory?: number }} p
 */
export function checkBreakers({ kosisRows, apartments, history, aptCount, histCount, minApartments = MIN_APARTMENTS, minHistory = MIN_HISTORY }) {
  /** @type {string[]} */
  const why = [];
  if (kosisRows) {
    const km = new Set(kosisMonthsOf(kosisRows));
    const missing = [...new Set(history.map((h) => h.base_month))].filter((m) => !km.has(m)).sort();
    if (missing.length) why.push(`① KOSIS 응답에 history 의 달이 빠짐: ${missing.join(",")}`);
  }
  if (apartments.length < minApartments) why.push(`② apartments ${apartments.length} < ${minApartments}(읽기 잘림 의심)`);
  if (history.length < minHistory) why.push(`② history ${history.length} < ${minHistory}(읽기 잘림 의심)`);
  if (aptCount !== apartments.length) why.push(`② apartments 읽은 ${apartments.length} ≠ count exact ${aptCount}`);
  if (histCount !== history.length) why.push(`② history 읽은 ${history.length} ≠ count exact ${histCount}`);
  return why;
}

/**
 * 반영 직전 행 상태. cur 이 없거나 열쇠(apartment_id·base_month)가 다르면 그 밖.
 * @param {HistRow | undefined} cur @param {PlanRow} p @returns {State}
 */
export function classifyLive(cur, p) {
  if (!cur || cur.apartment_id !== p.apartment_id || cur.base_month !== p.base_month) return "그 밖";
  if ((cur.unsold_count ?? null) === (p.old ?? null)) return "이전";
  if (cur.unsold_count === p.new) return "새";
  return "그 밖";
}

/** 이번 달(KST) YYYYMM. @param {Date} d */
export const kstMonth = (d) => {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** KOSIS 1회 — 수집기 main 과 같은 표·인자, 기간만 202601~이번 달. 키는 출력하지 않는다. @param {string} endMonth @returns {Promise<KosisRow[]>} */
async function defaultFetchKosis(endMonth) {
  const key = process.env.KOSIS_KEY;
  if (!key) throw new Error("KOSIS_KEY 없음");
  const params = new URLSearchParams({
    method: "getList", apiKey: key, orgId: "116", tblId: "DT_MLTM_2082", itmId: "ALL", objL1: "ALL", objL2: "ALL",
    prdSe: "M", startPrdDe: KOSIS_START, endPrdDe: endMonth, format: "json", jsonVD: "Y",
  });
  const res = await fetchWithRetry(`https://kosis.kr/openapi/Param/statisticsParameterData.do?${params}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const data = await res.json();
  if (data?.err) throw new Error(`KOSIS 에러: ${data.errMsg || data.err}`);
  if (!Array.isArray(data) || data.length === 0) throw new Error("KOSIS 응답이 비었다");
  return data;
}

/** @param {any} sb @param {string} table */
async function countExact(sb, table) {
  const r = await sb.from(table).select("*", { count: "exact", head: true });
  if (r.error) throw new Error(`${table} count 실패: ${r.error.message}`);
  return /** @type {number|null} */ (r.count ?? null);
}

/** apartments·history 전량(id 커서) + count exact. @param {any} sb */
async function readInputs(sb) {
  // 열은 글자 그대로 적는다 — 정적 가드(_selectall-keycol-coverage)가 커서 키 id 를 select 리터럴에서 찾는다. apartments 열 = step157/sim.mjs 와 같다.
  const apartments = /** @type {any[]} */ (await selectAll((s) => s.from("apartments").select("id, name, region, gu, units, unsold, unsold_rate, naver_sell_count, presale_type, unsold_source, unsold_as_of, complex_key, naver_presale_no, unit_source, created_at"), sb, "id"));
  const history = /** @type {HistRow[]} */ (await selectAll((s) => s.from("unsold_history").select("id, apartment_id, base_month, unsold_count, recorded_at"), sb, "id"));
  return { apartments, history, aptCount: await countExact(sb, "apartments"), histCount: await countExact(sb, "unsold_history") };
}

/** id 로 history 행 다시 읽기(묶음 200 — 응답이 1,000 이면 잘림이라 던진다). @param {any} sb @param {number[]} ids */
async function readHistoryByIds(sb, ids) {
  /** @type {Map<number, HistRow>} */
  const out = new Map();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const r = await sb.from("unsold_history").select("id, apartment_id, base_month, unsold_count, recorded_at").in("id", chunk);
    if (r.error) throw new Error(`history 재조회 실패: ${r.error.message}`);
    const data = /** @type {HistRow[]} */ (r.data ?? []);
    if (data.length >= 1000) throw new Error("history 재조회 응답이 1,000행 — 잘림 의심, 묶음을 줄여라");
    for (const h of data) out.set(Number(h.id), h);
  }
  return out;
}

/**
 * 조건부 UPDATE 1행(unsold_count 한 칸) — 조건 id + unsold_count=expect(null 이면 .is). 돌아온 행이 1 이어야 성공.
 * @param {any} sb @param {number} id @param {number|null} expect @param {number|null} value
 */
export async function updateCount(sb, id, expect, value) {
  let q = sb.from("unsold_history").update({ unsold_count: value }).eq("id", id);
  q = expect == null ? q.is("unsold_count", null) : q.eq("unsold_count", expect);
  const r = await q.select("id");
  if (r.error || (r.data?.length ?? 0) !== 1) return { ok: false, why: r.error?.message ?? `${r.data?.length ?? 0}행` };
  return { ok: true, why: "" };
}

/** @param {Counts} c */
const fmt = (c) => `바뀜 ${c.changed} · 같음 ${c.same} · 계산 대상 아님 ${c.orphan} · held ${c.held}`;

/**
 * @param {string[]} argv
 * @param {{ sb: any; fetchKosis?: (endMonth: string) => Promise<KosisRow[]>; log?: (s: string) => void; err?: (s: string) => void; now?: () => Date; minApartments?: number; minHistory?: number; concurrency?: number }} deps
 * @returns {Promise<number>} 종료 코드
 */
export async function run(argv, deps) {
  const args = parseArgs(argv);
  if (args.mode === "undo") return runUndo(args, deps);
  if (args.mode === "apply") return runApply(args, deps);
  return runDry(args, deps);
}

/** @param {Args} args @param {Parameters<typeof run>[1]} deps */
async function runDry(args, { sb, fetchKosis = defaultFetchKosis, log = console.log, err = console.error, now = () => new Date(), minApartments, minHistory }) {
  const out = /** @type {string} */ (args.out);
  // 반영 뒤 같은 이름으로 미리보기를 다시 뜨면 미리보기 지문이 바뀌어 --undo 가 막힌다(검사관 🟠) — 사본이 있으면 시작도 안 한다.
  if (existsSync(snapshotPathOf(out))) { err(`${snapshotPathOf(out)} 가 이미 있다 — 반영 뒤 같은 이름 금지, 새 이름으로 미리보기를 떠라`); return 1; }
  /** @type {KosisRow[]} */
  let kosisRows;
  let kosisSource;
  if (args.kosisFile) {
    kosisRows = JSON.parse(readFileSync(args.kosisFile, "utf8"));
    if (!Array.isArray(kosisRows) || kosisRows.length === 0) throw new Error(`--kosis-file 이 비었다: ${args.kosisFile}`);
    kosisSource = `파일 ${args.kosisFile}(호출 0)`;
  } else {
    const endMonth = kstMonth(now());
    kosisRows = await fetchKosis(endMonth);
    kosisSource = `KOSIS 1회 ${KOSIS_START}~${endMonth}`;
  }
  const kosisText = JSON.stringify(kosisRows);
  const kosisFile = resolve(kosisPathOf(out));
  const kosisMonths = kosisMonthsOf(kosisRows);
  log(`KOSIS ${kosisSource} · 행 ${kosisRows.length} · 달 ${kosisMonths.join(",")} · sha ${sha16(kosisText)}`);

  const { apartments, history, aptCount, histCount } = await readInputs(sb);
  log(`apartments ${apartments.length}(count ${aptCount}) · history ${history.length}(count ${histCount})`);
  const { rows, summary } = planHistoryRecalc({ apartments, history, kosisRows });
  const breakers = checkBreakers({ kosisRows, apartments, history, aptCount, histCount, minApartments, minHistory });
  const preview = {
    generatedAt: now().toISOString(), mode: "dry",
    inputs: { kosisSource, kosisFile, kosisRows: kosisRows.length, kosisMonths, kosisSha16: sha16(kosisText), apartments: apartments.length, apartmentsCountExact: aptCount, history: history.length, historyCountExact: histCount },
    breakers, summary, rows,
  };
  // 미리보기·KOSIS 저장본은 둘 다 새 파일로만(wx) — 덮어쓰면 승인한 미리보기·사본의 지문이 어긋난다. 미리보기를 먼저 써서
  // 미리보기가 이미 있으면 KOSIS 저장본도 안 만든다(KOSIS 저장본만 있으면 미리보기가 남지만 sha 가 달라 --apply 가 거부한다).
  try {
    writeFileSync(out, JSON.stringify(preview, null, 2), { flag: "wx" });
    writeFileSync(kosisFile, kosisText, { flag: "wx" });
  } catch (e) {
    if (/** @type {any} */ (e)?.code !== "EEXIST") throw e;
    err(`이미 있는 파일 — 덮어쓰지 않는다(새 이름으로): ${/** @type {any} */ (e).path ?? ""}`);
    return 1;
  }
  log(`미리보기 저장 ${out} · KOSIS 저장 ${kosisFile} · 고칠 줄 ${rows.length}`);
  log(`전체 ${fmt(summary.counts)}`);
  for (const [k, c] of Object.entries(summary.byRange)) log(`  ${k}: ${fmt(c)}`);
  for (const [m, c] of Object.entries(summary.byMonth).sort()) log(`  ${m}: ${fmt(c)}`);
  log(`차이 분포 ${JSON.stringify(summary.diffDist)} · 오름 ${summary.direction.up} · 내림 ${summary.direction.down}`);
  // 규칙 data-changing-run-approval §2: 미리보기에서 차단기 = 경고 + 파일(사유 포함) + exit 0. --apply 는 사유가 적힌 미리보기를 거부한다.
  if (breakers.length) { for (const b of breakers) err(`[차단] ${b}`); err("차단기 — 이 미리보기로는 --apply 하지 않는다(미리보기라 exit 0)"); }
  log("미리보기 — DB 쓰기 0");
  return 0;
}

/** @param {Args} args @param {Parameters<typeof run>[1]} deps */
async function runApply(args, { sb, log = console.log, err = console.error, now = () => new Date(), minApartments, minHistory, concurrency = 5 }) {
  const from = /** @type {string} */ (args.from), out = /** @type {string} */ (args.out);
  const fromText = readFileSync(from, "utf8");
  const fromSha = sha16(fromText);
  const preview = JSON.parse(fromText);
  if (preview?.mode !== "dry") throw new Error(`--from 은 미리보기 파일이어야 한다(mode=${preview?.mode})`);
  if (Array.isArray(preview.breakers) && preview.breakers.length) throw new Error(`--from 미리보기가 차단기에 걸려 있다: ${preview.breakers.join(" / ")}`);
  /** @type {PlanRow[]} */
  const planRows = preview.rows;
  if (!Array.isArray(planRows) || planRows.length === 0) throw new Error("--from 에 rows 가 없다");
  const seen = new Set();
  for (const p of planRows) {
    if (!Number.isInteger(p.id) || seen.has(p.id)) throw new Error(`id 가 이상하거나 중복: ${p.id}`);
    seen.add(p.id);
    if (!Number.isInteger(p.new) || p.new <= 0 || p.old === p.new) throw new Error(`새 값이 이상함 id=${p.id}: ${p.old} → ${p.new}`);
  }
  log(`--from ${from} sha ${fromSha} · 고칠 줄 ${planRows.length}`);

  // KOSIS 는 다시 부르지 않는다 — 미리보기 때 저장본으로 지금 DB 를 다시 계산해 행 단위로 맞댄다(검사관 🟠 — 개수만 보면
  // 그 사이 수집으로 분모가 바뀌어도 모른다). 저장본이 없거나 지문이 다르면 맞댈 수 없으니 쓰지 않는다.
  const kf = preview.inputs?.kosisFile;
  if (!kf || !existsSync(kf)) { err(`KOSIS 저장본 없음(${kf}) — 행 단위 대조를 못 하므로 쓰기 0`); return 1; }
  const kosisText = readFileSync(kf, "utf8");
  if (sha16(kosisText) !== preview.inputs.kosisSha16) { err(`KOSIS 저장본 sha 가 미리보기 기록과 다르다(${kf}) — 쓰기 0`); return 1; }
  /** @type {KosisRow[]} */
  const kosisRows = JSON.parse(kosisText);

  const { apartments, history, aptCount, histCount } = await readInputs(sb);
  const breakers = checkBreakers({ kosisRows, apartments, history, aptCount, histCount, minApartments, minHistory });
  if (breakers.length) { for (const b of breakers) err(`[차단] ${b}`); err("차단기 — 쓰기 0"); return 1; }
  // ① --from 행마다 지금 계산한 새 값(현재 값과 무관 — 일부 반영 뒤 다시 돌려도 같다) ② 지금 계산엔 고칠 줄인데 --from 에 없는 행
  const map = historyMap(apartments, kosisRows);
  const diffNew = planRows.filter((p) => {
    const v = map.get(`${p.apartment_id}|${p.base_month}`);
    return !v || v.held || v.estimated !== p.new;
  });
  const fromIds = new Set(planRows.map((p) => p.id));
  const extra = planHistoryRecalc({ apartments, history, kosisRows }).rows.filter((r) => !fromIds.has(r.id));
  if (diffNew.length || extra.length) {
    const sample = [
      ...diffNew.slice(0, 5).map((p) => { const v = map.get(`${p.apartment_id}|${p.base_month}`); return { id: p.id, kind: "새 값 다름", from: p.new, now: v ? (v.held ? "held" : v.estimated) : "계산 대상 아님" }; }),
      ...extra.slice(0, 5).map((r) => ({ id: r.id, kind: "--from 에 없음", from: null, now: r.new })),
    ];
    err(`지금 다시 계산한 새 값이 --from 과 다르다 — 새 값 다름 ${diffNew.length} · --from 에 없음 ${extra.length} — 쓰기 0, 새로 미리보기를 떠라: ${JSON.stringify(sample)}`);
    writeFileSync(out, JSON.stringify({ generatedAt: now().toISOString(), mode: "apply", from, fromSha16: fromSha, result: "거부(행 단위 불일치)", diffNew: diffNew.length, extra: extra.length, sample }, null, 2));
    return 1;
  }
  log(`다시 계산한 새 값 = --from(행 단위 일치 ${planRows.length})`);

  const cur = await readHistoryByIds(sb, planRows.map((p) => p.id));
  const states = planRows.map((p) => ({ p, c: cur.get(p.id), state: classifyLive(cur.get(p.id), p) }));
  /** @type {Record<string, number>} */ const byState = { "이전": 0, "새": 0, "그 밖": 0 };
  for (const s of states) byState[s.state]++;
  log(`행 상태: 이전 ${byState["이전"]} · 새 ${byState["새"]} · 그 밖 ${byState["그 밖"]}`);
  const writeResult = (/** @type {Record<string, any>} */ extra) =>
    writeFileSync(out, JSON.stringify({ generatedAt: now().toISOString(), mode: "apply", from, fromSha16: fromSha, byState, ...extra }, null, 2));
  const other = states.filter((s) => s.state === "그 밖");
  if (other.length) {
    err(`"그 밖" ${other.length}행 — 한 줄도 쓰지 않고 중단: ${other.slice(0, 20).map((s) => `${s.p.id}(지금 ${s.c?.unsold_count ?? "없음"} · 이전 ${s.p.old} · 새 ${s.p.new})`).join(", ")}`);
    writeResult({ result: "거부(그 밖)", rows: states.map((s) => ({ id: s.p.id, state: s.state, now: s.c?.unsold_count ?? null, old: s.p.old, new: s.p.new })) });
    return 1;
  }

  const snapPath = snapshotPathOf(from);
  if (existsSync(snapPath)) {
    const snapText = readFileSync(snapPath, "utf8");
    const snap = JSON.parse(snapText);
    const byId = new Map((snap.rows ?? []).map((/** @type {any} */ r) => [r.id, r]));
    const bad = planRows.filter((p) => { const b = /** @type {any} */ (byId.get(p.id)); return !b || (b.unsold_count ?? null) !== (p.old ?? null); });
    if (snap.fromSha16 !== fromSha || bad.length) { err(`기존 사본이 이 미리보기의 이전 값과 다름(${bad.slice(0, 20).map((p) => p.id).join(",") || "sha"}) — 중단`); return 1; }
    log(`기존 사본 사용 ${snapPath} sha ${sha16(snapText)}(이어서 반영)`);
  } else {
    if (byState["새"]) { err(`사본이 없는데 이미 "새" 행 ${byState["새"]}개 — 사본에 새 값이 담기므로 중단`); return 1; }
    const snapText = JSON.stringify({
      takenAt: now().toISOString(), fromPath: resolve(from), fromSha16: fromSha,
      rows: states.map(({ c }) => ({ id: /** @type {HistRow} */ (c).id, apartment_id: c?.apartment_id, base_month: c?.base_month, unsold_count: c?.unsold_count ?? null, recorded_at: c?.recorded_at ?? null })),
    }, null, 2);
    writeFileSync(snapPath, snapText, { flag: "wx" });
    log(`사본 저장 ${snapPath} (${states.length}행) sha ${sha16(snapText)}`);
  }

  const sem = createSemaphore(concurrency);
  /** @type {Map<number, string>} */ const result = new Map();
  await Promise.all(states.map((s) => sem(async () => {
    if (s.state === "새") { result.set(s.p.id, "건너뜀(이미 새 값)"); return; }
    const r = await updateCount(sb, s.p.id, s.p.old, s.p.new);
    result.set(s.p.id, r.ok ? "반영" : `실패: ${r.why}`);
    if (!r.ok) err(`쓰기 실패 ${s.p.id}: ${r.why}`);
  })));
  const ok = [...result.values()].filter((v) => v === "반영").length;
  const skip = [...result.values()].filter((v) => v.startsWith("건너뜀")).length;
  const fail = result.size - ok - skip;
  const reread = await readHistoryByIds(sb, planRows.map((p) => p.id));
  const good = planRows.filter((p) => classifyLive(reread.get(p.id), p) === "새").length;
  log(`반영 ${ok} · 이미 새 값 ${skip} · 실패 ${fail} · 재조회 새 값 ${good}/${planRows.length}`);
  writeResult({ result: { ok, skip, fail, good }, snapshot: snapPath, rows: states.map((s) => ({ id: s.p.id, state: s.state, result: result.get(s.p.id), old: s.p.old, new: s.p.new })) });
  return fail === 0 && good === planRows.length ? 0 : 1;
}

/** @param {Args} args @param {Parameters<typeof run>[1]} deps */
async function runUndo(args, { sb, log = console.log, err = console.error, concurrency = 5 }) {
  const snapPath = /** @type {string} */ (args.undo);
  const snapText = readFileSync(snapPath, "utf8");
  const snap = JSON.parse(snapText);
  if (!Array.isArray(snap.rows)) throw new Error("사본에 rows 가 없다");
  log(`사본 ${snapPath} sha ${sha16(snapText)} · ${snap.rows.length}행`);
  // 새 값은 미리보기에서 찾는다(--from, 없으면 사본에 적힌 경로). 못 찾으면 "지금 ≠ 사본" 행은 전부 되돌리지 않는다.
  /** @type {Map<number, number>} */
  const newById = new Map();
  const previewPath = args.from ?? snap.fromPath ?? null;
  if (previewPath && existsSync(previewPath)) {
    const t = readFileSync(previewPath, "utf8");
    if (sha16(t) !== snap.fromSha16) throw new Error(`미리보기 sha 가 사본 기록(${snap.fromSha16})과 다르다: ${previewPath}`);
    for (const r of JSON.parse(t).rows ?? []) newById.set(r.id, r.new);
    log(`미리보기 ${previewPath} — 새 값 ${newById.size}행`);
  } else err(`⚠ 미리보기를 못 찾음(${previewPath}) — 사본 값과 다른 행은 되돌리지 않고 실패로 보고`);

  const cur = await readHistoryByIds(sb, snap.rows.map((/** @type {any} */ r) => r.id));
  const sem = createSemaphore(concurrency);
  let ok = 0, skip = 0, fail = 0;
  await Promise.all(snap.rows.map((/** @type {any} */ b) => sem(async () => {
    const c = cur.get(b.id);
    if (!c || c.apartment_id !== b.apartment_id || c.base_month !== b.base_month) { fail++; err(`되돌림 안 함 ${b.id} — 행이 없거나 열쇠가 다름`); return; }
    if ((c.unsold_count ?? null) === (b.unsold_count ?? null)) { skip++; return; }
    // 반영은 recorded_at 을 안 바꾼다 — 달라졌으면 그 뒤 수집기가 다시 쓴 줄이라 옛 값으로 덮지 않는다(그 밖).
    if ((c.recorded_at ?? null) !== (b.recorded_at ?? null)) { fail++; err(`되돌림 안 함 ${b.id} — recorded_at ${c.recorded_at} ≠ 사본 ${b.recorded_at}(수집기가 다시 쓴 줄, 손으로 확인)`); return; }
    const nv = newById.get(b.id);
    if (nv === undefined || c.unsold_count !== nv) { fail++; err(`되돌림 안 함 ${b.id} — 지금 ${c.unsold_count} 이 사본(${b.unsold_count})·새(${nv ?? "모름"}) 어느 쪽도 아님(손으로 확인)`); return; }
    const r = await updateCount(sb, b.id, nv, b.unsold_count ?? null);
    if (r.ok) ok++; else { fail++; err(`되돌림 실패 ${b.id}: ${r.why}`); }
  })));
  log(`되돌림 ${ok} · 이미 사본 값 ${skip} · 실패 ${fail}`);
  return fail ? 1 : 0;
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  try {
    process.exitCode = await run(process.argv.slice(2), { sb: getSupabase() });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
