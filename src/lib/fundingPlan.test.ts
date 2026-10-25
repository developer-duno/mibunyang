import { describe, it, expect } from "vitest";
import {
  closestChipIndex,
  isValidSplit,
  maxPrincipalForAnnualPayment,
  noticeUnitChips,
  compareNoticeNo,
  planFunding,
  positiveOrNull,
  unitLabel,
  type FundingInput,
} from "./fundingPlan";

/** 목업과 같은 가짜 예시(세션658 plan-page) — 인천 남동구 비규제, 59A 3억 9,800만 */
const base: FundingInput = {
  price: 39800,
  zone: "normal",
  region: "인천",
  gu: "남동구",
  firstDate: null,
  income: 4800,
  cash: 8000,
  existingMonthly: null,
  split: { contract: 10, interim: 60, balance: 30 },
  bankRate: 4.38,
};

describe("maxPrincipalForAnnualPayment — 30년 원리금균등 역산", () => {
  it("연 1,920만 · 7.38% · 30년 → 2억 3,154만(내림) — 손계산 160만/월 × 연금현가 144.71", () => {
    expect(maxPrincipalForAnnualPayment(1920, 7.38, 30)).toBe(23154);
  });
  it("0·음수·금리 없음은 0", () => {
    expect(maxPrincipalForAnnualPayment(0, 7, 30)).toBe(0);
    expect(maxPrincipalForAnnualPayment(-10, 7, 30)).toBe(0);
    expect(maxPrincipalForAnnualPayment(1000, 0, 30)).toBe(0);
  });
});

describe("planFunding", () => {
  it("목업 예시 — 단계 3,980/2억 3,880/1억 1,940 · 지역 2억 7,860 · 소득 2억 3,154 · 작은 값 · 월 116 · 더 필요한 돈 8,646", () => {
    const p = planFunding(base);
    expect(p).not.toBeNull();
    expect(p?.stages).toEqual({ contract: 3980, interim: 23880, balance: 11940 });
    expect(p?.ltv.current.amount).toBe(27860);
    expect(p?.stressAdd).toBe(3.0); // 인천 = 수도권
    expect(p?.stressRate).toBe(7.38);
    expect(p?.incomeLimit).toBe(23154);
    expect(p?.loan).toBe(23154);
    expect(p?.monthly).toBe(116);
    expect(p?.shortfall).toBe(8646);
  });

  it("소득 없음 → 지역 한도만(소득 한도 null · 이유 no-income)", () => {
    const p = planFunding({ ...base, income: null });
    expect(p?.incomeLimit).toBeNull();
    expect(p?.incomeSkip).toBe("no-income");
    expect(p?.loan).toBe(27860);
  });

  it("소득이 넉넉하면 지역 한도가 작은 값(min — max 로 바꾸면 빨강)", () => {
    const p = planFunding({ ...base, income: 20000 });
    expect(p?.incomeLimit).toBeGreaterThan(27860);
    expect(p?.loan).toBe(27860);
  });

  it("소득 0·음수는 빈칸 취급 — 주담대 0 이 되지 않는다", () => {
    for (const income of [0, -100]) {
      const p = planFunding({ ...base, income });
      expect(p?.incomeSkip).toBe("no-income");
      expect(p?.loan).toBe(27860);
    }
    expect(positiveOrNull(0)).toBeNull();
    expect(positiveOrNull(Number.NaN)).toBeNull();
  });

  it("기존 대출로 연 상환 가능액이 음수 → 0 → 소득 한도 0 · 월 상환 줄 없음", () => {
    const p = planFunding({ ...base, existingMonthly: 200 }); // 200×12 = 2,400 > 1,920
    expect(p?.incomeLimit).toBe(0);
    expect(p?.loan).toBe(0);
    expect(p?.monthly).toBeNull();
    expect(p?.shortfall).toBe(39800 - 8000);
  });

  it("기존 대출은 연 상환액에서 뺀다 — 월 50만 → 연 1,320만으로 역산", () => {
    const p = planFunding({ ...base, existingMonthly: 50 });
    expect(p?.incomeLimit).toBe(maxPrincipalForAnnualPayment(1920 - 600, 7.38, 30));
  });

  it("금리 없음 → 소득 한도·월 상환 둘 다 없음(이유 no-rate) — '0원/월' 금지", () => {
    const p = planFunding({ ...base, bankRate: null });
    expect(p?.incomeLimit).toBeNull();
    expect(p?.incomeSkip).toBe("no-rate");
    expect(p?.monthly).toBeNull();
    expect(p?.loan).toBe(27860);
  });

  it("지방 비규제는 가산 0.75 — 부산이면 스트레스 금리 5.13%", () => {
    const p = planFunding({ ...base, region: "부산", gu: "해운대구" });
    expect(p?.stressAdd).toBe(0.75);
    expect(p?.stressRate).toBe(5.13);
    expect(p?.incomeLimit).toBe(maxPrincipalForAnnualPayment(1920, 5.13, 30));
  });

  it("규제지역은 지방이 아니어도 가산 3.0 — 서울 중구", () => {
    const p = planFunding({ ...base, zone: "overheated", region: "서울", gu: "중구" });
    expect(p?.stressAdd).toBe(3.0);
  });

  it("비율 합이 100 이 아니면 계산 중단(null)", () => {
    expect(planFunding({ ...base, split: { contract: 10, interim: 60, balance: 20 } })).toBeNull();
    expect(planFunding({ ...base, split: { contract: 20, interim: 60, balance: 30 } })).toBeNull();
    expect(isValidSplit({ contract: 0, interim: 0, balance: 100 })).toBe(true);
    expect(isValidSplit({ contract: -10, interim: 80, balance: 30 })).toBe(false);
  });

  it("더 필요한 돈 ≤ 0 이면 음수(남는 돈)", () => {
    const p = planFunding({ ...base, cash: 30000 });
    expect(p?.shortfall).toBeLessThanOrEqual(0);
  });

  it("종전 규정은 큰 숫자에 안 들어간다(결정 18) — 서울 중구 2021 공고: 주담대 40% 1억 5,920만 · 종전 70% 는 따로", () => {
    const p = planFunding({
      ...base,
      zone: "overheated",
      region: "서울",
      gu: "중구",
      firstDate: "2021-05-04",
      income: null,
    });
    expect(p?.ltv.grandfathered?.amount).toBe(27860);
    expect(p?.loan).toBe(15920);
    expect(p?.shortfall).toBe(39800 - 15920 - 8000);
  });
});

describe("평형 칩", () => {
  it("unitLabel — 059.9847A → 59A · 074.9916 → 74 · 빈 값 null", () => {
    expect(unitLabel("059.9847A")).toBe("59A");
    expect(unitLabel("074.9916 ")).toBe("74");
    expect(unitLabel("084.9901B")).toBe("84B");
    expect(unitLabel("")).toBeNull();
    expect(unitLabel(null)).toBeNull();
  });

  const units = [
    { house_manage_no: "2022000456", house_ty: "084.9916A", top_amount: 62787 },
    { house_manage_no: "2022000456", house_ty: "059.9847A", top_amount: 47213 },
    { house_manage_no: "2022000456", house_ty: "074.9916", top_amount: 0 },
    { house_manage_no: "2022000456", house_ty: "059.9871B", top_amount: 47208 },
    { house_manage_no: "2024930047", house_ty: "059.9871B", top_amount: 46268 },
    { house_manage_no: "2022910270", house_ty: "084.9901B", top_amount: null },
  ];

  it("270 꼴 — 원공고 2022000456 vs 무순위 2024930047 → 공고번호가 큰 2024930047 한 벌(카드 분양가 46,268 과 같은 값)", () => {
    expect(noticeUnitChips(units)).toEqual([{ label: "59B", price: 46268 }]);
    expect(noticeUnitChips([])).toEqual([]);
  });

  it("한 공고 안에서는 분양가 0·빈 행 빼고 면적 오름차순", () => {
    expect(noticeUnitChips(units.filter((u) => u.house_manage_no === "2022000456"))).toEqual([
      { label: "59A", price: 47213 },
      { label: "59B", price: 47208 },
      { label: "84A", price: 62787 },
    ]);
  });

  it("compareNoticeNo — 길이 먼저, 같으면 문자열(길이가 다른 번호도 큰 쪽)", () => {
    expect(compareNoticeNo("2024930047", "2022000456")).toBeGreaterThan(0);
    expect(compareNoticeNo("999", "1000")).toBeLessThan(0); // 문자열 비교면 "999" > "1000"
    expect(compareNoticeNo("2022000456", "2022000456")).toBe(0);
    expect(
      noticeUnitChips([
        { house_manage_no: "999", house_ty: "059A", top_amount: 1 },
        { house_manage_no: "1000", house_ty: "084A", top_amount: 2 },
      ])
    ).toEqual([{ label: "84A", price: 2 }]);
  });

  it("closestChipIndex — 대표 분양가와 가장 가까운 칩, 가격 없으면 첫 칩", () => {
    const chips = noticeUnitChips(units.filter((u) => u.house_manage_no === "2022000456"));
    expect(closestChipIndex(chips, 46268)).toBe(1); // 59B 47,208 이 59A 47,213 보다 가깝다
    expect(closestChipIndex(chips, 60000)).toBe(2);
    expect(closestChipIndex(chips, null)).toBe(0);
    expect(closestChipIndex([], 1)).toBe(-1);
  });
});
