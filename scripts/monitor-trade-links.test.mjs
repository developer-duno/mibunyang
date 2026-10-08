// @ts-check
/**
 * 감시 ⑰ 단지↔거래 연결 표 건전성 (세션590 — 시세 비교 범위 좁히기 나).
 * (a) 묶기 배치 20일 무성공 · (b) 서로 다른 complex_key 묶음이 같은 열쇠를 active 로 공유하는 **명단** · (c) 빈 표·없는 표 침묵.
 */
import { describe, it, expect } from "vitest";
import {
  checkTradeLinksHealth, fetchTradeLinksHealth, runDailyGuardedChecks, TRADE_LINKS_STALE_DAYS, TRADE_LINKS_COLLECTOR,
} from "./monitor-collectors.mjs";
import { formatIssue } from "./notify-telegram.mjs";

const NOW = new Date("2026-10-23T03:00:00Z");
const daysAgo = (/** @type {number} */ d) => ({ finished_at: new Date(NOW.getTime() - d * 86400000).toISOString() });
const APTS = [
  { id: "a1", complex_key: "K1", presale_type: null, name: "한빛마을" },
  { id: "a2", complex_key: "K1", presale_type: null, name: "한빛마을(무순위)" },
  { id: "b1", complex_key: "K2", presale_type: null, name: "한빛마을2" },
  { id: "l1", complex_key: "K3", presale_type: "국민임대", name: "한빛마을 국민임대" },
  { id: "e1", complex_key: null, presale_type: null, name: "열쇠없음1" },
  { id: "e2", complex_key: null, presale_type: null, name: "열쇠없음2" },
];
/** @param {string} apt @param {string} key @param {string} [kind] */
const L = (apt, key, kind = "apt_seq") => ({ apartment_id: apt, link_kind: kind, link_key: key });

describe("checkTradeLinksHealth", () => {
  it("상수 — 20일 · 수집기 이름", () => {
    expect([TRADE_LINKS_STALE_DAYS, TRADE_LINKS_COLLECTOR]).toEqual([20, "assign-trade-links"]);
  });

  it("(a) 마지막 성공 21일 전 → stale · 19일 전 → 침묵 · 기록 없음 → stale", () => {
    const links = [L("a1", "S1")];
    expect(checkTradeLinksHealth(links, APTS, daysAgo(21), { now: NOW }).map((i) => i.kind)).toEqual(["trade-links-stale"]);
    expect(checkTradeLinksHealth(links, APTS, daysAgo(19), { now: NOW })).toEqual([]);
    const none = checkTradeLinksHealth(links, APTS, null, { now: NOW });
    expect(none.map((i) => [i.kind, i.detail])).toEqual([["trade-links-stale", "단지↔거래 묶기의 성공 기록이 없음"]]);
  });

  it("(b) 다른 묶음(K1·K2)이 같은 열쇠 active → 명단(열쇠·단지 id 그대로)", () => {
    const issues = checkTradeLinksHealth([L("a1", "S1"), L("b1", "S1"), L("a1", "S2")], APTS, daysAgo(1), { now: NOW });
    expect(issues.map((i) => [i.kind, i.detail, i.lines?.[0]])).toEqual([["trade-links-sibling", "apt_seq|S1 가 묶음 2개에 active", "단지: a1, b1"]]);
  });

  it("(b) 같은 묶음 두 행 · 임대 행 + 분양 행 → 침묵 / 묶음 열쇠가 빈 행은 충돌 셈에서 뺀다(보완 F7 — 빈 두 행도 침묵)", () => {
    expect(checkTradeLinksHealth([L("a1", "S1"), L("a2", "S1")], APTS, daysAgo(1), { now: NOW })).toEqual([]);
    expect(checkTradeLinksHealth([L("a1", "S1"), L("l1", "S1")], APTS, daysAgo(1), { now: NOW })).toEqual([]);
    expect(checkTradeLinksHealth([L("e1", "S9"), L("e2", "S9")], APTS, daysAgo(1), { now: NOW })).toEqual([]);
    expect(checkTradeLinksHealth([L("a1", "S9"), L("e2", "S9")], APTS, daysAgo(1), { now: NOW })).toEqual([]);
  });

  it("(b) hold 줄은 형제 셈에 안 넣는다(active 만)", () => {
    expect(checkTradeLinksHealth([L("a1", "S1"), { ...L("b1", "S1"), status: "hold" }], APTS, daysAgo(1), { now: NOW })).toEqual([]);
  });

  it("(c) hold 가 45일 넘게 남으면 명단(단지 id·열쇠·사유) — 44일은 침묵 · 46일은 알림", () => {
    const created = (/** @type {number} */ d) => new Date(NOW.getTime() - d * 86400000).toISOString();
    const h = (/** @type {string} */ apt, /** @type {string} */ key, /** @type {number} */ d) => ({ ...L(apt, key), status: "hold", hold_reason: "sibling", created_at: created(d) });
    expect(checkTradeLinksHealth([L("a1", "S1"), h("b1", "S2", 44)], APTS, daysAgo(1), { now: NOW })).toEqual([]);
    const issues = checkTradeLinksHealth([L("a1", "S1"), h("b1", "S2", 46), h("e1", "S3", 60)], APTS, daysAgo(1), { now: NOW });
    expect(issues.map((i) => i.kind)).toEqual(["trade-links-hold-aging"]);
    expect(issues[0].lines?.slice(0, 2).map((s) => s.split(" · ").slice(0, 3).join(" · "))).toEqual(["b1 · apt_seq:S2 · sibling", "e1 · apt_seq:S3 · sibling"]);
    expect(formatIssue(issues[0])).toMatch(/\[조치\]/);
  });

  it("(c) G3 기준은 updated_at — 46일 전 created + 1일 전 updated(오늘 hold 로 바뀐 줄)는 명단에 없음 · updated_at 이 46일 전이면 알림", () => {
    const at = (/** @type {number} */ d) => new Date(NOW.getTime() - d * 86400000).toISOString();
    const hu = (/** @type {number} */ c, /** @type {number} */ u) => ({ ...L("b1", "S2"), status: "hold", hold_reason: "phase", created_at: at(c), updated_at: at(u) });
    expect(checkTradeLinksHealth([L("a1", "S1"), hu(46, 1)], APTS, daysAgo(1), { now: NOW })).toEqual([]);
    expect(checkTradeLinksHealth([L("a1", "S1"), hu(60, 46)], APTS, daysAgo(1), { now: NOW }).map((i) => i.kind)).toEqual(["trade-links-hold-aging"]);
  });

  it("(c) G5 hold 아닌 줄은 오래돼도 안 센다(active 60일) · 45일 정각은 침묵(넘어야 알림)", () => {
    const at = (/** @type {number} */ d) => new Date(NOW.getTime() - d * 86400000).toISOString();
    expect(checkTradeLinksHealth([{ ...L("a1", "S1"), status: "active", created_at: at(60), updated_at: at(60) }], APTS, daysAgo(1), { now: NOW })).toEqual([]);
    expect(checkTradeLinksHealth([L("a1", "S1"), { ...L("b1", "S2"), status: "hold", hold_reason: "phase", created_at: at(45) }], APTS, daysAgo(1), { now: NOW })).toEqual([]);
  });

  it("(b) 같은 열쇠 이름이라도 종류(apt_seq/presale)가 다르면 다른 열쇠", () => {
    expect(checkTradeLinksHealth([L("a1", "X"), L("b1", "X", "presale")], APTS, daysAgo(1), { now: NOW })).toEqual([]);
  });

  it("(b) 명단이 바뀌면 at(지문)도 바뀐다 — 같은 개수라도", () => {
    const apts2 = [...APTS, { id: "c1", complex_key: "K9", presale_type: null, name: "다른단지" }];
    const one = checkTradeLinksHealth([L("a1", "S1"), L("b1", "S1")], apts2, daysAgo(1), { now: NOW })[0];
    const two = checkTradeLinksHealth([L("a1", "S1"), L("c1", "S1")], apts2, daysAgo(1), { now: NOW })[0];
    expect(one.at).not.toBe(two.at);
  });

  it("(c) 연결 표가 비면 침묵(성공 기록이 없어도)", () => {
    expect(checkTradeLinksHealth([], APTS, null, { now: NOW })).toEqual([]);
  });

  it("알림 글에 조치 안내가 붙는다", () => {
    const [i] = checkTradeLinksHealth([L("a1", "S1"), L("b1", "S1")], APTS, daysAgo(1), { now: NOW });
    expect(formatIssue(i)).toMatch(/\[조치\]/);
    const [s] = checkTradeLinksHealth([L("a1", "S1")], APTS, null, { now: NOW });
    expect(formatIssue(s)).toMatch(/Assign trade links/);
  });
});

describe("fetchTradeLinksHealth — 표 없음 침묵", () => {
  it("PGRST205 → missing · 다른 조회는 안 한다", async () => {
    let calls = 0;
    const sb = {
      from() {
        calls++;
        /** @type {any} */
        const q = {};
        for (const m of ["select", "eq", "in", "order", "limit", "gt"]) q[m] = () => q;
        q.then = (/** @type {any} */ res, /** @type {any} */ rej) =>
          Promise.resolve({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.apartment_trade_links' in the schema cache" } }).then(res, rej);
        return q;
      },
    };
    const h = await fetchTradeLinksHealth(sb);
    expect(h).toEqual({ missing: true, links: [], apts: [], latestSuccess: null });
    expect(calls).toBe(1);
  });
});

describe("runDailyGuardedChecks 배선", () => {
  const quiet = {
    fetchGuPairs: async () => ({ aptPairs: [], regionRows: [] }),
    fetchCoordRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchTradeRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchRegionRuns: async () => ({}),
    fetchAhRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchFailureRuns: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchKeyHealth: async () => ({ gapRows: /** @type {Array<Record<string, any>>} */ ([]), latestSuccess: { finished_at: new Date().toISOString() } }),
    fetchKaptWindowRuns: async () => ({}),
    fetchTradeDeals: async () => ({ empty: true, rows: [], tradesCounts: {}, latest: "202609", prev: "202608" }),
    fetchSgisMapRun: async () => [], // ⑱(세션614) — 같은 이유: 없으면 운영 조회로 새어 check-failed 가 하나 더 생긴다
    clearHoldAlertKeys: async (/** @type {string} */ _prefix) => {},
  };
  /** @param {any[]} issues */
  const mine = (issues) => issues.filter((i) => String(i.kind).startsWith("trade-links"));

  it("조회 결과의 형제 명단이 이슈로 실린다", async () => {
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({
      ...quiet,
      fetchTradeLinks: async () => ({ links: [L("a1", "S1"), L("b1", "S1")], apts: APTS, latestSuccess: { finished_at: new Date().toISOString() } }),
    }));
    expect(mine(issues).map((i) => i.kind)).toEqual(["trade-links-sibling"]);
  });

  it("빈 표·없는 표면 침묵", async () => {
    for (const h of [{ links: [], apts: [], latestSuccess: null }, { missing: true, links: [], apts: [], latestSuccess: null }]) {
      const issues = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchTradeLinks: async () => h }));
      expect(mine(issues)).toEqual([]);
      expect(issues.filter((i) => i.kind === "check-failed")).toEqual([]);
    }
  });

  it("조회가 던지면 '⑰ 연결 표 점검 실행 실패' 1건", async () => {
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchTradeLinks: async () => { throw new Error("statement timeout"); } }));
    expect(issues.filter((i) => i.kind === "check-failed").map((i) => i.detail)).toEqual(["⑰ 연결 표 점검 실행 실패 — statement timeout"]);
  });
});
