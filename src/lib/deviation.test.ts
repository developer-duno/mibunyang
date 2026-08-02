import { describe, it, expect } from "vitest";
import { computeDeviation, deviationText, deviationAriaLabel } from "./deviation";
import { CARD_DEVIATION_FIELDS, OVERVIEW_DEVIATION_FIELDS, deviationSpec } from "@/constants/deviationFields";
import { computeRegionalStats, NATIONAL_KEY, type RegionalStats } from "@/scoring/regionalStats";
import type { Apt } from "@/types/scoring";

const priceSpec = deviationSpec("price")!;
const unsoldSpec = deviationSpec("unsoldRate")!;
const subwaySpec = deviationSpec("subwayDist")!;
const jeonseSpec = deviationSpec("jeonseRate")!;

function rows(region: string, field: string, values: (number | null)[]): Apt[] {
  return values.map((v) => ({ region, [field]: v }) as unknown as Apt);
}

/** 서울에 n개, 값이 1..n 인 분포를 만든다 */
function seoul(field: string, n: number): RegionalStats {
  return computeRegionalStats(
    rows(
      "서울",
      field,
      Array.from({ length: n }, (_, i) => i + 1)
    ),
    [field]
  );
}

describe("G3 본인값 게이트 — 미수집", () => {
  const stats = seoul("price", 30);

  it("값이 null 이면 미수집", () => {
    const d = computeDeviation(priceSpec, null, "서울", stats);
    expect(d.state).toBe("missing");
    expect(d.text).toBe("미수집");
    expect(d.fav).toBeNull();
  });

  it("센티널이면 미수집 — 9999m 를 '아주 먼 진짜 값'으로 그리지 않는다", () => {
    const s = seoul("subwayDist", 30);
    const d = computeDeviation(subwaySpec, 9999, "서울", s);
    expect(d.state).toBe("missing");
    expect(d.text).toBe("미수집");
  });

  it("통계 자체가 없으면 미수집", () => {
    expect(computeDeviation(priceSpec, 100, "서울", null).state).toBe("missing");
  });

  it("값 0 은 미수집이 아니다 — 미분양 0%% 는 오히려 좋은 값", () => {
    const s = computeRegionalStats(
      rows(
        "서울",
        "unsoldRate",
        Array.from({ length: 30 }, (_, i) => i)
      ),
      ["unsoldRate"]
    );
    const d = computeDeviation(unsoldSpec, 0, "서울", s);
    expect(d.state).toBe("ok");
    expect(d.tone).toBe("good"); // 낮을수록 좋은 지표라 0 은 유리 쪽
  });
});

describe("MAD 의 성질 — 절반 이상이 같으면 mad 가 0 이 된다", () => {
  /**
   * 이 테스트를 쓰다가 실제로 걸렸다. 중위절대편차는 "가운데" 를 보므로
   * 표본의 과반이 한 값이면 나머지가 아무리 흩어져 있어도 mad 는 0 이다.
   * 즉 G2 는 "완전히 똑같을 때"뿐 아니라 **"과반이 한 값에 뭉쳐 있을 때"**도
   * 막대를 지운다. 의도된 보수성이라 그대로 두되, 잊지 않도록 박제한다.
   */
  it("과반이 한 값이면 나머지가 흩어져 있어도 uniform 으로 본다", () => {
    const vals = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, ...Array(20).fill(5)];
    const s = computeRegionalStats(rows("서울", "unsoldRate", vals), ["unsoldRate"]);
    expect(s["서울"].unsoldRate.mad).toBe(0);
    expect(s["서울"].unsoldRate.distinct).toBeGreaterThan(2); // 값 자체는 여러 종류인데도
    expect(computeDeviation(unsoldSpec, 0, "서울", s).state).toBe("uniform");
  });

  it("고르게 흩어져 있으면 mad 가 0 이 아니라 통과한다", () => {
    const s = computeRegionalStats(
      rows(
        "서울",
        "unsoldRate",
        Array.from({ length: 30 }, (_, i) => i)
      ),
      ["unsoldRate"]
    );
    expect(s["서울"].unsoldRate.mad).toBeGreaterThan(0);
  });
});

describe("G1 표본 게이트", () => {
  it("시도 n≥20 이면 그 시도 기준 (전국 배지 없음)", () => {
    const d = computeDeviation(priceSpec, 5, "서울", seoul("price", 30));
    expect(d.state).toBe("ok");
    expect(d.nationalFallback).toBe(false);
  });

  it("8 ≤ n < 20 이면 전국 기준으로 그리고 배지를 켠다", () => {
    // 제주 10개 + 서울 30개 → 제주는 시도 임계 미달, 전국(40)은 충분
    const all = [...rows("제주", "price", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), ...rows("서울", "price", [11, 12, 13, 14])];
    const stats = computeRegionalStats(all, ["price"]);
    const d = computeDeviation(priceSpec, 1, "제주", stats);
    expect(d.state).toBe("ok");
    expect(d.nationalFallback).toBe(true);
  });

  it("전국 표본도 8 미만이면 아예 그리지 않는다", () => {
    const stats = computeRegionalStats(rows("제주", "price", [1, 2, 3]), ["price"]);
    const d = computeDeviation(priceSpec, 1, "제주", stats);
    expect(d.state).toBe("sparse");
    expect(d.text).toBe("비교할 단지가 적어요");
    expect(d.fav).toBeNull();
  });

  it("모르는 지역이면 전국으로 떨어진다", () => {
    const d = computeDeviation(priceSpec, 5, "없는지역", seoul("price", 30));
    expect(d.state).toBe("ok");
    expect(d.nationalFallback).toBe(true);
  });
});

describe("G2 변별력 게이트 — 이 설계의 구조적 방어선", () => {
  it("그 지역이 전부 같은 값이면 막대를 그리지 않는다", () => {
    const stats = computeRegionalStats(rows("경기", "price", Array(30).fill(500)), ["price"]);
    const d = computeDeviation(priceSpec, 500, "경기", stats);
    expect(d.state).toBe("uniform");
    expect(d.text).toBe("이 지역은 다 같아요");
  });

  it("distinct 가 2 이하이면 그리지 않는다", () => {
    const vals = [...Array(15).fill(100), ...Array(15).fill(200)];
    const stats = computeRegionalStats(rows("경기", "price", vals), ["price"]);
    expect(computeDeviation(priceSpec, 100, "경기", stats).state).toBe("uniform");
  });

  it("필드명을 하드코딩하지 않아도 지역 상수 필드가 스스로 빠진다", () => {
    // popGrowth 는 실측상 17개 시도 전부 지역 단일값이다.
    const fakeSpec = { ...priceSpec, field: "popGrowth" };
    const stats = computeRegionalStats(rows("경기", "popGrowth", Array(543).fill(-0.5)), ["popGrowth"]);
    expect(computeDeviation(fakeSpec, -0.5, "경기", stats).state).toBe("uniform");
  });

  it("mad 가 0 이 아니면 통과한다", () => {
    const stats = seoul("price", 30);
    expect(computeDeviation(priceSpec, 5, "서울", stats).state).toBe("ok");
  });
});

describe("fav — 막대는 항상 오른쪽이 유리", () => {
  it("낮을수록 좋은 지표는 싼 쪽이 fav 높음", () => {
    const stats = seoul("price", 100); // 1..100
    const cheap = computeDeviation(priceSpec, 5, "서울", stats);
    const pricey = computeDeviation(priceSpec, 95, "서울", stats);
    expect(cheap.fav!).toBeGreaterThan(pricey.fav!);
    expect(cheap.tone).toBe("good");
    expect(pricey.tone).toBe("bad");
  });

  it("높을수록 좋은 지표는 큰 쪽이 fav 높음", () => {
    const stats = seoul("jeonseRate", 100);
    const high = computeDeviation(jeonseSpec, 95, "서울", stats);
    const low = computeDeviation(jeonseSpec, 5, "서울", stats);
    expect(high.fav!).toBeGreaterThan(low.fav!);
    expect(high.tone).toBe("good");
    expect(low.tone).toBe("bad");
  });

  it("fav 는 0~100 범위를 벗어나지 않는다", () => {
    const stats = seoul("price", 50);
    for (const v of [-999, 0, 1, 25, 50, 999]) {
      const d = computeDeviation(priceSpec, v, "서울", stats);
      if (d.fav != null) {
        expect(d.fav).toBeGreaterThanOrEqual(0);
        expect(d.fav).toBeLessThanOrEqual(100);
      }
    }
  });

  it("한가운데면 '평균 수준' + 중립", () => {
    const stats = seoul("price", 101); // 중앙값 51
    const d = computeDeviation(priceSpec, 51, "서울", stats);
    expect(d.text).toBe("평균 수준");
    expect(d.tone).toBe("neutral");
    expect(d.state).toBe("ok");
  });
});

describe("deviationText — 값 슬롯 문장", () => {
  it("퍼센트 지표: 부호 없이 '12% 싸요'", () => {
    expect(deviationText(priceSpec, 88, 100, true)).toBe("12% 싸요");
    expect(deviationText(priceSpec, 108, 100, false)).toBe("8% 비싸요");
  });

  it("퍼센트 지표에 마이너스 부호가 절대 안 나온다 (막대 방향과 충돌 차단)", () => {
    for (const v of [10, 50, 88, 150, 300]) {
      expect(deviationText(priceSpec, v, 100, v < 100)).not.toContain("-");
      expect(deviationText(priceSpec, v, 100, v < 100)).not.toContain("−");
    }
  });

  it("이미 % 인 지표는 %p 로 말한다", () => {
    expect(deviationText(unsoldSpec, 18, 15, false)).toBe("3%p 많아요");
    expect(deviationText(unsoldSpec, 12, 15, true)).toBe("3%p 적어요");
  });

  it("%p 가 1 미만이면 소수 한 자리", () => {
    expect(deviationText(unsoldSpec, 15.4, 15, false)).toBe("0.4%p 많아요");
  });

  it("거리는 2배 넘게 멀면 배수로 말한다", () => {
    expect(deviationText(subwaySpec, 1200, 400, false)).toBe("3배 멀어요");
    expect(deviationText(subwaySpec, 1000, 400, false)).toBe("2.5배 멀어요");
  });

  it("거리가 2배 이내면 퍼센트", () => {
    expect(deviationText(subwaySpec, 236, 400, true)).toBe("41% 가까워요");
  });

  it("차이가 반올림해서 0 이면 '평균 수준'", () => {
    expect(deviationText(priceSpec, 100.2, 100, true)).toBe("평균 수준");
    expect(deviationText(unsoldSpec, 15, 15, true)).toBe("평균 수준");
  });

  it("중위값이 0 이어도 나눗셈이 터지지 않는다", () => {
    expect(deviationText(priceSpec, 10, 0, false)).toBe("비싸요");
    expect(deviationText(subwaySpec, 10, 0, false)).toBe("멀어요");
  });
});

describe("deviationAriaLabel", () => {
  const stats = seoul("price", 30);

  it("'점수' 라는 글자를 절대 넣지 않는다 (DetailModal 테스트 쿼리와 충돌)", () => {
    for (const value of [1, 15, 30, null]) {
      const d = computeDeviation(priceSpec, value, "서울", stats);
      expect(deviationAriaLabel(priceSpec, d, "서울", "3억")).not.toContain("점수");
    }
  });

  it("정상이면 어디와 견줬는지 말한다", () => {
    const d = computeDeviation(priceSpec, 3, "서울", stats);
    const label = deviationAriaLabel(priceSpec, d, "서울", "3억");
    expect(label).toContain("서울");
    expect(label).toContain("분양가");
  });

  it("전국 폴백이면 '전국' 이라 말한다", () => {
    const all = [...rows("제주", "price", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), ...rows("서울", "price", [11, 12, 13, 14])];
    const d = computeDeviation(priceSpec, 1, "제주", computeRegionalStats(all, ["price"]));
    expect(deviationAriaLabel(priceSpec, d, "제주", "1억")).toContain("전국");
  });

  it("미수집이면 그렇다고 말한다", () => {
    const d = computeDeviation(priceSpec, null, "서울", stats);
    expect(deviationAriaLabel(priceSpec, d, "서울", "—")).toContain("자료가 아직 없습니다");
  });
});

describe("deviationFields 정의 자체의 불변식", () => {
  it("카드 3줄은 팝업 8줄의 앞부분이다 — 읽는 법이 이어지게", () => {
    expect(OVERVIEW_DEVIATION_FIELDS.slice(0, 3)).toEqual(CARD_DEVIATION_FIELDS);
  });

  it("모든 필드가 better 방향을 갖는다", () => {
    for (const f of OVERVIEW_DEVIATION_FIELDS) {
      expect(["low", "high"], `${f.field} 의 better`).toContain(f.better);
    }
  });

  it("모든 필드가 라벨·양끝 끝말·문장 조각을 갖는다", () => {
    for (const f of OVERVIEW_DEVIATION_FIELDS) {
      for (const key of ["label", "lowWord", "highWord", "goodWord", "badWord"] as const) {
        expect(f[key], `${f.field}.${key}`).toBeTruthy();
      }
    }
  });

  it("필드명이 중복되지 않는다", () => {
    const names = OVERVIEW_DEVIATION_FIELDS.map((f) => f.field);
    expect(new Set(names).size).toBe(names.length);
  });

  it("채움률 0% 인 supplyRatio 는 등재되지 않는다", () => {
    expect(OVERVIEW_DEVIATION_FIELDS.map((f) => f.field)).not.toContain("supplyRatio");
  });

  it("deviationSpec 은 없는 필드에 undefined", () => {
    expect(deviationSpec("없는필드")).toBeUndefined();
    expect(deviationSpec("price")?.label).toBe("분양가");
  });
});

describe("전국 버킷 키가 실제 시도명과 겹치지 않는다", () => {
  it("NATIONAL_KEY 는 기호형이라 '서울' 같은 지역명과 충돌하지 않는다", () => {
    expect(NATIONAL_KEY.startsWith("__")).toBe(true);
  });
});
