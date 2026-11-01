// @ts-check
/**
 * 지자체 단지별 미분양 명단 수집기(대구·충남 — 시험판, PR-2). 설계서 `docs/superpowers/plans/2026-11-01-govlist-unsold-source.md` v2.1.
 *
 * 순서(data-changing-run-approval): 조회 → 계획 → impact 저장(항상) → 차단기 → 바꾸기 전 사본·역계획 → 쓰기.
 *   node scripts/collectors/collect-unsold-govlist.mjs --dry-run --impact-out=<경로> [--source=daegu|chungnam] [--file=<source>:<xlsx 경로>]
 *   node scripts/collectors/collect-unsold-govlist.mjs --apply --apply-from=<승인한 impact> [--absent-zero]
 *
 * - dry-run 은 미등재→0 꺼짐·켬 **두 계획을 같이** impact 에 싣는다(사장님 Q5 재료). DB·collector_runs 에 아무것도 안 쓴다.
 * - `--apply` 는 첫 회차라 `--apply-from` 이 있어야 한다 — 다시 세운 계획이 승인 impact 의 같은 모드(꺼짐/켬) 계획과
 *   쓰는 행의 id·행동·이전 값·새 값까지 같을 때만 쓴다(다르면 쓰기 0 · failure `GOVLIST_PLAN_MISMATCH`). 차단기를 넘는 회차도
 *   승인 계획 일치가 곧 승인이다. 러너 등재·`shouldSkipKosisFill`·감시·화면은 이 PR 밖(PR-3·PR-4).
 * - 쓰기 = ① `unsold_gov_list` 새 batch 넣기 → 행 수 = batch_rows 확인 → 같은 (출처, 기준일)의 옛 batch 지우기 ② apartments 6칸 조건부 갱신
 *   (이전 값이 그대로인 행만). ① 이 실패하면 ② 를 하지 않는다.
 * - 표식(`collector_runs.error_message`): `GOVLIST_SKIP <source> <이유>`(fetch · header · rows0 · not_newer) · `GOVLIST_BREAKER …` ·
 *   `GOVLIST_PLAN_MISMATCH …` · `GOVLIST_WRITE …`.
 * - 외부 호출: 출처마다 3회(목록·글·첨부). 공공데이터 API·카카오 0. DB 는 읽기(apartments·applyhome_unit_supply·presale_schedule_official·unsold_gov_list).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { ROOT, loadEnv, getSupabase, selectAll, log, logError, createReporter, recordCollectorRun } from "./_shared.mjs";
import { fetchLatestGovlist, SOURCE_REGION, GovlistFetchError } from "./_govlist-fetch.mjs";
import { parseGovlistWorkbook, GovlistParseError } from "./_govlist-parse.mjs";
import { buildBundles, matchComplexes, parseMatchDecisions } from "./_govlist-match.mjs";
import { planSource, summarize, breaker, comparePlans, buildBackup, buildListRows, isWrite, VALUE_KEYS, RESTORE_EXPECT_KEYS } from "./_govlist-plan.mjs";

/** @typedef {import("./_govlist-fetch.mjs").GovlistSource} GovlistSource */
/** @typedef {import("./_govlist-plan.mjs").PlanRow} PlanRow */
/** @typedef {import("./_govlist-match.mjs").AptRow} AptRow */

export const PHASE = "unsold-govlist";
export const SOURCES = /** @type {const} */ (["daegu", "chungnam"]);
export const DECISIONS_PATH = resolve(ROOT, "docs/audits/govlist-match-decisions.json");
export const LIST_TABLE = "unsold_gov_list";
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
  const known = ["--dry-run", "--apply", "--absent-zero"];
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
  if (apply && !applyFrom) throw new Error("첫 회차는 --apply --apply-from=<승인한 impact> 로만 씁니다");
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
  return {
    dryRun, apply, absentZero: argv.includes("--absent-zero"), impactOut, applyFrom,
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
 * 그 출처의 가장 새 batch(기준일·행 수) — 표가 아직 없으면(PR-1 전) null.
 * @param {any} sb @param {string} source
 * @returns {Promise<{ asOf: string; rows: number; batchId: string } | null | "no-table">}
 */
async function loadPrevBatch(sb, source) {
  const { data, error } = await sb.from(LIST_TABLE).select("as_of,batch_id,batch_rows").eq("source", source)
    .order("as_of", { ascending: false }).order("fetched_at", { ascending: false }).limit(1);
  if (error) {
    if (isMissingTable(error)) return "no-table";
    throw new Error(`${LIST_TABLE} 조회 실패: ${error.message}`);
  }
  const r = data?.[0];
  return r ? { asOf: r.as_of, rows: Number(r.batch_rows), batchId: r.batch_id } : null;
}

/**
 * 명단 표 쓰기 — 새 batch 먼저 넣고 행 수 = batch_rows 확인 뒤 같은 (출처, 기준일)의 옛 batch 를 지운다(`trade_deals` 꼴).
 * @param {any} sb @param {ReturnType<typeof buildListRows>} rows
 * @returns {Promise<{ ok: boolean; inserted: number; deletedOld: number; error?: string }>}
 */
export async function writeListBatch(sb, rows) {
  if (!rows.length) return { ok: false, inserted: 0, deletedOld: 0, error: "행 0" };
  const { source, as_of: asOf, batch_id: batchId } = rows[0];
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from(LIST_TABLE).insert(rows.slice(i, i + 200));
    if (error) return { ok: false, inserted, deletedOld: 0, error: `insert: ${error.message}` };
    inserted += Math.min(200, rows.length - i);
  }
  const c = await sb.from(LIST_TABLE).select("id", { count: "exact", head: true }).eq("source", source).eq("as_of", asOf).eq("batch_id", batchId);
  if (c.error || c.count !== rows.length) {
    await sb.from(LIST_TABLE).delete().eq("source", source).eq("as_of", asOf).eq("batch_id", batchId);
    return { ok: false, inserted, deletedOld: 0, error: `행 수 확인 실패(${c.error?.message ?? `${c.count} ≠ ${rows.length}`}) — 새 batch 를 지웠다` };
  }
  const d = await sb.from(LIST_TABLE).delete({ count: "exact" }).eq("source", source).eq("as_of", asOf).neq("batch_id", batchId);
  if (d.error) return { ok: false, inserted, deletedOld: 0, error: `옛 batch 지우기: ${d.error.message}` };
  return { ok: true, inserted, deletedOld: d.count ?? 0 };
}

/**
 * apartments 한 행 조건부 갱신 — 이전 값(4칸 + 새 2칸이 있으면 6칸)이 그대로일 때만.
 * @param {any} sb @param {PlanRow} r @param {boolean} listedCols
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

/** "YYYYMMDD-HHmmss"(KST). @param {Date} d */
const stamp = (d) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

/**
 * @param {{ argv?: string[]; sb?: any; fetchImpl?: typeof fetch; now?: Date; decisionsPath?: string; artifactsRoot?: string;
 *   loadGrids?: (buf: Buffer) => Promise<import("./_govlist-parse.mjs").Grid[]> }} [deps]
 */
export async function main(deps = {}) {
  const argv = deps.argv ?? process.argv.slice(2);
  const args = parseArgs(argv);
  const now = deps.now ?? new Date();
  // 엑셀 읽기 모듈은 쓸 때만 불러온다(시험은 격자를 직접 넣는다 — exceljs 없이도 본체 시험이 돈다).
  const loadGrids = deps.loadGrids ?? (async (/** @type {Buffer} */ buf) => (await import("./_govlist-xlsx.mjs")).workbookToGrids(buf));
  const artifactsRoot = deps.artifactsRoot ?? resolve(ROOT, ".omc/artifacts/govlist");
  const startedAt = now.toISOString();
  const rpt = createReporter(PHASE);
  // 판정 파일이 깨졌으면 누리집·DB 를 부르기 전에 멈춘다.
  const decisions = parseMatchDecisions(JSON.parse(readFileSync(deps.decisionsPath ?? DECISIONS_PATH, "utf8")));
  if (!deps.sb) loadEnv();
  const sb = deps.sb ?? getSupabase();
  log(PHASE, `=== ${args.dryRun ? "미리보기(dry-run — 쓰기 0)" : "반영(--apply)"} · 출처 ${args.sources.join(",")} · 미등재→0 ${args.absentZero ? "켬" : "꺼짐"} ===`);

  /** @type {string[]} */ const markers = [];
  /** @type {any[]} */ const sourceReports = [];
  /** @type {PlanRow[]} */ const planOff = [];
  /** @type {PlanRow[]} */ const planOn = [];
  /** @type {Array<{ source: string; asOf: string; listRows: ReturnType<typeof buildListRows>; prevRows: number | null }>} */ const writes = [];
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
    Object.assign(rep, { asOf: parsed.asOf, sheet: parsed.sheet, rows: parsed.rows.length, complexes: parsed.complexes.length, hidden: parsed.complexes.filter((c) => c.hidden).length, checks: parsed.checks, columns: parsed.columns.map((c) => c.key) });
    if (!parsed.rows.length) { skip("rows0"); continue; }
    log(PHASE, `[${source}] ${parsed.asOf} 명단 — 면적대 줄 ${parsed.rows.length} · 단지 ${parsed.complexes.length}(비공개 ${rep.hidden}) · 소계 어긋남 ${parsed.checks.subtotalMismatch.length} · 합계 어긋남 ${parsed.checks.sectionMismatch.length}(원본 수식 — 경고)`);
    // ── 전 회차 ──
    const prev = await loadPrevBatch(sb, source);
    rep.prev = prev;
    const prevRows = prev && prev !== "no-table" ? prev.rows : null;
    let notNewer = false;
    if (prev === "no-table") log(PHASE, `[${source}] ${LIST_TABLE} 표 없음(PR-1 마이그 전) — 전 회차 없음으로 계획`);
    else if (prev && parsed.asOf <= prev.asOf) { notNewer = true; skip(`not_newer(파일 ${parsed.asOf} ≤ 저장된 ${prev.asOf})`); }
    // ── 우리 단지 · 매칭 ──
    const { rows: apts, listedCols } = await loadApartments(sb, region);
    listedColsAll &&= listedCols;
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
    log(PHASE, `[${source}] 매칭 — 우리 행 ${apts.length} · 묶음 ${bundles.length} · ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
    // ── 계획(꺼짐·켬) ──
    const common = { source, asOf: parsed.asOf, now, complexes: parsed.complexes, results, bundles, sggUniverse: parsed.sggUniverse, listRowCount: parsed.rows.length, prevRowCount: prevRows };
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
      writes.push({ source, asOf: parsed.asOf, prevRows, listRows: buildListRows({ source, asOf: parsed.asOf, batchId, fileUrl: file.fileUrl, fetchedAt: now.toISOString(), rows: parsed.rows, results }) });
    }
  }

  // ── 전이표 · 차단기 ──
  const lists = writes.map((w) => ({ source: w.source, rows: w.listRows.length, prevRows: w.prevRows }));
  const sumOff = summarize(planOff), sumOn = summarize(planOn);
  const brOff = breaker({ changedBundles: sumOff.changedBundles, lists }), brOn = breaker({ changedBundles: sumOn.changedBundles, lists });
  const impact = {
    generatedAt: now.toISOString(), phase: PHASE, mode: args.dryRun ? "dry-run" : "apply", externalCalls: calls, listedCols: listedColsAll,
    sources: sourceReports, markers,
    modes: { off: { summary: sumOff, breaker: brOff, plan: planOff }, on: { summary: sumOn, breaker: brOn, plan: planOn } },
  };
  for (const [k, s, b] of /** @type {const} */ ([["꺼짐", sumOff, brOff], ["켬", sumOn, brOn]])) {
    log(PHASE, `[전이표 ${k}] 쓰는 행 ${s.writeRows} · 바뀔 단지 ${s.changedBundles} · 값 변화 ${JSON.stringify(s.byChange)} · 출처 ${JSON.stringify(s.sourceShift)}${b.tripped ? ` · 차단기 ${b.reasons.join(" / ")}` : ""}`);
  }
  const impactPath = args.impactOut ?? resolve(artifactsRoot, `impact-${stamp(now)}.json`);
  mkdirSync(dirname(impactPath), { recursive: true });
  writeFileSync(impactPath, JSON.stringify(impact, null, 2), "utf8");
  log(PHASE, `[IMPACT] ${impactPath}`);

  if (args.dryRun) {
    log(PHASE, `=== 미리보기 끝 — DB·collector_runs 쓰기 0 · 누리집 호출 ${calls}회 ===`);
    return { impact, impactPath, wrote: 0 };
  }

  // ── 반영(--apply --apply-from) ──
  const mode = args.absentZero ? "on" : "off";
  const plan = mode === "on" ? planOn : planOff;
  const br = mode === "on" ? brOn : brOff;
  const approved = /** @type {any} */ (JSON.parse(readFileSync(/** @type {string} */ (args.applyFrom), "utf8")))?.modes?.[mode]?.plan;
  const finish = async (/** @type {string} */ status, /** @type {number} */ ok, /** @type {number} */ fail) => {
    const s = rpt.summary();
    await recordCollectorRun(PHASE, { ...s, status, ok, fail, startedAt, errorMessage: markers.length ? markers.join(" · ").slice(0, 1800) : null }, deps.sb ?? null);
  };
  if (!Array.isArray(approved)) {
    markers.push(`GOVLIST_PLAN_MISMATCH 승인 파일에 modes.${mode}.plan 없음`);
    await finish("failure", 0, 1);
    return { impact, impactPath, wrote: 0 };
  }
  const cmp = comparePlans(plan, approved);
  if (!cmp.same) {
    const m = `GOVLIST_PLAN_MISMATCH 이번에만 ${cmp.onlyCurrent.length} · 승인에만 ${cmp.onlyApproved.length} · 값 다름 ${cmp.changed.length}`;
    markers.push(m); logError(PHASE, `[차단] ${m} — 쓰기 0`);
    await finish("failure", 0, 1);
    return { impact, impactPath, wrote: 0 };
  }
  if (br.tripped) log(PHASE, `[차단기] ${br.reasons.join(" / ")} — 승인한 계획과 행마다 같아 통과(승인 = 이 명단)`);
  // 바꾸기 전 사본·역계획(출처·기준일별 · 새 파일로만)
  for (const w of writes) {
    const rows = plan.filter((r) => r.source === w.source);
    if (!rows.some(isWrite)) continue;
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
    const lr = await writeListBatch(sb, w.listRows);
    if (!lr.ok) {
      markers.push(`GOVLIST_WRITE ${w.source} list_table(${lr.error})`); fail++;
      logError(PHASE, `[${w.source}] 명단 표 쓰기 실패 — 이 출처의 apartments 는 쓰지 않는다: ${lr.error}`);
      continue;
    }
    log(PHASE, `[${w.source}] 명단 표 ${lr.inserted}행 넣음 · 옛 batch ${lr.deletedOld}행 지움`);
    for (const r of plan.filter((x) => x.source === w.source && isWrite(x))) {
      if (rpt.interrupted()) break;
      const res = await updateApartment(sb, r, listedColsAll);
      if (res === "ok") ok++; else if (res === "race") race++; else fail++;
    }
  }
  if (race) markers.push(`GOVLIST_WRITE race ${race}`);
  if (fail) markers.push(`GOVLIST_WRITE fail ${fail}`);
  log(PHASE, `=== 반영 끝 — apartments ${ok}행 · 경합 ${race} · 실패 ${fail} ===`);
  await finish(fail || race ? "failure" : "success", ok, fail + race);
  return { impact, impactPath, wrote: ok };
}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) {
  main().catch((err) => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
