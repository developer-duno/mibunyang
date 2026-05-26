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

const { resolveRegion, parseGu, parseHouseholds } = await import("./population.mjs");

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
  // 자치구 직접 (서울 등)
  it("(서울특별시, '강남구') — 자치구 직접 (sggNm 단어 1개)", () => {
    expect(parseGu("서울특별시", "강남구")).toEqual({ region: "서울", gu: "강남구" });
  });

  // 경기도 자치구 — sggNm 그대로
  it("(경기도, '수원시 팔달구') — 자치구 단위 (sggNm 그대로)", () => {
    expect(parseGu("경기도", "수원시 팔달구")).toEqual({ region: "경기", gu: "수원시 팔달구" });
  });

  // 경기도 시 합계 — sggNm 단어 1개
  it("(경기도, '수원시') — 시 합계 행", () => {
    expect(parseGu("경기도", "수원시")).toEqual({ region: "경기", gu: "수원시" });
  });

  // 세종 특수 처리
  it("(세종특별자치시, anything) → 세종 + 세종시", () => {
    expect(parseGu("세종특별자치시", "")).toEqual({ region: "세종", gu: "세종시" });
    expect(parseGu("세종특별자치시", "어진동")).toEqual({ region: "세종", gu: "세종시" });
  });

  // sggNm 부재 + 비세종 시 null
  it("sggNm 부재 + 비세종 시 null", () => {
    expect(parseGu("경기도", null)).toBeNull();
    expect(parseGu("경기도", "")).toBeNull();
    expect(parseGu("경기도", undefined)).toBeNull();
  });

  // ctpvNm 매칭 불가 시 null
  it("ctpvNm 매칭 불가 시 null", () => {
    expect(parseGu("미지의땅", "수원시")).toBeNull();
    expect(parseGu(null, "강남구")).toBeNull();
  });
});

describe("parseHouseholds", () => {
  // 정상값 — 정수 그대로
  it("'72618' → 72618", () => {
    expect(parseHouseholds("72618")).toBe(72618);
  });

  // 콤마 포함 — 콤마 제거 후 정수
  it("'4,097,562' → 4097562 (콤마 제거)", () => {
    expect(parseHouseholds("4,097,562")).toBe(4097562);
  });

  // 숫자 입력
  it("숫자 1234 → 1234", () => {
    expect(parseHouseholds(1234)).toBe(1234);
  });

  // 0 / 음수 / 빈값 / null / undefined → null
  it("0 / 음수 / 빈값 / null / undefined → null", () => {
    expect(parseHouseholds("0")).toBeNull();
    expect(parseHouseholds("-100")).toBeNull();
    expect(parseHouseholds("")).toBeNull();
    expect(parseHouseholds(null)).toBeNull();
    expect(parseHouseholds(undefined)).toBeNull();
  });

  // NaN 케이스 (비숫자 문자열) → null
  it("비숫자 문자열 → null", () => {
    expect(parseHouseholds("abc")).toBeNull();
  });
});
