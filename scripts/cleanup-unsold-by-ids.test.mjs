// @ts-check
/**
 * cleanup-unsold-by-ids.mjs — buildClearPlan·checkCurrentValues 정확값 시험 (세션576, 검사관 반영판)
 *
 * buildClearPlan 픽스처: 정상 2 · hold 1 · 이미 NULL 1 · 없는 id 1.
 * checkCurrentValues 픽스처: 사본과 일치 1 · 현재값 달라짐 1(검사관 지적).
 */
import { describe, it, expect } from "vitest";
import { buildClearPlan, checkCurrentValues } from "./cleanup-unsold-by-ids.mjs";

/** @param {Partial<import("./cleanup-unsold-by-ids.mjs").AptRow> & { id: string }} p */
function row(p) {
  return {
    id: p.id, name: p.name ?? p.id, presale_type: p.presale_type ?? "분양",
    unsold: p.unsold ?? null, unsold_rate: p.unsold_rate ?? null,
    unsold_source: p.unsold_source ?? null, unsold_as_of: p.unsold_as_of ?? null,
  };
}

describe("buildClearPlan (세션576)", () => {
  const rows = [
    row({ id: "n1", name: "정상A", unsold: 5, unsold_rate: 10, unsold_source: "kosis", unsold_as_of: null }),
    row({ id: "n2", name: "정상B", unsold: 20, unsold_rate: 40, unsold_source: "naver_listing", unsold_as_of: "2026-01-01" }),
    row({ id: "h1", name: "보류C", unsold: null, unsold_rate: null, unsold_source: "hold", unsold_as_of: "2026-09-01" }),
    row({ id: "e1", name: "이미빈D", unsold: null, unsold_rate: null, unsold_source: null, unsold_as_of: null }),
    // "없는id" 는 rows 에 아예 없음
  ];
  const ids = ["n1", "n2", "h1", "e1", "없는id"];

  const { clearRows, skipRows } = buildClearPlan(rows, ids);

  it("비울 행이 정확히 2건이다(정상 2)", () => {
    expect(clearRows).toHaveLength(2);
    expect(clearRows.map((r) => r.id).sort()).toEqual(["n1", "n2"]);
  });

  it("hold 행은 skip 되고 값은 손대지 않는다", () => {
    const h = skipRows.find((s) => s.id === "h1");
    expect(h).toBeDefined();
    expect(h?.reason).toMatch(/보류/);
  });

  it("이미 전부 NULL 인 행은 skip 된다", () => {
    const e = skipRows.find((s) => s.id === "e1");
    expect(e).toBeDefined();
    expect(e?.reason).toMatch(/이미 비어/);
  });

  it("명단에 없는(조회 결과에 없는) id 는 skip 된다", () => {
    const missing = skipRows.find((s) => s.id === "없는id");
    expect(missing).toBeDefined();
    expect(missing?.reason).toMatch(/명단에 없음/);
  });

  it("skip 총합이 3건이다(hold 1 + 이미빈 1 + 없는id 1)", () => {
    expect(skipRows).toHaveLength(3);
  });

  it("clearRows 에는 현재값이 그대로 담겨 있다(되돌릴 사본용)", () => {
    const n1 = clearRows.find((r) => r.id === "n1");
    expect(n1).toMatchObject({ unsold: 5, unsold_rate: 10, unsold_source: "kosis" });
  });
});

describe("checkCurrentValues (세션576, 검사관 지적 1)", () => {
  const snapshotRows = [
    { id: "s1", name: "일치A", unsold: 5, unsold_rate: 10, unsold_source: "kosis", unsold_as_of: null },
    { id: "s2", name: "달라짐B", unsold: 20, unsold_rate: 40, unsold_source: "naver_listing", unsold_as_of: null },
  ];

  it("사본과 지금 DB 값이 완전히 같은 행만 반영 대상에 남는다", () => {
    const dbRows = [
      row({ id: "s1", name: "일치A", unsold: 5, unsold_rate: 10, unsold_source: "kosis", unsold_as_of: null }),
      // s2 는 그 사이 unsold 가 20 → 25 로 바뀜(다른 수집기가 손댐)
      row({ id: "s2", name: "달라짐B", unsold: 25, unsold_rate: 40, unsold_source: "naver_listing", unsold_as_of: null }),
    ];
    const { toApply, staleSkipped } = checkCurrentValues(snapshotRows, dbRows);
    expect(toApply).toHaveLength(1);
    expect(toApply[0].id).toBe("s1");
    expect(staleSkipped).toHaveLength(1);
    expect(staleSkipped[0].id).toBe("s2");
    expect(staleSkipped[0].reason).toMatch(/현재값 달라짐: unsold DB=25 사본=20/);
  });

  it("사본 시점 행이 DB 에서 사라졌으면(행 없음) 건너뛴다", () => {
    const { toApply, staleSkipped } = checkCurrentValues(snapshotRows, []);
    expect(toApply).toHaveLength(0);
    expect(staleSkipped).toHaveLength(2);
    expect(staleSkipped.every((s) => s.reason.includes("행 없음"))).toBe(true);
  });
});
