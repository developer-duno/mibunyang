// @ts-check
/**
 * 감시 ⑯ trade_deals 건전성 (세션589 — 시세 비교 범위 좁히기 가).
 * (a) 열쇠별 batch 둘 이상 명단(완성 여부) · (b) 화성 4코드 판정 달 매매 0행 · (c) trades 대비 비율 0.9~1.3 ·
 * 빈 표·없는 표 침묵 · 수집 회차 진행 중이면 (b)(c) 보류. batch 완성 = 행 수 = batch_rows.
 * 판정은 개수가 아니라 **명단**(열쇠·코드)으로 본다 — 단언도 명단 그대로 적는다.
 */
import { describe, it, expect } from "vitest";
import {
  checkTradeDealsHealth, tradeDealsMonths, fetchTradeDealsHealth, runDailyGuardedChecks,
  TRADE_DEALS_RATIO_MIN, TRADE_DEALS_RATIO_MAX,
} from "./monitor-collectors.mjs";
import { formatIssue } from "./notify-telegram.mjs";
import { fakeSb } from "./collectors/__fixtures__/trade-deals/fake-sb.mjs";

const LATEST = "202609";
const PREV = "202608";
/** 수집 회차는 05:40 행 뒤 06:00 에 끝났다 — 진행 중 아님 */
const OPTS = { latest: LATEST, prev: PREV, lastRunFinishedAt: "2026-10-06T06:00:00.000Z", now: new Date("2026-10-06T07:00:00.000Z") };
const HW = ["41591", "41593", "41595", "41597"];

/**
 * 열쇠 하나에 n 행(기본 완성 — batch_rows = n).
 * @param {string} sgg @param {string} month @param {string} type @param {string} batch @param {number} n
 * @param {string} [at] @param {number} [want]
 */
const rowsOf = (sgg, month, type, batch, n, at = "2026-10-06T05:40:00.000Z", want = n) =>
  Array.from({ length: n }, () => ({ sgg_cd: sgg, deal_month: month, trade_type: type, batch_id: batch, batch_rows: want, recorded_at: at }));

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
  it("KST +9 경계: 10/02 01:00 KST(UTC 로는 10/01 16:00) → 어제는 KST 10/01 → 202609", () => {
    expect(tradeDealsMonths(new Date("2026-10-02T01:00:00+09:00"))).toEqual({ latest: "202609", prev: "202608" });
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
  it("양성: 두 열쇠에 batch 둘 → 그 두 열쇠 명단 그대로(정렬) · 완성/미완성을 적는다", () => {
    const rows = [
      ...healthy(),
      ...rowsOf("41597", PREV, "sale", "OLDBATCH", 3, "2026-09-06T05:40:00.000Z"),
      ...rowsOf("41597", PREV, "sale", "NEWBATCH", 4, "2026-10-06T05:40:00.000Z", 9),
      ...rowsOf("11680", LATEST, "jeonse", "XBATCHXX", 1),
      ...rowsOf("11680", LATEST, "jeonse", "YBATCHYY", 1),
    ];
    const dup = checkTradeDealsHealth(rows, { [LATEST]: 110 }, OPTS).filter((i) => i.kind === "trade-deals-dup");
    expect(dup.map((i) => i.detail)).toEqual(["11680|202609|jeonse batch 2개", "41597|202608|sale batch 2개"]);
    expect(dup[1]).toMatchObject({ collector: "trade_deals", at: "2026-10-06T05:40:00.000Z" });
    expect(dup[1].lines?.[0]).toBe("batch 별 행 수: OLDBATCH…=3/3(완성) · NEWBATCH…=4/9(미완성)");
  });
  it("완성 batch 가 하나도 없으면 그 사실을 적는다(화면 정상이라고 단정하지 않는다)", () => {
    const rows = [...healthy(), ...rowsOf("41597", PREV, "sale", "P1", 2, undefined, 5), ...rowsOf("41597", PREV, "sale", "P2", 1, undefined, 5)];
    const dup = checkTradeDealsHealth(rows, { [LATEST]: 110 }, OPTS).filter((i) => i.kind === "trade-deals-dup");
    expect(dup[0].lines?.[1]).toMatch(/완성 batch 가 하나도 없습니다/);
    expect(dup.map((i) => i.lines?.join(" ")).join(" ")).not.toMatch(/화면은 정상/);
  });
  it("음성: 열쇠마다 batch 하나면 0건", () => {
    expect(checkTradeDealsHealth(healthy(), { [LATEST]: 110 }, OPTS).filter((i) => i.kind === "trade-deals-dup")).toEqual([]);
  });
  it("미완성 batch 하나만 남은 열쇠도 명단에 오른다 — 읽는 쪽엔 빈 열쇠(검사관 B 지적 2)", () => {
    const rows = [...healthy(), ...rowsOf("41597", PREV, "jeonse", "HALFHALF", 3, undefined, 8)];
    const dup = checkTradeDealsHealth(rows, { [LATEST]: 110 }, OPTS).filter((i) => i.kind === "trade-deals-dup");
    expect(dup.map((i) => i.detail)).toEqual(["41597|202608|jeonse batch 1개"]);
    expect(dup[0].lines?.[1]).toMatch(/완성 batch 가 하나도 없습니다/);
  });
  it("완성 batch 하나뿐인 열쇠·행이 아예 없는 열쇠는 명단에 없다(미완성 1개와 구분)", () => {
    const rows = [...healthy(), ...rowsOf("41597", PREV, "jeonse", "FULLFULL", 8)]; // 41597|202608|presale 은 행 0 — 열쇠 자체가 없다
    const dup = checkTradeDealsHealth(rows, { [LATEST]: 110 }, OPTS).filter((i) => i.kind === "trade-deals-dup");
    expect(dup).toEqual([]);
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
  it("미완성 batch 만 있는 코드는 0행으로 본다(읽는 쪽과 같은 규칙)", () => {
    const rows = [...healthy().filter((r) => r.sgg_cd !== "41595"), ...rowsOf("41595", LATEST, "sale", "B1", 3, undefined, 10)];
    const hw = checkTradeDealsHealth(rows, { [LATEST]: 100 }, OPTS).filter((i) => i.kind === "trade-deals-hwaseong");
    expect(hw.map((i) => i.detail)).toEqual(["화성 41595 202609 매매 0행"]);
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
  it("회차가 끝났는데 trades 0행·trade_deals 있음 → ∞ 경보(진짜 어긋남)", () => {
    const r = checkTradeDealsHealth(healthy(), { [LATEST]: 0 }, OPTS).filter((i) => i.kind === "trade-deals-ratio");
    expect(r).toHaveLength(1);
    expect(r[0].detail).toContain("= ∞");
  });
  it("지난 회차 흔적(옛 완성·미완성)은 비율에 안 넣는다 — 열쇠마다 가장 새 완성 batch 만", () => {
    const rows = [...healthy(), ...rowsOf("11680", LATEST, "sale", "OLD", 70, "2026-09-06T05:40:00.000Z"),
      ...rowsOf("11680", LATEST, "sale", "HALF", 30, "2026-10-06T05:50:00.000Z", 80)];
    const r = checkTradeDealsHealth(rows, { [LATEST]: 100 }, { ...OPTS, lastRunFinishedAt: "2026-10-06T06:00:00.000Z" })
      .filter((i) => i.kind === "trade-deals-ratio");
    expect(r).toEqual([]); // 110 ÷ 100 — OLD 70·HALF 30 을 더하면 2.1 로 울렸을 것
  });
});

describe("checkTradeDealsHealth — 수집 회차 진행 중이면 (b)(c) 보류(검사관 C4)", () => {
  it("새 표 최신 행이 마지막 회차 끝보다 늦으면 ∞·화성 0행이어도 침묵 — (a) 는 그대로", () => {
    const rows = [...rowsOf("11680", LATEST, "sale", "B1", 70, "2026-10-06T05:50:00.000Z"),
      ...rowsOf("11680", LATEST, "jeonse", "X", 1, "2026-10-06T05:50:00.000Z"), ...rowsOf("11680", LATEST, "jeonse", "Y", 1, "2026-10-06T05:50:00.000Z")];
    const issues = checkTradeDealsHealth(rows, { [LATEST]: 0 }, { ...OPTS, lastRunFinishedAt: "2026-09-06T06:00:00.000Z" });
    expect(issues.map((i) => i.kind)).toEqual(["trade-deals-dup"]);
  });
  it("수집기 기록이 아예 없어도 180분 안이면 진행 중으로 본다", () => {
    const issues = checkTradeDealsHealth(healthy(), { [LATEST]: 0 }, { ...OPTS, lastRunFinishedAt: null });
    expect(issues).toEqual([]);
  });
  it("180분(예산 150 + 30)이 넘도록 끝 기록이 없으면 판정하고 '기록 없이 끝난 회차' 1건(검사관 B 지적 3)", () => {
    const opts = { ...OPTS, lastRunFinishedAt: "2026-09-06T06:00:00.000Z", now: new Date("2026-10-06T08:41:00.000Z") }; // 최신 05:40 + 181분
    const issues = checkTradeDealsHealth(healthy(), { [LATEST]: 0 }, opts);
    expect(issues.map((i) => i.kind)).toEqual(["trade-deals-norun", "trade-deals-ratio"]);
    expect(issues[0].detail).toContain("2026-10-06T05:40:00.000Z");
    // 179분이면 아직 보류
    expect(checkTradeDealsHealth(healthy(), { [LATEST]: 0 }, { ...opts, now: new Date("2026-10-06T08:39:00.000Z") })).toEqual([]);
  });
  it("PC 시계가 40초 빨라 최신 기록이 회차 끝보다 늦게 찍혀도(여유 2분) 끝난 회차로 판정한다", () => {
    const rows = healthy().map((r) => ({ ...r, recorded_at: "2026-10-06T06:00:40.000Z" }));
    const issues = checkTradeDealsHealth(rows, { [LATEST]: 0 }, { ...OPTS, lastRunFinishedAt: "2026-10-06T06:00:00.000Z", now: new Date("2026-10-06T06:01:00.000Z") });
    expect(issues.map((i) => i.kind)).toEqual(["trade-deals-ratio"]);
  });
});

describe("fetchTradeDealsHealth — 표 없음 침묵 · 달마다 나눠 읽기", () => {
  it("표가 없으면(PGRST205) missing·empty 로 돌려준다 → 판정 0건(검사관 A6)", async () => {
    const h = await fetchTradeDealsHealth(fakeSb([], { missingTable: true }), new Date("2026-10-03T03:00:00+09:00"));
    expect(h).toMatchObject({ empty: true, missing: true, latest: "202609", prev: "202608" });
    expect(checkTradeDealsHealth(h.rows, h.tradesCounts, { ...h })).toEqual([]);
  });

  it("두 달을 deal_month = 한 달씩 읽고 trades 행 수·마지막 회차 끝을 같이 가져온다(검사관 C5)", async () => {
    const seed = [...healthy(LATEST), ...healthy(PREV), ...rowsOf("11680", "202607", "sale", "B0", 5)];
    const sb = fakeSb(seed, {
      extra: {
        trades: [...Array.from({ length: 100 }, () => ({ deal_month: LATEST })), ...Array.from({ length: 90 }, () => ({ deal_month: PREV }))],
        collector_runs: [{ collector: "trades", finished_at: "2026-10-06T06:00:00.000Z" }, { collector: "trades", finished_at: "2026-09-06T06:00:00.000Z" }],
      },
    });
    const h = await fetchTradeDealsHealth(sb, new Date("2026-10-07T03:00:00+09:00"));
    expect(h.rows).toHaveLength(220);
    expect(h.tradesCounts).toEqual({ [LATEST]: 100, [PREV]: 90 });
    expect(h.lastRunFinishedAt).toBe("2026-10-06T06:00:00.000Z");
    const dealReads = sb.state.selectFilters.filter((f) => f.table === "trade_deals" && f.eq.deal_month);
    expect([...new Set(dealReads.map((f) => f.eq.deal_month))]).toEqual([LATEST, PREV]);
    expect(checkTradeDealsHealth(h.rows, h.tradesCounts, { ...h })).toEqual([]);
  });
});

describe("텔레그램 문구 — 세 종류 모두 제목·조치가 있고 undefined 가 없다", () => {
  it("dup · hwaseong · ratio", () => {
    const rows = [...rowsOf("41591", LATEST, "sale", "A", 1), ...rowsOf("41591", LATEST, "sale", "B", 1)];
    const issues = checkTradeDealsHealth(rows, { [LATEST]: 100 }, OPTS);
    expect(new Set(issues.map((i) => i.kind))).toEqual(new Set(["trade-deals-dup", "trade-deals-hwaseong", "trade-deals-ratio"]));
    const norun = checkTradeDealsHealth(healthy(), { [LATEST]: 110 }, { ...OPTS, lastRunFinishedAt: null, now: new Date("2026-10-07T00:00:00.000Z") });
    expect(norun.map((i) => i.kind)).toEqual(["trade-deals-norun"]);
    for (const i of [...issues, ...norun]) {
      const text = formatIssue(i);
      expect(text).toContain("🧾 <b>");
      expect(text).toContain("[조치]");
      expect(text).not.toContain("undefined");
      expect(text).not.toContain("화면은 정상");
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
      fetchTradeDeals: async () => ({ empty: false, rows: healthy(), tradesCounts: { [LATEST]: 130, [PREV]: null }, latest: LATEST, prev: PREV, lastRunFinishedAt: OPTS.lastRunFinishedAt }),
    }));
    expect(mine(issues).map((i) => i.kind)).toEqual(["trade-deals-ratio"]);
  });

  it("빈 표·없는 표면 침묵", async () => {
    for (const extra of [{}, { missing: true }]) {
      const issues = await runDailyGuardedChecks(/** @type {any} */ ({
        ...quiet,
        fetchTradeDeals: async () => ({ empty: true, ...extra, rows: [], tradesCounts: {}, latest: LATEST, prev: PREV }),
      }));
      expect(mine(issues)).toEqual([]);
      expect(issues.filter((i) => i.kind === "check-failed")).toEqual([]);
    }
  });

  it("조회가 던지면 '⑯ trade_deals 점검 실행 실패' 1건", async () => {
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchTradeDeals: async () => { throw new Error("statement timeout"); } }));
    const failed = issues.filter((i) => i.kind === "check-failed");
    expect(failed.map((i) => i.detail)).toEqual(["⑯ trade_deals 점검 실행 실패 — statement timeout"]);
  });
});
