// @ts-check
import { describe, it, expect } from "vitest";
import { resolveRegion, parseGu, unitPriceManwon, aggregateBySggu } from "./collect-housing-price.mjs";

// --- resolveRegion ---
describe("resolveRegion", () => {
  it("정식명 → 약칭 매핑 (서울특별시 → 서울)", () => {
    expect(resolveRegion("서울특별시")).toBe("서울");
    expect(resolveRegion("경기도")).toBe("경기");
    expect(resolveRegion("세종특별자치시")).toBe("세종");
  });

  it("약칭 그대로 통과", () => {
    expect(resolveRegion("서울")).toBe("서울");
    expect(resolveRegion("부산")).toBe("부산");
  });

  it("부분 매칭 (포함 관계)", () => {
    expect(resolveRegion("서울시")).toBe("서울");
  });

  it("null/undefined 입력 → null", () => {
    expect(resolveRegion(null)).toBeNull();
    expect(resolveRegion(undefined)).toBeNull();
    expect(resolveRegion("")).toBeNull();
  });

  it("매칭 불가 → null", () => {
    expect(resolveRegion("외계행성특별시")).toBeNull();
  });
});

// --- parseGu ---
describe("parseGu", () => {
  it("일반 시도 + gu → {region, gu}", () => {
    expect(parseGu("서울특별시", "종로구")).toEqual({ region: "서울", gu: "종로구" });
    expect(parseGu("경기도", "수원시")).toEqual({ region: "경기", gu: "수원시" });
  });

  it("세종 특수 처리 (sggNm 무시, gu='세종시')", () => {
    expect(parseGu("세종특별자치시", "")).toEqual({ region: "세종", gu: "세종시" });
    expect(parseGu("세종특별자치시", "임의값")).toEqual({ region: "세종", gu: "세종시" });
  });

  it("region 매칭 실패 → null", () => {
    expect(parseGu("외계행성특별시", "종로구")).toBeNull();
  });

  it("sggNm 빈 값 + 세종 외 → null", () => {
    expect(parseGu("서울특별시", "")).toBeNull();
  });
});

// --- unitPriceManwon ---
describe("unitPriceManwon", () => {
  it("정상 케이스: 공시가격 / 전용면적 / 10000 = 만원/㎡", () => {
    // 5억원 단지 / 85㎡ → 588.23 만원/㎡
    const result = unitPriceManwon({ pblntfPc: "500000000", excluseAr: "85" });
    expect(result).toBeCloseTo(588.23, 1);
  });

  it("작은 단지 케이스", () => {
    // 1억원 / 50㎡ → 200 만원/㎡
    const result = unitPriceManwon({ pblntfPc: "100000000", excluseAr: "50" });
    expect(result).toBe(200);
  });

  it("공시가격 0 → null", () => {
    expect(unitPriceManwon({ pblntfPc: "0", excluseAr: "85" })).toBeNull();
  });

  it("전용면적 0 또는 음수 → null", () => {
    expect(unitPriceManwon({ pblntfPc: "500000000", excluseAr: "0" })).toBeNull();
    expect(unitPriceManwon({ pblntfPc: "500000000", excluseAr: "-1" })).toBeNull();
  });

  it("필드 누락 → null", () => {
    expect(unitPriceManwon({})).toBeNull();
    expect(unitPriceManwon({ pblntfPc: "500000000" })).toBeNull();
    expect(unitPriceManwon({ excluseAr: "85" })).toBeNull();
  });

  it("숫자 파싱 불가 → null", () => {
    expect(unitPriceManwon({ pblntfPc: "abc", excluseAr: "85" })).toBeNull();
  });
});

// --- aggregateBySggu ---
describe("aggregateBySggu", () => {
  it("시군구별 평균 집계", () => {
    const items = [
      { ctpvNm: "서울특별시", sggNm: "종로구", pblntfPc: "500000000", excluseAr: "85" }, // 588.23
      { ctpvNm: "서울특별시", sggNm: "종로구", pblntfPc: "600000000", excluseAr: "85" }, // 705.88
      { ctpvNm: "경기도", sggNm: "수원시", pblntfPc: "400000000", excluseAr: "100" },    // 400
    ];
    const result = aggregateBySggu(items);

    const jongno = result.get("서울|종로구");
    expect(jongno).toBeDefined();
    expect(jongno?.avgUnitPrice).toBeCloseTo((588.235 + 705.882) / 2, 1);
    expect(jongno?.sampleCount).toBe(2);

    const suwon = result.get("경기|수원시");
    expect(suwon?.avgUnitPrice).toBe(400);
    expect(suwon?.sampleCount).toBe(1);
  });

  it("parseGu 실패 항목 스킵", () => {
    const items = [
      { ctpvNm: "외계행성", sggNm: "X", pblntfPc: "500000000", excluseAr: "85" },
      { ctpvNm: "서울특별시", sggNm: "종로구", pblntfPc: "500000000", excluseAr: "85" },
    ];
    const result = aggregateBySggu(items);
    expect(result.size).toBe(1);
    expect(result.has("서울|종로구")).toBe(true);
  });

  it("unitPriceManwon null 항목 스킵", () => {
    const items = [
      { ctpvNm: "서울특별시", sggNm: "종로구", pblntfPc: "0", excluseAr: "85" },         // null
      { ctpvNm: "서울특별시", sggNm: "종로구", pblntfPc: "500000000", excluseAr: "85" },   // 588.23
    ];
    const result = aggregateBySggu(items);
    expect(result.get("서울|종로구")?.sampleCount).toBe(1);
  });

  it("빈 입력 → 빈 Map", () => {
    expect(aggregateBySggu([]).size).toBe(0);
  });

  it("세종 특수 케이스", () => {
    const items = [
      { ctpvNm: "세종특별자치시", sggNm: "", pblntfPc: "400000000", excluseAr: "85" },
    ];
    const result = aggregateBySggu(items);
    expect(result.get("세종|세종시")).toBeDefined();
    expect(result.get("세종|세종시")?.avgUnitPrice).toBeCloseTo(470.59, 1);
  });
});
