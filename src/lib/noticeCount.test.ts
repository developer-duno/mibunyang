import { describe, it, expect } from "vitest";
import { noticeCount } from "./noticeCount";

describe("noticeCount — 청약홈 공고(ah-) 수 (세션635 다 · 세션675 바 ①)", () => {
  it("ah- 만 센다 · 배열이 아니면 0", () => {
    expect(noticeCount(["ah-1", "ah-2", "ap-3"])).toBe(2);
    expect(noticeCount(["ap-1"])).toBe(0);
    expect(noticeCount(null)).toBe(0);
    expect(noticeCount(undefined)).toBe(0);
    expect(noticeCount([1, "ah-1"])).toBe(1);
  });
});
