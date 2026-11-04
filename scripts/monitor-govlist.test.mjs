// @ts-check
/**
 * 감시 ⑫(h) 지자체 명단 만료·갱신 안 됨 + ㉔ 지자체 명단 수집 건전성(세션692 PR-4 · 설계서 §7).
 * 표식은 수집기 collect-unsold-govlist.mjs 와 같은 꼴(`GOVLIST_SKIP <출처> <이유>` 를 " · " 로 이음)으로 만든다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  checkApplyhomeUnsold,
  holdAlertResolved,
  HOLD_BASELINE_IDS,
  checkGovlistSkips,
  checkGovlistDrop,
  parseGovlistSkips,
  GOVLIST_COLLECTOR,
  runDailyGuardedChecks,
  isAlwaysDedup,
} from "./monitor-collectors.mjs";
import { formatIssue } from "./notify-telegram.mjs";

/** 기준 명단 그대로의 hold 행 — (d) 가 끼지 않게. */
const holds = HOLD_BASELINE_IDS.map((id) => ({ id, unsold: null, unsold_rate: null, unsold_source: "hold", unsold_as_of: "2026-11-01" }));
/** @param {Record<string, unknown>} o */
const gov = (o) => ({ name: "두류", unsold: null, unsold_rate: null, unsold_source: "govlist", unsold_as_of: "2026-09-30", unsold_listed_as_of: "2026-09-30", ...o });
/** @param {any[]} rows @param {Date} now */
const hIssues = (rows, now) => checkApplyhomeUnsold([...holds, ...rows], { now }).filter((i) => i.collector === "unsold-govlist");

describe("⑫(h) 지자체 명단 — 만료 지남·갱신 안 됨", () => {
  it("brief 예시: govlist 0행 → 이슈 0", () => {
    expect(hIssues([], new Date("2027-12-01T00:00:00Z"))).toEqual([]);
  });
  it("(h-2) 비공개 등재: 기준월 + 6개월 당일까지 침묵 · 다음 날(KST) 1건", () => {
    const rows = [gov({ id: "ah-2025910146" })];
    expect(hIssues(rows, new Date("2027-03-30T14:59:00Z"))).toEqual([]); // KST 03-30 23:59
    const at = hIssues(rows, new Date("2027-03-30T15:00:00Z")); // KST 03-31
    expect(at.map((i) => i.at?.split(":")[0])).toEqual(["govstale"]);
    expect(at[0].detail).toContain("두류(ah-2025910146)");
  });
  it("(h-1) 만료 + 여유 35일 지남 → govexp · 숫자 명단 행은 h-2 에 안 걸린다", () => {
    const rows = [gov({ id: "a" }), gov({ id: "b", unsold: 4, unsold_rate: 1.1 })];
    // 03-30 만료 · +35일 = 05-04 · 다음 날 05-05 KST 부터 (h-1)
    expect(hIssues(rows, new Date("2027-05-04T03:00:00Z")).map((i) => i.at?.split(":")[0])).toEqual(["govstale"]);
    const later = hIssues(rows, new Date("2027-05-05T03:00:00Z"));
    expect(later.map((i) => i.at?.split(":")[0])).toEqual(["govexp", "govstale"]);
    expect(later[0].detail).toContain("2곳"); // 숫자·비공개 둘 다
    expect(later[1].detail).toContain("1곳"); // 비공개만
  });
  it("dedup 지문 = 명단 id 정렬 해시 — 같은 명단은 같은 at, 순서만 바뀌어도 같고, 하나 늘면 바뀐다 · daily dedup · (d) 해소 판정과 안 섞임", () => {
    const now = new Date("2027-06-01T00:00:00Z");
    const a = hIssues([gov({ id: "x" }), gov({ id: "y" })], now);
    const b = hIssues([gov({ id: "y" }), gov({ id: "x" })], now);
    const c = hIssues([gov({ id: "y" }), gov({ id: "x" }), gov({ id: "z" })], now);
    expect(a.map((i) => i.at)).toEqual(b.map((i) => i.at));
    expect(a[0].at).not.toBe(c[0].at);
    expect(a.every((i) => isAlwaysDedup(i))).toBe(true);
    expect(holdAlertResolved(checkApplyhomeUnsold([...holds, gov({ id: "x" })], { now }))).toBe(true);
  });
  it("(h-3) 기준월 있는 govlist 만이면 날짜 없음 줄 0건(침묵)", () => {
    const now = new Date("2026-11-08T00:00:00Z");
    expect(hIssues([gov({ id: "a" }), gov({ id: "b", unsold: 4 })], now).filter((i) => i.at?.startsWith("govnodate:"))).toEqual([]);
  });
  it("(h-3) 기준월이 빈 govlist 1곳 → 「기준월이 빈 단지 1곳」 1건 · 지문 접두 govnodate · 다른 (h) 줄은 안 섞임", () => {
    const now = new Date("2026-11-08T00:00:00Z");
    const is = hIssues([gov({ id: "a" }), gov({ id: "nd", unsold_as_of: null, unsold_listed_as_of: null })], now);
    expect(is.map((i) => i.at?.split(":")[0])).toEqual(["govnodate"]);
    expect(is[0].detail).toContain("기준월(unsold_as_of)이 빈 단지 1곳");
    expect(is[0].detail).toContain("두류(nd)");
    expect(isAlwaysDedup(is[0])).toBe(true);
  });
  it("다른 출처·(a)~(f) 판정은 govlist 행이 섞여도 그대로(청약홈 만료 없음 → (a) 0)", () => {
    const all = checkApplyhomeUnsold([...holds, gov({ id: "x" })], { now: new Date("2026-11-08T00:00:00Z") });
    expect(all).toEqual([]);
  });
});

/** @param {string | null} msg @param {string} at @param {string} [status] */
const run = (msg, at, status = "success") => ({ status, error_message: msg, finished_at: at });

describe("㉔-a GOVLIST_SKIP — 최근 실행 1행", () => {
  it("parseGovlistSkips — 표식만 뽑고 다른 GOVLIST_* 조각은 무시", () => {
    expect(parseGovlistSkips("GOVLIST_SKIP chungnam not_newer · GOVLIST_WRITE race 1 · GOVLIST_SKIP daegu fetch")).toEqual([
      { source: "chungnam", reason: "not_newer" }, { source: "daegu", reason: "fetch" },
    ]);
    expect(parseGovlistSkips(null)).toEqual([]);
    expect(parseGovlistSkips("GOVLIST_BREAKER 바뀔 단지 60")).toEqual([]);
  });
  it("brief 예시: collector_runs 0행 → 이슈 0 · 최신 실행에 표식 없으면 침묵(옛 실행 표식은 무시)", () => {
    expect(checkGovlistSkips([])).toEqual([]);
    expect(checkGovlistSkips([run(null, "2026-12-08T00:00:00Z"), run("GOVLIST_SKIP chungnam not_newer", "2026-11-08T00:00:00Z")])).toEqual([]);
  });
  it("걸림 — 1건 · 출처·이유가 detail 에 · daily dedup", () => {
    const is = checkGovlistSkips([run("GOVLIST_SKIP chungnam not_newer", "2026-12-08T00:00:00Z")]);
    expect(is).toHaveLength(1);
    expect(is[0].kind).toBe("govlist-health");
    expect(is[0].collector).toBe(GOVLIST_COLLECTOR);
    expect(is[0].detail).toContain("chungnam(not_newer)");
    expect(isAlwaysDedup(is[0])).toBe(true);
  });
  it("dedup 지문 — 같은 표식이 다달이 이어지면 같은 at(구간 첫 실행) · 깨끗한 success 가 끊으면 새 구간 · 표식이 바뀌면 다른 at", () => {
    const m = "GOVLIST_SKIP chungnam not_newer";
    const one = checkGovlistSkips([run(m, "2026-12-08T00:00:00Z"), run(m, "2026-11-08T00:00:00Z")])[0].at;
    const two = checkGovlistSkips([run(m, "2027-01-08T00:00:00Z"), run(m, "2026-12-08T00:00:00Z"), run(m, "2026-11-08T00:00:00Z")])[0].at;
    expect(one).toBe(two);
    const broken = checkGovlistSkips([run(m, "2027-01-08T00:00:00Z"), run(null, "2026-12-08T00:00:00Z"), run(m, "2026-11-08T00:00:00Z")])[0].at;
    expect(broken).not.toBe(one);
    const other = checkGovlistSkips([run("GOVLIST_SKIP chungnam header", "2026-12-08T00:00:00Z"), run(m, "2026-11-08T00:00:00Z")])[0].at;
    expect(other).not.toBe(one);
    // 표식 순서만 바뀐 같은 내용은 같은 지문 앞부분
    const ab = checkGovlistSkips([run("GOVLIST_SKIP a x · GOVLIST_SKIP b y", "T")])[0].at;
    const ba = checkGovlistSkips([run("GOVLIST_SKIP b y · GOVLIST_SKIP a x", "T")])[0].at;
    expect(ab).toBe(ba);
  });
});

/** @param {string} source @param {string} asOf @param {string} batch @param {number} n @param {number} [declared] */
const batch = (source, asOf, batch, n, declared = n) => Array.from({ length: n }, () => ({ source, as_of: asOf, batch_id: batch, batch_rows: declared }));

describe("㉔-b 명단 행 수 전 기준월 대비 −50%", () => {
  it("brief 예시: 명단 0행 → 이슈 0 · 기준월 하나뿐이면 침묵", () => {
    expect(checkGovlistDrop([])).toEqual([]);
    expect(checkGovlistDrop(batch("daegu", "2026-09-30", "b1", 60))).toEqual([]);
  });
  it("경계: 전 60 → 30 은 침묵(= 절반) · 29 는 걸림", () => {
    expect(checkGovlistDrop([...batch("daegu", "2026-09-30", "b1", 60), ...batch("daegu", "2026-10-31", "b2", 30)])).toEqual([]);
    const is = checkGovlistDrop([...batch("daegu", "2026-09-30", "b1", 60), ...batch("daegu", "2026-10-31", "b2", 29)]);
    expect(is).toHaveLength(1);
    expect(is[0].detail).toContain("GOVLIST_DROP daegu 명단 행 29 < 전 기준월(2026-09-30) 60");
    expect(isAlwaysDedup(is[0])).toBe(true);
  });
  it("반쯤 쓰인 batch(실제 행 ≠ batch_rows)는 세지 않는다 — 같은 달의 완성 batch 로 판정", () => {
    const rows = [...batch("daegu", "2026-09-30", "b1", 60), ...batch("daegu", "2026-10-31", "half", 10, 58), ...batch("daegu", "2026-10-31", "full", 58)];
    expect(checkGovlistDrop(rows)).toEqual([]);
    // 완성 batch 가 없는 달은 기준월로 안 친다 → 9월이 최신 하나뿐 → 침묵
    expect(checkGovlistDrop([...batch("daegu", "2026-09-30", "b1", 60), ...batch("daegu", "2026-10-31", "half", 10, 58)])).toEqual([]);
  });
  it("출처마다 따로 · dedup 지문 = 출처|기준월|행 수 — 같은 상태 같은 at, 다른 출처는 다른 at", () => {
    const rows = [...batch("daegu", "2026-09-30", "b1", 60), ...batch("daegu", "2026-10-31", "b2", 10), ...batch("chungnam", "2026-06-30", "c1", 100), ...batch("chungnam", "2026-07-31", "c2", 20)];
    const a = checkGovlistDrop(rows), b = checkGovlistDrop([...rows].reverse());
    expect(a.map((i) => i.detail.split(" ")[1])).toEqual(["chungnam", "daegu"]);
    expect(a.map((i) => i.at)).toEqual(b.map((i) => i.at));
    expect(a[0].at).not.toBe(a[1].at);
  });
});

describe("㉔ 배선", () => {
  const quiet = {
    fetchGuPairs: async () => ({ aptPairs: [], regionRows: [] }),
    fetchCoordRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchTradeRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchRegionRuns: async () => ({}),
    fetchAhRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchUnsourcedZero: async () => ({ rows: [], doc: { evidence: [], held: [], pending: [] } }),
    fetchFailureRuns: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchKeyHealth: async () => ({ gapRows: /** @type {Array<Record<string, any>>} */ ([]), latestSuccess: { finished_at: new Date().toISOString() } }),
    fetchKaptWindowRuns: async () => ({}),
    fetchTradeDeals: async () => ({ empty: true, rows: /** @type {Array<Record<string, any>>} */ ([]), tradesCounts: {}, latest: "202609", prev: "202608" }),
    fetchTradeLinks: async () => ({ links: /** @type {Array<Record<string, any>>} */ ([]), apts: /** @type {Array<Record<string, any>>} */ ([]), latestSuccess: null }),
    fetchSgisMapRun: async () => [],
    fetchNoticeRuns: async () => ({}),
    fetchPriceHistoryCounts: async () => ({ A: { count: 163140 }, B: { count: 129 } }),
    fetchSeoThin: async () => ({ status: 200, text: '{"count":0,"ids":[],"names":[],"applied":true,"cap":15}' }),
    clearHoldAlertKeys: async (/** @type {string} */ _prefix) => {},
  };
  it("runDailyGuardedChecks 가 ㉔ 재료를 1회 물어 두 판정을 싣는다 · 0행이면 침묵", async () => {
    let n = 0;
    const silent = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchGovlistHealth: async () => { n++; return { runs: [], listRows: [] }; } }));
    expect(n).toBe(1);
    expect(silent.filter((i) => i.kind === "govlist-health" || i.kind === "check-failed")).toEqual([]);
    const loud = await runDailyGuardedChecks(/** @type {any} */ ({
      ...quiet,
      fetchGovlistHealth: async () => ({
        runs: [run("GOVLIST_SKIP chungnam not_newer", "2026-12-08T00:00:00Z")],
        listRows: [...batch("daegu", "2026-09-30", "b1", 60), ...batch("daegu", "2026-10-31", "b2", 5)],
      }),
    }));
    expect(loud.filter((i) => i.kind === "govlist-health").map((i) => i.detail.split(" ")[0])).toEqual(["GOVLIST_SKIP", "GOVLIST_DROP"]);
  });
  it("수집기 PHASE·표식 문구·이음이 감시와 같다(한쪽만 바뀌면 빨강)", () => {
    const src = readFileSync(fileURLToPath(new URL("./collectors/collect-unsold-govlist.mjs", import.meta.url)), "utf8");
    expect(src).toContain(`export const PHASE = "${GOVLIST_COLLECTOR}";`);
    expect(src).toContain("const m = `GOVLIST_SKIP ${source} ${why}`;");
    expect(src).toContain('markers.join(" · ")');
    const mon = readFileSync(fileURLToPath(new URL("./monitor-collectors.mjs", import.meta.url)), "utf8");
    expect(mon).toContain('s.from("unsold_gov_list").select("id, source, as_of, batch_id, batch_rows"),\n    getSupabase(),\n    "id",'.replace(/\n/g, mon.includes("\r\n") ? "\r\n" : "\n"));
  });
  it("텔레그램 문구 — 제목·조치가 있고 undefined 가 없다", () => {
    const text = formatIssue(checkGovlistSkips([run("GOVLIST_SKIP chungnam not_newer", "2026-12-08T00:00:00Z")])[0]);
    expect(text).toContain("<b>지자체 미분양 명단 수집 경고</b>");
    expect(text).toContain("[조치]");
    expect(text).not.toContain("undefined");
    const h = formatIssue(hIssues([gov({ id: "x" })], new Date("2027-06-01T00:00:00Z"))[0]);
    expect(h).toContain("[조치]");
    expect(h).not.toContain("undefined");
  });
});
