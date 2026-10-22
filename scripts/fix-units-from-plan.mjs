// @ts-check
/**
 * fix-units-from-plan.mjs — 승인된 세대수 계획 파일대로 apartments.units·unit_source 를 고치는 일회성 도구 (세션654).
 *
 * ## 왜
 * 세션653 조사로 세대수가 틀린 38곳(청약홈 공고 총공급으로 정정)과 근거 없는 "세대수 1" 세종 6행(빈칸으로)을 찾았고,
 * 사장님이 2026-10-21 그 명단(`approved-units-plan.json`)을 승인했다. 계획 파일이 곧 승인 명단이다.
 * 세대수가 바뀌면 그 행의 미분양률도 같은 식(`clampUnsoldRate(round(unsold/units·1000)/10)` —
 * collect-applyhome-seed.mjs·molit-units.mjs 와 같은 식)으로 다시 계산해 같이 쓴다(세대수 빈칸이면 미분양률 빈칸).
 * 미분양 수(unsold)는 바꾸지 않는다 — 재료 칸으로 대조만 한다.
 *
 * ## 사용법 (기본 = 미리보기, `--dry-run` 인자는 받지 않는다 — data-changing-run-approval §2)
 *   node --env-file=.env.local scripts/fix-units-from-plan.mjs --plan=<계획.json> --impact-out=<미리보기.json>
 *   node --env-file=.env.local scripts/fix-units-from-plan.mjs --plan=<계획.json> --impact-out=<반영.json> --apply --from=<미리보기.json>
 *   node --env-file=.env.local scripts/fix-units-from-plan.mjs --plan=<계획.json> --undo=<사본.json>
 *
 * ## 안전장치 (메모리 feedback_oneoff_fix_script_resumable — 세션632 본보기와 같은 꼴)
 *   - 행마다 지금 상태를 이전 / 새 / 그 밖 으로 가른다(units·unit_source·unsold_rate + 재료 칸 unsold).
 *   - 순서 = 조회 → 계획(순수) → 미리보기 저장(--impact-out 항상) → 차단기 → 쓰기.
 *   - `--apply` 는 `--from=<미리보기 impact>` 필수: 계획 파일 sha256 이 같아야 하고, 미리보기 때 읽은 unsold 와 지금이
 *     다르면 그 행은 "그 밖"(승인한 미분양률과 다른 값을 쓰지 않는다). "그 밖"이 1행이라도 있으면 쓰기 0 + exit 1.
 *   - "새" 행은 건너뛴다 → 일부만 반영된 뒤 다시 돌리면 남은 행만 잇는다.
 *   - 되돌림 사본 = 쓰기 전 (id, units, unit_source, unsold, unsold_rate, updated_at) — 없을 때만 `wx`, 있으면 계획 이전 값과
 *     대조 뒤 재사용. 경로 = `<계획 파일>.before.json`. 사본이 없는데 "새" 행이 있으면 거부(새 값을 사본에 담게 된다).
 *   - UPDATE 조건 = 기대 상태 전체(id + units + unit_source + unsold, null 이면 `.is`). 돌아온 행이 1이 아니면 실패로 센다.
 *   - `--undo` 는 행별: "새"만 사본 값으로, 이전(사본과 같음)은 건너뜀, "그 밖"은 실패 보고.
 *   - 종료 코드는 process.exitCode.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clampUnsoldRate, getSupabase } from "./collectors/_shared.mjs";
import { pickBundleUnits } from "./collectors/_same-complex.mjs";
import { foldForUnsold } from "./collectors/_unsold-bundle.mjs";
import { unitsFollowUpdate } from "./collectors/naver-presale.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_LIVE_PATH = resolve(ROOT, "public/data/apartments.json");
export const COLS =
  "id,name,region,gu,units,unit_source,unsold,unsold_rate,unsold_source,unsold_as_of,presale_type,naver_presale_no,complex_key,updated_at";
const SNAP_COLS = /** @type {const} */ (["id", "units", "unit_source", "unsold", "unsold_rate", "updated_at"]);

/**
 * @typedef {{ id: string; name: string; region: string; oldUnits: number|null; oldSource: string|null;
 *   newUnits: number|null; newSource: string|null; basis: string; action: "set"|"set_null"|"skip" }} PlanRow
 * @typedef {Record<string, any> & { id: string }} DbRow
 * @typedef {"이전"|"새"|"그 밖"|"건너뜀"} State
 * @typedef {{ plan: string; apply: boolean; undo: string|null; impactOut: string|null; from: string|null; mode: "dry"|"apply"|"undo" }} Args
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
    const m = /^--(plan|undo|impact-out|from)=(.+)$/.exec(a);
    if (!m) throw new Error(`모르는 인자: ${a}`);
    if (m[1] in kv) throw new Error(`--${m[1]} 가 두 번`);
    kv[m[1]] = m[2];
  }
  if (!kv.plan) throw new Error("--plan=<계획 파일> 필수");
  const undo = kv.undo ?? null;
  const impactOut = kv["impact-out"] ?? null;
  const from = kv.from ?? null;
  if (apply && undo) throw new Error("--apply 와 --undo 는 같이 못 준다");
  if (apply && !from) throw new Error("--apply 는 --from=<미리보기 impact 파일> 필수");
  if (from && !apply) throw new Error("--from 은 --apply 와만 쓴다");
  if (undo && impactOut) throw new Error("--undo 는 --impact-out 을 받지 않는다");
  if (!undo && !impactOut) throw new Error("--impact-out=<경로> 필수(미리보기 저장)");
  if (from && impactOut && samePath(from, impactOut)) throw new Error("--from 과 --impact-out 이 같은 파일 — 미리보기를 덮어쓴 뒤 자기와 맞대게 된다");
  if (impactOut && samePath(impactOut, kv.plan)) throw new Error("--impact-out 이 계획 파일과 같은 경로 — 승인 명단을 덮어쓴다");
  if (impactOut && samePath(impactOut, snapshotPathOf(kv.plan))) throw new Error("--impact-out 이 되돌림 사본 경로와 같다 — 사본을 덮어쓴다");
  return { plan: kv.plan, apply, undo, impactOut, from, mode: apply ? "apply" : undo ? "undo" : "dry" };
}

/** 경로 비교 — 절대경로로 풀고 Windows 는 대소문자 무시. @param {string} a @param {string} b */
function samePath(a, b) {
  const x = resolve(a), y = resolve(b);
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/** @param {unknown} a @param {unknown} b */
const same = (a, b) => (a ?? null) === (b ?? null);

/** 미분양률 — collect-applyhome-seed.mjs:187 · molit-units.mjs:106 과 같은 식. @param {number|null|undefined} unsold @param {number|null|undefined} units */
export function rateOf(unsold, units) {
  return clampUnsoldRate(unsold != null && units != null && units > 0 ? Math.round((unsold / units) * 1000) / 10 : null);
}

/**
 * 계획 파일 검증 — 모양·개수·행별 규칙. @param {any} json
 * @returns {{ rows: PlanRow[]; targets: PlanRow[]; skips: PlanRow[] }}
 */
export function validatePlan(json) {
  if (!json || !Array.isArray(json.plan)) throw new Error("계획 파일에 plan 배열이 없다");
  /** @type {PlanRow[]} */
  const rows = json.plan;
  const ids = new Set();
  /** @type {Record<string, number>} */
  const counts = { set: 0, set_null: 0, skip: 0 };
  for (const p of rows) {
    if (typeof p?.id !== "string" || !p.id) throw new Error("id 없는 행");
    if (ids.has(p.id)) throw new Error(`id 중복 ${p.id}`);
    ids.add(p.id);
    if (!(p.action in counts)) throw new Error(`모르는 action ${p.action} (${p.id})`);
    counts[p.action]++;
    if (p.action === "set" && !(Number.isInteger(p.newUnits) && /** @type {number} */ (p.newUnits) > 1 && typeof p.newSource === "string")) {
      throw new Error(`set 행의 새 값이 이상함 ${p.id}: ${p.newUnits}/${p.newSource}`);
    }
    if (p.action === "set_null" && p.newUnits !== null) throw new Error(`set_null 행인데 newUnits 가 ${p.newUnits} (${p.id})`);
    if (p.action !== "skip" && same(p.oldUnits, p.newUnits) && same(p.oldSource, p.newSource)) throw new Error(`이전 = 새 (${p.id}) — 할 일 없는 행`);
  }
  if (json.counts) {
    for (const k of Object.keys(counts)) {
      if ((json.counts[k] ?? 0) !== counts[k]) throw new Error(`counts.${k}=${json.counts[k]} 인데 실제 ${counts[k]}`);
    }
  }
  return { rows, targets: rows.filter((p) => p.action !== "skip"), skips: rows.filter((p) => p.action === "skip") };
}

/** 새 값 3칸. @param {PlanRow} p @param {number|null} unsold */
export function nextOf(p, unsold) {
  return { units: p.newUnits, unit_source: p.newSource, unsold_rate: rateOf(unsold, p.newUnits) };
}

/**
 * 행 상태. refUnsold = 기대 unsold(미리보기 때 읽은 값 — undefined 면 지금 값을 기준으로 삼는다).
 * @param {DbRow} cur @param {PlanRow} p @param {number|null|undefined} [refUnsold]
 * @returns {State}
 */
export function classifyRow(cur, p, refUnsold) {
  if (p.action === "skip") return "건너뜀";
  const u = refUnsold === undefined ? cur.unsold : refUnsold;
  if (!same(cur.unsold, u)) return "그 밖";
  if (same(cur.units, p.oldUnits) && same(cur.unit_source, p.oldSource) && same(cur.unsold_rate, rateOf(u, p.oldUnits))) return "이전";
  if (same(cur.units, p.newUnits) && same(cur.unit_source, p.newSource) && same(cur.unsold_rate, rateOf(u, p.newUnits))) return "새";
  return "그 밖";
}

/** 계획한 값의 변화 종류. @param {PlanRow} p */
export function changeKind(p) {
  if (p.action === "skip") return "건너뜀";
  if (p.oldUnits != null && p.newUnits != null) return p.oldUnits === p.newUnits ? "변화 없음" : "값→다른 값";
  if (p.oldUnits != null && p.newUnits == null) return "값→빈칸";
  if (p.oldUnits == null && p.newUnits != null) return "빈칸→값";
  return "변화 없음";
}

/**
 * 행별 계획(순수). @param {PlanRow[]} planRows @param {Map<string, DbRow>} curById @param {Map<string, number|null>} [refById]
 */
export function buildRowPlan(planRows, curById, refById) {
  return planRows.map((p) => {
    const cur = curById.get(p.id);
    if (!cur) throw new Error(`DB 에 없는 행 ${p.id}`);
    const ref = refById ? refById.get(p.id) : undefined;
    if (refById && p.action !== "skip" && !refById.has(p.id)) throw new Error(`미리보기에 없는 행 ${p.id}`);
    const unsold = ref === undefined ? cur.unsold : ref;
    return {
      id: p.id, name: p.name, action: p.action, basis: p.basis,
      state: classifyRow(cur, p, ref),
      change: changeKind(p),
      refUnsold: unsold, // 쓰기 조건의 unsold — 반영 때는 미리보기 때 읽은 값
      prev: { units: p.oldUnits, unit_source: p.oldSource, unsold_rate: p.action === "skip" ? cur.unsold_rate : rateOf(unsold, p.oldUnits) },
      next: p.action === "skip" ? null : nextOf(p, unsold),
      cur: Object.fromEntries(["units", "unit_source", "unsold", "unsold_rate", "unsold_source", "updated_at"].map((k) => [k, cur[k] ?? null])),
    };
  });
}

/** @param {ReturnType<typeof buildRowPlan>} rows */
export function summarize(rows) {
  /** @type {Record<string, number>} */ const byChange = {};
  /** @type {Record<string, number>} */ const byState = {};
  for (const r of rows) {
    byChange[r.change] = (byChange[r.change] ?? 0) + 1;
    byState[r.state] = (byState[r.state] ?? 0) + 1;
  }
  const targets = rows.filter((r) => r.next);
  const rateChanged = targets.filter((r) => !same(r.prev.unsold_rate, r.next?.unsold_rate));
  const unsoldGtUnits = targets.filter((r) => r.cur.unsold != null && r.next?.units != null && r.cur.unsold > r.next.units).map((r) => r.id);
  return {
    byChange, byState,
    rateChanged: rateChanged.length,
    rateChanges: rateChanged.map((r) => ({ id: r.id, from: r.prev.unsold_rate, to: r.next?.unsold_rate ?? null, unsold: r.cur.unsold })),
    unsoldGtNewUnits: unsoldGtUnits,
  };
}

/**
 * 반영 뒤를 흉내 낸 행 목록(묶음 구성원 + 대상 행을 새 값으로). @param {DbRow[]} members @param {ReturnType<typeof buildRowPlan>} rows
 */
export function simulateAfter(members, rows) {
  const nextById = new Map(rows.filter((r) => r.next).map((r) => [r.id, r.next]));
  return members.map((m) => (nextById.has(m.id) ? { ...m, ...nextById.get(m.id) } : m));
}

/**
 * ① 즉시 — VIEW apartments_flat 의 카드 세대수(20261013000000_view_one_card_bundle.sql:44-55·157):
 * 묶음(COALESCE(complex_key,id)) 구성원 2+ 이면 D7(= JS pickBundleUnits), 혼자면 그 행 units.
 * @param {DbRow[]} before @param {DbRow[]} after
 */
export function viewUnitsChanges(before, after) {
  /** @param {DbRow[]} rows */
  const cardUnits = (rows) => {
    /** @type {Map<string, DbRow[]>} */ const by = new Map();
    for (const r of rows) {
      const k = r.complex_key ?? r.id;
      const a = by.get(k);
      if (a) a.push(r); else by.set(k, [r]);
    }
    /** @type {Map<string, number|null>} */ const out = new Map();
    for (const [k, ms] of by) out.set(k, ms.length >= 2 ? (pickBundleUnits(/** @type {any} */ (ms))?.units ?? null) : (ms[0].units ?? null));
    return out;
  };
  const b = cardUnits(before), a = cardUnits(after);
  const changed = [...b].filter(([k, v]) => !same(v, a.get(k))).map(([k, v]) => ({ key: k, before: v, after: a.get(k) ?? null }));
  return { bundles: b.size, changed };
}

/**
 * ③ KOSIS 회차 — 배분 분모가 되는 묶음 세대수(_unsold-bundle.mjs foldForUnsold → b.units)가 바뀌는 묶음.
 * 운영은 pairOf(KOSIS 구 짝)로 묶음을 더 쪼갤 수 있지만, 이 대상 묶음은 혼자이거나 세종(구 없음)이라 쪼개짐이 없다.
 * @param {DbRow[]} before @param {DbRow[]} after
 */
export function kosisDenomChanges(before, after) {
  /** @param {DbRow[]} rows */
  const units = (rows) => new Map(foldForUnsold(/** @type {any} */ (rows), { isRespected: () => false }).map((b) => [b.key, b.units]));
  const b = units(before), a = units(after);
  return [...b].filter(([k, v]) => !same(v, a.get(k))).map(([k, v]) => ({ key: k, before: v, after: a.get(k) ?? null }));
}

/** ③ molit-units 대상 조건 — molit-units.mjs:54 `.or("units.lte.1,unsold_rate.gte.100")`(null 은 어느 쪽도 아님). @param {DbRow} r */
export const molitTargeted = (r) => (r.units != null && r.units <= 1) || (r.unsold_rate != null && r.unsold_rate >= 100);

/**
 * ③ naver-presale — 세대수는 빈칸일 때만 채운다(naver-presale.mjs:1270 `!match.apartment.units && enrich.units`),
 * 값이 있으면 따라가기 갈래(:1272-1274 `applyUnitsFollow`) — 실제 판정 함수 `unitsFollowUpdate`(:630) 로 센다.
 * 따라가기 후보 = 세대수가 있고 네이버 값이 다르다고 가정했을 때(탐침 = 지금 값 + 2) 덮일 행. 같은 함수가
 * `--follow-units` 없는 기본 회차에서도 후보 명단(unitsFollowed)을 만들고 `UNITS_FOLLOW_CANDIDATES n` 표식으로 센다(:1368).
 * @param {DbRow[]} afterTargets
 */
export function naverRefill(afterTargets) {
  const blank = afterTargets.filter((r) => !r.units);
  return {
    blankAfter: blank.map((r) => r.id),
    blankWithPresaleNo: blank.filter((r) => r.naver_presale_no != null).map((r) => r.id),
    followCandidates: afterTargets
      .filter((r) => !!r.units && unitsFollowUpdate(/** @type {any} */ (r), Number(r.units) + 2) != null)
      .map((r) => r.id),
  };
}

/**
 * 라이브 목록(굽기 파일)에 보이는 대상 행 — 카드 id(대표) / 카드의 memberIds·aliasIds 에 든 행.
 * @param {string[]} ids @param {any} live
 */
export function liveVisibility(ids, live) {
  const cards = Array.isArray(live) ? live : live?.data;
  if (!Array.isArray(cards)) return null;
  const rep = new Set(cards.map((c) => c.id));
  /** @type {Map<string, string>} */ const inCard = new Map();
  for (const c of cards) for (const m of [...(c.memberIds ?? []), ...(c.aliasIds ?? [])]) if (!inCard.has(m)) inCard.set(m, c.id);
  const asRep = ids.filter((id) => rep.has(id));
  const asMember = ids.filter((id) => !rep.has(id) && inCard.has(id));
  return { cards: cards.length, asRep: asRep.length, asMember: asMember.length, notShown: ids.filter((id) => !rep.has(id) && !inCard.has(id)) };
}

/**
 * 조건부 UPDATE 1행 — expect 전체를 조건으로(null 이면 `.is`). 돌아온 행이 정확히 1이어야 성공.
 * @param {any} sb @param {string} id @param {Record<string, any>} expect @param {Record<string, any>} payload
 */
export async function conditionalUpdate(sb, id, expect, payload) {
  let q = sb.from("apartments").update(payload).eq("id", id);
  for (const [col, v] of Object.entries(expect)) q = v == null ? q.is(col, null) : q.eq(col, v);
  const r = await q.select("id");
  if (r.error || (r.data?.length ?? 0) !== 1) return { ok: false, why: r.error?.message ?? `${r.data?.length ?? 0}행` };
  return { ok: true, why: "" };
}

/** @param {string} planPath */
export const snapshotPathOf = (planPath) => `${planPath.replace(/\.json$/i, "")}.before.json`;

/** @param {string} text */
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** @param {any} sb @param {string[]} ids @returns {Promise<Map<string, DbRow>>} */
async function readByIds(sb, ids) {
  const r = await sb.from("apartments").select(COLS).in("id", ids);
  if (r.error) throw new Error(`조회 실패: ${r.error.message}`);
  const data = /** @type {DbRow[]} */ (r.data ?? []);
  if (data.length !== ids.length) throw new Error(`조회 행 수 ${data.length} ≠ 명단 ${ids.length}`);
  return new Map(data.map((x) => [x.id, x]));
}

/**
 * @param {string[]} argv
 * @param {{ sb: any; livePath?: string; log?: (s: string) => void; err?: (s: string) => void; now?: () => Date }} deps
 * @returns {Promise<number>} 종료 코드
 */
export async function run(argv, { sb, livePath = DEFAULT_LIVE_PATH, log = console.log, err = console.error, now = () => new Date() }) {
  const args = parseArgs(argv);
  const planText = readFileSync(args.plan, "utf8");
  const planSha = sha256(planText);
  const planJson = JSON.parse(planText);
  const { rows: planRows, targets } = validatePlan(planJson);
  log(`계획 ${args.plan} sha256 ${planSha.slice(0, 16)} · ${planRows.length}행(대상 ${targets.length}) · 모드 ${args.mode}`);

  const curById = await readByIds(sb, planRows.map((p) => p.id));
  if (args.mode === "undo") return runUndo(sb, args, targets, curById, planSha, log, err, now);

  /** @type {Map<string, number|null> | undefined} */
  let refById;
  if (args.mode === "apply") {
    const preview = JSON.parse(readFileSync(/** @type {string} */ (args.from), "utf8"));
    if (preview.mode !== "dry") throw new Error(`--from 은 미리보기 impact 여야 한다(mode=${preview.mode})`);
    if (preview.planSha256 !== planSha) throw new Error("--from 미리보기의 계획 sha256 이 지금 계획 파일과 다르다");
    refById = new Map((preview.rows ?? []).filter((/** @type {any} */ r) => r.next).map((/** @type {any} */ r) => [r.id, r.cur.unsold ?? null]));
  }
  const rows = buildRowPlan(planRows, curById, refById);
  const summary = summarize(rows);

  // 반영 뒤 세 시점 — 묶음 구성원까지 읽는다(대상 행의 complex_key 를 공유하는 행).
  const keys = [...new Set(targets.map((p) => curById.get(p.id)?.complex_key).filter((k) => k != null))];
  /** @type {DbRow[]} */
  let members = targets.filter((p) => curById.get(p.id)?.complex_key == null).map((p) => /** @type {DbRow} */ (curById.get(p.id)));
  if (keys.length) {
    const m = await sb.from("apartments").select(COLS).in("complex_key", keys);
    if (m.error) throw new Error(`묶음 조회 실패: ${m.error.message}`);
    members = members.concat(m.data ?? []);
  }
  const after = simulateAfter(members, rows);
  const targetIds = new Set(targets.map((p) => p.id));
  /** @type {any} */
  let live = null;
  try { live = JSON.parse(readFileSync(livePath, "utf8")); } catch { live = null; }
  const visibility = live ? liveVisibility([...targetIds], live) : null;
  const threePoints = {
    immediateView: viewUnitsChanges(members, after),
    nextBake: "다음 굽기(daily-deploy 03:00 KST)가 ① 의 VIEW 값을 public/data 에 싣는다 — 점수 등급 변화는 compute-scores 뒤에야 확인",
    nextCollect: {
      molitUnits: { before: members.filter((r) => targetIds.has(r.id) && molitTargeted(r)).map((r) => r.id), after: after.filter((r) => targetIds.has(r.id) && molitTargeted(r)).map((r) => r.id) },
      naverPresale: { ...naverRefill(after.filter((r) => targetIds.has(r.id))), followCandidatesBefore: naverRefill(members.filter((r) => targetIds.has(r.id))).followCandidates },
      kosisDenom: kosisDenomChanges(members, after),
    },
  };
  const impact = {
    generatedAt: now().toISOString(), mode: args.mode, planPath: args.plan, planSha256: planSha,
    planGeneratedAt: planJson.generatedAt ?? null, from: args.from, summary, threePoints,
    liveVisibility: visibility ? { ...visibility, method: `굽기 파일 ${livePath} 의 카드 id(대표) / memberIds·aliasIds(묶인 행)` } : `확인 못 함(${livePath} 없음)`,
    bundleMembers: members.length, rows,
  };
  writeFileSync(/** @type {string} */ (args.impactOut), JSON.stringify(impact, null, 2));
  log(`미리보기 저장 ${args.impactOut}`);

  log("id | 이름 | 세대수 | 출처 | 미분양률(미분양 수) | 지금 상태");
  for (const r of rows) {
    const nx = r.next ? `${r.prev.units} → ${r.next.units} | ${r.prev.unit_source} → ${r.next.unit_source} | ${r.prev.unsold_rate} → ${r.next.unsold_rate} (${r.cur.unsold})` : `${r.cur.units} 그대로 | ${r.cur.unit_source} | ${r.cur.unsold_rate} (${r.cur.unsold})`;
    log(`${r.id} | ${r.name} | ${nx} | ${r.state}`);
  }
  log(`변화: ${JSON.stringify(summary.byChange)} · 상태: ${JSON.stringify(summary.byState)} · 미분양률 바뀜 ${summary.rateChanged} · 미분양>새 세대수 ${summary.unsoldGtNewUnits.length}`);
  log(`라이브: ${visibility ? `카드 ${visibility.cards}장 중 대표 ${visibility.asRep} · 묶인 행 ${visibility.asMember} · 안 보임 ${visibility.notShown.length}` : "확인 못 함"}`);
  log(`① VIEW 카드 세대수 바뀌는 묶음 ${threePoints.immediateView.changed.length}/${threePoints.immediateView.bundles}`);
  log(`③ molit-units 대상 ${threePoints.nextCollect.molitUnits.before.length} → ${threePoints.nextCollect.molitUnits.after.length} · naver-presale 빈칸 ${threePoints.nextCollect.naverPresale.blankAfter.length}(번호 있음 ${threePoints.nextCollect.naverPresale.blankWithPresaleNo.length}, 따라가기 ${threePoints.nextCollect.naverPresale.followCandidates.length}) · KOSIS 분모 바뀌는 묶음 ${threePoints.nextCollect.kosisDenom.length}`);

  const other = rows.filter((r) => r.state === "그 밖");
  if (args.mode === "dry") {
    if (other.length) err(`⚠ "그 밖" ${other.length}행(${other.map((r) => r.id).join(",")}) — 이대로면 --apply 는 쓰지 않는다`);
    log(`미리보기 — 쓰기 0`);
    return 0;
  }

  // --apply
  if (other.length) { err(`"그 밖" ${other.length}행(${other.map((r) => r.id).join(",")}) — 한 줄도 쓰지 않고 중단`); return 1; }
  const snapPath = snapshotPathOf(args.plan);
  if (existsSync(snapPath)) {
    const snapText = readFileSync(snapPath, "utf8");
    const snap = JSON.parse(snapText);
    const bad = targets.filter((p) => {
      const b = (snap.rows ?? []).find((/** @type {any} */ x) => x.id === p.id);
      return !b || classifyRow(b, p, refById?.get(p.id)) !== "이전";
    });
    if (snap.planSha256 !== planSha || bad.length) { err(`기존 사본이 계획 이전 값과 다름(${bad.map((p) => p.id).join(",") || "sha256"}) — 중단`); return 1; }
    log(`기존 사본 사용 ${snapPath} sha256 ${sha256(snapText).slice(0, 16)}(이어서 반영)`);
  } else {
    const fresh = rows.filter((r) => r.state === "새");
    if (fresh.length) { err(`사본이 없는데 이미 "새" 행 ${fresh.length}개 — 사본에 새 값이 담기므로 중단`); return 1; }
    const snapText = JSON.stringify({
      takenAt: now().toISOString(), planSha256: planSha,
      rows: targets.map((p) => Object.fromEntries(SNAP_COLS.map((k) => [k, curById.get(p.id)?.[k] ?? null]))),
    }, null, 2);
    writeFileSync(snapPath, snapText, { flag: "wx" });
    log(`사본 저장 ${snapPath} (${targets.length}행) sha256 ${sha256(snapText).slice(0, 16)}`);
  }

  let ok = 0, skip = 0, fail = 0;
  for (const r of rows) {
    if (!r.next) continue;
    if (r.state === "새") { skip++; continue; }
    const res = await conditionalUpdate(sb, r.id,
      { units: r.prev.units, unit_source: r.prev.unit_source, unsold: r.refUnsold },
      { ...r.next, updated_at: now().toISOString() });
    if (res.ok) ok++; else { fail++; err(`쓰기 실패 ${r.id}: ${res.why}`); }
  }
  log(`반영 ${ok} · 이미 새 값 ${skip} · 실패 ${fail}`);
  const reread = await readByIds(sb, planRows.map((p) => p.id));
  const good = targets.filter((p) => classifyRow(/** @type {DbRow} */ (reread.get(p.id)), p, refById?.get(p.id)) === "새").length;
  log(`재조회 새 값 ${good}/${targets.length}`);
  return fail === 0 && good === targets.length ? 0 : 1;
}

/**
 * @param {any} sb @param {Args} args @param {PlanRow[]} targets @param {Map<string, DbRow>} curById @param {string} planSha
 * @param {(s: string) => void} log @param {(s: string) => void} err @param {() => Date} now
 */
async function runUndo(sb, args, targets, curById, planSha, log, err, now) {
  const snapText = readFileSync(/** @type {string} */ (args.undo), "utf8");
  const snap = JSON.parse(snapText);
  log(`사본 ${args.undo} sha256 ${sha256(snapText).slice(0, 16)}`);
  if (snap.planSha256 !== planSha) throw new Error("사본의 계획 sha256 이 지금 계획 파일과 다르다");
  let ok = 0, skip = 0, fail = 0;
  for (const p of targets) {
    const b = (snap.rows ?? []).find((/** @type {any} */ x) => x.id === p.id);
    const cur = /** @type {DbRow} */ (curById.get(p.id));
    if (!b) { err(`사본에 없음 ${p.id}`); fail++; continue; }
    const isSnap = same(cur.units, b.units) && same(cur.unit_source, b.unit_source) && same(cur.unsold, b.unsold) && same(cur.unsold_rate, b.unsold_rate);
    if (isSnap) { skip++; continue; }
    if (classifyRow(cur, p, b.unsold) !== "새") { err(`되돌림 안 함 ${p.id} — 지금 값이 사본·새 어느 쪽도 아님(손으로 확인)`); fail++; continue; }
    const res = await conditionalUpdate(sb, p.id,
      { units: p.newUnits, unit_source: p.newSource, unsold: b.unsold },
      { units: b.units, unit_source: b.unit_source, unsold_rate: b.unsold_rate, updated_at: now().toISOString() });
    if (res.ok) ok++; else { fail++; err(`되돌림 실패 ${p.id}: ${res.why}`); }
  }
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
