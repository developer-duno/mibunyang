// @ts-check
/**
 * compare-unsold-impact.mjs — compareImpact 정확값 시험 (세션576)
 *
 * 인라인 픽스처: before 5행 · after 5행. 전이 3종(write→skip_lease · write_zero→write ·
 * hold_ge50→skip_lease) · 추정값 변화 1(action 은 write 로 같고 newEstimate 만 바뀜) ·
 * 한쪽에만 있는 id 1(before 에만 있음).
 */
import { describe, it, expect } from "vitest";
import { compareImpact } from "./compare-unsold-impact.mjs";

/** @param {Partial<import("./compare-unsold-impact.mjs").PlanRow> & { id: string }} p */
function row(p) {
  return {
    id: p.id, name: p.name ?? p.id, region: p.region ?? "서울", gu: p.gu ?? "강서구",
    action: p.action ?? "write", kosisKey: p.kosisKey ?? "강서구",
    guUnsold: p.guUnsold ?? 10, totalUnitsInGu: p.totalUnitsInGu ?? 100,
    newEstimate: p.newEstimate ?? null, newRate: p.newRate ?? null,
    currentUnsold: p.currentUnsold ?? null, currentRate: p.currentRate ?? null,
    currentSource: p.currentSource ?? null, applyhomeExpired: p.applyhomeExpired ?? false,
  };
}

describe("compareImpact (세션576)", () => {
  const before = {
    generatedAt: "2026-09-26T00:00:00.000Z",
    actionCounts: { write: 3, write_zero: 1, hold_ge50: 1 },
    breaker: { fired: false, zeroChanges: 0, denominator: 4, ratio: 0, limit: 10, expectZero: null },
    plan: [
      row({ id: "a1", name: "단지A", action: "write", newEstimate: 10, currentUnsold: 10 }), // → skip_lease
      row({ id: "a2", name: "단지B", action: "write", newEstimate: 5, currentUnsold: 5 }), // action 동일, newEstimate 만 바뀜
      row({ id: "a3", name: "단지C", action: "write_zero", newEstimate: 0, currentUnsold: 0 }), // → write
      row({ id: "a4", name: "단지D", action: "hold_ge50", newEstimate: 50, currentUnsold: 50 }), // → skip_lease
      row({ id: "a5", name: "단지E", action: "write", newEstimate: 3, currentUnsold: 3 }), // before 에만 있음
    ],
  };
  const after = {
    generatedAt: "2026-09-26T01:00:00.000Z",
    actionCounts: { skip_lease: 2, write: 2 },
    breaker: { fired: false, zeroChanges: 0, denominator: 4, ratio: 0, limit: 10, expectZero: null },
    plan: [
      row({ id: "a1", name: "단지A", action: "skip_lease", newEstimate: null, currentUnsold: 10 }),
      row({ id: "a2", name: "단지B", action: "write", newEstimate: 6, currentUnsold: 5 }), // 5 → 6 (up)
      row({ id: "a3", name: "단지C", action: "write", newEstimate: 1, currentUnsold: 0 }),
      row({ id: "a4", name: "단지D", action: "skip_lease", newEstimate: null, currentUnsold: 50 }),
      // a5 없음(after 없음), a6 신규(before 없음)
      row({ id: "a6", name: "단지F", action: "write", newEstimate: 2, currentUnsold: 2 }),
    ],
  };

  const result = compareImpact(before, after);

  it("action 전이 집계가 정확하다(3종)", () => {
    expect(result.transitions).toEqual({
      "write→skip_lease": 1,
      "write_zero→write": 1,
      "hold_ge50→skip_lease": 1,
    });
  });

  it("전이 행 명단이 정확하다(3건, id·from·to)", () => {
    expect(result.transitionRows).toHaveLength(3);
    const byId = Object.fromEntries(result.transitionRows.map((r) => [r.id, r]));
    expect(byId.a1).toMatchObject({ from: "write", to: "skip_lease", currentUnsold: 10 });
    expect(byId.a3).toMatchObject({ from: "write_zero", to: "write", currentUnsold: 0 });
    expect(byId.a4).toMatchObject({ from: "hold_ge50", to: "skip_lease", currentUnsold: 50 });
  });

  it("action 같고 추정값 바뀐 행이 정확히 1건(↑1 ↓0)이다", () => {
    expect(result.estimateChanged.up).toBe(1);
    expect(result.estimateChanged.down).toBe(0);
    expect(result.estimateChanged.rows).toHaveLength(1);
    expect(result.estimateChanged.rows[0]).toMatchObject({ id: "a2", fromEstimate: 5, toEstimate: 6 });
  });

  it("한쪽에만 있는 id 를 정확히 센다(before 없음=1, after 없음=1)", () => {
    expect(result.onlyAfter).toBe(1); // a6 은 before 에 없다(신규)
    expect(result.onlyBefore).toBe(1); // a5 는 after 에 없다(사라짐)
  });

  it("actionCounts 전후·delta 가 정확하다", () => {
    expect(result.actionCountsBefore).toEqual({ write: 3, write_zero: 1, hold_ge50: 1 });
    expect(result.actionCountsAfter).toEqual({ skip_lease: 2, write: 2 });
    expect(result.actionCountsDelta).toEqual({ write: -1, write_zero: -1, hold_ge50: -1, skip_lease: 2 });
  });

  it("breaker 전후를 그대로 돌려준다", () => {
    expect(result.breakerBefore).toEqual(before.breaker);
    expect(result.breakerAfter).toEqual(after.breaker);
  });
});
