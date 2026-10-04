// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoanRatesSection, pickMonthlyRate } from "./LoanRatesSection";
import { useLoanRates } from "@/hooks/useLoanRates";

// useLoanRates 모킹
vi.mock("@/hooks/useLoanRates", () => ({
  useLoanRates: vi.fn(() => ({
    rates: [
      {
        bank: "테스트은행",
        product: "주담대A",
        mortgageType: "아파트",
        repayType: "분할상환방식",
        rateMin: 3.5,
        rateMax: 4.2,
      },
      {
        bank: "샘플은행",
        product: "주담대B",
        mortgageType: "아파트",
        repayType: "분할상환방식",
        rateMin: 3.8,
        rateMax: 5.0,
      },
    ],
    loading: false,
    error: null,
  })),
}));

const makeApt = (overrides = {}) => ({
  price: 50000,
  region: "경기",
  gu: "수원시",
  area: 84,
  _ltvBase: 35000,
  ...overrides,
});

describe("LoanRatesSection", () => {
  // 기본 렌더링 — 은행별 금리 비교 텍스트
  it("은행별 금리 비교 텍스트를 표시한다", () => {
    render(<LoanRatesSection apt={makeApt()} />);
    expect(screen.getByText("은행별 금리 비교")).toBeTruthy();
  });

  // 금융권역 탭 렌더링 — 펼친 후 탭 확인
  it("펼치면 금융권역 탭 4개를 표시한다", () => {
    render(<LoanRatesSection apt={makeApt()} />);
    fireEvent.click(screen.getByText("은행별 금리 비교"));
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(tabs[0].textContent).toBe("은행");
    expect(tabs[1].textContent).toBe("저축은행");
    // finlife 오픈API 권역코드표: 030200 = 여신전문 · 050000 = 보험 (옛 라벨 "보험"·"기타"는 틀렸다 — 세션592)
    expect(tabs[2].textContent).toBe("여신전문");
    expect(tabs[3].textContent).toBe("보험");
  });

  // aria-selected 속성 — 기본 "은행" 선택
  it("기본 선택 탭의 aria-selected가 true이다", () => {
    render(<LoanRatesSection apt={makeApt()} />);
    fireEvent.click(screen.getByText("은행별 금리 비교"));
    const bankTab = screen.getByRole("tab", { name: "은행" });
    expect(bankTab.getAttribute("aria-selected")).toBe("true");
  });

  // 탭 클릭으로 금융권역 전환
  it("탭 클릭 시 aria-selected가 변경된다", () => {
    render(<LoanRatesSection apt={makeApt()} />);
    fireEvent.click(screen.getByText("은행별 금리 비교"));
    const savingsTab = screen.getByRole("tab", { name: "저축은행" });
    fireEvent.click(savingsTab);
    expect(savingsTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "은행" }).getAttribute("aria-selected")).toBe("false");
  });

  // 금리 테이블 표시
  it("금리 테이블에 은행명과 금리를 표시한다", () => {
    render(<LoanRatesSection apt={makeApt()} />);
    fireEvent.click(screen.getByText("은행별 금리 비교"));
    expect(screen.getByText("테스트은행")).toBeTruthy();
    expect(screen.getByText("3.5%")).toBeTruthy();
  });

  // 키보드 접근성 — Enter 키로 토글
  it("Enter 키로 섹션을 토글할 수 있다", () => {
    render(<LoanRatesSection apt={makeApt()} />);
    const toggle = screen.getByRole("button", { name: /은행별 금리/ });
    fireEvent.keyDown(toggle, { key: "Enter" });
    expect(screen.getAllByRole("tab")).toHaveLength(4);
  });

  // aria-expanded 속성
  it("토글 버튼의 aria-expanded가 올바르게 변경된다", () => {
    render(<LoanRatesSection apt={makeApt()} />);
    const toggle = screen.getByRole("button", { name: /은행별 금리/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  // 월 상환액 시뮬레이션 — 단위 버그 정정 (D4, 세션574)
  it("월 상환액 시뮬레이션이 '-/월'이 아니라 '만'을 포함한 금액을 표시한다", () => {
    render(<LoanRatesSection apt={makeApt()} />);
    fireEvent.click(screen.getByText("은행별 금리 비교"));
    const sim = screen.getByText(/최저 금리 3\.5% 기준/).closest("div");
    expect(sim?.textContent).not.toContain("-/월");
    // 정확값: _ltvBase 35,000만 · rateMin 3.5% · 30년 원리금균등 = 157.17 → Math.round → fmtPrice(157) = "157만"
    // (검사관 독립 뮤테이션: 단위가 10배 틀려도 정규식만으로는 초록이었다 — 세션575)
    expect(sim?.textContent).toContain("157만/월");
  });

  // 상품 아래 작은 글씨 — 담보유형·상환방식·금리유형 구별 (D4, 세션574)
  it("상품 아래에 담보유형·상환방식·금리유형 조합을 작은 글씨로 표시한다", () => {
    // mockReturnValueOnce 는 아니다 — LoanRatesSection 이 렌더마다(닫힘→열림) useLoanRates 를
    // 무조건 호출하므로 once 값이 첫 렌더(닫힌 상태)에서 소비되고 실제 테이블이 그려지는
    // 두 번째 렌더는 기본 mock 을 쓴다. mockReturnValue 로 고정 후 이 시험 끝에서 원복.
    const defaultImpl = vi.mocked(useLoanRates).getMockImplementation();
    vi.mocked(useLoanRates).mockReturnValue({
      rates: [
        {
          bank: "테스트은행",
          product: "주담대A",
          rateMin: 3.5,
          rateMax: 4.2,
          mortgageType: "아파트",
          repayType: "분할상환",
          rateType: "변동금리",
        },
      ],
      loading: false,
      error: null,
    });
    try {
      render(<LoanRatesSection apt={makeApt()} />);
      fireEvent.click(screen.getByText("은행별 금리 비교"));
      expect(screen.getByText("아파트 · 분할상환 · 변동금리")).toBeTruthy();
    } finally {
      if (defaultImpl) vi.mocked(useLoanRates).mockImplementation(defaultImpl);
    }
  });

  // 월 상환액 금리 = 아파트·분할상환 상품 중 최저 (세션592 A7) — 30년 원리금균등 계산이라
  // 만기일시상환·아파트외 상품 금리를 쓰면 안 된다(10/02 은행권 맨 위 3.7% 가 아파트외·만기일시였다).
  it("월 상환액은 만기일시·아파트외 상품을 건너뛰고 아파트·분할상환 최저 금리로 계산한다", () => {
    const defaultImpl = vi.mocked(useLoanRates).getMockImplementation();
    vi.mocked(useLoanRates).mockReturnValue({
      rates: [
        { bank: "가", product: "p1", mortgageType: "아파트외", repayType: "분할상환방식", rateMin: 3.0, rateMax: 5 },
        { bank: "나", product: "p2", mortgageType: "아파트", repayType: "만기일시상환방식", rateMin: 3.2, rateMax: 5 },
        { bank: "다", product: "p3", mortgageType: "아파트", repayType: "분할상환방식", rateMin: 4.5, rateMax: 6 },
        { bank: "라", product: "p4", mortgageType: "아파트", repayType: "분할상환방식", rateMin: 4.2, rateMax: 6 },
      ],
      loading: false,
      error: null,
    });
    try {
      render(<LoanRatesSection apt={makeApt()} />);
      fireEvent.click(screen.getByText("은행별 금리 비교"));
      const sim = screen.getByText(/아파트·분할상환 최저 금리 4\.2% 기준/).closest("div");
      // 35,000만 · 4.2% · 30년 원리금균등 = 171.15 → "171만"
      expect(sim?.textContent).toContain("171만/월");
      expect(screen.queryByText(/최저 금리 3\.0% 기준|최저 금리 3% 기준|최저 금리 3\.2% 기준/)).toBeNull();
    } finally {
      if (defaultImpl) vi.mocked(useLoanRates).mockImplementation(defaultImpl);
    }
  });

  it("아파트·분할상환 상품이 하나도 없으면 월 상환액 줄을 그리지 않는다 (표는 그대로)", () => {
    const defaultImpl = vi.mocked(useLoanRates).getMockImplementation();
    vi.mocked(useLoanRates).mockReturnValue({
      rates: [
        { bank: "가", product: "p1", mortgageType: "아파트외", repayType: "분할상환방식", rateMin: 3.0, rateMax: 5 },
        { bank: "나", product: "p2", mortgageType: "아파트", repayType: "만기일시상환방식", rateMin: 3.2, rateMax: 5 },
      ],
      loading: false,
      error: null,
    });
    try {
      render(<LoanRatesSection apt={makeApt()} />);
      fireEvent.click(screen.getByText("은행별 금리 비교"));
      expect(screen.getByText("가")).toBeTruthy();
      expect(screen.queryByText("월 상환액 시뮬레이션")).toBeNull();
      expect(document.body.textContent).not.toContain("/월");
    } finally {
      if (defaultImpl) vi.mocked(useLoanRates).mockImplementation(defaultImpl);
    }
  });

  // 구별 필드가 없는 행은 작은 글씨 줄이 없다 (D4, 세션574)
  it("담보유형 등 필드가 없는 행에는 작은 글씨 줄이 없고 undefined 문자열도 없다", () => {
    render(<LoanRatesSection apt={makeApt()} />);
    fireEvent.click(screen.getByText("은행별 금리 비교"));
    expect(screen.queryByText(/undefined/)).toBeNull();
    expect(document.body.textContent).not.toContain("undefined");
  });
});

describe("pickMonthlyRate — 월 상환액 금리 고르기 (세션592 A7)", () => {
  it("아파트 + 분할상환으로 시작하는 상품 중 최저 rateMin", () => {
    expect(
      pickMonthlyRate([
        { mortgageType: "아파트외", repayType: "만기일시상환방식", rateMin: 3.7 },
        { mortgageType: "아파트", repayType: "만기일시상환방식", rateMin: 3.7 },
        { mortgageType: "아파트", repayType: "분할상환방식", rateMin: 4.2 },
        { mortgageType: "아파트", repayType: "분할상환방식", rateMin: 4.18 },
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
  // ⚠️ 변이 대상: `v <= 0`·`Number.isFinite` 거르기를 빼면 빨강.
  it("금리 0·NaN 상품은 고르지 않는다 — 옆의 정상 상품을 고른다", () => {
    const apt = (/** @type {number} */ rateMin) => ({ mortgageType: "아파트", repayType: "분할상환방식", rateMin });
    expect(pickMonthlyRate([apt(0), apt(4.2)])).toBe(4.2);
    expect(pickMonthlyRate([apt(Number.NaN), apt(4.2)])).toBe(4.2);
    expect(pickMonthlyRate([apt(0)])).toBeNull();
    expect(pickMonthlyRate([apt(Number.NaN)])).toBeNull();
  });
});
