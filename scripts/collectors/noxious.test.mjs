// @ts-check
/**
 * noxious.mjs 테스트 — Haversine 거리 계산 검증
 */
import { describe, it, expect, vi } from "vitest";

// loadEnv + 외부 API 호출 방지
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn() };
});

const { haversineM } = await import("./noxious.mjs");

describe("haversineM", () => {
  // 동일 좌표 → 0m
  it("동일 좌표는 0m를 반환한다", () => {
    expect(haversineM(37.5, 127.0, 37.5, 127.0)).toBe(0);
  });

  // 서울→부산 약 325km (오차 5km 이내)
  it("서울→부산 약 325km", () => {
    // 서울(37.5665, 126.978) → 부산(35.1796, 129.0756)
    const dist = haversineM(37.5665, 126.978, 35.1796, 129.0756);
    expect(dist).toBeGreaterThan(320_000);
    expect(dist).toBeLessThan(330_000);
  });

  // 짧은 거리 (1km 이내)
  it("가까운 두 지점의 거리를 정확히 계산한다", () => {
    // 약 1km 떨어진 두 지점 (위도 약 0.009도 ≈ 1km)
    const dist = haversineM(37.5, 127.0, 37.509, 127.0);
    expect(dist).toBeGreaterThan(900);
    expect(dist).toBeLessThan(1100);
  });

  // 적도 부근 경도 차이 검증
  it("적도에서 경도 1도 ≈ 약 111km", () => {
    const dist = haversineM(0, 0, 0, 1);
    expect(dist).toBeGreaterThan(110_000);
    expect(dist).toBeLessThan(112_000);
  });
});
