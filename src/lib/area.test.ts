import { describe, it, expect } from "vitest";
import { hasKnownArea, fmtArea } from "./area";

describe("hasKnownArea", () => {
  it("null·undefined·0·음수는 면적 없음, 양수(문자열 포함)는 면적 있음", () => {
    expect(hasKnownArea(null)).toBe(false);
    expect(hasKnownArea(undefined)).toBe(false);
    expect(hasKnownArea(0)).toBe(false);
    expect(hasKnownArea(-1)).toBe(false);
    expect(hasKnownArea("84")).toBe(true);
    expect(hasKnownArea(84)).toBe(true);
  });
});

// 세션675 👤 「면적 숫자 정리」
describe("fmtArea — 소수 둘째 자리 + ㎡", () => {
  it("59.7537 → 59.75㎡ · 85 → 85㎡ · 84.999 → 85㎡ · 문자열도", () => {
    expect(fmtArea(59.7537)).toBe("59.75㎡");
    expect(fmtArea(85)).toBe("85㎡");
    expect(fmtArea(84.999)).toBe("85㎡");
    expect(fmtArea("71.78")).toBe("71.78㎡");
  });
});
