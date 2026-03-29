/**
 * migration.mjs 테스트 — 전입/전출 순수 함수 검증
 *
 * 대상: resolveRegion, parseGu
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
    today: vi.fn(() => "2026-03-30"),
    recordApiQuota: vi.fn(),
    REGION_MAP: orig.REGION_MAP,
  };
});

// MOIS_POP_KEY 설정 — 모듈 로드 시 process.exit 방지
process.env.MOIS_POP_KEY = "test-key";

const { resolveRegion, parseGu } = await import("./migration.mjs");

// ── resolveRegion ─────────────────────────────────────────────
describe("resolveRegion", () => {
  it("정확한 매칭 '서울특별시' → '서울'", () => {
    expect(resolveRegion("서울특별시")).toBe("서울");
  });

  it("정확한 매칭 '경기도' → '경기'", () => {
    expect(resolveRegion("경기도")).toBe("경기");
  });

  it("부분 매칭 '부산' → '부산'", () => {
    expect(resolveRegion("부산")).toBe("부산");
  });

  it("null → null", () => {
    expect(resolveRegion(null)).toBeNull();
  });

  it("매칭 불가 → null", () => {
    expect(resolveRegion("알수없는지역")).toBeNull();
  });

  it("세종특별자치시 → 세종", () => {
    expect(resolveRegion("세종특별자치시")).toBe("세종");
  });
});

// ── parseGu ───────────────────────────────────────────────────
describe("parseGu", () => {
  it("'서울특별시 강남구' → { region: '서울', gu: '강남구' }", () => {
    const result = parseGu("서울특별시 강남구");
    expect(result).toEqual({ region: "서울", gu: "강남구" });
  });

  it("'경기도 수원시' → { region: '경기', gu: '수원시' }", () => {
    const result = parseGu("경기도 수원시");
    expect(result).toEqual({ region: "경기", gu: "수원시" });
  });

  it("세종특별자치시 → { region: '세종', gu: '세종시' }", () => {
    const result = parseGu("세종특별자치시 아무동");
    expect(result).toEqual({ region: "세종", gu: "세종시" });
  });

  it("단어 1개만 → null", () => {
    expect(parseGu("서울")).toBeNull();
  });

  it("알 수 없는 시도 → null", () => {
    expect(parseGu("미국 뉴욕")).toBeNull();
  });

  it("앞뒤 공백 trim", () => {
    const result = parseGu("  서울특별시  종로구  ");
    expect(result).toEqual({ region: "서울", gu: "종로구" });
  });
});
