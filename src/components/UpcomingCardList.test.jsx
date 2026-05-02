// UpcomingCardList 단위 테스트 — D-day 로직 + null 가드
import { describe, it, expect } from "vitest";
import { computeDday } from "./UpcomingCardList";

describe("computeDday — 청약일 D-day 계산 (spec § 6-2)", () => {
  const today = new Date("2026-05-08T00:00:00");

  it("당일 청약 → '오늘 청약' (빨강)", () => {
    const r = computeDday("2026-05-08", today);
    expect(r.label).toBe("오늘 청약");
  });

  it("D-3 (5/11 - 5/8) → 'D-3' (주황)", () => {
    const r = computeDday("2026-05-11", today);
    expect(r.label).toBe("D-3");
  });

  it("D-7 (5/15 - 5/8) → 'D-7' (회색)", () => {
    const r = computeDday("2026-05-15", today);
    expect(r.label).toBe("D-7");
  });

  it("D-30 → 'D-30' (회색, 1주 초과)", () => {
    const r = computeDday("2026-06-07", today);
    expect(r.label).toBe("D-30");
  });

  it("D+1 (5/7 - 5/8 = 어제) → 'D+1'", () => {
    const r = computeDday("2026-05-07", today);
    expect(r.label).toBe("D+1");
  });

  it("D+8 (1주 이상 지난 단지) → null (표시 X)", () => {
    const r = computeDday("2026-04-30", today);
    expect(r).toBeNull();
  });

  it("null 입력 → null", () => {
    expect(computeDday(null)).toBeNull();
  });

  it("비정형 텍스트 ('미정') → null", () => {
    expect(computeDday("미정", today)).toBeNull();
  });

  it("빈 문자열 → null", () => {
    expect(computeDday("", today)).toBeNull();
  });
});
