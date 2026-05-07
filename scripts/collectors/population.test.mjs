// @ts-check
/**
 * population.mjs 테스트 — 지역명 해석, 시군구 파싱 검증
 */
import { describe, it, expect, vi } from "vitest";

// loadEnv + 외부 API 호출 방지
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getMibuyangSupabase: vi.fn(), getSupabase: vi.fn() };
});

const { resolveRegion, parseGu } = await import("./population.mjs");

describe("resolveRegion", () => {
  // 정확 매칭: 풀네임 → 약칭
  it("'경기도' → '경기'", () => {
    expect(resolveRegion("경기도")).toBe("경기");
  });

  it("'서울특별시' → '서울'", () => {
    expect(resolveRegion("서울특별시")).toBe("서울");
  });

  it("'세종특별자치시' → '세종'", () => {
    expect(resolveRegion("세종특별자치시")).toBe("세종");
  });

  // null 안전
  it("null 입력 시 null을 반환한다", () => {
    expect(resolveRegion(null)).toBeNull();
  });

  // 매칭 불가
  it("매칭 불가한 문자열은 null을 반환한다", () => {
    expect(resolveRegion("미지의땅")).toBeNull();
  });
});

describe("parseGu", () => {
  // 정상: "서울특별시 강남구"
  it("'서울특별시 강남구' 파싱", () => {
    const result = parseGu("서울특별시 강남구");
    expect(result).toEqual({ region: "서울", gu: "강남구" });
  });

  // 경기도 시군구 (3단어)
  it("'경기도 수원시 팔달구' 파싱 — 2번째 토큰을 gu로", () => {
    const result = parseGu("경기도 수원시 팔달구");
    expect(result).not.toBeNull();
    expect(result?.region).toBe("경기");
    expect(result?.gu).toBe("수원시");
  });

  // 세종 특수 처리
  it("세종특별자치시 → 세종 + 세종시", () => {
    const result = parseGu("세종특별자치시 어진동");
    expect(result).toEqual({ region: "세종", gu: "세종시" });
  });

  // 파싱 불가
  it("단일 단어 입력은 null을 반환한다", () => {
    expect(parseGu("서울")).toBeNull();
  });
});
