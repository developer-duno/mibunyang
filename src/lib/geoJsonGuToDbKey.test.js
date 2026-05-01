import { describe, it, expect } from "vitest";
import { geoSigunguToByGuKey } from "./geoJsonGuToDbKey";

const f = (code, name) => ({ properties: { code, name } });

describe("geoSigunguToByGuKey", () => {
  it("일반 시군구 → region|gu", () => {
    expect(geoSigunguToByGuKey(f("11680", "강남구"))).toBe("서울|강남구");
    expect(geoSigunguToByGuKey(f("21260", "수영구"))).toBe("부산|수영구");
  });

  it("창원 5구 모두 같은 키 (경남|창원시 합산)", () => {
    const codes = ["38111", "38112", "38113", "38114", "38115"];
    const names = ["창원시의창구", "창원시성산구", "창원시마산합포구", "창원시마산회원구", "창원시진해구"];
    const keys = codes.map((c, i) => geoSigunguToByGuKey(f(c, names[i])));
    expect(keys).toEqual([
      "경남|창원시", "경남|창원시", "경남|창원시", "경남|창원시", "경남|창원시",
    ]);
  });

  it("청주 2구 모두 같은 키 (충북|청주시 합산)", () => {
    expect(geoSigunguToByGuKey(f("33011", "청주시상당구"))).toBe("충북|청주시");
    expect(geoSigunguToByGuKey(f("33012", "청주시흥덕구"))).toBe("충북|청주시");
  });

  it("일반 군 (XX군) name 그대로", () => {
    expect(geoSigunguToByGuKey(f("38390", "거창군"))).toBe("경남|거창군");
    expect(geoSigunguToByGuKey(f("31200", "가평군"))).toBe("경기|가평군");
  });

  it("동명이구 — code prefix 로 region 분리", () => {
    expect(geoSigunguToByGuKey(f("11160", "강서구"))).toBe("서울|강서구");
    expect(geoSigunguToByGuKey(f("21120", "강서구"))).toBe("부산|강서구");
    // 동구 5곳 (울산/광주/인천/대구/부산) 모두 분리
    expect(geoSigunguToByGuKey(f("26030", "동구"))).toBe("울산|동구");
    expect(geoSigunguToByGuKey(f("21030", "동구"))).toBe("부산|동구");
  });

  it("잘못된 입력 → null", () => {
    expect(geoSigunguToByGuKey(null)).toBe(null);
    expect(geoSigunguToByGuKey({})).toBe(null);
    expect(geoSigunguToByGuKey(f("", "강남구"))).toBe(null);
    expect(geoSigunguToByGuKey(f("1", "강남구"))).toBe(null);   // code 1자리
    expect(geoSigunguToByGuKey(f("99999", "외계구"))).toBe(null); // 매핑 없는 prefix
    expect(geoSigunguToByGuKey(f("11680", ""))).toBe(null);     // 빈 name
  });
});
