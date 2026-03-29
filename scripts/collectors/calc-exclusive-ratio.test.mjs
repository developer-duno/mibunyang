/**
 * calc-exclusive-ratio.mjs 테스트 — calcRatio 전용률 계산 검증
 */
import { describe, it, expect, vi } from "vitest";

// 외부 호출 방지
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn() };
});

const { calcRatio } = await import("./calc-exclusive-ratio.mjs");

describe("calcRatio", () => {
  // 정상 계산 — 전용면적 84.99 / 공급면적 114.8 = 74.0%
  it("정상 비율을 소수점 1자리로 반환한다", () => {
    expect(calcRatio(84.99, 114.8)).toBe(74.0);
  });

  // 전용률 100% — area === supply_area
  it("전용면적 = 공급면적 → 100.0%", () => {
    expect(calcRatio(60, 60)).toBe(100.0);
  });

  // 소수점 반올림 검증
  it("소수점 반올림이 정확하다", () => {
    // 59 / 84 = 70.238... → 70.2
    expect(calcRatio(59, 84)).toBe(70.2);
  });

  // null 처리
  it("area가 null이면 null을 반환한다", () => {
    expect(calcRatio(null, 100)).toBeNull();
  });

  it("supplyArea가 null이면 null을 반환한다", () => {
    expect(calcRatio(84, null)).toBeNull();
  });

  // 0 처리
  it("area가 0이면 null을 반환한다", () => {
    expect(calcRatio(0, 100)).toBeNull();
  });

  it("supplyArea가 0이면 null을 반환한다 (0 나누기 방지)", () => {
    expect(calcRatio(84, 0)).toBeNull();
  });

  // 음수 방어
  it("supplyArea가 음수이면 null을 반환한다", () => {
    expect(calcRatio(84, -10)).toBeNull();
  });

  // undefined
  it("undefined 입력은 null을 반환한다", () => {
    expect(calcRatio(undefined, 100)).toBeNull();
    expect(calcRatio(84, undefined)).toBeNull();
  });
});
