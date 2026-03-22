/**
 * noise-estimate.mjs 테스트 — 소음 추정 경계값 검증
 */
import { describe, it, expect, vi } from "vitest";

// loadEnv + 외부 API 호출 방지
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn() };
});

const { estimateNoise, estimateNoiseFromAddress } = await import("./noise-estimate.mjs");

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

// 도로명 주소 파싱 기반 소음 추정
describe("estimateNoiseFromAddress", () => {
  it("'대로' 포함 주소 → 100m (도로 근접)", () => {
    expect(estimateNoiseFromAddress("경기도 화성시 동탄대로 123")).toBe(100);
  });
  it("'로' 포함 주소 → 150m (보통 도로)", () => {
    expect(estimateNoiseFromAddress("서울시 강남구 테헤란로 123")).toBe(150);
  });
  it("텍스트 도로명 '세종로' → 150m", () => {
    expect(estimateNoiseFromAddress("서울시 종로구 세종로 1")).toBe(150);
  });
  it("'종로구 + 길' 주소 → 구명 오매칭 없이 300m", () => {
    expect(estimateNoiseFromAddress("서울시 종로구 돈화문길 123")).toBe(300);
  });
  it("'대로' 우선순위 — 150이 아닌 100 반환", () => {
    expect(estimateNoiseFromAddress("서울시 서초구 강남대로 456")).toBe(100);
  });
  it("'길' 포함 주소 → 300m (이면도로)", () => {
    expect(estimateNoiseFromAddress("경기도 수원시 매탄길 45")).toBe(300);
  });
  it("null 주소 → null", () => {
    expect(estimateNoiseFromAddress(null)).toBeNull();
  });
  it("빈 문자열 → null", () => {
    expect(estimateNoiseFromAddress("")).toBeNull();
  });
  it("도로명 없는 주소 → null", () => {
    expect(estimateNoiseFromAddress("경기도 화성시 123")).toBeNull();
  });
});
