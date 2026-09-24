// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  runDailyGuardedChecks,
  runFailOpenCheck,
  checkFailedIssue,
  isAlwaysDedup,
  dedupScope,
  dedupKey as dedupKeyOf,
  HOLD_ALERT_KEY_PREFIX,
  HOLD_BASELINE_IDS,
  holdAlertResolved,
  checkApplyhomeUnsold,
} from "./monitor-collectors.mjs";
import { formatIssue } from "./notify-telegram.mjs";

// 감시 ⑦⑧⑨⑪⑫ 가 조회 실패 때 조용히 "이상 없음" 이 되던 구멍(세션569 최종 검사관 🔴1).
// 실패한 점검은 check-failed 이슈 1건으로 알리고, 다른 점검은 계속 돈다(fail-open).

const LABELS = {
  fetchGuPairs: "⑦ 시군구 짝 점검",
  fetchCoordRows: "⑨ 좌표 부정확 점검",
  fetchTradeRows: "⑧ 지역×월 거래 점검",
  fetchRegionRuns: "⑪ 시도 이름 못 맞춤 점검",
  fetchAhRows: "⑫ 청약홈 미분양 값 점검",
  fetchFailureRuns: "⑬ 로컬 수집기 실패 점검",
};

/** 전부 정상으로 도는 가짜 조회 — 판정 결과(이상)는 나올 수 있지만 실행 실패는 없다. */
function okDeps() {
  return {
    fetchGuPairs: async () => ({ aptPairs: [], regionRows: [] }),
    fetchCoordRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchTradeRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchRegionRuns: async () => ({}),
    // 만료된 청약홈 값 1곳 — ⑫ 가 실제로 돌았다는 표지(이상 1건이 나와야 한다)
    fetchAhRows: async () => [
      { id: "ah-x", name: "만료단지", unsold: 10, unsold_source: "applyhome", unsold_as_of: "2020-01-01", competition_shortfall: 3 },
    ],
    // 방금 끝난 차단기 실패 1행 — ⑬ 이 실제로 돌았다는 표지(이상 1건이 나와야 한다)
    fetchFailureRuns: async () => [
      { collector: "kosis-unsold", status: "failure", ok_count: 0, fail_count: 0, error_message: "차단기", finished_at: new Date().toISOString() },
    ],
    // 운영 monitor_alert_state 를 절대 지우지 않게 — 시험은 항상 가짜(세션572)
    clearHoldAlertKeys: async (/** @type {string} */ _prefix) => {},
  };
}

/** @param {any[]} issues */
const failed = (issues) => issues.filter((i) => i.kind === "check-failed");

describe("runDailyGuardedChecks — 점검 실행 실패는 알림 1건(세션569 🔴1)", () => {
  it("다섯 점검이 다 정상으로 돌면 실행 실패 이슈 0건", async () => {
    const issues = await runDailyGuardedChecks(okDeps());
    expect(failed(issues)).toEqual([]);
    expect(issues.some((i) => i.kind === "applyhome-unsold")).toBe(true); // ⑫ 가 실제로 돌았다
    expect(issues.some((i) => i.kind === "local-failure")).toBe(true); // ⑬ 이 실제로 돌았다(세션570)
  });

  for (const [dep, label] of Object.entries(LABELS)) {
    it(`${label} 조회가 throw → 실행 실패 이슈 1건 + "이상 없음" 경로(issues 0건) 미진입`, async () => {
      const deps = { ...okDeps(), [dep]: async () => { throw new Error(`boom-${dep}`); } };
      const issues = await runDailyGuardedChecks(/** @type {any} */ (deps));
      const f = failed(issues);
      expect(f).toHaveLength(1);
      expect(f[0].collector).toBe("monitor");
      expect(f[0].detail).toBe(`${label} 실행 실패 — boom-${dep}`);
      expect(issues.length).toBeGreaterThan(0); // main 은 issues.length === 0 일 때만 "이상 없음"
      // daily 하루 1회 리마인드 대상 — "항상 dedup" 이면 둘째 날부터 조용해진다
      expect(isAlwaysDedup(f[0])).toBe(false);
      expect(dedupScope(issues, "daily")).not.toContain(f[0]);
    });
  }

  it("한 점검이 실패해도 나머지는 계속 돈다 — ⑦ 실패여도 ⑫ 이상은 그대로 나온다", async () => {
    const deps = { ...okDeps(), fetchGuPairs: async () => { throw new Error("x"); } };
    const issues = await runDailyGuardedChecks(/** @type {any} */ (deps));
    expect(issues.some((i) => i.kind === "applyhome-unsold")).toBe(true);
  });

  it("여섯 다 실패하면 6건, 옛 main 순서(⑦ ⑨ ⑧ ⑪ ⑫) + ⑬(세션570) 그대로", async () => {
    const boom = async () => { throw new TypeError("column x does not exist"); };
    const issues = await runDailyGuardedChecks({
      fetchGuPairs: boom, fetchCoordRows: boom, fetchTradeRows: boom, fetchRegionRuns: boom, fetchAhRows: boom, fetchFailureRuns: boom,
    });
    expect(failed(issues).map((i) => i.detail.split(" 실행 실패")[0])).toEqual([
      "⑦ 시군구 짝 점검", "⑨ 좌표 부정확 점검", "⑧ 지역×월 거래 점검", "⑪ 시도 이름 못 맞춤 점검", "⑫ 청약홈 미분양 값 점검",
      "⑬ 로컬 수집기 실패 점검",
    ]);
  });
});

describe("runFailOpenCheck · checkFailedIssue", () => {
  it("정상이면 점검 결과를 그대로, 예외면 실행 실패 이슈 1건", async () => {
    const ok = [{ kind: /** @type {const} */ ("nulls"), collector: "c", detail: "d" }];
    expect(await runFailOpenCheck("L", async () => ok)).toBe(ok);
    const r = await runFailOpenCheck("L", async () => { throw "문자열 예외"; });
    expect(r).toEqual([checkFailedIssue("L", "문자열 예외")]);
    expect(r[0].detail).toBe("L 실행 실패 — 문자열 예외");
  });

  it("오류 메시지는 앞 120자만", () => {
    const i = checkFailedIssue("L", new Error("가".repeat(300)));
    expect(i.detail).toBe(`L 실행 실패 — ${"가".repeat(120)}`);
  });

  it("텔레그램 문구 — 제목·조치가 있고 undefined 가 없다", () => {
    const text = formatIssue(checkFailedIssue("⑫ 청약홈 미분양 값 점검", new Error("boom")));
    expect(text).toContain("🧯 <b>감시 점검 실행 실패</b>");
    expect(text).toContain("⑫ 청약홈 미분양 값 점검 실행 실패 — boom");
    expect(text).toContain("[조치]");
    expect(text).not.toContain("undefined");
  });
});

describe("main 배선 (소스)", () => {
  const src = readFileSync(fileURLToPath(new URL("./monitor-collectors.mjs", import.meta.url)), "utf8")
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");

  it("daily 스윕이 runDailyGuardedChecks 결과를 issues 에 싣는다", () => {
    expect(src).toMatch(/issues = issues\.concat\(await runDailyGuardedChecks\(\)\);/);
  });
});

// 감시 ⑫(d) 해소 날 hold 열쇠 삭제(세션572 — 세션571 검사관 🟡5: 한 번 울린 열쇠가 영원히 남아 재발이 침묵)
/** @param {string} id */
const holdRow = (id) => ({ id, name: `보류${id}`, unsold: null, unsold_source: "hold", unsold_as_of: "2026-09-24", competition_shortfall: null });

describe("⑫(d) 해소 시 hold 열쇠 삭제(세션572)", () => {
  /** @param {Array<Record<string, any>>} ahRows */
  function depsWith(ahRows) {
    /** @type {string[]} */
    const calls = [];
    const deps = {
      ...okDeps(),
      fetchAhRows: async () => ahRows,
      clearHoldAlertKeys: async (/** @type {string} */ prefix) => { calls.push(prefix); },
    };
    return { deps, calls };
  }

  it("① DB hold 명단 = 기준(13곳) → 삭제 1회, 인자 = HOLD_ALERT_KEY_PREFIX", async () => {
    const { deps, calls } = depsWith(HOLD_BASELINE_IDS.map(holdRow));
    const issues = await runDailyGuardedChecks(deps);
    expect(issues.some((i) => String(i.at ?? "").startsWith("hold:"))).toBe(false);
    expect(calls).toEqual([HOLD_ALERT_KEY_PREFIX]);
  });

  it("② DB 명단 ≠ 기준(12곳) → 삭제 0회 + (d) 이슈 1건", async () => {
    const { deps, calls } = depsWith(HOLD_BASELINE_IDS.slice(1).map(holdRow));
    const issues = await runDailyGuardedChecks(deps);
    expect(issues.filter((i) => String(i.at ?? "").startsWith("hold:"))).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it("③ ⑫ 조회가 throw → 삭제 0회 + check-failed 1건(hold 0 을 해소로 오독하지 않는다)", async () => {
    const { deps, calls } = depsWith([]);
    deps.fetchAhRows = async () => { throw new Error("boom-ah"); };
    const issues = await runDailyGuardedChecks(deps);
    expect(failed(issues)).toHaveLength(1);
    expect(failed(issues)[0].detail).toBe("⑫ 청약홈 미분양 값 점검 실행 실패 — boom-ah");
    expect(calls).toEqual([]);
  });

  it("④ holdAlertResolved — (d) 만 있으면 false · (a)(b)(c)(e) 만 있으면 true · 빈 배열 true", () => {
    const now = new Date("2026-10-08T21:00:00Z");
    const d = checkApplyhomeUnsold([holdRow("h-1")], { now, holdBaseline: ["h-2"] });
    expect(d.map((i) => String(i.at).split(":")[0])).toEqual(["hold"]);
    expect(holdAlertResolved(d)).toBe(false);
    const others = checkApplyhomeUnsold([
      { id: "ah-a", name: "a", unsold: 10, unsold_source: "applyhome", unsold_as_of: "2020-01-01", competition_shortfall: 3 },
      { id: "ah-b", name: "b", unsold: 10, unsold_source: "applyhome", unsold_as_of: null, competition_shortfall: 3 },
      { id: "ah-c", name: "c", unsold: 10, unsold_source: "applyhome", unsold_as_of: "2026-08-14", competition_shortfall: 0 },
      { ...holdRow("h-1"), unsold_as_of: "2025-01-01" },
    ], { now, holdBaseline: ["h-1"] });
    expect(others.map((i) => String(i.at).split(":")[0]).sort()).toEqual(["expired", "holdstale", "nodate", "soldout"]);
    expect(holdAlertResolved(others)).toBe(true);
    expect(holdAlertResolved([])).toBe(true);
  });

  it("HOLD_ALERT_KEY_PREFIX = dedupKey 형식의 (d) 접두, LIKE 와일드카드 없음", () => {
    expect(HOLD_ALERT_KEY_PREFIX).toBe("applyhome-unsold|unsold-applyhome|hold:");
    expect(HOLD_ALERT_KEY_PREFIX).not.toMatch(/[_%]/);
    const d = checkApplyhomeUnsold([holdRow("h-1")], { holdBaseline: ["h-2"] });
    expect(dedupKeyOf(d[0]).startsWith(HOLD_ALERT_KEY_PREFIX)).toBe(true);
  });
});
