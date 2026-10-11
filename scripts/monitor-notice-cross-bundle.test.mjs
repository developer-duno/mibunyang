// @ts-check
/**
 * 감시 ⑳ 청약홈 공고가 다른 단지 묶음에 같이 붙음 (세션630 · 설계서 docs/superpowers/plans/2026-10-12-applyhome-notice-decisions.md §6)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkNoticeCrossBundle, loadNoticeActivePairs, runNoticeCrossBundleCheck } from "./monitor-collectors.mjs";

const KEYS = new Map(/** @type {Array<[string, string | null]>} */ ([["ah-1", "K1"], ["ah-1b", "K1"], ["ah-2", "K2"], ["ah-3", null]]));

describe("checkNoticeCrossBundle", () => {
  it("같은 묶음 여러 행은 정상(0건)", () => {
    expect(checkNoticeCrossBundle([
      { apartment_id: "ah-1", house_manage_no: "H1" }, { apartment_id: "ah-1b", house_manage_no: "H1" },
    ], KEYS, new Set())).toEqual([]);
  });

  it("다른 묶음 2곳+ → NTC_CROSS 1건 · 명단(빈 열쇠는 자기 id 묶음)", () => {
    const issues = checkNoticeCrossBundle([
      { apartment_id: "ah-1", house_manage_no: "H1" }, { apartment_id: "ah-2", house_manage_no: "H1" },
      { apartment_id: "ah-1", house_manage_no: "H2" }, { apartment_id: "ah-3", house_manage_no: "H2" },
      { apartment_id: "ah-2", house_manage_no: "H3" },
    ], KEYS, new Set());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "notice-cross-bundle", collector: "applyhome-detail" });
    expect(issues[0].detail).toMatch(/^NTC_CROSS 청약홈 공고 2건/);
    expect(issues[0].lines).toEqual(["H1 → ah-1 / ah-2", "H2 → ah-1 / ah-3"]);
  });

  it("★ 모든 묶음에 active 쌍이 있으면 건너뜀 — 사람이 일부러 두 묶음에 붙인 공고는 경보 아님", () => {
    const rows = [{ apartment_id: "ah-1", house_manage_no: "H1" }, { apartment_id: "ah-2", house_manage_no: "H1" }];
    expect(checkNoticeCrossBundle(rows, KEYS, new Set(["H1|ah-1", "H1|ah-2"]))).toEqual([]);
  });

  it("★ active 행 옆에 다른 묶음의 틀린 행이 남아 있으면 경보(디센트 727: 0003 active · 0027 다른 묶음)", () => {
    const rows = [{ apartment_id: "ah-1", house_manage_no: "H1" }, { apartment_id: "ah-2", house_manage_no: "H1" }];
    const issues = checkNoticeCrossBundle(rows, KEYS, new Set(["H1|ah-1"]));
    expect(issues).toHaveLength(1);
    expect(issues[0].lines).toEqual(["H1 → ah-1 / ah-2"]);
  });

  it("명단은 앞 5건 + 외 N건", () => {
    const rows = Array.from({ length: 7 }, (_, i) => [
      { apartment_id: "ah-1", house_manage_no: `H${i}` }, { apartment_id: "ah-2", house_manage_no: `H${i}` },
    ]).flat();
    const [issue] = checkNoticeCrossBundle(rows, KEYS, new Set());
    expect(issue.lines).toHaveLength(6);
    expect(issue.lines?.[5]).toBe("외 2건");
  });
});

describe("runNoticeCrossBundleCheck — fail-open", () => {
  it("조회 실패 → check-failed 1건", async () => {
    const issues = await runNoticeCrossBundleCheck({ fetchRows: async () => { throw new Error("boom"); }, loadActive: () => new Set() });
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("check-failed");
    expect(issues[0].detail).toBe("⑳ 공고 다른 묶음 점검 실행 실패 — boom");
  });

  it("주입 재료로 판정 · 운영 판정 파일의 active 쌍 = 4", async () => {
    const issues = await runNoticeCrossBundleCheck({
      fetchRows: async () => ({ schedRows: [{ apartment_id: "ah-1", house_manage_no: "H1" }, { apartment_id: "ah-2", house_manage_no: "H1" }], keyById: KEYS }),
      loadActive: () => new Set(),
    });
    expect(issues.map((i) => i.kind)).toEqual(["notice-cross-bundle"]);
    expect([...loadNoticeActivePairs()].sort()).toEqual(["2021000727|ah-2026910003", "2021000772|ap-6025315", "2023000532|ap-6027298", "2025820017|ap-6025730"]);
  });
});

describe("main 배선", () => {
  const src = readFileSync(fileURLToPath(new URL("./monitor-collectors.mjs", import.meta.url)), "utf8");
  it("⑳ 는 ⑲ 바로 뒤, 같은 월요일(또는 수동 강제) 블록 안", () => {
    expect(src).toMatch(/issues = issues\.concat\(await runOwnershipCheck\(\)\);\s*\r?\n(?:\s*\/\/[^\n]*\r?\n)+\s*issues = issues\.concat\(await runNoticeCrossBundleCheck\(\)\);\s*\r?\n\s*\}/);
  });
});
