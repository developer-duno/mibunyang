import { describe, it, expect } from "vitest";
import { hasKnownArea } from "./area";

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
