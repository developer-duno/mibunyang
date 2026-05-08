// @ts-check
/**
 * calc-floors.mjs 테스트 — classifyFloors 층수 분류 검증
 */
import { describe, it, expect, vi } from "vitest";

// 외부 호출 방지
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn() };
});

const { classifyFloors } = await import("./calc-floors.mjs");

describe("classifyFloors", () => {
  // null/0/음수 → null
  it("null 입력은 null을 반환한다", () => {
    expect(classifyFloors(null)).toBeNull();
  });

  it("undefined 입력은 null을 반환한다", () => {
    expect(classifyFloors(undefined)).toBeNull();
  });

  it("0층은 null을 반환한다", () => {
    expect(classifyFloors(0)).toBeNull();
  });

  it("음수는 null을 반환한다", () => {
    expect(classifyFloors(-3)).toBeNull();
  });

  // 저층 (1~5F)
  it("1층 → 저층(1~5F)", () => {
    expect(classifyFloors(1)).toBe("저층(1~5F)");
  });

  it("5층 → 저층(1~5F) (경계값)", () => {
    expect(classifyFloors(5)).toBe("저층(1~5F)");
  });

  // 중층 (6~15F)
  it("6층 → 중층(6~15F) (경계값)", () => {
    expect(classifyFloors(6)).toBe("중층(6~15F)");
  });

  it("15층 → 중층(6~15F) (경계값)", () => {
    expect(classifyFloors(15)).toBe("중층(6~15F)");
  });

  // 고층 (16~25F)
  it("16층 → 고층(16~25F) (경계값)", () => {
    expect(classifyFloors(16)).toBe("고층(16~25F)");
  });

  it("25층 → 고층(16~25F) (경계값)", () => {
    expect(classifyFloors(25)).toBe("고층(16~25F)");
  });

  // 초고층 (26F+)
  it("26층 → 초고층(26F+) (경계값)", () => {
    expect(classifyFloors(26)).toBe("초고층(26F+)");
  });

  it("50층 → 초고층(26F+)", () => {
    expect(classifyFloors(50)).toBe("초고층(26F+)");
  });
});
