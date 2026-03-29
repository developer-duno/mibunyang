/**
 * industry-match.mjs 테스트 — 산업단지 매칭 순수 함수 검증
 *
 * 대상: haversine
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
    ROOT: orig.ROOT,
  };
});

const { haversine } = await import("./industry-match.mjs");

// ── haversine (industry-match) ────────────────────────────────
describe("haversine (industry-match)", () => {
  it("같은 좌표 → 거리 0", () => {
    expect(haversine(37.5, 127.0, 37.5, 127.0)).toBe(0);
  });

  it("서울↔대구 약 240km", () => {
    // 서울시청: 37.5665, 126.9780 / 대구시청: 35.8714, 128.6014
    const dist = haversine(37.5665, 126.9780, 35.8714, 128.6014);
    expect(dist).toBeGreaterThan(220);
    expect(dist).toBeLessThan(260);
  });

  it("반월시화산단 반경 10km 검증", () => {
    // 반월시화: 37.31, 126.73 / 안산시 중심: 37.32, 126.83 → ~8.5km
    const dist = haversine(37.31, 126.73, 37.32, 126.83);
    expect(dist).toBeGreaterThan(5);
    expect(dist).toBeLessThan(15);
  });
});
