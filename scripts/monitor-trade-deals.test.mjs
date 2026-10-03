// @ts-check
/**
 * 감시 ⑯ trade_deals 건전성 (세션589 — 시세 비교 범위 좁히기 가).
 * (a) 열쇠별 batch 둘 이상 명단 · (b) 화성 4코드 판정 달 매매 0행 · (c) trades 대비 비율 0.9~1.3 · 빈 표 침묵.
 * 판정은 개수가 아니라 **명단**(열쇠·코드)으로 본다 — 단언도 명단 그대로 적는다.
 */
import { describe, it, expect } from "vitest";
import {
  checkTradeDealsHealth, tradeDealsMonths, runDailyGuardedChecks,
  TRADE_DEALS_RATIO_MIN, TRADE_DEALS_RATIO_MAX,
} from "./monitor-collectors.mjs";
import { formatIssue } from "./notify-telegram.mjs";

const LATEST = "202609";
const PREV = "202608";
const OPTS = { latest: LATEST, prev: PREV };
const HW = ["41591", "41593", "41595", "41597"];

/**
 * 열쇠 하나에 n 행.
 * @param {string} sgg @param {string} month @param {string} type @param {string} batch @param {number} n
 * @param {string} [at]
 */
const rowsOf = (sgg, month, type, batch, n, at = "2026-10-06T05:40:00Z") =>
  Array.from({ length: n }, () => ({ sgg_cd: sgg, deal_month: month, trade_type: type, batch_id: batch, recorded_at: at }));

/** 화성 4코드 모두 판정 달 매매 10행 + 강남 매매 70행 = 110행 (같은 batch) */
const healthy = (month = LATEST) => [
  ...HW.flatMap((c) => rowsOf(c, month, "sale", "B1", 10)),
  ...rowsOf("11680", month, "sale", "B1", 70),
];

describe("tradeDealsMonths — 어제(KST) 기준 전월·그 앞 달", () => {
  it("2026-10-03 KST → 202609 · 202608", () => {
    expect(tradeDealsMonths(new Date("2026-10-03T03:00:00+09:00"))).toEqual({ latest: "202609", prev: "202608" });
  });
  it("2026-10-01 00:30 KST 는 어제가 9월 30일 → 202608 · 202607", () => {
    expect(tradeDealsMonths(new Date("2026-10-01T00:30:00+09:00"))).toEqual({ latest: "202608", prev: "202607" });
  });
  it("1월 → 전년 12월·11월로 넘어간다", () => {
    expect(tradeDealsMonths(new Date("2027-01-15T12:00:00+09:00"))).toEqual({ latest: "202612", prev: "202611" });
  });
});

describe("checkTradeDealsHealth — 빈 표 침묵", () => {
  it("empty=true 면 다른 재료가 이상해도 0건", () => {
    expect(checkTradeDealsHealth(rowsOf("41597", LATEST, "sale", "A", 1).concat(rowsOf("41597", LATEST, "sale", "B", 1)),
      { [LATEST]: 1000 }, { ...OPTS, empty: true })).toEqual([]);
  });
  it("표에 행은 있지만 두 달 다 없으면 (b)(c) 침묵", () => {
    expect(checkTradeDealsHealth([], { [LATEST]: 1000, [PREV]: 1000 }, OPTS)).toEqual([]);
  });
});

describe("checkTradeDealsHealth — (a) 중복 batch 명단", () => {
  it("양성: 두 열쇠에 batch 둘 → 그 두 열쇠 명단 그대로(정렬)", () => {
    const rows = [
      ...healthy(),
      ...rowsOf("41597", PREV, "sale", "OLD", 3, "2026-09-06T05:40:00Z"),
      ...rowsOf("41597", PREV, "sale", "NEW", 4, "2026-10-06T05:40:00Z"),
      ...rowsOf("11680", LATEST, "jeonse", "X", 1),
      ...rowsOf("11680", LATEST, "jeonse", "Y", 1),
    ];
    const dup = checkTradeDealsHealth(rows, { [LATEST]: 110 }, OPTS).filter((i) => i.kind === "trade-deals-dup");
    expect(dup.map((i) => i.detail)).toEqual(["11680|202609|jeonse batch 2개", "41597|202608|sale batch 2개"]);
    expect(dup[1]).toMatchObject({ collector: "trade_deals", at: "2026-10-06T05:40:00Z" });
  });
  it("음성: 열쇠마다 batch 하나면 0건", () => {
    expect(checkTradeDealsHealth(healthy(), { [LATEST]: 110 }, OPTS).filter((i) => i.kind === "trade-deals-dup")).toEqual([]);
  });
  it("열쇠가 10개 넘으면 10건 + '외 N개' 1건", () => {
    const rows = [...healthy()];
    for (let i = 0; i < 12; i++) {
      const c = String(11000 + i);
      rows.push(...rowsOf(c, LATEST, "presale", "A", 1), ...rowsOf(c, LATEST, "presale", "B", 1));
    }
    const dup = checkTradeDealsHealth(rows, { [LATEST]: 134 }, OPTS).filter((i) => i.kind === "trade-deals-dup");
    expect(dup).toHaveLength(11);
    expect(dup[10].detail).toBe("외 2개 열쇠도 batch 둘 이상");
  });
});

describe("checkTradeDealsHealth — (b) 화성 4코드", () => {
  it("양성: 41593·41595 가 판정 달 매매 0행 → 어느 코드인지 명단", () => {
    const rows = [...rowsOf("41591", LATEST, "sale", "B1", 10), ...rowsOf("41597", LATEST, "sale", "B1", 10), ...rowsOf("41593", LATEST, "jeonse", "B1", 5),
      ...rowsOf("11680", LATEST, "sale", "B1", 75)];
    const hw = checkTradeDealsHealth(rows, { [LATEST]: 100 }, OPTS).filter((i) => i.kind === "trade-deals-hwaseong");
    expect(hw).toHaveLength(1);
    expect(hw[0].detail).toBe("화성 41593,41595 202609 매매 0행");
    expect(hw[0].lines?.[1]).toBe("각 코드 행 수: 41591=10 · 41593=0 · 41595=0 · 41597=10");
  });
  it("음성: 4코드 모두 > 0 이면 0건", () => {
    expect(checkTradeDealsHealth(healthy(), { [LATEST]: 110 }, OPTS).filter((i) => i.kind === "trade-deals-hwaseong")).toEqual([]);
  });
  it("최근 달이 아직 수집 전(행 0)이면 그 앞 달로 판정 — 매달 1~6일 거짓 경보 차단", () => {
    const issues = checkTradeDealsHealth(healthy(PREV), { [LATEST]: 0, [PREV]: 110 }, OPTS);
    expect(issues).toEqual([]);
  });
});

describe("checkTradeDealsHealth — (c) trades 대비 비율", () => {
  it(`경계 리터럴: 기준 = ${TRADE_DEALS_RATIO_MIN}~${TRADE_DEALS_RATIO_MAX}`, () => {
    expect([TRADE_DEALS_RATIO_MIN, TRADE_DEALS_RATIO_MAX]).toEqual([0.9, 1.3]);
  });
  it("음성: 110 ÷ 100 = 1.10 → 0건 · 경계 정확히 0.9·1.3 도 0건", () => {
    const ratio = (/** @type {number} */ t) => checkTradeDealsHealth(healthy(), { [LATEST]: t }, OPTS).filter((i) => i.kind === "trade-deals-ratio");
    expect(ratio(100)).toEqual([]);
    expect(ratio(110 / 0.9)).toEqual([]);
    expect(ratio(110 / 1.3)).toEqual([]);
  });
  it("양성: 110 ÷ 130 = 0.85 → 두 수 모두 적는다", () => {
    const r = checkTradeDealsHealth(healthy(), { [LATEST]: 130 }, OPTS).filter((i) => i.kind === "trade-deals-ratio");
    expect(r.map((i) => i.detail)).toEqual(["202609 trade_deals 110행 ÷ trades 130행 = 0.85 (기준 0.9~1.3)"]);
  });
  it("양성: 110 ÷ 80 = 1.38 → 경보", () => {
    const r = checkTradeDealsHealth(healthy(), { [LATEST]: 80 }, OPTS).filter((i) => i.kind === "trade-deals-ratio");
    expect(r.map((i) => i.detail)).toEqual(["202609 trade_deals 110행 ÷ trades 80행 = 1.38 (기준 0.9~1.3)"]);
  });
  it("trades 0행인데 trade_deals 있음 → ∞ 경보", () => {
    const r = checkTradeDealsHealth(healthy(), { [LATEST]: 0 }, OPTS).filter((i) => i.kind === "trade-deals-ratio");
    expect(r).toHaveLength(1);
    expect(r[0].detail).toContain("= ∞");
  });
  it("죽은 회차 흔적은 비율에 안 넣는다 — 열쇠마다 가장 새 batch 만 센다", () => {
    const rows = [...healthy(), ...rowsOf("11680", LATEST, "sale", "OLD", 70, "2026-09-06T05:40:00Z")];
    const r = checkTradeDealsHealth(rows, { [LATEST]: 100 }, OPTS).filter((i) => i.kind === "trade-deals-ratio");
    expect(r).toEqual([]); // 110 ÷ 100 — OLD 70 을 더하면 1.8 로 울렸을 것
  });
});

describe("텔레그램 문구 — 세 종류 모두 제목·조치가 있고 undefined 가 없다", () => {
  it("dup · hwaseong · ratio", () => {
    const rows = [...rowsOf("41591", LATEST, "sale", "A", 1), ...rowsOf("41591", LATEST, "sale", "B", 1)];
    const issues = checkTradeDealsHealth(rows, { [LATEST]: 100 }, OPTS);
    expect(new Set(issues.map((i) => i.kind))).toEqual(new Set(["trade-deals-dup", "trade-deals-hwaseong", "trade-deals-ratio"]));
    for (const i of issues) {
      const text = formatIssue(i);
      expect(text).toContain("🧾 <b>");
      expect(text).toContain("[조치]");
      expect(text).not.toContain("undefined");
    }
  });
});

describe("runDailyGuardedChecks — ⑯ 가 매일 점검 묶음에 연결돼 있다", () => {
  const quiet = {
    fetchGuPairs: async () => ({ aptPairs: [], regionRows: [] }),
    fetchCoordRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchTradeRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchRegionRuns: async () => ({}),
    fetchAhRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchFailureRuns: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchKeyHealth: async () => ({ gapRows: /** @type {Array<Record<string, any>>} */ ([]), latestSuccess: { finished_at: new Date().toISOString() } }),
    fetchKaptWindowRuns: async () => ({}),
    clearHoldAlertKeys: async (/** @type {string} */ _prefix) => {},
  };
  /** @param {any[]} issues */
  const mine = (issues) => issues.filter((i) => i.collector === "trade_deals");

  it("조회 결과의 이상이 이슈로 실린다", async () => {
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({
      ...quiet,
      fetchTradeDeals: async () => ({ empty: false, rows: healthy(), tradesCounts: { [LATEST]: 130, [PREV]: null }, latest: LATEST, prev: PREV }),
    }));
    expect(mine(issues).map((i) => i.kind)).toEqual(["trade-deals-ratio"]);
  });

  it("빈 표면 침묵", async () => {
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({
      ...quiet,
      fetchTradeDeals: async () => ({ empty: true, rows: [], tradesCounts: {}, latest: LATEST, prev: PREV }),
    }));
    expect(mine(issues)).toEqual([]);
  });

  it("조회가 던지면 '⑯ trade_deals 점검 실행 실패' 1건", async () => {
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchTradeDeals: async () => { throw new Error("relation trade_deals does not exist"); } }));
    const failed = issues.filter((i) => i.kind === "check-failed");
    expect(failed.map((i) => i.detail)).toEqual(["⑯ trade_deals 점검 실행 실패 — relation trade_deals does not exist"]);
  });
});
