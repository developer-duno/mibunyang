/**
 * reverse-geocode.mjs 테스트 — 역지오코딩 순수 함수 검증
 *
 * 대상: normalizeRegion
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
    sleep: vi.fn(),
  };
});

// KAKAO_KEY 설정 — 모듈 로드 시 process.exit 방지
process.env.KAKAO_KEY = "test-key";

const { normalizeRegion } = await import("./reverse-geocode.mjs");

// ── normalizeRegion ───────────────────────────────────────────
describe("normalizeRegion", () => {
  it("서울특별시 → 서울", () => {
    expect(normalizeRegion("서울특별시")).toBe("서울");
  });

  it("부산광역시 → 부산", () => {
    expect(normalizeRegion("부산광역시")).toBe("부산");
  });

  it("경기도 → 경기", () => {
    expect(normalizeRegion("경기도")).toBe("경기");
  });

  it("세종특별자치시 → 세종", () => {
    expect(normalizeRegion("세종특별자치시")).toBe("세종");
  });

  it("강원특별자치도 → 강원", () => {
    expect(normalizeRegion("강원특별자치도")).toBe("강원");
  });

  it("강원도 → 강원 (구 명칭)", () => {
    expect(normalizeRegion("강원도")).toBe("강원");
  });

  it("전북특별자치도 → 전북", () => {
    expect(normalizeRegion("전북특별자치도")).toBe("전북");
  });

  it("충청북도 → 충북", () => {
    expect(normalizeRegion("충청북도")).toBe("충북");
  });

  it("제주특별자치도 → 제주", () => {
    expect(normalizeRegion("제주특별자치도")).toBe("제주");
  });

  it("매핑에 없는 값 → 원본 반환", () => {
    expect(normalizeRegion("알수없는지역")).toBe("알수없는지역");
  });
});
