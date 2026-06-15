import { describe, it, expect } from "vitest";
import { normalizeQuery, matchesQuery } from "./searchMatch";

describe("normalizeQuery", () => {
  it("소문자화 + 양끝/내부 일반 공백 제거", () => {
    expect(normalizeQuery("  Lake Side  ")).toBe("lakeside");
  });
  it("전각 공백(U+3000)도 제거", () => {
    expect(normalizeQuery("강서　크라운")).toBe("강서크라운");
  });
  it("공백만 입력하면 빈 문자열", () => {
    expect(normalizeQuery("   ")).toBe("");
    expect(normalizeQuery("　")).toBe("");
  });
});

describe("matchesQuery", () => {
  const apt = { name: "검단신도시 푸르지오 더 베뉴", region: "인천", gu: "서구" };

  it("빈 쿼리는 전체 통과", () => {
    expect(matchesQuery(apt, "")).toBe(true);
  });
  it("단지명 부분일치", () => {
    expect(matchesQuery(apt, "푸르지오")).toBe(true);
  });
  it("공백 무시 부분일치 (단지명 내부 공백)", () => {
    expect(matchesQuery(apt, normalizeQuery("푸르지오 더베뉴"))).toBe(true);
  });
  it("지역(시도) 일치", () => {
    expect(matchesQuery(apt, "인천")).toBe(true);
  });
  it("구 일치", () => {
    expect(matchesQuery(apt, "서구")).toBe(true);
  });
  it("미일치", () => {
    expect(matchesQuery(apt, "래미안")).toBe(false);
  });
  it("gu 누락(undefined)이어도 런타임 에러 없이 name/region 으로 매칭", () => {
    const noGu = { name: "래미안 강남", region: "서울" };
    expect(matchesQuery(noGu, "래미안")).toBe(true);
    expect(matchesQuery(noGu, "서구")).toBe(false);
  });
});
