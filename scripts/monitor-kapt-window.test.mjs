// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  checkKaptWindowSkips,
  KAPT_WINDOW_COLLECTORS,
  KAPT_WINDOW_MARKER,
  ALWAYS_DEDUP_KINDS,
  isAlwaysDedup,
  dedupKey,
  runDailyGuardedChecks,
} from "./monitor-collectors.mjs";
import { formatIssue } from "./notify-telegram.mjs";

// 감시 ⑮ 2u K-apt 창 건너뜀(세션589 보완 B2 — 검사 C3). 창 때문에 건너뛴 회차는 status=success · skip=N 이라
// ②·⑤-a·⑤-b 가 모두 침묵했다(data-changing-run-approval.md §4 가 경고한 꼴). 수집기가 남기는 머리말
// SIBLING_KAPT_WINDOW 를 읽는다 — molit-units 는 최근 2회가 모두 건너뜀, 관리비·건물정보는 최근 회차가 멈췄으면.

const WIN = "SIBLING_KAPT_WINDOW 2u K-apt 창(KST 06:20~08:25·12:40~15:15·21:00~23:30·매월 21일 14:50~21:00)이라 건너뜀 — 대상 31건 다음 회차로";
/** @param {string | null} msg @param {string} at */
const run = (msg, at, status = "success") => ({ status, error_message: msg, finished_at: at });

describe("KAPT_WINDOW_COLLECTORS — 수집기 이름은 각 파일의 PHASE 상수 그대로", () => {
  const phaseOf = (/** @type {string} */ file) => {
    const src = readFileSync(fileURLToPath(new URL(`./collectors/${file}`, import.meta.url)), "utf8");
    return /^const PHASE = "([^"]+)";/m.exec(src)?.[1];
  };
  it("molit-units · molit-building · maintenance", () => {
    expect(KAPT_WINDOW_COLLECTORS.map((c) => c.collector)).toEqual([
      phaseOf("molit-units.mjs"), phaseOf("molit-building-info.mjs"), phaseOf("collect-maintenance.mjs"),
    ]);
    expect(KAPT_WINDOW_COLLECTORS.map((c) => c.collector)).toEqual(["molit-units", "molit-building", "maintenance"]);
  });
  it("molit-units 는 최근 2회 · 관리비·건물정보는 최근 1회", () => {
    expect(KAPT_WINDOW_COLLECTORS.map((c) => c.consecutive)).toEqual([2, 1, 1]);
  });
  it("머리말은 수집기가 남기는 글자와 같다", () => {
    expect(KAPT_WINDOW_MARKER).toBe("SIBLING_KAPT_WINDOW");
    for (const f of ["molit-units.mjs", "molit-building-info.mjs", "collect-maintenance.mjs"]) {
      const src = readFileSync(fileURLToPath(new URL(`./collectors/${f}`, import.meta.url)), "utf8");
      expect(src).toContain("`SIBLING_KAPT_WINDOW 2u K-apt 창(KST ${siblingKaptWindowText()})");
    }
  });
});

describe("checkKaptWindowSkips — 판정", () => {
  it("molit-units 최근 2회가 모두 창 건너뜀 → 1건(at = 최근 실행)", () => {
    const issues = checkKaptWindowSkips({ "molit-units": [run(WIN, "2026-10-09T05:00:00Z"), run(WIN, "2026-10-06T00:00:00Z"), run(null, "2026-10-02T00:00:00Z")] });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "kapt-window", collector: "molit-units", at: "2026-10-09T05:00:00Z" });
    expect(issues[0].detail).toContain("최근 2회");
  });

  it("molit-units 최근 1회만 건너뜀 → 0건(한 번은 다음 회차가 메운다)", () => {
    expect(checkKaptWindowSkips({ "molit-units": [run(WIN, "2026-10-09T05:00:00Z"), run(null, "2026-10-06T00:00:00Z")] })).toEqual([]);
    expect(checkKaptWindowSkips({ "molit-units": [run(WIN, "2026-10-09T05:00:00Z")] })).toEqual([]); // 기록이 1회뿐
  });

  it("molit-units 앞이 정상이고 그 전 2회가 건너뜀 → 0건(최근만 본다)", () => {
    expect(checkKaptWindowSkips({ "molit-units": [run(null, "2026-10-12T00:00:00Z"), run(WIN, "2026-10-09T05:00:00Z"), run(WIN, "2026-10-06T00:00:00Z")] })).toEqual([]);
  });

  it("관리비·건물정보는 최근 회차가 창 때문에 멈췄으면 1건씩", () => {
    const stop = "SIBLING_KAPT_WINDOW 2u K-apt 창(KST …) 또는 시작 5분 전이라 멈춤 — 남은 120곳 다음 회차";
    const issues = checkKaptWindowSkips({
      maintenance: [run(stop, "2026-10-16T21:16:00Z")],
      "molit-building": [run(stop, "2026-10-10T21:40:00Z", "failure")],
    });
    expect(issues.map((i) => i.collector).sort()).toEqual(["maintenance", "molit-building"]);
    expect(issues.find((i) => i.collector === "maintenance")?.detail).toContain("멈춤");
  });

  it("다른 오류 문구(KAPT_RESULT_04 등)·빈 문구는 이 점검이 아니다", () => {
    expect(checkKaptWindowSkips({
      maintenance: [run("KAPT_RESULT_04 getHsmpHeatCostInfoV3", "2026-10-16T00:00:00Z", "failure")],
      "molit-units": [run(null, "2026-10-09T00:00:00Z"), run("x SIBLING_KAPT_WINDOW", "2026-10-06T00:00:00Z")],
    })).toEqual([]);
  });

  it("기록이 없는 수집기는 조용히 넘어간다", () => {
    expect(checkKaptWindowSkips({})).toEqual([]);
  });

  it("항상 dedup — 같은 실행은 한 번만, 다음 회차가 또 건너뛰면 다시 알린다", () => {
    expect(ALWAYS_DEDUP_KINDS.has("kapt-window")).toBe(true);
    const a = checkKaptWindowSkips({ maintenance: [run(WIN, "2026-10-16T00:00:00Z")] })[0];
    const b = checkKaptWindowSkips({ maintenance: [run(WIN, "2026-10-17T00:00:00Z")] })[0];
    expect(isAlwaysDedup(a)).toBe(true);
    expect(dedupKey(a)).not.toBe(dedupKey(b));
  });

  it("텔레그램 문구 — 제목·조치가 있고 undefined 가 없다", () => {
    const text = formatIssue(checkKaptWindowSkips({ maintenance: [run(WIN, "2026-10-16T00:00:00Z")] })[0]);
    expect(text).toContain("⏸️ <b>2u K-apt 창 때문에 건너뜀</b>");
    expect(text).toContain("[조치]");
    expect(text).not.toContain("undefined");
  });
});

describe("runDailyGuardedChecks — ⑮ 가 매일 점검 묶음에 연결돼 있다", () => {
  const quiet = {
    fetchGuPairs: async () => ({ aptPairs: [], regionRows: [] }),
    fetchCoordRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchTradeRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchRegionRuns: async () => ({}),
    fetchAhRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchFailureRuns: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchKeyHealth: async () => ({ gapRows: /** @type {Array<Record<string, any>>} */ ([]), latestSuccess: { finished_at: new Date().toISOString() } }),
    fetchTradeDeals: async () => ({ empty: true, rows: [], tradesCounts: {}, latest: "202609", prev: "202608" }), // ⑯(세션589) — 운영 조회로 새지 않게
    fetchTradeLinks: async () => ({ links: [], apts: [], latestSuccess: null }), // ⑰(세션590) — 같은 이유
    fetchSgisMapRun: async () => [], // ⑱(세션614) — 같은 이유: 없으면 운영 조회로 새어 check-failed 가 하나 더 생긴다
    clearHoldAlertKeys: async (/** @type {string} */ _prefix) => {},
  };

  it("조회 결과의 창 건너뜀이 이슈로 실리고, 조회에 세 수집기 이름을 넘긴다", async () => {
    /** @type {string[][]} */
    const asked = [];
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({
      ...quiet,
      fetchKaptWindowRuns: async (/** @type {readonly string[]} */ names) => { asked.push([...names]); return { maintenance: [run(WIN, "2026-10-16T00:00:00Z")] }; },
    }));
    expect(asked).toEqual([["molit-units", "molit-building", "maintenance"]]);
    expect(issues.filter((i) => i.kind === "kapt-window")).toHaveLength(1);
  });

  it("조회가 던지면 '⑮ 2u 창 건너뜀 점검 실행 실패' 1건(다른 점검은 계속)", async () => {
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchKaptWindowRuns: async () => { throw new Error("boom"); } }));
    const failed = issues.filter((i) => i.kind === "check-failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].detail).toBe("⑮ 2u 창 건너뜀 점검 실행 실패 — boom");
  });
});
