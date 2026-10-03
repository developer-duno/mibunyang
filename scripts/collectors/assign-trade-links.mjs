// @ts-check
/**
 * 우리 단지 ↔ 실거래 열쇠 연결 표(`apartment_trade_links`)를 채운다 — 시세 비교 범위 좁히기 나) (세션590)
 * (설계서 docs/superpowers/specs/2026-10-03-trade-scope-narrowing.md §4-2 · §5-1 · 계획서 Task 3)
 *
 * ## 무엇을 하나
 * apartments 전량 + `trade_deals` 12개월(열쇠마다 가장 새 완성 batch)을 읽어 `_trade-links.mjs planLinks` 로 연결을 계산하고,
 * 지금 표와 다른 줄만 넣기·지우기·고치기 한다. 규칙은 `_trade-links.mjs` 한 곳에만 있다.
 *
 * ## 언제 도나
 * `collect-trade-stats.yml` 안에서 `trade-stats` 바로 앞(매월 8·22일 01:00 KST — 계획서 B2). 연결 표를 읽는 쪽이 trade-stats
 * 하나뿐이고 거래 원문(trade_deals)은 매월 6일에만 바뀐다. 이 단계가 실패해도 통계는 지난 연결로 계속 간다.
 *
 * ## 안전장치 (전부 "쓰지 않고 실패로 끝난다" — 쓰기 실행이면 collector_runs 에 failure 1행 · 감시 ⑰)
 * - 받은 apartments 행 수 ≠ 표의 행 수 → `LINK_COUNT_MISMATCH`(부분 조회로 계산하면 형제 판정이 틀어진다)
 * - 연결 표가 없음(마이그 적용 전) → 미리보기는 "지금 연결 0" 으로 진행 · 쓰기 실행은 `LINK_NO_TABLE`
 * - 정기 실행(`--apply`): 지워지거나 바뀌는 줄이 30줄 또는 10% 를 넘거나, 새로 넣는 줄이 지금 줄보다 많음(첫 채우기)
 *   → `LINK_BREAKER`. 한도를 넘는 반영은 사람이 승인한 계획 파일로만.
 * - 사람이 승인한 반영(`--apply-from=<계획 파일>`): 다시 계산한 계획이 승인 파일과 **줄 단위로** 같을 때만 → 다르면 `LINK_PLAN_MISMATCH`
 * - 쓸 때도 **이전 상태(status)가 그대로인 줄만** 지우거나 고친다(그 사이 남이 바꾼 줄은 0행이 돌아와 실패로 센다) → 일부 실패 `LINK_WRITE`
 * - 예외로 죽으면 `LINK_ERROR`. 미리보기가 기본이다.
 *
 * ## 사용법
 *   node scripts/collectors/assign-trade-links.mjs                              # 미리보기
 *   node scripts/collectors/assign-trade-links.mjs --out=<절대경로.json>          # 미리보기 + 계획 파일(명단 — 줄마다 이름·시도·구·거래 이름·지번·유사도·연도 차)
 *   node scripts/collectors/assign-trade-links.mjs --apply-from=<절대경로.json>   # 승인한 계획 파일과 같을 때만 반영(첫 채우기)
 *   node scripts/collectors/assign-trade-links.mjs --apply                      # 정기(차단기)
 * `--out` 은 미리보기에서만, 이미 있는 파일이면 DB 를 보기 전에 던진다(flag wx). 다른 인자(`--dry-run` 포함)는 받지 않는다.
 *
 * ⚠️ 선행: supabase/migrations/20261004000000_trade_links_and_scope_stats.sql
 * ⚠️ 외부 API 호출 없음(DB 만). process.exit 를 부르지 않는다(Windows 에서 fetch 뒤 exit = 127, 세션579).
 */
import { loadEnv, log, logError, getSupabase, selectAll, recordCollectorRun, createReporter, sleep } from "./_shared.mjs";
import { fetchTradeDealsWindow, isMissingTable } from "./_trade-deals.mjs";
import {
  buildKeyDictionary, planLinks, diffLinks, evaluateLinkBreaker, planLines, compareLinkPlanToApproved, parseLinkDecisions,
} from "./_trade-links.mjs";
import { isMovedIn, completionMonthIndex } from "./_match-gates.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

loadEnv();

const PHASE = "assign-trade-links";
const __dirname = dirname(fileURLToPath(import.meta.url));
const DECISIONS_PATH = join(resolve(__dirname, "..", ".."), "docs", "audits", "trade-link-decisions.json");
/** 거래 창(개월) — trade-stats 의 비교 기간과 같다. */
export const LINK_WINDOW_MONTHS = 12;
/** 공유 DB 에 한꺼번에 쏘지 않는다 — 열쇠 깔기와 같은 값. */
export const WRITE_CONCURRENCY = 5;
export const WRITE_BATCH_DELAY_MS = 100;
/** 넣기는 묶음으로(돌아온 행 수로 성공을 센다). */
export const INSERT_CHUNK = 100;
const DEAL_COLS = "trade_type,sgg_cd,umd_cd,umd_nm,jibun,jibun_main,jibun_sub,apt_seq,apt_name,build_year";

/**
 * 미리보기 로그에 결과를 찍을 대조군(설계서 §5-1 5 · 조사 2차 표본) — 이름 일부로 찾는다(동명이 있으면 전부 찍는다).
 * 판정에는 쓰지 않는다(눈 검수용).
 */
export const CONTROL_PROBES = Object.freeze([
  { label: "양성 서희스타힐스4차", find: "화성시청역 서희스타힐스 4차" },
  { label: "양성 반정5단지", find: "반정 아이파크 캐슬 5단지" },
  { label: "양성 비봉호반써밋", find: "화성비봉 공공주택지구 B2블록 호반써밋" },
  { label: "양성 A106(어울림/아테라)", find: "A106" },
  { label: "양성 광교중앙역퍼스트", find: "힐스테이트 광교중앙역 퍼스트" },
  { label: "음성 신동탄포레자이", find: "신동탄포레자이" },
  { label: "음성 금강6차↔7차", find: "동탄신도시 금강펜테리움" },
  { label: "보류 운암퍼스티체", find: "운암자이포레나퍼스티체" },
  { label: "보류 디에이치퍼스티어", find: "디에이치 퍼스티어 아이파크" },
  { label: "애매 비봉우미린", find: "화성 비봉 B-4BL 우미린" },
]);

/**
 * 실행 인자(허용 목록 — 열쇠 깔기와 같은 꼴). 틀리면 throw(DB 를 보기 전에 멈춘다).
 * @param {readonly string[]} argv
 * @returns {{ apply: boolean, applyFrom: string | null, out: string | null }}
 */
export function parseArgs(argv) {
  let applyFlag = false;
  /** @type {string | null} */
  let applyFrom = null;
  /** @type {string | null} */
  let out = null;
  /** @type {string[]} */
  const unknown = [];
  for (const a of argv.slice(2)) {
    if (a === "--apply") applyFlag = true;
    else if (a.startsWith("--apply-from")) {
      const m = /^--apply-from=(.+)$/.exec(a);
      if (!m) throw new Error(`--apply-from 에는 계획 파일 경로가 필요합니다: ${a}`);
      if (applyFrom != null) throw new Error("--apply-from 이 두 번 나왔습니다");
      applyFrom = m[1];
    } else if (a.startsWith("--out")) {
      const m = /^--out=(.+)$/.exec(a);
      if (!m) throw new Error(`--out 에는 저장할 파일 경로가 필요합니다: ${a}`);
      if (out != null) throw new Error("--out 이 두 번 나왔습니다");
      out = m[1];
    } else unknown.push(a);
  }
  if (unknown.length > 0) {
    throw new Error(`모르는 인자: ${unknown.join(" ")} — 쓸 수 있는 것은 --apply · --apply-from=<승인한 계획 파일> · --out=<파일> 뿐입니다(인자 없이 = 미리보기)`);
  }
  if (applyFrom != null && out != null) throw new Error("--apply-from 과 --out 은 같이 줄 수 없습니다 — 승인 파일을 덮어쓸 수 있습니다");
  if (applyFlag && out != null) throw new Error("--apply 와 --out 은 같이 줄 수 없습니다 — 계획 파일은 미리보기에서만 만듭니다");
  if (applyFlag && applyFrom != null) throw new Error("--apply 와 --apply-from 은 같이 줄 수 없습니다 — 하나만 고릅니다");
  return { apply: applyFlag || applyFrom != null, applyFrom, out };
}

/**
 * `--out` 파일이 이미 있으면 DB 를 보기 전에 던진다(승인했을 수 있는 계획 파일을 덮지 않는다 — 쓸 때도 flag wx).
 * @param {string | null} out
 * @param {(p: string) => boolean} [exists]
 */
export function assertOutFree(out, exists = existsSync) {
  if (out != null && exists(out)) {
    throw new Error(`--out 파일이 이미 있습니다: ${out} — 승인했을 수 있는 계획 파일을 덮어쓰지 않는다 — 새 이름으로`);
  }
}

/**
 * 표가 없을 때 무엇을 할지 — 미리보기는 "지금 연결 0" 으로 진행, 쓰기는 멈춤. 순수 함수(시험용).
 * @param {boolean} apply
 * @returns {{ proceed: boolean, marker: string | null }}
 */
export function onMissingTable(apply) {
  return apply ? { proceed: false, marker: "LINK_NO_TABLE" } : { proceed: true, marker: null };
}

/** 이번 달 기준 n 개월 전 YYYYMM(KST). @param {Date} now @param {number} n */
export function fromMonthOf(now, n) {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const idx = kst.getUTCFullYear() * 12 + kst.getUTCMonth() - n;
  return `${Math.floor(idx / 12)}${String((idx % 12) + 1).padStart(2, "0")}`;
}

/**
 * @param {boolean} apply @param {string} marker @param {string} why @param {number} rowCount
 */
async function failRun(apply, marker, why, rowCount) {
  logError(PHASE, `${why} — 아무것도 쓰지 않았습니다`);
  if (apply) await recordCollectorRun(PHASE, { status: "failure", ok: 0, fail: 0, skip: rowCount, errorMessage: `${marker} ${why}` });
  process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv);
  const { apply, applyFrom } = args;
  const decisions = parseLinkDecisions(JSON.parse(readFileSync(DECISIONS_PATH, "utf8")));
  /** @type {unknown} */
  let approvedLines = null;
  if (applyFrom != null) {
    approvedLines = /** @type {{ planLines?: unknown }} */ (JSON.parse(readFileSync(applyFrom, "utf8")))?.planLines;
    if (!Array.isArray(approvedLines)) throw new Error(`승인한 계획 파일에 planLines 배열이 없습니다: ${applyFrom}`);
  }
  assertOutFree(args.out);
  const t0 = Date.now();
  const now = new Date();
  const sb = getSupabase();

  // 1) apartments 전량 + 행 수 확인
  const apts = await selectAll(
    (s) => s.from("apartments").select("id,name,region,gu,dong,bjd_code,lot_main,lot_sub,completion,coord_shared,complex_key,presale_type"),
    sb,
    "id",
  );
  const { count, error: countError } = await sb.from("apartments").select("id", { count: "exact", head: true });
  if (countError || count == null || count !== apts.length) {
    await failRun(apply, "LINK_COUNT_MISMATCH", `받은 apartments ${apts.length} ≠ 표의 행 수 ${count ?? "알 수 없음"}${countError ? ` (${countError.message})` : ""} — 부분 조회로는 계산하지 않습니다`, apts.length);
    return;
  }

  // 2) 거래 12개월(완성 batch 만)
  const fromMonth = fromMonthOf(now, LINK_WINDOW_MONTHS);
  const deals = await fetchTradeDealsWindow(sb, { fromMonth, cols: DEAL_COLS });
  log(PHASE, `거래 ${fromMonth}~ ${deals.total}행 중 완성 batch ${deals.rows.length}행${deals.droppedKeys.length ? ` · 완성 batch 없는 열쇠 ${deals.droppedKeys.length}개 제외(예: ${deals.droppedKeys.slice(0, 5).join(", ")})` : ""}`);

  // 3) 지금 연결 표
  /** @type {any[]} */
  let current = [];
  let tableMissing = false;
  try {
    current = await selectAll((s) => s.from("apartment_trade_links").select("id,apartment_id,link_kind,link_key,method,similarity,status,hold_reason"), sb, "id");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!isMissingTable({ message: msg })) throw e;
    tableMissing = true;
    const m = onMissingTable(apply);
    if (!m.proceed) {
      await failRun(apply, m.marker ?? "LINK_NO_TABLE", `연결 표 apartment_trade_links 가 없습니다(마이그 20261004000000 적용 전): ${msg}`, apts.length);
      return;
    }
    log(PHASE, "연결 표가 아직 없습니다 — 미리보기는 '지금 연결 0' 으로 진행");
  }

  // 4) 계획
  const dict = buildKeyDictionary(/** @type {any[]} */ (deals.rows));
  const { desired, dropped } = planLinks(apts, dict, decisions, { now });
  const plan = diffLinks(current, desired);
  const lines = planLines(plan);
  const counts = {
    active: desired.filter((l) => l.status === "active").length,
    hold: desired.filter((l) => l.status === "hold").length,
    rejected: desired.filter((l) => l.status === "rejected").length,
    add: plan.add.length, remove: plan.remove.length, change: plan.change.length, unchanged: plan.unchanged,
  };
  /** @type {Record<string, number>} */
  const byMethod = {};
  /** @type {Record<string, number>} */
  const byHold = {};
  for (const l of desired) {
    if (l.status === "active") byMethod[l.method] = (byMethod[l.method] ?? 0) + 1;
    if (l.status === "hold") byHold[l.hold_reason ?? "?"] = (byHold[l.hold_reason ?? "?"] ?? 0) + 1;
  }
  const aptById = new Map(apts.map((a) => [a.id, a]));
  /** @param {string} id */
  const statusOf = (id) => {
    const a = aptById.get(id);
    return isMovedIn(a?.completion, now) ? "입주 후" : completionMonthIndex(a?.completion) == null ? "모름" : "입주 전";
  };
  const linkedApts = new Set(desired.filter((l) => l.status === "active").map((l) => l.apartment_id));
  /** @type {Record<string, { all: number, linked: number }>} */
  const byStatus = { "입주 후": { all: 0, linked: 0 }, "입주 전": { all: 0, linked: 0 }, "모름": { all: 0, linked: 0 } };
  for (const a of apts) {
    const s = statusOf(a.id);
    byStatus[s].all++;
    if (linkedApts.has(a.id)) byStatus[s].linked++;
  }
  log(PHASE, `단지 ${apts.length} · 열쇠 사전 apt_seq ${dict.aptSeq.size} · 분양권 ${dict.presale.size} · 법정동 ${dict.umdName.size}`);
  log(PHASE, `연결 active ${counts.active} · hold ${counts.hold} · rejected ${counts.rejected} | 지금 표 ${current.length}${tableMissing ? "(표 없음)" : ""} → 넣기 ${counts.add} · 지우기 ${counts.remove} · 고치기 ${counts.change} · 그대로 ${counts.unchanged}`);
  log(PHASE, `방법별(active) ${JSON.stringify(byMethod)} · hold 사유별 ${JSON.stringify(byHold)}`);
  log(PHASE, `연결된 단지: ${Object.entries(byStatus).map(([k, v]) => `${k} ${v.linked}/${v.all}`).join(" · ")}`);
  /** @type {string[]} */
  const controlLines = [];
  for (const p of CONTROL_PROBES) {
    const hits = apts.filter((a) => String(a.name ?? "").includes(p.find));
    if (!hits.length) { controlLines.push(`[대조군] ${p.label}: 우리 단지 없음`); continue; }
    for (const a of hits) {
      const ls = desired.filter((l) => l.apartment_id === a.id);
      const txt = ls.length ? ls.map((l) => `${l.link_kind}:${l.link_key}(${l.trade_apt_name ?? "?"}) ${l.status}${l.hold_reason ? `/${l.hold_reason}` : ""} ${l.method} ${l.similarity ?? "-"}`).join(" | ") : `연결 없음 — ${dropped.filter((d) => d.apartment_id === a.id && d.key == null).map((d) => d.why).join(" / ") || "사유 없음"}`;
      controlLines.push(`[대조군] ${p.label}: ${a.id} ${a.name} → ${txt}`);
    }
  }
  for (const l of controlLines) log(PHASE, l);

  if (args.out != null) {
    /** @param {any} l */
    const readable = (l) => {
      const a = aptById.get(l.apartment_id);
      return { ...l, name: a?.name ?? null, region: a?.region ?? null, gu: a?.gu ?? null, completion: a?.completion ?? null, complex_key: a?.complex_key ?? null };
    };
    /** @param {Map<string, any>} m */
    const dictOut = (m) => [...m.values()].map((e) => ({ key: e.key, sgg_cd: e.sgg_cd, umd_cd: e.umd_cd, umd_nm: e.umd_nm, name: e.name, build_year: e.build_year, jibuns: [...e.rawJibuns], n: e.n }));
    writeFileSync(args.out, JSON.stringify({
      takenAt: new Date().toISOString(), fromMonth, apartments: apts.length, deals: { total: deals.total, complete: deals.rows.length, droppedKeys: deals.droppedKeys },
      dictionary: { aptSeq: dictOut(dict.aptSeq), presale: dictOut(dict.presale) },
      counts, byMethod, byHold, byStatus, controls: controlLines,
      holds: desired.filter((l) => l.status === "hold").map(readable),
      dropped: dropped.filter((d) => d.key == null).slice(0, 500).map((d) => ({ ...d, name: aptById.get(d.apartment_id)?.name ?? null })),
      plan: { add: plan.add.map(readable), remove: plan.remove.map(readable), change: plan.change.map((c) => ({ ...c, next: readable(c.next) })) },
      planLines: lines,
    }, null, 1) + "\n", { flag: "wx" });
    log(PHASE, `계획 파일 저장: ${args.out}`);
  }
  log(PHASE, `계산 소요 ${((Date.now() - t0) / 1000).toFixed(1)}초`);

  const breaker = evaluateLinkBreaker({ add: plan.add.length, remove: plan.remove.length, change: plan.change.length, existing: current.length });
  if (!apply) {
    if (breaker.tripped) log(PHASE, `⚠ 정기 실행이면 차단기에 걸립니다(${breaker.reason}) — 명단을 확인하고 승인받은 뒤 --apply-from=<이 계획 파일> 로 반영`);
    log(PHASE, "미리보기 종료 — 아무것도 쓰지 않았습니다");
    return;
  }
  if (applyFrom != null) {
    const cmp = compareLinkPlanToApproved(lines, approvedLines);
    if (!cmp.same) {
      for (const l of [...cmp.onlyCurrent.slice(0, 10), ...cmp.onlyApproved.slice(0, 10)]) log(PHASE, `  어긋남 ${l}`);
      await failRun(apply, "LINK_PLAN_MISMATCH", `승인한 계획 파일과 지금 계획이 다릅니다 — 지금만 ${cmp.onlyCurrent.length}줄 · 파일만 ${cmp.onlyApproved.length}줄. 미리보기를 다시 떠서 승인받으세요`, apts.length);
      return;
    }
    log(PHASE, `승인한 계획 파일과 일치(${lines.length}줄) — 반영합니다`);
  } else if (breaker.tripped) {
    await failRun(apply, "LINK_BREAKER", `차단기 발동: ${breaker.reason}`, apts.length);
    return;
  }

  const rpt = createReporter(PHASE);
  let ok = 0;
  let fail = 0;
  /** @param {any} r @param {number} expected */
  const countBack = (r, expected) => {
    const res = /** @type {{ data?: unknown[] | null, error?: { message?: string } | null }} */ (r);
    const got = res.error || !res.data ? 0 : res.data.length;
    if (got < expected && !fail) logError(PHASE, `쓰기 실패 예시: ${res.error?.message ?? "돌아온 행이 모자람(행이 없거나 그 사이 상태가 바뀜)"}`);
    ok += got;
    fail += expected - got;
  };
  const stamp = () => new Date().toISOString();
  // 넣기 — 묶음 insert, 돌아온 행 수로 센다
  for (let i = 0; i < plan.add.length; i += INSERT_CHUNK) {
    if (rpt.interrupted()) break;
    if (i > 0) await sleep(WRITE_BATCH_DELAY_MS);
    const chunk = plan.add.slice(i, i + INSERT_CHUNK).map((l) => ({ ...l, updated_at: stamp() }));
    countBack(await sb.from("apartment_trade_links").insert(chunk).select("id"), chunk.length);
  }
  // 지우기·고치기 — 이전 상태가 그대로인 줄만(동시 5)
  /** @type {Array<() => PromiseLike<any>>} */
  const jobs = [
    ...plan.remove.map((c) => () => sb.from("apartment_trade_links").delete().eq("id", c.id).eq("status", c.status).select("id")),
    ...plan.change.map((c) => () => sb.from("apartment_trade_links")
      .update({ method: c.next.method, similarity: c.next.similarity, build_year_gap: c.next.build_year_gap, trade_apt_name: c.next.trade_apt_name, trade_jibun: c.next.trade_jibun, status: c.next.status, hold_reason: c.next.hold_reason, verified_at: c.next.verified_at, verified_by: c.next.verified_by, updated_at: stamp() })
      .eq("id", c.id).eq("status", c.prev.status).select("id")),
  ];
  for (let i = 0; i < jobs.length; i += WRITE_CONCURRENCY) {
    if (rpt.interrupted()) { log(PHASE, `중단 신호 — ${ok}줄까지 반영하고 멈춥니다`); break; }
    if (i > 0) await sleep(WRITE_BATCH_DELAY_MS);
    const results = await Promise.all(jobs.slice(i, i + WRITE_CONCURRENCY).map((f) => f()));
    for (const r of results) countBack(r, 1);
  }
  rpt.success(ok);
  if (fail) rpt.fail(fail);
  rpt.skip(plan.unchanged);
  await recordCollectorRun(PHASE, { ...rpt.summary(), errorMessage: fail ? `LINK_WRITE ${fail}줄 실패(0행 반환 포함)` : null });
  log(PHASE, `완료 — 반영 ${ok}줄${fail ? ` / 실패 ${fail}줄` : ""} · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
  if (fail) process.exitCode = 1;
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) {
  main().catch(async (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    logError(PHASE, msg);
    const wantedWrite = process.argv.some((a) => a === "--apply" || a.startsWith("--apply-from"));
    if (wantedWrite) await recordCollectorRun(PHASE, { status: "failure", ok: 0, fail: 1, skip: 0, errorMessage: `LINK_ERROR ${msg}` });
    process.exitCode = 1;
  });
}
