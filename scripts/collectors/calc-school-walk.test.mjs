/**
 * calc-school-walk.mjs 테스트 — 초등학교 도보시간 순수 함수 검증
 *
 * 대상: findNearestElemSchool, calcWalkingMinutes
 */
import { describe, it, expect, vi } from "vitest";

// _shared.mjs 모킹
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    createReporter: vi.fn(() => ({
      success: vi.fn(), fail: vi.fn(), skip: vi.fn(),
      summary: vi.fn(() => ({ elapsed: "0.0", ok: 0, fail: 0, skip: 0, total: 0 })),
    })),
  };
});

const { findNearestElemSchool, calcWalkingMinutes } = await import("./calc-school-walk.mjs");

// ── findNearestElemSchool ─────────────────────────────────────
describe("findNearestElemSchool", () => {
  it("초등학교 1개 → 해당 거리 반환", () => {
    expect(findNearestElemSchool([{ type: "초", distance: 300 }])).toBe(300);
  });

  it("초등학교 여러 개 → 최소 거리", () => {
    const schools = [
      { type: "초", distance: 500 },
      { type: "초", distance: 200 },
      { type: "초", distance: 800 },
    ];
    expect(findNearestElemSchool(schools)).toBe(200);
  });

  it("초등학교 없음 (중/고만) → null", () => {
    const schools = [
      { type: "중", distance: 300 },
      { type: "고", distance: 500 },
    ];
    expect(findNearestElemSchool(schools)).toBeNull();
  });

  it("빈 배열 → null", () => {
    expect(findNearestElemSchool([])).toBeNull();
  });

  it("null 입력 → null", () => {
    expect(findNearestElemSchool(null)).toBeNull();
  });

  it("distance 0인 초등학교 → 무시", () => {
    const schools = [{ type: "초", distance: 0 }, { type: "초", distance: 400 }];
    expect(findNearestElemSchool(schools)).toBe(400);
  });
});

// ── calcWalkingMinutes ────────────────────────────────────────
describe("calcWalkingMinutes", () => {
  it("350m / 70(m/분) → 5분 (올림)", () => {
    expect(calcWalkingMinutes(350)).toBe(5); // 350/70 = 5.0
  });

  it("400m / 70(m/분) → 6분 (올림)", () => {
    expect(calcWalkingMinutes(400)).toBe(6); // 400/70 = 5.71 → ceil = 6
  });

  it("distance 0 → null", () => {
    expect(calcWalkingMinutes(0)).toBeNull();
  });

  it("distance null → null", () => {
    expect(calcWalkingMinutes(null)).toBeNull();
  });

  it("커스텀 속도 80m/분", () => {
    expect(calcWalkingMinutes(320, 80)).toBe(4); // 320/80 = 4.0
  });
});
