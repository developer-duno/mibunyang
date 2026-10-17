// @ts-check
/**
 * 감시 ㉒ checkPriceHistoryFloors 시험 — complex_price_history 의 "지우면 안 되는 줄" 바닥(세션648).
 *
 * 왜: 2u 정부 줄 정리(#741)는 `A1 AND area_no='' AND base_month 6글자` 줄만 지운다. 그 밖의 줄(A 8글자 옛 줄 ·
 *   B 6글자 A1 area_no 있음)은 미분양 쪽이 더하기만 해 줄어들 일이 없다 — 줄면 오삭제. 2u 의 매주·매일 삭제는
 *   collector_runs 에 안 남아 다른 점검이 못 본다.
 */
import { describe, it, expect } from "vitest";
import {
  checkPriceHistoryFloors, applyPriceHistorySlice, PRICE_HISTORY_FLOORS, PRICE_HISTORY_FLOOR_FROZEN, PRICE_HISTORY_TABLE, isAlwaysDedup,
} from "./monitor-collectors.mjs";
import { formatIssue } from "./notify-telegram.mjs";

const B_OK = { count: 129 };

describe("㉒ 바닥 상수", () => {
  it("A ≥ 163,140 · B ≥ 129 · 동결일 20261017(세션648 실측)", () => {
    expect(PRICE_HISTORY_FLOORS.map((f) => [f.key, f.floor])).toEqual([["A", 163140], ["B", 129]]);
    expect(PRICE_HISTORY_FLOOR_FROZEN).toBe("20261017");
    expect(PRICE_HISTORY_TABLE).toBe("complex_price_history");
  });
});

describe("㉒ checkPriceHistoryFloors — 조각 A", () => {
  it("A=163,139 → 경보 1건(차이 1)", () => {
    const issues = checkPriceHistoryFloors({ A: { count: 163139 }, B: B_OK });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "price-history-floor", collector: "complex_price_history" });
    expect(issues[0].detail).toBe("A 네이버 옛 줄 163,139 < 바닥 163,140 (−1)");
  });
  it("A=163,140(바닥 그대로) → 0", () => {
    expect(checkPriceHistoryFloors({ A: { count: 163140 }, B: B_OK })).toEqual([]);
  });
  it("A=170,000(늘어남) → 0", () => {
    expect(checkPriceHistoryFloors({ A: { count: 170000 }, B: B_OK })).toEqual([]);
  });
  it("A=null → 조회 실패(check-failed) 1건 — 못 셌는데 침묵하지 않는다", () => {
    const issues = checkPriceHistoryFloors({ A: { count: null }, B: B_OK });
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("check-failed");
    expect(issues[0].detail).toBe("㉒ 시세 이력 바닥 점검(A 네이버 옛 줄 조회) 실행 실패 — count 없음(null)");
  });
});

describe("㉒ checkPriceHistoryFloors — 조각 B · 조회 오류", () => {
  it("B=100 → 경보 1건(차이 29)", () => {
    const issues = checkPriceHistoryFloors({ A: { count: 163140 }, B: { count: 100 } });
    expect(issues.map((i) => i.detail)).toEqual(["B 6글자 중 삭제 조건 밖 100 < 바닥 129 (−29)"]);
  });
  it("B 조회 오류(error 객체, count null) → 조회 실패 1건 · 오류 문구가 실린다", () => {
    const issues = checkPriceHistoryFloors({ A: { count: 163140 }, B: { count: null, error: { message: "permission denied for table complex_price_history" } } });
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("check-failed");
    expect(issues[0].detail).toContain("B 6글자 중 삭제 조건 밖 조회");
    expect(issues[0].detail).toContain("permission denied");
  });
  it("결과에 조각이 아예 없으면 둘 다 조회 실패", () => {
    expect(checkPriceHistoryFloors({}).map((i) => i.kind)).toEqual(["check-failed", "check-failed"]);
  });
});

describe("㉒ 경보 글 · dedup", () => {
  it("텔레그램 글 — 제목·지금 값·바닥·차이·조치(2u 창·덤프 경로)", () => {
    const [issue] = checkPriceHistoryFloors({ A: { count: 163100 }, B: B_OK });
    const text = formatIssue(issue);
    expect(text).toContain("<b>시세 이력 지우면 안 되는 줄이 줄어듦</b>");
    expect(text).toContain("A 네이버 옛 줄 163,100 &lt; 바닥 163,140 (−40)");
    expect(text).toContain("2u 정부 줄 정리(#741)가 조건 밖 줄을 지웠을 수 있음 — 2u(naver-estate-web) 창에 알리고, 2u 삭제 직전 덤프(D:\\db-backups\\naver-estate\\) 확인");
    expect(text).not.toContain("undefined");
  });
  it("daily 에서 dedup 하지 않는다 — 고칠 때까지 매일 알린다", () => {
    const [issue] = checkPriceHistoryFloors({ A: { count: 1 }, B: B_OK });
    expect(isAlwaysDedup(issue)).toBe(false);
  });
});

describe("㉒ 조각 조건(쿼리)", () => {
  /** 호출을 적어 두는 가짜 쿼리 */
  function fakeQuery() {
    /** @type {Array<[string, string, string]>} */
    const calls = [];
    const q = {
      calls,
      /** @param {string} c @param {string} v */ like(c, v) { calls.push(["like", c, v]); return q; },
      /** @param {string} c @param {string} v */ lte(c, v) { calls.push(["lte", c, v]); return q; },
      /** @param {string} c @param {string} v */ eq(c, v) { calls.push(["eq", c, v]); return q; },
      /** @param {string} c @param {string} v */ neq(c, v) { calls.push(["neq", c, v]); return q; },
    };
    return q;
  }
  it("A = 8글자 AND base_month <= 동결일", () => {
    const q = fakeQuery();
    applyPriceHistorySlice(q, "A");
    expect(q.calls).toEqual([["like", "base_month", "________"], ["lte", "base_month", "20261017"]]);
  });
  it("B = 6글자 AND trade_type='A1' AND area_no<>''", () => {
    const q = fakeQuery();
    applyPriceHistorySlice(q, "B");
    expect(q.calls).toEqual([["like", "base_month", "______"], ["eq", "trade_type", "A1"], ["neq", "area_no", ""]]);
  });
});
