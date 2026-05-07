// @ts-check
/**
 * transit-match.mjs 테스트 — 교통 매칭 순수 함수 검증
 *
 * 대상: haversine
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
    ROOT: orig.ROOT,
  };
});

const { haversine } = await import("./transit-match.mjs");

// ── haversine (transit-match) ─────────────────────────────────
describe("haversine (transit-match)", () => {
  it("같은 좌표 → 거리 0", () => {
    expect(haversine(37.5, 127.0, 37.5, 127.0)).toBe(0);
  });

  it("서울↔부산 약 325km", () => {
    // 서울시청: 37.5665, 126.9780 / 부산시청: 35.1796, 129.0756
    const dist = haversine(37.5665, 126.9780, 35.1796, 129.0756);
    expect(dist).toBeGreaterThan(300);
    expect(dist).toBeLessThan(350);
  });

  it("근거리 (~1km) 계산", () => {
    // 약 0.009도 ≈ 1km
    const dist = haversine(37.5, 127.0, 37.509, 127.0);
    expect(dist).toBeGreaterThan(0.8);
    expect(dist).toBeLessThan(1.2);
  });

  it("반환값은 km 단위 (양수)", () => {
    const dist = haversine(37.5, 127.0, 37.6, 127.1);
    expect(dist).toBeGreaterThan(0);
  });
});
