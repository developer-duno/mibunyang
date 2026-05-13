// @ts-check
/**
 * population-sex-age.mjs 테스트 — 지역명 해석, 성/연령 파싱 검증 (세션 242 W6-A)
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getMibuyangSupabase: vi.fn(), getSupabase: vi.fn() };
});

const { resolveRegion, parseGu, parseSexAge, AGE_BUCKETS } = await import("./population-sex-age.mjs");

describe("resolveRegion", () => {
  it("'서울특별시' → '서울'", () => {
    expect(resolveRegion("서울특별시")).toBe("서울");
  });
  it("'경기도' → '경기'", () => {
    expect(resolveRegion("경기도")).toBe("경기");
  });
  it("null 입력 시 null", () => {
    expect(resolveRegion(null)).toBeNull();
    expect(resolveRegion(undefined)).toBeNull();
    expect(resolveRegion("")).toBeNull();
  });
});

describe("parseGu", () => {
  it("서울 종로구 정상 자리", () => {
    expect(parseGu("서울특별시", "종로구")).toEqual({ region: "서울", gu: "종로구" });
  });
  it("세종 자리 = gu 무시 후 '세종시' 자리", () => {
    expect(parseGu("세종특별자치시", "")).toEqual({ region: "세종", gu: "세종시" });
  });
  it("ctpvNm 미상 → null", () => {
    expect(parseGu("미상", "강남구")).toBeNull();
  });
  it("sggNm 빈 자리 (서울/경기 등) → null", () => {
    expect(parseGu("서울특별시", "")).toBeNull();
  });
});

describe("parseSexAge", () => {
  // sample 응답 박제 (서울 종로구, 202602)
  const sample = {
    stdgCd: "1111000000",
    ctpvNm: "서울특별시",
    sggNm: "종로구",
    statsYm: "202602",
    totNmprCnt: "136764",
    maleNmprCnt: "65495",
    femlNmprCnt: "71269",
    male0AgeNmprCnt: "2577",
    male10AgeNmprCnt: "4480",
    male20AgeNmprCnt: "9313",
    male30AgeNmprCnt: "9859",
    male40AgeNmprCnt: "8671",
    male50AgeNmprCnt: "11170",
    male60AgeNmprCnt: "10458",
    male70AgeNmprCnt: "5861",
    male80AgeNmprCnt: "2704",
    male90AgeNmprCnt: "391",
    male100AgeNmprCnt: "11",
    feml0AgeNmprCnt: "2464",
    feml10AgeNmprCnt: "4702",
    feml20AgeNmprCnt: "10782",
    feml30AgeNmprCnt: "9927",
    feml40AgeNmprCnt: "9420",
    feml50AgeNmprCnt: "11604",
    feml60AgeNmprCnt: "10521",
    feml70AgeNmprCnt: "6819",
    feml80AgeNmprCnt: "4160",
    feml90AgeNmprCnt: "846",
    feml100AgeNmprCnt: "24",
  };

  it("totalMale/totalFeml/total 자리 정확 자리", () => {
    const b = parseSexAge(sample);
    expect(b.totalMale).toBe(65495);
    expect(b.totalFeml).toBe(71269);
    expect(b.total).toBe(136764);
    expect(b.statsYm).toBe("202602");
  });

  it("male/feml 11 연령대 (age0~age100) 자리 채움", () => {
    const b = parseSexAge(sample);
    expect(Object.keys(b.male)).toHaveLength(AGE_BUCKETS.length);
    expect(Object.keys(b.feml)).toHaveLength(AGE_BUCKETS.length);
    expect(b.male.age0).toBe(2577);
    expect(b.male.age50).toBe(11170);
    expect(b.male.age100).toBe(11);
    expect(b.feml.age40).toBe(9420);
    expect(b.feml.age100).toBe(24);
  });

  it("연령대 합산 = totalMale 자리 검증", () => {
    const b = parseSexAge(sample);
    const sumMale = Object.values(b.male).reduce((s, n) => s + n, 0);
    expect(sumMale).toBe(b.totalMale);
  });

  it("필드 누락 자리 = 0 fallback", () => {
    const partial = /** @type {Record<string, unknown>} */ ({
      ctpvNm: "서울특별시", sggNm: "종로구", statsYm: "202602",
      totNmprCnt: "100", maleNmprCnt: "50", femlNmprCnt: "50",
      // 연령대 필드 0개 자리
    });
    const b = parseSexAge(partial);
    expect(b.male.age0).toBe(0);
    expect(b.feml.age100).toBe(0);
  });

  it("필드 null/undefined 자리 = 0 fallback", () => {
    const nullish = /** @type {Record<string, unknown>} */ ({
      ctpvNm: "서울", sggNm: "강남구", statsYm: "202602",
      totNmprCnt: null, maleNmprCnt: undefined, femlNmprCnt: "0",
      male0AgeNmprCnt: null,
    });
    const b = parseSexAge(nullish);
    expect(b.total).toBe(0);
    expect(b.totalMale).toBe(0);
    expect(b.male.age0).toBe(0);
  });
});

describe("AGE_BUCKETS", () => {
  it("11 연령대 (0, 10, ..., 100)", () => {
    expect(AGE_BUCKETS).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(AGE_BUCKETS.length).toBe(11);
  });
});
