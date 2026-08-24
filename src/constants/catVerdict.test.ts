import { describe, it, expect } from "vitest";
import { catVerdict } from "./catVerdict";
import { gr } from "@/theme";
import type { Res } from "@/types/scoring";

// 미니카드 결론 1줄 — 세션 409 D2b. 적대검증 2라운드(임계 70/50 gr 정합, price deviation
// fairPrice 판별, benefit noData, factory undefined 무크래시) 반영.
function mk(over: Partial<Res> = {}): Res {
  return { total: 50, subs: [], ...over };
}

describe("catVerdict — 6 카테고리 × 3 구간 (임계 70/50 inclusive)", () => {
  const cases: Array<[string, number, string]> = [
    ["location", 80, "입지 우수"],
    ["location", 70, "입지 우수"],
    ["location", 69, "입지 양호"],
    ["location", 50, "입지 양호"],
    ["location", 49, "입지 아쉬움"],
    ["product", 75, "상품성 우수"],
    ["product", 60, "상품성 무난"],
    ["product", 30, "상품성 미흡"],
    ["risk", 90, "안전성 높음"],
    ["risk", 55, "안전성 보통"],
    ["risk", 10, "위험 요소 주의"],
    ["future", 70, "미래가치 밝음"],
    ["future", 51, "성장 잠재력 보통"],
    ["future", 0, "미래가치 제한적"],
  ];
  for (const [k, total, expected] of cases) {
    it(`${k} total=${total} → "${expected}"`, () => {
      expect(catVerdict(k, mk({ total }))).toBe(expected);
    });
  }
});

describe("catVerdict — 임계 70/50 이 gr() 등급 경계와 정합", () => {
  // 같은 카드에 등급(gr)+결론이 나란히 노출되므로 경계가 어긋나면 톤 모순.
  // 70=B+(good 시작), 50=C(mid 시작) — 어느 등급도 verdict 경계를 걸치지 않아야.
  it("70점은 gr B+ 이고 verdict 도 상위 문구", () => {
    expect(gr(70).l).toBe("B+");
    expect(catVerdict("location", mk({ total: 70 }))).toBe("입지 우수");
  });
  it("50점은 gr C 이고 verdict 도 중간 문구", () => {
    expect(gr(50).l).toBe("C");
    expect(catVerdict("location", mk({ total: 50 }))).toBe("입지 양호");
  });
  it("49점은 gr D 이고 verdict 도 하위 문구", () => {
    expect(gr(49).l).toBe("D");
    expect(catVerdict("location", mk({ total: 49 }))).toBe("입지 아쉬움");
  });
});

describe("catVerdict — price 는 적정가 괴리(deviation) 실측 우선", () => {
  it("fairPrice>0 + deviation 양수 → 저렴", () => {
    expect(catVerdict("price", mk({ total: 40, fairPrice: 50000, deviation: "12.3" }))).toBe("적정가 대비 12% 저렴");
  });
  it("fairPrice>0 + deviation 음수 → 비쌈 (절댓값 표기)", () => {
    expect(catVerdict("price", mk({ total: 80, fairPrice: 50000, deviation: "-18.7" }))).toBe("적정가 대비 19% 비쌈");
  });
  // 세션531: 경계가 0 → ±DEV_NEUTRAL_BAND_PCT(10). 그 폭은 우리 적정가 추정 자체의 흔들림
  //   (중앙 ±11.5%p)에서 왔다 — 그보다 작은 차이로 방향을 단정하지 않는다.
  //   `subContext`·`cardChips` 와 같은 상수를 써야 한 단지가 화면마다 다른 말을 안 듣는다.
  //   옛 경계(0)로 되돌리면 아래가 red.
  it.each(["-9.9", "9.9", "-3.2", "3.2"])("밴드 안(%s%%)이면 방향을 단정하지 않는다 (세션531)", (d) => {
    expect(catVerdict("price", mk({ total: 80, fairPrice: 50000, deviation: d }))).toBe("적정가 수준");
  });
  it("fairPrice>0 + deviation 0 → '적정가 수준' (진짜 0% 괴리 정직 표기)", () => {
    expect(catVerdict("price", mk({ total: 60, fairPrice: 50000, deviation: "0.0" }))).toBe("적정가 수준");
  });
  it("fairPrice=0 (적정가 산출 실패) → 점수 폴백 대신 '적정가 산출 불가' (세션512)", () => {
    // scorePrice.ts:116 데이터 부재 분기 = fairPrice:0, deviation:"0.0". 부호 분기로 가면 거짓 표시.
    expect(catVerdict("price", mk({ total: 72, fairPrice: 0, deviation: "0.0" }))).toBe("적정가 산출 불가");
  });
  it("deviation/fairPrice undefined (factory 기본값) → 점수 문구 폴백, 무크래시", () => {
    expect(catVerdict("price", mk({ total: 45 }))).toBe("적정가 산출 불가");
  });

  // ⚠️ 세션512 — 적정가를 못 만든 74곳에게 "주변 대비 부담"이라 단정하고 있었다. 분양가도 모르고
  //    주변과 비교한 적도 없는데 나쁘다고 말한 것이다(낮은 총점은 기본값이 만든 값이지 관측이 아니다).
  //    옛 문구가 돌아오면 red.
  it("적정가를 못 만들면 '주변 대비'라 말하지 않는다 (세션512)", () => {
    for (const total of [10, 45, 72]) {
      expect(catVerdict("price", mk({ total, fairPrice: 0 }))).not.toMatch(/주변/);
    }
    // 총점 폴백 문구 자체에서도 '주변 대비'를 뺐다 — 이 축은 주변 단지를 직접 비교하지 않는다
    expect(catVerdict("location", mk({ total: 20 }))).not.toMatch(/주변/);
  });
  it("deviation number 0 + fairPrice number 0 (engine 폴백) → '적정가 산출 불가' (세션512)", () => {
    // fairPrice=0 은 적정가를 못 만들었다는 뜻이라, deviation 이 숫자 0 이어도 "적정"이라 말할 수 없다.
    expect(catVerdict("price", mk({ total: 55, fairPrice: 0, deviation: 0 }))).toBe("적정가 산출 불가");
  });
});

describe("catVerdict — benefit noData", () => {
  it("noData=true → '혜택 정보 없음' (점수 무관)", () => {
    expect(catVerdict("benefit", mk({ total: 0, noData: true }))).toBe("혜택 정보 없음");
  });
  it("noData=false → 점수 문구", () => {
    expect(catVerdict("benefit", mk({ total: 75, noData: false }))).toBe("혜택 풍부");
  });
  it("noData 미설정(undefined) → 점수 문구", () => {
    expect(catVerdict("benefit", mk({ total: 55 }))).toBe("혜택 양호");
  });
});

describe("catVerdict — 미지 카테고리 폴백", () => {
  it("VERDICT 에 없는 키 → '—'", () => {
    expect(catVerdict("unknown", mk({ total: 80 }))).toBe("—");
  });
});
