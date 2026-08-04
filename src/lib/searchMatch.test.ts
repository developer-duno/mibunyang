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

describe("matchesQuery — 초성 검색", () => {
  const hannam = { name: "한남더힐", region: "서울", gu: "용산구" };
  const dongtan = { name: "동탄역 롯데캐슬", region: "경기", gu: "화성시" };

  it("초성 검색: 'ㅎㄴ' → 한남", () => {
    expect(matchesQuery(hannam, "ㅎㄴ")).toBe(true);
  });
  it("초성 검색: 'ㄷㅌ' → 동탄 (동=ㄷ, 탄=ㅌ)", () => {
    expect(matchesQuery(dongtan, "ㄷㅌ")).toBe(true);
  });
  it("'ㄷㅇ'는 동탄의 초성이 아니므로 매칭 안 됨(안내 예시 정정 근거)", () => {
    expect(matchesQuery(dongtan, "ㄷㅇ")).toBe(false);
  });
  it("초성 검색은 지역·구에도 적용 ('ㅇㅅ' → 용산구)", () => {
    expect(matchesQuery(hannam, "ㅇㅅ")).toBe(true);
  });
  it("초성 미일치는 false ('ㄱㄴ' → 한남 아님)", () => {
    expect(matchesQuery(hannam, "ㄱㄴ")).toBe(false);
  });
  it("겹자음 초성도 매칭 ('ㄲ' → 꿈에그린)", () => {
    expect(matchesQuery({ name: "꿈에그린", region: "부산", gu: "해운대구" }, "ㄲ")).toBe(true);
  });
  it("완성형+초성 혼합('한ㄴ')은 초성 검색이 아니라 일반 부분일치로 폴백(→ false)", () => {
    expect(matchesQuery(hannam, "한ㄴ")).toBe(false);
  });
  it("완성형 검색은 기존대로 동작(초성 로직에 영향 없음)", () => {
    expect(matchesQuery(hannam, "한남")).toBe(true);
  });
});
