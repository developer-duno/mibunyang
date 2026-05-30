// @ts-check
/**
 * housing-permits.mjs 테스트 — 주택 인허가 순수 함수 검증
 *
 * 대상: resolveRegion
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
    fetchWithRetry: vi.fn(),
    today: vi.fn(() => "2026-03-30"),
    recordApiQuota: vi.fn(),
    REGION_MAP: orig.REGION_MAP,
    VALID_REGIONS: orig.VALID_REGIONS,
  };
});

// MOLIT_KEY 설정 — 모듈 로드 시 process.exit 방지
process.env.MOLIT_KEY = "test-key";

const { resolveRegion } = await import("./housing-permits.mjs");

// ── resolveRegion ─────────────────────────────────────────────
describe("resolveRegion (housing-permits)", () => {
  it("정확한 매칭 '서울특별시' → '서울'", () => {
    expect(resolveRegion("서울특별시")).toBe("서울");
  });

  it("정확한 매칭 '경기도' → '경기'", () => {
    expect(resolveRegion("경기도")).toBe("경기");
  });

  it("부분 매칭 '대전' → '대전'", () => {
    expect(resolveRegion("대전")).toBe("대전");
  });

  it("null → null", () => {
    expect(resolveRegion(null)).toBeNull();
  });

  it("매칭 불가 → null", () => {
    expect(resolveRegion("알수없는곳")).toBeNull();
  });

  it("제주특별자치도 → 제주", () => {
    expect(resolveRegion("제주특별자치도")).toBe("제주");
  });
});
