// @ts-check
import { describe, it, expect } from "vitest";
import { resolveRegion, parseGu, unitPriceManwon, aggregateBySggu, parseCsvLine, rowFromFields } from "./collect-housing-price.mjs";

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
  it("일반 시도 + 시군구 → {region, gu}", () => {
    expect(parseGu("서울특별시", "종로구")).toEqual({ region: "서울", gu: "종로구" });
    expect(parseGu("경기도", "수원시")).toEqual({ region: "경기", gu: "수원시" });
  });

  it("세종 특수 처리 (시군구 무시, gu='세종시')", () => {
    expect(parseGu("세종특별자치시", "")).toEqual({ region: "세종", gu: "세종시" });
    expect(parseGu("세종특별자치시", "임의값")).toEqual({ region: "세종", gu: "세종시" });
  });

  it("region 매칭 실패 → null", () => {
    expect(parseGu("외계행성특별시", "종로구")).toBeNull();
  });

  it("시군구 빈 값 + 세종 외 → null", () => {
    expect(parseGu("서울특별시", "")).toBeNull();
  });
});

// --- unitPriceManwon (한글 키: 공시가격/전용면적) ---
describe("unitPriceManwon", () => {
  it("정상 케이스: 공시가격(원) / 전용면적(㎡) / 10000 = 만원/㎡", () => {
    // 5억원 단지 / 85㎡ → 588.23 만원/㎡
    const result = unitPriceManwon({ "공시가격": "500000000", "전용면적": "85" });
    expect(result).toBeCloseTo(588.23, 1);
  });

  it("작은 단지 케이스", () => {
    // 1억원 / 50㎡ → 200 만원/㎡
    const result = unitPriceManwon({ "공시가격": "100000000", "전용면적": "50" });
    expect(result).toBe(200);
  });

  it("공시가격 0 → null", () => {
    expect(unitPriceManwon({ "공시가격": "0", "전용면적": "85" })).toBeNull();
  });

  it("전용면적 0 또는 음수 → null", () => {
    expect(unitPriceManwon({ "공시가격": "500000000", "전용면적": "0" })).toBeNull();
    expect(unitPriceManwon({ "공시가격": "500000000", "전용면적": "-1" })).toBeNull();
  });

  it("필드 누락 → null", () => {
    expect(unitPriceManwon({})).toBeNull();
    expect(unitPriceManwon({ "공시가격": "500000000" })).toBeNull();
    expect(unitPriceManwon({ "전용면적": "85" })).toBeNull();
  });

  it("숫자 파싱 불가 → null", () => {
    expect(unitPriceManwon({ "공시가격": "abc", "전용면적": "85" })).toBeNull();
  });
});

// --- aggregateBySggu (한글 키: 시도/시군구/공시가격/전용면적) ---
describe("aggregateBySggu", () => {
  it("시군구별 평균 집계", () => {
    const rows = [
      { "시도": "서울특별시", "시군구": "종로구", "공시가격": "500000000", "전용면적": "85" }, // 588.23
      { "시도": "서울특별시", "시군구": "종로구", "공시가격": "600000000", "전용면적": "85" }, // 705.88
      { "시도": "경기도", "시군구": "수원시", "공시가격": "400000000", "전용면적": "100" },    // 400
    ];
    const result = aggregateBySggu(rows);

    const jongno = result.get("서울|종로구");
    expect(jongno).toBeDefined();
    expect(jongno?.avgUnitPrice).toBeCloseTo((588.235 + 705.882) / 2, 1);
    expect(jongno?.sampleCount).toBe(2);

    const suwon = result.get("경기|수원시");
    expect(suwon?.avgUnitPrice).toBe(400);
    expect(suwon?.sampleCount).toBe(1);
  });

  it("parseGu 실패 항목 스킵", () => {
    const rows = [
      { "시도": "외계행성", "시군구": "X", "공시가격": "500000000", "전용면적": "85" },
      { "시도": "서울특별시", "시군구": "종로구", "공시가격": "500000000", "전용면적": "85" },
    ];
    const result = aggregateBySggu(rows);
    expect(result.size).toBe(1);
    expect(result.has("서울|종로구")).toBe(true);
  });

  it("unitPriceManwon null 항목 스킵", () => {
    const rows = [
      { "시도": "서울특별시", "시군구": "종로구", "공시가격": "0", "전용면적": "85" },         // null
      { "시도": "서울특별시", "시군구": "종로구", "공시가격": "500000000", "전용면적": "85" },   // 588.23
    ];
    const result = aggregateBySggu(rows);
    expect(result.get("서울|종로구")?.sampleCount).toBe(1);
  });

  it("빈 입력 → 빈 Map", () => {
    expect(aggregateBySggu([]).size).toBe(0);
  });

  it("세종 특수 케이스", () => {
    const rows = [
      { "시도": "세종특별자치시", "시군구": "", "공시가격": "400000000", "전용면적": "85" },
    ];
    const result = aggregateBySggu(rows);
    expect(result.get("세종|세종시")).toBeDefined();
    expect(result.get("세종|세종시")?.avgUnitPrice).toBeCloseTo(470.59, 1);
  });
});

// --- parseCsvLine (세션 247 W6-C v2 신규) ---
describe("parseCsvLine", () => {
  it("따옴표로 둘러싼 21 컬럼 정상 분해 (따옴표 strip)", () => {
    const line = `"2025","1","1111010100","서울특별시 종로구 자하문로36길 16-14","서울특별시","종로구","","청운동","0","1","0","","청운벽산빌리지","1","111","187.49","926000000","3","1","1","1002135465"`;
    const fields = parseCsvLine(line);
    expect(fields.length).toBe(21);
    expect(fields[4]).toBe("서울특별시");
    expect(fields[5]).toBe("종로구");
    expect(fields[16]).toBe("926000000");
  });

  it("따옴표 없는 라인 (단순 콤마 분해)", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("이스케이프된 따옴표 처리", () => {
    const line = `"단지""특수","123"`;
    const fields = parseCsvLine(line);
    expect(fields.length).toBe(2);
    expect(fields[0]).toBe(`단지"특수`);
    expect(fields[1]).toBe("123");
  });
});

// --- rowFromFields (세션 247 W6-C v2 신규) ---
describe("rowFromFields", () => {
  it("headers 와 fields zip", () => {
    const obj = rowFromFields(["시도", "시군구", "공시가격"], ["서울", "종로구", "500000000"]);
    expect(obj).toEqual({ "시도": "서울", "시군구": "종로구", "공시가격": "500000000" });
  });

  it("fields 부족 시 빈 문자열", () => {
    const obj = rowFromFields(["a", "b", "c"], ["1", "2"]);
    expect(obj).toEqual({ "a": "1", "b": "2", "c": "" });
  });
});
