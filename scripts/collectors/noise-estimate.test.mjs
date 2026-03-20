/**
 * noise-estimate.mjs 테스트 — 소음 추정 경계값 검증
 */
import { describe, it, expect, vi } from "vitest";

// loadEnv + 외부 API 호출 방지
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn() };
});

const { estimateNoise } = await import("./noise-estimate.mjs");

describe("estimateNoise", () => {
  // 50m 이내 → 높음
  it("50m 이내이면 '높음'을 반환한다", () => {
    expect(estimateNoise(30)).toBe("높음");
  });

  // 정확히 50m → 높음 (경계값 포함)
  it("정확히 50m이면 '높음'을 반환한다", () => {
    expect(estimateNoise(50)).toBe("높음");
  });

  // 51~100m → 보통
  it("51~100m이면 '보통'을 반환한다", () => {
    expect(estimateNoise(51)).toBe("보통");
    expect(estimateNoise(100)).toBe("보통");
  });

  // 101~200m → 낮음
  it("101~200m이면 '낮음'을 반환한다", () => {
    expect(estimateNoise(101)).toBe("낮음");
    expect(estimateNoise(200)).toBe("낮음");
  });

  // 200m 초과 → 매우 낮음
  it("200m 초과이면 '매우 낮음'을 반환한다", () => {
    expect(estimateNoise(201)).toBe("매우 낮음");
    expect(estimateNoise(500)).toBe("매우 낮음");
  });

  // null → null
  it("null 입력 시 null을 반환한다", () => {
    expect(estimateNoise(null)).toBeNull();
  });
});
