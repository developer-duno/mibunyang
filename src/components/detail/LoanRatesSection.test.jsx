// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoanRatesSection } from "./LoanRatesSection";
import { useLoanRates } from "@/hooks/useLoanRates";

/**
 * 다른 금융권 금리 "더 보기" (세션593 D6) — 은행권은 본문으로 올라갔고 여기엔 저축은행·여신전문·보험만.
 * 월 상환액·금리 고르기 시험은 `src/lib/loanRates.test.ts`·`BankLoanBlocks.test.tsx` 로 옮겼다.
 */

vi.mock("@/hooks/useLoanRates", () => ({
  useLoanRates: vi.fn(() => ({
    rates: [
      {
        bank: "테스트저축은행",
        product: "주담대A",
        mortgageType: "아파트",
        repayType: "분할상환방식",
        rateType: "변동금리",
        rateMin: 5.5,
        rateMax: 7.2,
      },
      { bank: "샘플캐피탈", product: "주담대B", rateMin: 6.1, rateMax: 8.0 },
    ],
    disclosureMonth: "202609",
    loading: false,
    error: null,
  })),
}));

const LABEL = "저축은행 · 여신전문 · 보험 금리 보기";

describe("LoanRatesSection — 다른 금융권 더 보기", () => {
  beforeEach(() => {
    vi.mocked(useLoanRates).mockClear();
  });

  it("라벨은 '저축은행 · 여신전문 · 보험 금리 보기' — 옛 '은행별 금리 비교'는 없다", () => {
    render(<LoanRatesSection />);
    expect(screen.getByText(LABEL)).toBeTruthy();
    expect(screen.queryByText("은행별 금리 비교")).toBeNull();
  });

  // ⚠️ 변이 대상: 권역 금리 훅을 접힘 바깥(항상 마운트)으로 올리면 빨강 — 닫힌 채 호출 0 이어야 한다.
  it("닫힌 동안에는 금리를 부르지 않는다 (호출 0)", () => {
    render(<LoanRatesSection />);
    expect(vi.mocked(useLoanRates)).not.toHaveBeenCalled();
  });

  it("펼치면 그때 저축은행(030300) 금리를 부른다 · 은행권(020000)은 부르지 않는다", () => {
    render(<LoanRatesSection />);
    fireEvent.click(screen.getByText(LABEL));
    const groups = vi.mocked(useLoanRates).mock.calls.map((c) => c[0]);
    expect(groups.length).toBeGreaterThan(0);
    expect(new Set(groups)).toEqual(new Set(["030300"]));
  });

  it("펼치면 권역 탭 3개 — 저축은행 · 여신전문 · 보험 (은행 탭 없음)", () => {
    render(<LoanRatesSection />);
    fireEvent.click(screen.getByText(LABEL));
    const tabs = screen.getAllByRole("tab");
    // finlife 오픈API 권역코드표: 030300 저축은행 · 030200 여신전문 · 050000 보험
    expect(tabs.map((t) => t.textContent)).toEqual(["저축은행", "여신전문", "보험"]);
    expect(screen.getByRole("tab", { name: "저축은행" }).getAttribute("aria-selected")).toBe("true");
  });

  it("탭을 누르면 그 권역 금리를 부르고 선택이 바뀐다", () => {
    render(<LoanRatesSection />);
    fireEvent.click(screen.getByText(LABEL));
    const ins = screen.getByRole("tab", { name: "보험" });
    fireEvent.click(ins);
    expect(ins.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "저축은행" }).getAttribute("aria-selected")).toBe("false");
    expect(vi.mocked(useLoanRates).mock.calls.map((c) => c[0])).toContain("050000");
  });

  it("표에 은행 이름·금리·상품 구별 글씨를 보여 준다", () => {
    render(<LoanRatesSection />);
    fireEvent.click(screen.getByText(LABEL));
    expect(screen.getByText("테스트저축은행")).toBeTruthy();
    expect(screen.getByText("5.5%")).toBeTruthy();
    expect(screen.getByText("아파트 · 분할상환방식 · 변동금리")).toBeTruthy();
    expect(document.body.textContent).not.toContain("undefined");
  });

  it("Enter 키로 펼칠 수 있고 aria-expanded 가 바뀐다", () => {
    render(<LoanRatesSection />);
    const toggle = screen.getByRole("button", { name: /저축은행 · 여신전문 · 보험/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(toggle, { key: "Enter" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("월 상환액 줄은 여기에 없다 (본문 '한 달에 갚을 돈'으로 옮겼다)", () => {
    render(<LoanRatesSection />);
    fireEvent.click(screen.getByText(LABEL));
    expect(screen.queryByText("월 상환액 시뮬레이션")).toBeNull();
    expect(document.body.textContent).not.toContain("/월");
  });
});
