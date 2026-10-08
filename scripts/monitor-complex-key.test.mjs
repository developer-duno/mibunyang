// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  checkComplexKeyGaps,
  checkComplexKeyRunStale,
  runDailyGuardedChecks,
  COMPLEX_KEY_GAP_HOURS,
  COMPLEX_KEY_GAP_FETCH_LIMIT,
} from "./monitor-collectors.mjs";

// 감시 ⑭ — 묶음 열쇠 칸(apartments.complex_key) 채우기 배치가 하루 넘게 안 돈 신호(세션588):
//   (a) 만든 지 오래된 행의 칸이 비어 있다  (b) 배치의 마지막 성공이 오래됐다(새 행이 없는 날에도 잡는다)

const NOW = new Date("2026-10-10T00:00:00Z");
/** @param {number} hoursAgo */
const at = (hoursAgo) => new Date(NOW.getTime() - hoursAgo * 3600000).toISOString();

describe("checkComplexKeyGaps — ⑭ (a) 묶음 열쇠 칸 빈 행", () => {
  it("빈 행이 없으면 이상 없음", () => {
    expect(checkComplexKeyGaps([], { now: NOW })).toEqual([]);
  });

  it(`만든 지 ${COMPLEX_KEY_GAP_HOURS}시간이 안 된 행은 세지 않는다(다음 굽기 전의 새 행은 빈칸이 정상)`, () => {
    const rows = [{ id: "ah-1", name: "새 단지", created_at: at(COMPLEX_KEY_GAP_HOURS - 1) }];
    expect(checkComplexKeyGaps(rows, { now: NOW })).toEqual([]);
  });

  it("오래된 빈 행이 있으면 stale 이슈 1건 — 가장 오래된 행부터 5곳까지 이름을 적는다", () => {
    const rows = [
      { id: "ah-new", name: "새 단지", created_at: at(2) },
      ...[7, 6, 5, 4, 3, 2].map((d) => ({ id: `ap-${d}`, name: `단지${d}`, created_at: at(d * 24) })),
    ];
    const issues = checkComplexKeyGaps(rows, { now: NOW });
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("stale");
    expect(issues[0].collector).toBe("assign-complex-keys");
    expect(issues[0].detail).toBe(`묶음 열쇠 칸이 빈 단지 6곳 — 만든 지 ${COMPLEX_KEY_GAP_HOURS}시간 넘음`);
    expect(issues[0].lines?.[1]).toBe("예: 단지7(ap-7), 단지6(ap-6), 단지5(ap-5), 단지4(ap-4), 단지3(ap-3) 외 1곳");
    expect(issues[0].at).toBe(at(7 * 24));
  });

  it("조회 상한까지 꽉 찼으면 '곳 이상'이라고 적는다", () => {
    const rows = Array.from({ length: COMPLEX_KEY_GAP_FETCH_LIMIT }, (_, i) => ({ id: `ap-${i}`, name: "x", created_at: at(100 + i) }));
    expect(checkComplexKeyGaps(rows, { now: NOW })[0].detail).toContain(`${COMPLEX_KEY_GAP_FETCH_LIMIT}곳 이상`);
  });

  it("created_at 이 비었거나 날짜가 아니면 세지 않는다(던지지 않는다)", () => {
    const rows = [{ id: "ah-1", name: "a", created_at: null }, { id: "ah-2", name: "b", created_at: "날짜아님" }, { id: "ah-3", name: "c" }];
    expect(checkComplexKeyGaps(rows, { now: NOW })).toEqual([]);
  });
});

describe("checkComplexKeyRunStale — ⑭ (b) 채우기 배치의 마지막 성공", () => {
  it(`마지막 성공이 ${COMPLEX_KEY_GAP_HOURS}시간 안이면 이상 없음`, () => {
    expect(checkComplexKeyRunStale({ finished_at: at(COMPLEX_KEY_GAP_HOURS - 1) }, { now: NOW })).toEqual([]);
    expect(checkComplexKeyRunStale({ finished_at: at(COMPLEX_KEY_GAP_HOURS) }, { now: NOW })).toEqual([]);
  });

  it("그보다 오래됐으면 stale 이슈 1건 — 몇 시간 전인지 적는다", () => {
    const issues = checkComplexKeyRunStale({ finished_at: at(50) }, { now: NOW });
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("stale");
    expect(issues[0].collector).toBe("assign-complex-keys");
    expect(issues[0].detail).toBe(`묶음 열쇠 채우기의 마지막 성공이 50시간 전(기준 ${COMPLEX_KEY_GAP_HOURS}시간)`);
    expect(issues[0].at).toBe(at(50));
  });

  it("성공 기록이 아예 없으면 '성공 기록이 없음'", () => {
    for (const none of [null, undefined, {}, { finished_at: null }, { finished_at: "날짜아님" }]) {
      const issues = checkComplexKeyRunStale(none, { now: NOW });
      expect(issues).toHaveLength(1);
      expect(issues[0].detail).toBe("묶음 열쇠 채우기의 성공 기록이 없음");
    }
  });
});

describe("runDailyGuardedChecks — ⑭ 가 매일 점검 묶음에 연결돼 있다", () => {
  const fresh = () => ({ finished_at: new Date().toISOString() });
  const quiet = {
    fetchGuPairs: async () => ({ aptPairs: [], regionRows: [] }),
    fetchCoordRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchTradeRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchRegionRuns: async () => ({}),
    fetchAhRows: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchFailureRuns: async () => /** @type {Array<Record<string, any>>} */ ([]),
    fetchKaptWindowRuns: async () => ({}), // ⑮(세션589) — 운영 조회로 새지 않게
    fetchTradeDeals: async () => ({ empty: true, rows: [], tradesCounts: {}, latest: "202609", prev: "202608" }), // ⑯(세션589) — 같은 이유
    fetchTradeLinks: async () => ({ links: [], apts: [], latestSuccess: null }), // ⑰(세션590) — 같은 이유
    fetchSgisMapRun: async () => [], // ⑱(세션614) — 같은 이유: 없으면 운영 조회로 새어 check-failed 가 하나 더 생긴다
    clearHoldAlertKeys: async (/** @type {string} */ _prefix) => {},
  };
  /** @param {any[]} issues */
  const mine = (issues) => issues.filter((i) => i.collector === "assign-complex-keys");

  it("빈 행 0 · 방금 성공이면 ⑭ 이슈 0건", async () => {
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchKeyHealth: async () => ({ gapRows: [], latestSuccess: fresh() }) }));
    expect(mine(issues)).toEqual([]);
  });

  it("오래된 빈 행을 주면 그 이슈가 결과에 실린다", async () => {
    const old = new Date(Date.now() - (COMPLEX_KEY_GAP_HOURS + 12) * 3600000).toISOString();
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchKeyHealth: async () => ({ gapRows: [{ id: "ah-1", name: "빈 단지", created_at: old }], latestSuccess: fresh() }) }));
    expect(mine(issues)).toHaveLength(1);
    expect(mine(issues)[0].detail).toContain("빈 단지 1곳");
  });

  it("빈 행이 없어도 마지막 성공이 오래됐으면 이슈가 실린다(새 행이 없는 날)", async () => {
    const old = new Date(Date.now() - (COMPLEX_KEY_GAP_HOURS + 12) * 3600000).toISOString();
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchKeyHealth: async () => ({ gapRows: [], latestSuccess: { finished_at: old } }) }));
    expect(mine(issues)).toHaveLength(1);
    expect(mine(issues)[0].detail).toContain("마지막 성공이");
  });

  it("조회가 던지면 '⑭ 묶음 열쇠 칸 점검 실행 실패' 1건(다른 점검은 계속)", async () => {
    const issues = await runDailyGuardedChecks(/** @type {any} */ ({ ...quiet, fetchKeyHealth: async () => { throw new Error("column apartments.complex_key does not exist"); } }));
    const failed = issues.filter((i) => i.kind === "check-failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].detail).toBe("⑭ 묶음 열쇠 칸 점검 실행 실패 — column apartments.complex_key does not exist");
  });
});

describe("fetchComplexKeyHealth — ⑭ 의 실제 조회 줄(위 시험은 조회를 주입해 이 줄을 안 지난다)", () => {
  // 세션589 검사관 A #6: 성공 조건(S1)·빈칸 조건(S3)·오래된 순 정렬(S4)을 빼도 초록이었다.
  // 함수 본문 전체를 지문(줄바꿈 LF · sha256)으로 못 박고, 무엇이 중요한지는 아래 글자 단언으로 남긴다.
  // 이 함수를 고쳤으면 변이 도구(mutate-monitor.mjs)를 다시 돌리고 지문을 갱신한다.
  const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "monitor-collectors.mjs"), "utf8").replace(/\r\n/g, "\n");
  const start = raw.indexOf("async function fetchComplexKeyHealth() {\n");
  const body = start < 0 ? "" : raw.slice(start, raw.indexOf("\n}\n", start) + 2);

  it("기준 시간 36시간 · 조회 상한 200 — 숫자 그대로(지문 함수 밖 상수라 따로 못 박는다 · 재검사 Z1)", () => {
    expect(COMPLEX_KEY_GAP_HOURS).toBe(36);
    expect(COMPLEX_KEY_GAP_FETCH_LIMIT).toBe(200);
  });

  it("본문 지문이 승인한 값과 같다", () => {
    expect(start).toBeGreaterThan(0);
    expect(createHash("sha256").update(body).digest("hex")).toBe("5b523174b36a3e4de5d60430a18a698b57bf8f190968cf4c2f1a5e2a78e2516a");
  });

  it("빈 칸 조회: 칸이 빈 행만 · 오래된 순 · 상한까지", () => {
    expect(body).toContain(
      ['    .is("complex_key", null)', '    .order("created_at", { ascending: true })', "    .limit(COMPLEX_KEY_GAP_FETCH_LIMIT);"].join("\n"),
    );
  });

  it("마지막 성공 조회: 이 배치의 success 기록만 · 최신 1건", () => {
    expect(body).toContain(
      ['    .eq("collector", "assign-complex-keys")', '    .eq("status", "success")', '    .order("finished_at", { ascending: false })', "    .limit(1);"].join("\n"),
    );
  });
});
