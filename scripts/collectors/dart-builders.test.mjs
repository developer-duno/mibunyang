// @ts-check
/**
 * dart-builders.mjs 테스트 — DART 시공사 재무 순수 함수 검증
 *
 * 대상: estimateCreditGrade, parseAmount
 */
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

const { estimateCreditGrade, parseAmount } = await import("./dart-builders.mjs");

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
