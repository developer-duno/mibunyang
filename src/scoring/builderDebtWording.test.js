// @ts-check
// @vitest-environment node
/**
 * 시공사 부채비율 글자의 경계 숫자는 점수표(`BUILDER_DEBT_TIERS`)에서 조립한다 (세션592).
 *
 * 값을 비교하는 시험(engine.test.js "시공사 재무 글자")은 손글씨 150·200 을 못 잡는다 — 오늘은 표와 같은
 * 숫자라 결과 글자가 같기 때문이다. 표를 바꾸는 날 글자만 옛 숫자로 남는 것을 막으려고, 글자를 만드는
 * 자리가 표를 읽는지 소스로 본다. 좌변(키 이름)까지 고정해 주석·다른 줄에 걸리지 않게 한다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (/** @type {string} */ p) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("시공사 부채비율 글자 — 경계 숫자는 BUILDER_DEBT_TIERS 에서 (세션592)", () => {
  it("점수 탭 detail 이 두 경계를 표에서 읽는다(손글씨 150·200 금지)", () => {
    const src = read("./scoreRisk.ts");
    const line = src.split("\n").find((l) => l.includes("이하 안정 · "));
    expect(line, "detail 템플릿 줄을 못 찾았다 — 이 시험이 낡았다").toBeDefined();
    expect(line).toContain("${BUILDER_DEBT_TIERS[0].max}% 이하 안정");
    expect(line).toContain("${BUILDER_DEBT_TIERS[1].max}% 이하 보통");
  });

  it("판정 기준(subContext) benchmark 가 표에서 읽는다", () => {
    const src = read("../constants/subContext.ts");
    expect(src).toMatch(/benchmark:\s*`부채비율 \$\{BUILDER_DEBT_TIERS\[0\]\.max\}% 이하`/);
  });

  it("카드 칩 뜨는 조건이 표에서 읽는다(손글씨 150 금지)", () => {
    const src = read("../constants/cardChips.ts");
    expect(src).toMatch(/Number\(builderDebtRatio\)\s*>\s*BUILDER_DEBT_TIERS\[0\]\.max/);
  });
});
