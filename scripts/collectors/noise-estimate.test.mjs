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
  // 50m 이내 → 70dB (높음)
  it("50m 이내이면 70(dB)을 반환한다", () => {
    expect(estimateNoise(30)).toBe(70);
  });

  // 정확히 50m → 70dB (경계값 포함)
  it("정확히 50m이면 70(dB)을 반환한다", () => {
    expect(estimateNoise(50)).toBe(70);
  });

  // 51~100m → 60dB (보통)
  it("51~100m이면 60(dB)을 반환한다", () => {
    expect(estimateNoise(51)).toBe(60);
    expect(estimateNoise(100)).toBe(60);
  });

  // 101~200m → 50dB (낮음)
  it("101~200m이면 50(dB)을 반환한다", () => {
    expect(estimateNoise(101)).toBe(50);
    expect(estimateNoise(200)).toBe(50);
  });

  // 200m 초과 → 40dB (매우 낮음)
  it("200m 초과이면 40(dB)을 반환한다", () => {
    expect(estimateNoise(201)).toBe(40);
    expect(estimateNoise(500)).toBe(40);
  });

  // null → null
  it("null 입력 시 null을 반환한다", () => {
    expect(estimateNoise(null)).toBeNull();
  });
});
