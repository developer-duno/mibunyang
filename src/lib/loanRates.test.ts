import { describe, it, expect } from "vitest";
import {
  pickMonthlyRate,
  calcMonthlyPayment,
  groupBankRanges,
  isUsableMortgageRate,
  displayBankName,
  fmtDisclosureMonth,
  BANK_RANGE_LIMIT,
} from "./loanRates";

/** 10/02 은행권(020000) 응답 사본(세션589 logs, ap-6028162)에서 뽑은 줄 — 값은 그대로 */
const COPY_ROWS = [
  { bank: "경남은행", mortgageType: "아파트외", repayType: "만기일시상환방식", rateMin: 3.7, rateMax: 5.51 },
  { bank: "경남은행", mortgageType: "아파트", repayType: "만기일시상환방식", rateMin: 3.7, rateMax: 5.51 },
  { bank: "우리은행", mortgageType: "아파트", repayType: "만기일시상환방식", rateMin: 4.18, rateMax: 5.28 },
  { bank: "아이엠뱅크", mortgageType: "아파트", repayType: "분할상환방식", rateMin: 4.2, rateMax: 5.3 },
  { bank: "아이엠뱅크", mortgageType: "아파트", repayType: "분할상환방식", rateMin: 4.2, rateMax: 6.51 },
  { bank: "신한은행", mortgageType: "아파트", repayType: "분할상환방식", rateMin: 4.29, rateMax: 5.69 },
];

describe("pickMonthlyRate — 월 상환액 금리 고르기 (세션592 A7 · 세션593 lib 로 옮김)", () => {
  it("아파트 + 분할상환으로 시작하는 상품 중 최저 rateMin", () => {
    expect(
      pickMonthlyRate([
        { mortgageType: "아파트외", repayType: "만기일시상환방식", rateMin: 3.7, rateMax: 5.51 },
        { mortgageType: "아파트", repayType: "만기일시상환방식", rateMin: 3.7, rateMax: 5.51 },
        { mortgageType: "아파트", repayType: "분할상환방식", rateMin: 4.2, rateMax: 6.51 },
        { mortgageType: "아파트", repayType: "분할상환방식", rateMin: 4.18, rateMax: 5.28 },
      ])
    ).toBe(4.18);
  });

  it("후보가 없거나 금리가 비면 null", () => {
    expect(pickMonthlyRate([])).toBeNull();
    expect(pickMonthlyRate([{ mortgageType: "아파트", repayType: "분할상환방식", rateMin: null }])).toBeNull();
    expect(pickMonthlyRate([{ mortgageType: "아파트외", repayType: "분할상환방식", rateMin: 3 }])).toBeNull();
    expect(pickMonthlyRate([{ mortgageType: null, repayType: null, rateMin: 3 }])).toBeNull();
  });

  // 세션592 보완 F3 — 0·NaN 금리는 "가장 싼 상품"으로 뽑히면 월 상환액이 0 이 된다.
  it("금리 0·NaN 상품은 고르지 않는다 — 옆의 정상 상품을 고른다", () => {
    const apt = (rateMin: number) => ({ mortgageType: "아파트", repayType: "분할상환방식", rateMin, rateMax: 6.5 });
    expect(pickMonthlyRate([apt(0), apt(4.2)])).toBe(4.2);
    expect(pickMonthlyRate([apt(Number.NaN), apt(4.2)])).toBe(4.2);
    expect(pickMonthlyRate([apt(0)])).toBeNull();
    expect(pickMonthlyRate([apt(Number.NaN)])).toBeNull();
  });
});

describe("calcMonthlyPayment — D2 예시값", () => {
  // 계획서 D2: 대표 단지 ap-6028162 대출 2억 1,208만 · 사본 최저 아파트·분할상환 4.2% → 104만 원/월
  it("사본 기준 대출 21,208만 · 4.2% · 30년 → 104만", () => {
    const rate = pickMonthlyRate(COPY_ROWS);
    expect(rate).toBe(4.2);
    expect(Math.round(calcMonthlyPayment(21208, rate as number, 30))).toBe(104);
  });

  it("원금·금리·기간 중 하나라도 0 이면 0", () => {
    expect(calcMonthlyPayment(0, 4, 30)).toBe(0);
    expect(calcMonthlyPayment(10000, 0, 30)).toBe(0);
    expect(calcMonthlyPayment(10000, 4, 0)).toBe(0);
  });
});

describe("groupBankRanges — 은행 범위 막대 재료 (세션593 D3)", () => {
  // ⚠️ 변이 대상: 은행별 묶기를 빼면(상품마다 한 줄) 아이엠뱅크가 두 줄이 되어 빨강.
  it("같은 은행 여러 상품 → 한 줄, 최저 rateMin 최솟값 ~ 최고 rateMax 최댓값", () => {
    const out = groupBankRanges(COPY_ROWS);
    expect(out.filter((r) => r.bank === "아이엠뱅크")).toEqual([{ bank: "아이엠뱅크", min: 4.2, max: 6.51 }]);
  });

  // ⚠️ 변이 대상: 아파트·분할상환 거름을 빼면 경남은행(아파트외·만기일시 3.7%)이 맨 위에 와서 빨강.
  it("아파트외·만기일시 상품은 뺀다", () => {
    const out = groupBankRanges(COPY_ROWS);
    expect(out.map((r) => r.bank)).toEqual(["아이엠뱅크", "신한은행"]);
  });

  // ⚠️ 변이 대상: 5줄 상한을 빼면 7줄이 되어 빨강.
  it("최저 낮은 순 5줄 상한", () => {
    const rows = [5.1, 4.1, 4.9, 4.3, 4.7, 4.5, 4.2].map((v, i) => ({
      bank: `은행${i}`,
      mortgageType: "아파트",
      repayType: "분할상환방식",
      rateMin: v,
      rateMax: v + 1,
    }));
    const out = groupBankRanges(rows);
    expect(BANK_RANGE_LIMIT).toBe(5);
    expect(out).toHaveLength(5);
    expect(out.map((r) => r.min)).toEqual([4.1, 4.2, 4.3, 4.5, 4.7]);
  });

  it("5개 미만이면 있는 만큼, 0개면 빈 배열", () => {
    expect(groupBankRanges(COPY_ROWS)).toHaveLength(2);
    expect(groupBankRanges([])).toEqual([]);
    expect(groupBankRanges(COPY_ROWS.filter((r) => r.mortgageType === "아파트외"))).toEqual([]);
  });

  // 세션593 후속 F1 — 최저·최고 중 하나라도 0·NaN·빈 값인 **상품**은 통째로 뺀다(옛 판은 은행 안에서 반쪽씩 모았다).
  it("0·NaN·빈 금리가 섞인 상품은 통째로 빼고, 남는 상품이 없는 은행은 줄을 만들지 않는다", () => {
    const base = { mortgageType: "아파트", repayType: "분할상환방식" };
    const out = groupBankRanges([
      { ...base, bank: "가", rateMin: 0, rateMax: 6 },
      { ...base, bank: "가", rateMin: 4.4, rateMax: Number.NaN },
      { ...base, bank: "나", rateMin: null, rateMax: 6 },
      { ...base, bank: "다", rateMin: 4.6, rateMax: null },
      { ...base, bank: "라", rateMin: 4.7, rateMax: 6.2 },
    ]);
    expect(out).toEqual([{ bank: "라", min: 4.7, max: 6.2 }]);
  });
});

describe("isUsableMortgageRate — 월 상환액·은행 막대 공통 거름 (세션593 후속 F1)", () => {
  const base = { mortgageType: "아파트", repayType: "분할상환방식" };

  it("아파트·분할상환 + 최저·최고 둘 다 유효 + 최저 ≤ 최고 일 때만 통과", () => {
    expect(isUsableMortgageRate({ ...base, rateMin: 4.2, rateMax: 6.5 })).toBe(true);
    expect(isUsableMortgageRate({ ...base, rateMin: 4.2, rateMax: 4.2 })).toBe(true);
    expect(isUsableMortgageRate({ ...base, rateMin: 4.1, rateMax: null })).toBe(false);
    expect(isUsableMortgageRate({ ...base, rateMin: null, rateMax: 4.0 })).toBe(false);
    expect(isUsableMortgageRate({ ...base, rateMin: 5.0, rateMax: 4.0 })).toBe(false);
    expect(isUsableMortgageRate({ ...base, mortgageType: "아파트외", rateMin: 4.2, rateMax: 6.5 })).toBe(false);
    expect(isUsableMortgageRate({ ...base, repayType: "만기일시상환방식", rateMin: 4.2, rateMax: 6.5 })).toBe(false);
  });

  // ⚠️ 변이 대상: pickMonthlyRate 를 옛 거름(최고 금리 안 봄)으로 되돌리면 큰 숫자가 4.1 이 되어 빨강.
  it("최고 금리가 빈 4.1% 상품은 큰 숫자에서도 빠진다 — 큰 숫자 = 막대 맨 위 최저 = 4.2", () => {
    const rows = [
      { ...base, bank: "가은행", rateMin: 4.1, rateMax: null },
      { ...base, bank: "나은행", rateMin: 4.2, rateMax: 6.5 },
    ];
    expect(pickMonthlyRate(rows)).toBe(4.2);
    expect(groupBankRanges(rows)).toEqual([{ bank: "나은행", min: 4.2, max: 6.5 }]);
    expect(pickMonthlyRate(rows)).toBe(groupBankRanges(rows)[0].min);
  });

  it("같은 은행 {5.0, 빈 값} + {빈 값, 4.0} → 그 은행 줄 없음(거꾸로 '5.00% ~ 4.00%'가 생기지 않는다)", () => {
    const rows = [
      { ...base, bank: "가은행", rateMin: 5.0, rateMax: null },
      { ...base, bank: "가은행", rateMin: null, rateMax: 4.0 },
    ];
    expect(groupBankRanges(rows)).toEqual([]);
    expect(pickMonthlyRate(rows)).toBeNull();
  });

  // ⚠️ 변이 대상: 거름에서 "최저 ≤ 최고"를 빼면 거꾸로 된 3.9~3.5 상품이 큰 숫자·막대 맨 위로 올라와 빨강.
  it("최저 > 최고 로 거꾸로 적힌 상품은 뺀다", () => {
    const rows = [
      { ...base, bank: "가은행", rateMin: 3.9, rateMax: 3.5 },
      { ...base, bank: "나은행", rateMin: 4.2, rateMax: 6.5 },
    ];
    expect(pickMonthlyRate(rows)).toBe(4.2);
    expect(groupBankRanges(rows)).toEqual([{ bank: "나은행", min: 4.2, max: 6.5 }]);
  });

  it("어떤 섞인 응답이든 은행 줄은 최저 ≤ 최고, 큰 숫자 = 맨 위 줄 최저", () => {
    const rows = [
      ...COPY_ROWS,
      { ...base, bank: "다은행", rateMin: 3.8, rateMax: null },
      { ...base, bank: "라은행", rateMin: 5.0, rateMax: null },
      { ...base, bank: "라은행", rateMin: null, rateMax: 4.0 },
      { ...base, bank: "마은행", rateMin: 3.6, rateMax: 3.1 },
    ];
    const out = groupBankRanges(rows);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((r) => r.min <= r.max)).toBe(true);
    expect(pickMonthlyRate(rows)).toBe(out[0].min);
    expect(pickMonthlyRate(rows)).toBe(4.2); // 10/02 사본 대표 단지 금리 그대로
  });
});

describe("displayBankName — 법인 표기만 뗀다 (메인 결정 세션593)", () => {
  it("'주식회사'(앞·뒤)와 남는 공백만 떼고 다른 글자는 그대로", () => {
    expect(displayBankName("농협은행주식회사")).toBe("농협은행");
    expect(displayBankName("주식회사 하나은행")).toBe("하나은행");
    expect(displayBankName("주식회사 카카오뱅크")).toBe("카카오뱅크");
    expect(displayBankName("한국스탠다드차타드은행")).toBe("한국스탠다드차타드은행");
    expect(displayBankName("아이엠뱅크")).toBe("아이엠뱅크");
    expect(displayBankName("주식회사")).toBe("주식회사");
  });
});

describe("fmtDisclosureMonth — 공시월 글자 (세션593 D4)", () => {
  it("YYYYMM → 'N년 M월 공시'", () => {
    expect(fmtDisclosureMonth("202609")).toBe("2026년 9월 공시");
    expect(fmtDisclosureMonth("202512")).toBe("2025년 12월 공시");
  });
  it("없거나 형식이 아니면 null", () => {
    expect(fmtDisclosureMonth(null)).toBeNull();
    expect(fmtDisclosureMonth(undefined)).toBeNull();
    expect(fmtDisclosureMonth("202613")).toBeNull();
    expect(fmtDisclosureMonth("2026-09")).toBeNull();
  });
});
