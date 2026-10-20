import { describe, it, expect } from "vitest";
import {
  computeDeviation,
  deviationText,
  deviationAriaLabel,
  estimatedDeviation,
  resolveDeviationInput,
  deviationInputsEqual,
} from "./deviation";
import {
  CARD_DEVIATION_FIELDS,
  OVERVIEW_DEVIATION_FIELDS,
  deviationSpec,
  formatDeviationValue,
} from "@/constants/deviationFields";
import { computeRegionalStats, NATIONAL_KEY, type RegionalStats } from "@/scoring/regionalStats";
import type { Apt } from "@/types/scoring";

const priceSpec = deviationSpec("pp")!;
const unsoldSpec = deviationSpec("unsoldRate")!;
const subwaySpec = deviationSpec("subwayDist")!;
// 세션609 라: 전세가율 편차 줄은 같은 단지 값(complexJeonseRate)을 읽는다(옛 jeonseRate 는 구 전체)
const jeonseSpec = deviationSpec("complexJeonseRate")!;

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
  const stats = seoul("pp", 30);

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

  it("값 0 은 미수집이 아니다 — 미분양 0%% 도 진짜 값", () => {
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
    // 세션652: 미분양 줄은 neutral — 0 은 막대 왼쪽 끝(값이 낮음), 색은 중립, 문구는 "낮음"
    expect(d.tone).toBe("neutral");
    expect(d.fav!).toBeLessThan(50);
    expect(d.text).toMatch(/%p 낮음$/);
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
    const d = computeDeviation(priceSpec, 5, "서울", seoul("pp", 30));
    expect(d.state).toBe("ok");
    expect(d.nationalFallback).toBe(false);
  });

  it("8 ≤ n < 20 이면 전국 기준으로 그리고 배지를 켠다", () => {
    // 제주 10개 + 서울 30개 → 제주는 시도 임계 미달, 전국(40)은 충분
    const all = [...rows("제주", "pp", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), ...rows("서울", "pp", [11, 12, 13, 14])];
    const stats = computeRegionalStats(all, ["pp"]);
    const d = computeDeviation(priceSpec, 1, "제주", stats);
    expect(d.state).toBe("ok");
    expect(d.nationalFallback).toBe(true);
  });

  it("전국 표본도 8 미만이면 아예 그리지 않는다", () => {
    const stats = computeRegionalStats(rows("제주", "pp", [1, 2, 3]), ["pp"]);
    const d = computeDeviation(priceSpec, 1, "제주", stats);
    expect(d.state).toBe("sparse");
    expect(d.text).toBe("비교할 단지가 적어요");
    expect(d.fav).toBeNull();
  });

  it("모르는 지역이면 전국으로 떨어진다", () => {
    const d = computeDeviation(priceSpec, 5, "없는지역", seoul("pp", 30));
    expect(d.state).toBe("ok");
    expect(d.nationalFallback).toBe(true);
  });
});

describe("G2 변별력 게이트 — 이 설계의 구조적 방어선", () => {
  it("그 지역이 전부 같은 값이면 막대를 그리지 않는다", () => {
    const stats = computeRegionalStats(rows("경기", "pp", Array(30).fill(500)), ["pp"]);
    const d = computeDeviation(priceSpec, 500, "경기", stats);
    expect(d.state).toBe("uniform");
    expect(d.text).toBe("이 지역은 다 같아요");
  });

  it("distinct 가 2 이하이면 그리지 않는다", () => {
    const vals = [...Array(15).fill(100), ...Array(15).fill(200)];
    const stats = computeRegionalStats(rows("경기", "pp", vals), ["pp"]);
    expect(computeDeviation(priceSpec, 100, "경기", stats).state).toBe("uniform");
  });

  it("필드명을 하드코딩하지 않아도 지역 상수 필드가 스스로 빠진다", () => {
    // popGrowth 는 실측상 17개 시도 전부 지역 단일값이다.
    const fakeSpec = { ...priceSpec, field: "popGrowth" };
    const stats = computeRegionalStats(rows("경기", "popGrowth", Array(543).fill(-0.5)), ["popGrowth"]);
    expect(computeDeviation(fakeSpec, -0.5, "경기", stats).state).toBe("uniform");
  });

  it("mad 가 0 이 아니면 통과한다", () => {
    const stats = seoul("pp", 30);
    expect(computeDeviation(priceSpec, 5, "서울", stats).state).toBe("ok");
  });
});

describe("fav — 판정하는 줄은 오른쪽이 유리", () => {
  // 세션652: 지금 목록에 낮을수록 좋은 판정 줄은 없다(미분양 등은 neutral) — 뒤집기 경로는 합성 스펙으로 지킨다.
  it("낮을수록 좋은 판정 지표는 작은 쪽이 fav 높음 (합성 스펙)", () => {
    const judgedLow = { ...unsoldSpec, neutral: false, goodWord: "적어요", badWord: "많아요" };
    const stats = seoul("unsoldRate", 100); // 1..100
    const few = computeDeviation(judgedLow, 5, "서울", stats);
    const many = computeDeviation(judgedLow, 95, "서울", stats);
    expect(few.fav!).toBeGreaterThan(many.fav!);
    expect(few.tone).toBe("good");
    expect(many.tone).toBe("bad");
  });

  // 도움말 한 문장("오른쪽으로 길수록 이 단지 값이 크다")이 8줄 모두에 참인 근거 — 판정 줄이 뒤집히지 않는다.
  //   낮을수록 좋은 판정 줄을 새로 넣으면 그 줄은 끝말·막대가 어긋난다(세션652 사고) → red.
  it("8줄 모두 neutral 이거나 높을수록 좋은 줄이다 — '오른쪽 = 값이 큼'이 늘 참", () => {
    for (const f of OVERVIEW_DEVIATION_FIELDS) {
      expect(f.neutral === true || f.better === "high", f.field).toBe(true);
    }
  });
});

// 세션651(사장님 결정 — 공공기관 준거): 평당가·전세가율 줄은 좋고 나쁨을 말하지 않는다(`neutral`).
//   막대 = 백분위 그대로(오른쪽 = 값이 높음) · 색 중립 · 문구 = 한가운데 값과의 산술 차이(높음/낮음/같음).
//   옛 판정(파랑/주황·"싸요/비싸요"·"높아요/낮아요"·평균 수준 밴드)으로 되돌리면 red.
describe("neutral 줄 — 평당가·전세가율은 판정 없이 값 그대로 (세션651)", () => {
  it("두 필드 모두 neutral 이고 끝말은 낮다/높다", () => {
    for (const spec of [priceSpec, jeonseSpec]) {
      expect(spec.neutral, spec.field).toBe(true);
      expect([spec.lowWord, spec.highWord], spec.field).toEqual(["낮다", "높다"]);
    }
  });

  // 세션652(사장님 결정 ② 값 그대로): 미분양·역세권·소득부담·관리비도 neutral. 옛 버그 = 낮을수록 좋은 줄을
  //   뒤집어 "0.2%p 적어요" 막대가 "많다" 끝말 쪽으로 뻗었다 — 끝말 왼쪽이 늘 "값이 낮은" 쪽이어야 한다.
  it("미분양·소득부담·관리비는 neutral + 끝말 낮다/높다, 역세권은 neutral + 가깝다/멀다", () => {
    for (const field of ["unsoldRate", "pir", "avgMaintenanceCost"]) {
      const spec = deviationSpec(field)!;
      expect(spec.neutral, field).toBe(true);
      expect([spec.lowWord, spec.highWord], field).toEqual(["낮다", "높다"]);
    }
    expect(subwaySpec.neutral).toBe(true);
    expect([subwaySpec.lowWord, subwaySpec.highWord]).toEqual(["가깝다", "멀다"]);
  });

  it.each([["unsoldRate"], ["subwayDist"], ["pir"], ["avgMaintenanceCost"]] as const)(
    "%s: 값이 높을수록 막대가 오른쪽(뒤집지 않음), 색은 늘 중립",
    (field) => {
      const spec = deviationSpec(field)!;
      const stats = seoul(field, 100); // 1..100
      const low = computeDeviation(spec, 5, "서울", stats);
      const high = computeDeviation(spec, 95, "서울", stats);
      expect(low.fav!).toBeLessThan(50);
      expect(high.fav!).toBeGreaterThan(50);
      expect(low.tone).toBe("neutral");
      expect(high.tone).toBe("neutral");
    }
  );

  it("역세권 문구는 거리 사실 — `N% 가까움`·`N배 멂`·`같음` (높음/낮음·판정어 아님)", () => {
    const stats = seoul("subwayDist", 101); // 중앙값 51
    expect(computeDeviation(subwaySpec, 30, "서울", stats).text).toBe("41% 가까움");
    expect(computeDeviation(subwaySpec, 66, "서울", stats).text).toBe("29% 멂");
    expect(computeDeviation(subwaySpec, 51, "서울", stats).text).toBe("같음");
    expect(computeDeviation(subwaySpec, 101, "서울", stats).text).toBe("98% 멂");
    expect(computeDeviation(subwaySpec, 5, "서울", stats).text).toBe("90% 가까움");
  });

  it.each([
    ["pp", 5, 95],
    ["complexJeonseRate", 5, 95],
  ] as const)("%s: 값이 높을수록 막대가 오른쪽(fav = 백분위), 색은 늘 중립", (field, lo, hi) => {
    const spec = field === "pp" ? priceSpec : jeonseSpec;
    const stats = seoul(field, 100); // 1..100
    const low = computeDeviation(spec, lo, "서울", stats);
    const high = computeDeviation(spec, hi, "서울", stats);
    expect(high.fav!).toBeGreaterThan(low.fav!);
    expect(low.tone).toBe("neutral");
    expect(high.tone).toBe("neutral");
  });

  it("문구 = 한가운데 값과의 차이 + 높음/낮음 — 판정어 없음", () => {
    const stats = seoul("pp", 101); // 중앙값 51
    expect(computeDeviation(priceSpec, 61, "서울", stats).text).toBe("20% 높음");
    expect(computeDeviation(priceSpec, 41, "서울", stats).text).toBe("20% 낮음");
    const js = seoul("complexJeonseRate", 101);
    expect(computeDeviation(jeonseSpec, 54, "서울", js).text).toBe("3%p 높음");
    expect(computeDeviation(jeonseSpec, 50.6, "서울", js).text).toBe("0.4%p 낮음");
    for (const v of [1, 30, 49, 51, 53, 70, 100]) {
      for (const [spec, st] of [
        [priceSpec, stats],
        [jeonseSpec, js],
      ] as const) {
        const t = computeDeviation(spec, v, "서울", st).text;
        expect(t, `${spec.field} ${v}`).not.toMatch(/싸|비싸|유리|좋|평균 수준|높아요|낮아요/);
      }
    }
  });

  it("한가운데 값과 같으면 '같음' (옛 '평균 수준' 밴드 없음 — ±3 백분위 안이어도 차이를 적는다)", () => {
    const stats = seoul("pp", 101); // 중앙값 51
    expect(computeDeviation(priceSpec, 51, "서울", stats).text).toBe("같음");
    expect(computeDeviation(priceSpec, 52, "서울", stats).text).toBe("2% 높음");
  });

  it("fav 는 0~100 범위를 벗어나지 않는다", () => {
    const stats = seoul("pp", 50);
    for (const v of [-999, 0, 1, 25, 50, 999]) {
      const d = computeDeviation(priceSpec, v, "서울", stats);
      if (d.fav != null) {
        expect(d.fav).toBeGreaterThanOrEqual(0);
        expect(d.fav).toBeLessThanOrEqual(100);
      }
    }
  });

  it("한가운데면 '평균 수준' + 중립 (판정하는 줄 — 주차)", () => {
    const parkingSpec = deviationSpec("parkingRatio")!;
    const stats = seoul("parkingRatio", 101); // 중앙값 51
    const d = computeDeviation(parkingSpec, 51, "서울", stats);
    expect(d.text).toBe("평균 수준");
    expect(d.tone).toBe("neutral");
    expect(d.state).toBe("ok");
  });
});

describe("deviationText — 값 슬롯 문장", () => {
  it("퍼센트 지표: 부호 없이 '12% 낮음' (평당가 — neutral, 세션651)", () => {
    expect(deviationText(priceSpec, 88, 100, true)).toBe("12% 낮음");
    expect(deviationText(priceSpec, 108, 100, false)).toBe("8% 높음");
  });

  it("퍼센트 지표에 마이너스 부호가 절대 안 나온다 (막대 방향과 충돌 차단)", () => {
    for (const v of [10, 50, 88, 150, 300]) {
      expect(deviationText(priceSpec, v, 100, v < 100)).not.toContain("-");
      expect(deviationText(priceSpec, v, 100, v < 100)).not.toContain("−");
    }
  });

  // 세션652: 미분양·역세권은 neutral — good 인자와 무관하게 값의 방향만 말한다.
  it("이미 % 인 지표는 %p 로 말한다", () => {
    expect(deviationText(unsoldSpec, 18, 15, false)).toBe("3%p 높음");
    expect(deviationText(unsoldSpec, 12, 15, true)).toBe("3%p 낮음");
  });

  it("%p 가 1 미만이면 소수 한 자리", () => {
    expect(deviationText(unsoldSpec, 15.4, 15, false)).toBe("0.4%p 높음");
  });

  it("거리는 2배 넘게 멀면 배수로 말한다", () => {
    expect(deviationText(subwaySpec, 1200, 400, false)).toBe("3배 멂");
    expect(deviationText(subwaySpec, 1000, 400, false)).toBe("2.5배 멂");
  });

  it("거리가 2배 이내면 퍼센트", () => {
    expect(deviationText(subwaySpec, 236, 400, true)).toBe("41% 가까움");
  });

  it("차이가 반올림해서 0 이면 '평균 수준' — neutral 줄은 '같음'", () => {
    expect(deviationText(priceSpec, 100.2, 100, true)).toBe("같음");
    expect(deviationText(unsoldSpec, 15, 15, true)).toBe("같음");
    expect(deviationText(deviationSpec("parkingRatio")!, 1.2, 1.2, true)).toBe("평균 수준");
  });

  it("중위값이 0 이어도 나눗셈이 터지지 않는다", () => {
    expect(deviationText(priceSpec, 10, 0, false)).toBe("높음");
    expect(deviationText(subwaySpec, 10, 0, false)).toBe("멂");
  });
});

describe("deviationAriaLabel", () => {
  const stats = seoul("pp", 30);

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
    expect(label).toContain("평당가");
  });

  // 세션539 A-6: DeviationStrip.tsx 헤더와 짝인 문장이라 같은 이유로 "아파트"라 단정하지
  // 않는다 — 대조군(regionalStats.ts:90)이 region 하나로만 묶여 오피스텔·재건축이 섞인다.
  // 헤더만 고치고 이 스크린리더 문장이 되돌아가면 같은 위젯에서 눈에 보이는 글자와
  // 스크린리더가 듣는 말이 서로 다른 모집단을 말하게 된다.
  it('"아파트"라고 모집단을 단정하지 않는다 (세션539 A-6)', () => {
    const d = computeDeviation(priceSpec, 3, "서울", stats);
    const label = deviationAriaLabel(priceSpec, d, "서울", "3억");
    expect(label).not.toContain("아파트");
    expect(label).toContain("분양 단지");
  });

  it("전국 폴백이면 '전국' 이라 말한다", () => {
    const all = [...rows("제주", "pp", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), ...rows("서울", "pp", [11, 12, 13, 14])];
    const d = computeDeviation(priceSpec, 1, "제주", computeRegionalStats(all, ["pp"]));
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
    expect(deviationSpec("pp")?.label).toBe("평당가");
    // 총 분양가는 이제 편차 대상이 아니다 — 면적 편향 때문에 평당가로 교체(세션 487)
    expect(deviationSpec("price")).toBeUndefined();
  });
});

describe("전국 버킷 키가 실제 시도명과 겹치지 않는다", () => {
  it("NATIONAL_KEY 는 기호형이라 '서울' 같은 지역명과 충돌하지 않는다", () => {
    expect(NATIONAL_KEY.startsWith("__")).toBe(true);
  });
});

// 세션576 D5-b — 용문역 리체스트(ah-2023910096): 점수 탭은 `추정 1.13대/세대` 로 채점하는데 종합 탭
// 편차 막대만 `미수집` 이었다. 같은 모달이 두 말을 하지 않게 편차 막대도 같은 추정치를 쓴다.
describe("주차 추정 폴백 (세션576 D5-b)", () => {
  const parkingSpec = deviationSpec("parkingRatio")!;
  const yongmun = { parkingRatio: null, presaleParking: 99, units: 59, presaleGeneralSupply: 88 };

  it("실측 비율이 없으면 점수 탭과 같은 산식의 추정치를 쓴다 — 99 ÷ max(59, 88) = 1.125", () => {
    expect(resolveDeviationInput(parkingSpec, yongmun)).toEqual({ value: 1.125, estimated: true });
  });

  it("추정치 값 문구는 점수 탭과 같은 글자 — `추정 1.13대/세대`", () => {
    expect(formatDeviationValue(parkingSpec, 1.125, true)).toBe("추정 1.13대/세대");
    expect(formatDeviationValue(parkingSpec, 1.49)).toBe("1.49대/세대");
  });

  // 사장님 결정(세션576): 추정 오차(p10 −0.61 · p90 +0.69) > 실측 분포 사분위 폭(0.28) → 막대 위치는 소음.
  it("추정치 줄은 지역 분포와 견주지 않는다 — 막대 위치 없음(fav null), 값 문구만", () => {
    expect(estimatedDeviation(parkingSpec, 1.125)).toEqual({
      state: "estimated",
      fav: null,
      text: "추정 1.13대/세대",
      tone: "neutral",
      nationalFallback: false,
    });
  });

  it("추정치 줄의 스크린리더 문장 — 견주지 않았다고 말한다", () => {
    expect(
      deviationAriaLabel(
        parkingSpec,
        estimatedDeviation(parkingSpec, 1.125),
        "경기",
        formatDeviationValue(parkingSpec, 1.125, true)
      )
    ).toBe("주차 추정 1.13대/세대. 추정치라 지역 단지들과 견주지 않았습니다.");
  });

  it("추정할 수 없으면 원값 그대로 — 주차 0(원천 미기재)·null·3 초과(총세대 오염)", () => {
    expect(resolveDeviationInput(parkingSpec, { parkingRatio: null, presaleParking: 0, units: 500 })).toEqual({
      value: null,
      estimated: false,
    });
    expect(resolveDeviationInput(parkingSpec, { parkingRatio: null, presaleParking: null, units: 500 })).toEqual({
      value: null,
      estimated: false,
    });
    expect(
      resolveDeviationInput(parkingSpec, {
        parkingRatio: null,
        presaleParking: 1468,
        units: 5,
        presaleGeneralSupply: 102,
      })
    ).toEqual({ value: null, estimated: false });
  });

  it("실측 비율이 있으면 추정 재료가 있어도 절대 덮지 않는다", () => {
    expect(resolveDeviationInput(parkingSpec, { ...yongmun, parkingRatio: 1.49 })).toEqual({
      value: 1.49,
      estimated: false,
    });
  });

  it("폴백이 없는 필드는 원값 그대로", () => {
    expect(resolveDeviationInput(priceSpec, { pp: null, presaleParking: 99 })).toEqual({
      value: null,
      estimated: false,
    });
  });
});

describe("deviationInputsEqual — memo 비교는 추정 재료까지 본다 (세션576 D5-b)", () => {
  const base = {
    pp: 1200,
    unsoldRate: 4,
    subwayDist: 300,
    parkingRatio: null,
    presaleParking: 99,
    units: 59,
    presaleGeneralSupply: 88,
  };

  it("추정 재료만 바뀌어도 '다르다' — 주차대수·총세대·일반분양 각각", () => {
    expect(deviationInputsEqual(OVERVIEW_DEVIATION_FIELDS, base, { ...base, presaleParking: 120 })).toBe(false);
    expect(deviationInputsEqual(OVERVIEW_DEVIATION_FIELDS, base, { ...base, units: 60 })).toBe(false);
    expect(deviationInputsEqual(OVERVIEW_DEVIATION_FIELDS, base, { ...base, presaleGeneralSupply: 90 })).toBe(false);
  });

  it("필드 값이 바뀌면 '다르다', 아무것도 안 바뀌면 '같다'", () => {
    expect(deviationInputsEqual(OVERVIEW_DEVIATION_FIELDS, base, { ...base, pp: 1300 })).toBe(false);
    expect(deviationInputsEqual(OVERVIEW_DEVIATION_FIELDS, base, { ...base })).toBe(true);
  });
});
