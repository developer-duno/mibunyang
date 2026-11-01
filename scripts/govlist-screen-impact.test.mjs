// @ts-check
import { describe, it, expect } from "vitest";
import { simulateCard, unsoldFilterNow, unsoldFilterPr3 } from "./govlist-screen-impact.mjs";

describe("govlist 화면 변화 흉내 — VIEW apartments_flat 식과 같게", () => {
  const after = new Map([["ah-1", { unsold: null, unsold_rate: null }], ["ap-2", { unsold: 25, unsold_rate: 80.6 }], ["ah-3", { unsold: 40, unsold_rate: 9 }]]);
  it("묶음(구성원 2+) 카드: 비공개 → 미분양·률 NULL · 비공개 표시 켬 · 출처 govlist", () => {
    expect(simulateCard({ id: "ah-1", memberIds: ["ah-1", "ah-9"], units: 433, unsold: 165, unsoldRate: 38.1 }, after))
      .toMatchObject({ unsold: null, unsoldRate: null, unsoldListedHidden: true, unsoldSource: "govlist" });
  });
  it("혼자인 카드는 행의 새 률 · 묶음 카드는 새 미분양 ÷ 카드 세대수(100 초과 NULL)", () => {
    expect(simulateCard({ id: "ap-2", memberIds: ["ap-2"], units: 31, unsold: 7 }, after)).toMatchObject({ unsold: 25, unsoldRate: 80.6, unsoldListedHidden: false });
    expect(simulateCard({ id: "ah-3", memberIds: ["ah-3", "ah-4"], units: 400, unsold: 1 }, after)).toMatchObject({ unsold: 40, unsoldRate: 10 });
    expect(simulateCard({ id: "ah-3", memberIds: ["ah-3", "ah-4"], units: 30, unsold: 1 }, after)?.unsoldRate).toBeNull();
  });
  it("쓰는 행이 없는 카드는 null(안 바뀜) · memberIds 가 없으면 자기 id 로 본다", () => {
    expect(simulateCard({ id: "x", memberIds: ["x"] }, after)).toBeNull();
    expect(simulateCard({ id: "ah-1" }, after)?.unsoldListedHidden).toBe(true);
  });
  it("「미분양만 보기」: 지금 규칙은 비공개(NULL) 카드를 빼고 · PR-3 뒤 규칙은 남긴다", () => {
    const hidden = { unsold: null, unsoldListedHidden: true };
    expect([unsoldFilterNow(hidden), unsoldFilterPr3(hidden)]).toEqual([false, true]);
    expect([unsoldFilterNow({ unsold: 3 }), unsoldFilterPr3({ unsold: 0 })]).toEqual([true, false]);
  });
});
