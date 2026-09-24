// @ts-check
/**
 * cleanup-listing-based-unsold.mjs — 사람 보류(hold) 행을 정리 대상에서 빼는 조회 가드 (세션570).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("cleanup-listing-based-unsold — hold 제외 (세션570)", () => {
  const src = readFileSync(fileURLToPath(new URL("./cleanup-listing-based-unsold.mjs", import.meta.url)), "utf8");

  it("조회에 NULL-안전 hold 제외 필터가 붙어 있다(neq 단독은 출처 NULL 행까지 뺀다)", () => {
    expect(src).toContain(
      's.from("apartments").select("id, name, units, unsold, unsold_rate, naver_sell_count").or("unsold_source.is.null,unsold_source.neq.hold")',
    );
    // 머리말 주석은 이 함정을 설명하느라 그 문자열을 담고 있다 — 코드 줄에서만 찾는다
    const code = src.split(/\r?\n/).filter((l) => !/^\s*(\*|\/\/|\/\*\*)/.test(l)).join("\n");
    expect(code).toContain('.or("unsold_source.is.null,unsold_source.neq.hold")');
    expect(code).not.toMatch(/\.neq\("unsold_source",\s*"hold"\)/);
  });

  it("오염 판정은 값이 NULL 인 행(hold 는 항상 NULL)을 대상으로 삼지 않는다", async () => {
    const { isContaminatedUnsold } = await import("./cleanup-listing-based-unsold.mjs");
    expect(isContaminatedUnsold({ units: 10, unsold: null })).toBe(false);
    expect(isContaminatedUnsold({ units: 10, unsold: 11 })).toBe(true);
  });
});
