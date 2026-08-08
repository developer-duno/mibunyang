// @ts-check
/**
 * dart-builders.mjs 테스트 — DART 시공사 재무 순수 함수 검증
 *
 * 대상: estimateCreditGrade, parseAmount
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";

// _shared.mjs 모킹
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    sleep: vi.fn(),
  };
});

const { estimateCreditGrade, parseAmount, formatFailReasons } = await import("./dart-builders.mjs");

// ── estimateCreditGrade ───────────────────────────────────────
describe("estimateCreditGrade", () => {
  it("부채비율 ≤ 100% → A", () => {
    expect(estimateCreditGrade(50)).toBe("A");
    expect(estimateCreditGrade(100)).toBe("A");
  });

  it("부채비율 101~150% → A-", () => {
    expect(estimateCreditGrade(101)).toBe("A-");
    expect(estimateCreditGrade(150)).toBe("A-");
  });

  it("부채비율 151~200% → BBB", () => {
    expect(estimateCreditGrade(151)).toBe("BBB");
    expect(estimateCreditGrade(200)).toBe("BBB");
  });

  it("부채비율 201~250% → BB", () => {
    expect(estimateCreditGrade(201)).toBe("BB");
    expect(estimateCreditGrade(250)).toBe("BB");
  });

  it("부채비율 251~350% → B", () => {
    expect(estimateCreditGrade(251)).toBe("B");
    expect(estimateCreditGrade(350)).toBe("B");
  });

  it("부채비율 > 350% → CCC", () => {
    expect(estimateCreditGrade(351)).toBe("CCC");
    expect(estimateCreditGrade(1000)).toBe("CCC");
  });

  it("부채비율 0% → A", () => {
    expect(estimateCreditGrade(0)).toBe("A");
  });
});

// ── parseAmount ───────────────────────────────────────────────
describe("parseAmount", () => {
  it("콤마 포함 숫자 → 파싱", () => {
    expect(parseAmount("1,234,567")).toBe(1234567);
  });

  it("null/undefined → 0", () => {
    expect(parseAmount(null)).toBe(0);
    expect(parseAmount(undefined)).toBe(0);
  });

  it("빈 문자열 → 0", () => {
    expect(parseAmount("")).toBe(0);
  });

  it("음수 → 음수 반환", () => {
    expect(parseAmount("-500,000")).toBe(-500000);
  });

  it("소수점 → 소수 반환", () => {
    expect(parseAmount("1,234.56")).toBe(1234.56);
  });

  it("숫자 아닌 문자열 → 0", () => {
    expect(parseAmount("abc")).toBe(0);
  });
});

// ── 실패 사유 집계 (세션 504) ─────────────────────────────────────
//
// 사고: fetchFinancials 의 세 갈래(`!res.ok` / `status !== "000"` / `catch`)가 전부
// 조용히 continue 라, 8/04 회차가 배치당 86초(직전 성공의 25배)를 쓰고 재무 0건으로
// 끝났는데 **왜인지가 로그에 하나도 없었다**. 키 거부인지·응답 지연인지·연결 실패인지
// 가를 근거가 없어 처방을 못 정했다.
//
// 이 집계가 없으면 다음 회차도 똑같이 "0건" 만 남기고 끝난다.
describe("formatFailReasons — 0건으로 끝난 이유를 한 줄로 남긴다", () => {
  it("사유가 없으면 null (정상 회차에 빈 줄을 찍지 않기)", () => {
    expect(formatFailReasons(new Map())).toBeNull();
  });

  it("많이 난 사유가 앞에 온다", () => {
    const m = new Map([["status 013", 2], ["timeout(15s)", 7], ["HTTP 500", 5]]);
    expect(formatFailReasons(m)).toBe("timeout(15s)×7, HTTP 500×5, status 013×2");
  });

  it("응답 지연과 연결 실패를 다른 사유로 센다 (같은 0건이라도 처방이 다르다)", () => {
    const m = new Map([["timeout(15s)", 3], ["err:TypeError", 1]]);
    const out = formatFailReasons(m);
    expect(out).toContain("timeout(15s)×3");
    expect(out).toContain("err:TypeError×1");
  });
});

// 위 순수함수 테스트만으로는 **호출부가 지워지는 것**을 못 잡는다(집계 함수는 멀쩡한데
// 아무도 안 부르면 로그는 다시 조용해진다). 세 갈래 배선을 소스에서 직접 확인한다.
// ⚠️ 좌변까지 고정 — `noteFail` 부분 문자열만 찾으면 선언부·이 주석에도 걸려
//    "지워도 통과"하는 껍데기가 된다(.claude/rules/meta/guards-must-be-mutation-tested.md).
describe("dart-builders — 실패 사유 배선이 세 갈래 모두에 박혀 있다", () => {
  const src = readFileSync("scripts/collectors/dart-builders.mjs", "utf-8");

  it("HTTP 응답 실패 갈래", () => {
    expect(src).toMatch(/if \(!res\.ok\) \{ noteFail\(`HTTP \$\{res\.status\}`\); continue; \}/);
  });

  it("DART status 코드 갈래 (키 거부·보고서 없음 구분)", () => {
    expect(src).toMatch(/noteFail\(`status \$\{json\.status \?\? "\?"\}`\)/);
  });

  it("예외 갈래 — 응답 지연(TimeoutError)과 연결 실패를 가른다", () => {
    expect(src).toMatch(/noteFail\(name === "TimeoutError" \? "timeout\(15s\)" : `err:\$\{name\}`\)/);
  });

  it("집계 결과를 실제로 로그에 낸다", () => {
    expect(src).toMatch(/const reasons = formatFailReasons\(\);[\s\S]{0,120}?log\("dart", `\[실패사유\]/);
  });
});
