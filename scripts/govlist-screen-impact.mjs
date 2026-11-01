// @ts-check
/**
 * 지자체 명단 수집기(collect-unsold-govlist) dry-run 계획의 **손님 화면 변화**를 센다 — 전이표 재료(세션687 PR-2 보완 G6② · Q3 재료).
 *
 * 점수는 새로 짓지 않는다: `compute-scores.mjs` 와 같은 길(VIEW `apartments_flat` 전부 → `computeRegionalMedians` → `calcAll(apt, "live")`)
 * 을 그대로 쓰고, 등급은 화면 배지 `gr()`(theme), 위험 결론은 `calcCats().risk.total` 70/50 경계(catVerdict 와 같은 경계).
 * 카드 흉내: 계획의 쓰는 행이 든 카드(memberIds)는 VIEW 순위 0(govlist 유효)이 이긴다고 보고 — 미분양 = 새 값 ·
 * 미분양률 = 묶음(구성원 2+)이면 새 미분양 ÷ 카드 세대수(VIEW 와 같은 식, 100 초과 NULL) · 혼자면 그 행 새 률 · 비공개 표시 = 새 값 NULL.
 * 「미분양만 보기」 = 지금 규칙 `Number(unsold ?? 0) > 0`(useDataPipeline.ts) · PR-3 뒤 규칙 `… || unsoldListedHidden`.
 * 2u 가 읽는 원표 `apartments.unsold` 가 바뀌는 행 수도 같이 센다.
 *
 *   node --loader ./scripts/alias-loader.mjs scripts/govlist-screen-impact.mjs --impact=<impact.json> --md-out=<요약.md> [--mode=off|on]
 *   (읽기만 — DB·파일 쓰기는 impact 의 `screen` 칸과 요약 md 뿐)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadEnv, getSupabase, selectAll } from "./collectors/_shared.mjs";
import { computeRegionalMedians, calcCats, calcAll } from "@/scoring/engine";
import { gr } from "@/theme/index";

/** @typedef {Record<string, any>} Card */

/** 「미분양만 보기」 지금 규칙(useDataPipeline.ts:285·380). @param {Card} c */
export const unsoldFilterNow = (c) => Number(c.unsold ?? 0) > 0;
/** PR-3 뒤 규칙(설계서 §6 — 비공개 등재도 남긴다). @param {Card} c */
export const unsoldFilterPr3 = (c) => Number(c.unsold ?? 0) > 0 || !!c.unsoldListedHidden;

/**
 * 계획의 쓰는 행 → 카드의 바뀐 모습(VIEW 흉내). 카드에 쓰는 행이 없으면 null.
 * @param {Card} card VIEW apartments_flat 한 줄
 * @param {Map<string, { unsold: number | null; unsold_rate: number | null }>} afterById 쓰는 행 id → 새 값
 * @returns {Card | null}
 */
export function simulateCard(card, afterById) {
  const members = Array.isArray(card.memberIds) && card.memberIds.length ? card.memberIds : [card.id];
  const hit = members.map((/** @type {string} */ id) => afterById.get(id)).find((x) => x != null);
  if (!hit) return null;
  const units = Number(card.units ?? 0);
  let rate;
  if (members.length >= 2) {
    rate = hit.unsold == null || !(units > 0) ? null : Math.round((hit.unsold / units) * 1000) / 10;
    if (rate != null && rate > 100) rate = null;
  } else {
    rate = hit.unsold_rate != null && hit.unsold_rate > 100 ? null : hit.unsold_rate;
  }
  return { ...card, unsold: hit.unsold, unsoldRate: rate, unsoldListedHidden: hit.unsold == null, unsoldSource: "govlist" };
}

/** @param {number} t */
const riskWord = (t) => (t >= 70 ? "안전성 높음" : t >= 50 ? "안전성 보통" : "위험 요소 주의");

/**
 * @param {Card[]} cards 전부(중앙값 재료)
 * @param {Array<{ id: string; before: any; after: any; action: string }>} writeRows
 */
export function screenImpact(cards, writeRows) {
  /** @type {Map<string, { unsold: number | null; unsold_rate: number | null }>} */
  const afterById = new Map(writeRows.map((r) => [r.id, { unsold: r.after.unsold, unsold_rate: r.after.unsold_rate }]));
  const changed = new Map();
  for (const c of cards) { const s = simulateCard(c, afterById); if (s) changed.set(c.id, s); }
  const afterCards = cards.map((c) => changed.get(c.id) ?? c);
  const ctxB = { regionMedians: computeRegionalMedians(/** @type {any} */ (cards)) };
  const ctxA = { regionMedians: computeRegionalMedians(/** @type {any} */ (afterCards)) };
  /** @type {any[]} */ const rows = [];
  for (const [id, a] of changed) {
    const b = /** @type {Card} */ (cards.find((c) => c.id === id));
    const tb = calcAll(/** @type {any} */ (b), "live", /** @type {any} */ (ctxB)).total, ta = calcAll(/** @type {any} */ (a), "live", /** @type {any} */ (ctxA)).total;
    const rb = calcCats(/** @type {any} */ (b), /** @type {any} */ (ctxB)).risk.total, ra = calcCats(/** @type {any} */ (a), /** @type {any} */ (ctxA)).risk.total;
    rows.push({
      id, name: b.name, region: b.region, gu: b.gu,
      unsold: [b.unsold ?? null, a.unsold ?? null], unsoldRate: [b.unsoldRate ?? null, a.unsoldRate ?? null],
      total: [tb, ta], grade: [gr(tb).l, gr(ta).l], risk: [Math.round(rb), Math.round(ra)], riskWord: [riskWord(rb), riskWord(ra)],
      filterNow: [unsoldFilterNow(b), unsoldFilterNow(a)], filterPr3: [unsoldFilterPr3(b), unsoldFilterPr3(a)],
    });
  }
  rows.sort((x, y) => Math.abs(y.total[1] - y.total[0]) - Math.abs(x.total[1] - x.total[0]) || (x.id < y.id ? -1 : 1));
  const count = (/** @type {(r: any) => boolean} */ f) => rows.filter(f).length;
  return {
    cards: rows.length,
    gradeChanged: count((r) => r.grade[0] !== r.grade[1]),
    riskWordChanged: count((r) => r.riskWord[0] !== r.riskWord[1]),
    totalUp: count((r) => r.total[1] > r.total[0]), totalDown: count((r) => r.total[1] < r.total[0]), totalSame: count((r) => r.total[1] === r.total[0]),
    filterNow: { out: count((r) => r.filterNow[0] && !r.filterNow[1]), in: count((r) => !r.filterNow[0] && r.filterNow[1]) },
    filterPr3: { out: count((r) => r.filterPr3[0] && !r.filterPr3[1]), in: count((r) => !r.filterPr3[0] && r.filterPr3[1]) },
    rawUnsoldChanged: writeRows.filter((r) => (r.before.unsold ?? null) !== (r.after.unsold ?? null)).length,
    rows,
  };
}

/** @param {ReturnType<typeof screenImpact>} s @param {any} impact @param {string} mode */
export function transitionMarkdown(s, impact, mode) {
  const m = impact.modes[mode];
  const L = [];
  L.push(`# 지자체 명단(govlist) 첫 전이표 — ${mode === "off" ? "미등재→0 꺼짐" : "미등재→0 켬"} (${impact.generatedAt})`);
  L.push("");
  L.push("| 출처 | 기준일 | 면적대 줄 | 단지(비공개) | 매칭 strong/weak/none/decided/rejected | 판정 필요 단지 |");
  L.push("|---|---|---|---|---|---|");
  for (const x of impact.sources) {
    const c = x.match?.counts ?? {};
    L.push(`| ${x.source} | ${x.asOf ?? "-"} | ${x.rows ?? "-"} | ${x.complexes ?? "-"}(${x.hidden ?? "-"}) | ${c.strong ?? 0}/${c.weak ?? 0}/${c.none ?? 0}/${c.decided ?? 0}/${c.rejected ?? 0} | ${x.unresolved?.total ?? "-"} |`);
  }
  L.push("");
  L.push(`- 쓰는 행 ${m.summary.writeRows} · 바뀔 단지 ${m.summary.changedBundles} · 차단기 ${m.breaker.tripped ? m.breaker.reasons.join(" / ") : "안 걸림"} · CHECK 위반 ${m.checkViolations.length}`);
  L.push(`- 값 변화: ${JSON.stringify(m.summary.byChange)} · 출처: ${JSON.stringify(m.summary.sourceShift)}`);
  L.push(`- 켬 상한(미등재→0 을 (d) 하나로만 막은 행 — 판정 파일로 그 시군구를 해소하면 0 이 될 수 있음): ${impact.modes.on.dOnly.total}행 ${JSON.stringify(impact.modes.on.dOnly.byRegion)}`);
  L.push("");
  L.push("## 손님 화면 변화(카드 기준 · VIEW 흉내 · 점수 = compute-scores 와 같은 calcAll live)");
  L.push("");
  L.push("| 바뀌는 카드 | 총점 오름/내림/같음 | 등급 바뀜 | 위험 결론 바뀜 | 「미분양만 보기」 지금 규칙 빠짐/들어옴 | PR-3 뒤 규칙 빠짐/들어옴 | 2u 원표 unsold 바뀌는 행 |");
  L.push("|---|---|---|---|---|---|---|");
  L.push(`| ${s.cards} | ${s.totalUp}/${s.totalDown}/${s.totalSame} | ${s.gradeChanged} | ${s.riskWordChanged} | ${s.filterNow.out}/${s.filterNow.in} | ${s.filterPr3.out}/${s.filterPr3.in} | ${s.rawUnsoldChanged} |`);
  L.push("");
  L.push("### 대표 5곳(총점 변화 큰 순)");
  L.push("");
  L.push("| 카드 | 미분양 | 미분양률 | 총점 | 등급 | 위험 | 미분양만 보기(지금 → PR-3 뒤) |");
  L.push("|---|---|---|---|---|---|---|");
  const v = (/** @type {any} */ x) => (x == null ? "—" : x);
  for (const r of s.rows.slice(0, 5)) {
    L.push(`| ${r.name} (${r.region} ${r.gu ?? ""}) | ${v(r.unsold[0])} → ${v(r.unsold[1])} | ${v(r.unsoldRate[0])} → ${v(r.unsoldRate[1])} | ${r.total[0]} → ${r.total[1]} | ${r.grade[0]} → ${r.grade[1]} | ${r.risk[0]}(${r.riskWord[0]}) → ${r.risk[1]}(${r.riskWord[1]}) | ${r.filterNow[1] ? "남음" : "빠짐"} → ${r.filterPr3[1] ? "남음" : "빠짐"} |`);
  }
  L.push("");
  L.push("> 흉내의 한계: 카드 미분양은 「govlist 유효 행이 순위 0 으로 이긴다」고 보고 계산했다(같은 묶음에 유효 청약홈 행이 있으면 VIEW 50% 규칙이 달라질 수 있음 — 이번 계획엔 그런 묶음 0). 위험 점수의 미분양 칸은 비공개면 「모름 40」(👤 Q3).");
  return L.join("\n") + "\n";
}

export async function main() {
  const arg = (/** @type {string} */ p) => process.argv.find((a) => a.startsWith(p))?.slice(p.length) ?? null;
  const impactPath = arg("--impact="), mdOut = arg("--md-out="), mode = arg("--mode=") ?? "off";
  if (!impactPath || !mdOut || !["off", "on"].includes(mode)) throw new Error("--impact=<impact.json> --md-out=<요약.md> [--mode=off|on] 필요");
  const impact = JSON.parse(readFileSync(impactPath, "utf8"));
  loadEnv();
  const sb = getSupabase();
  const cards = await selectAll((q) => q.from("apartments_flat").select("*"), sb, "id");
  const writes = impact.modes[mode].plan.filter((/** @type {any} */ r) => String(r.action).startsWith("write_"));
  const s = screenImpact(cards, writes);
  impact.screen = { ...(impact.screen ?? {}), [mode]: { ...s, cardsLoaded: cards.length } };
  writeFileSync(impactPath, JSON.stringify(impact, null, 2), "utf8");
  writeFileSync(mdOut, transitionMarkdown(s, impact, mode), "utf8");
  console.log(`[screen] 카드 ${cards.length} 읽음 · 바뀌는 카드 ${s.cards} · 총점 ↑${s.totalUp} ↓${s.totalDown} =${s.totalSame} · 등급 바뀜 ${s.gradeChanged} · 미분양만 보기 지금 빠짐 ${s.filterNow.out} / PR-3 뒤 빠짐 ${s.filterPr3.out} · 2u 원표 ${s.rawUnsoldChanged}행 → ${mdOut}`);
}

const isCLI = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
