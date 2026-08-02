import { describe, it, expect } from "vitest";
import { CAT_DISPLAY_ORDER, orderedCatEntries } from "./catOrder";

/**
 * 이 파일의 존재 이유 — 화면 6카테고리 순서가 서버 `catsCache` 의 JSON 키
 * 직렬화 순서에 기대고 있던 것을 끊어낸 것이 세션 487 PR-0 이다.
 * 그 회귀를 잡는 가드가 아래 "입력 키 순서를 바꿔도 결과 불변" 3건이다.
 */
describe("CAT_DISPLAY_ORDER", () => {
  it("6카테고리를 빠짐없이 한 번씩만 담는다", () => {
    expect([...CAT_DISPLAY_ORDER].sort()).toEqual(["benefit", "future", "location", "price", "product", "risk"].sort());
    expect(new Set(CAT_DISPLAY_ORDER).size).toBe(6);
  });

  it("파랑(입지)과 보라(상품)이 인접하지 않는다 — 색각이상 혼동 쌍 분리", () => {
    const li = CAT_DISPLAY_ORDER.indexOf("location");
    const pi = CAT_DISPLAY_ORDER.indexOf("product");
    expect(Math.abs(li - pi)).toBeGreaterThan(1);
  });
});

describe("orderedCatEntries — 입력 키 순서 무시", () => {
  /** 운영 catsCache 실측 순서 (1,581행 전부 이 순서였다) */
  const opsOrder = { risk: 1, price: 2, future: 3, benefit: 4, product: 5, location: 6 };
  /** calcCats 폴백 경로의 순서 (운영과 다르다 — 이 불일치가 PR-0 의 발단) */
  const fallbackOrder = { price: 2, location: 6, product: 5, benefit: 4, risk: 1, future: 3 };
  /** 일부러 뒤집은 순서 */
  const reversed = { future: 3, risk: 1, product: 5, benefit: 4, location: 6, price: 2 };

  const expected = ["price", "location", "benefit", "product", "risk", "future"];

  it("운영 catsCache 순서 입력 → CAT_DISPLAY_ORDER 순서로 나온다", () => {
    expect(orderedCatEntries(opsOrder).map(([k]) => k)).toEqual(expected);
  });

  it("폴백(calcCats) 순서 입력 → 같은 결과", () => {
    expect(orderedCatEntries(fallbackOrder).map(([k]) => k)).toEqual(expected);
  });

  it("완전히 뒤집힌 순서 입력 → 같은 결과 (이게 이 PR 의 존재 이유)", () => {
    expect(orderedCatEntries(reversed).map(([k]) => k)).toEqual(expected);
  });

  it("세 입력의 값 짝이 모두 동일하게 유지된다 (키만 재배열, 값 유실 0)", () => {
    const a = orderedCatEntries(opsOrder);
    const b = orderedCatEntries(fallbackOrder);
    const c = orderedCatEntries(reversed);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a).toEqual([
      ["price", 2],
      ["location", 6],
      ["benefit", 4],
      ["product", 5],
      ["risk", 1],
      ["future", 3],
    ]);
  });
});

describe("orderedCatEntries — 부분 데이터 방어", () => {
  it("없는 카테고리는 건너뛴다 (순서는 유지)", () => {
    expect(orderedCatEntries({ risk: 1, price: 2 }).map(([k]) => k)).toEqual(["price", "risk"]);
  });

  it("null/undefined 값은 없는 것으로 본다", () => {
    expect(orderedCatEntries({ price: 2, location: null, product: undefined, risk: 1 }).map(([k]) => k)).toEqual([
      "price",
      "risk",
    ]);
  });

  it("0 과 빈 문자열은 유효한 값이라 살아남는다 (falsy 오판 방지)", () => {
    expect(orderedCatEntries<number | string>({ price: 0, risk: "" }).map(([k]) => k)).toEqual(["price", "risk"]);
  });

  it("cats 자체가 null/undefined 면 빈 배열", () => {
    expect(orderedCatEntries(null)).toEqual([]);
    expect(orderedCatEntries(undefined)).toEqual([]);
  });

  it("6카테고리 밖의 낯선 키는 무시한다", () => {
    expect(orderedCatEntries({ price: 2, 낯선키: 9 }).map(([k]) => k)).toEqual(["price"]);
  });
});
