// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoanRatesSection } from "./LoanRatesSection";

// useLoanRates 모킹
vi.mock("@/hooks/useLoanRates", () => ({
  useLoanRates: vi.fn(() => ({
    rates: [
      { bank: "테스트은행", product: "주담대A", rateMin: 3.5, rateMax: 4.2 },
      { bank: "샘플은행", product: "주담대B", rateMin: 3.8, rateMax: 5.0 },
    ],
    loading: false,
    error: null,
  })),
}));

const makeApt = (overrides = {}) => ({
  price: 50000, region: "경기", gu: "수원시", area: 84,
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
    expect(tabs[2].textContent).toBe("보험");
    expect(tabs[3].textContent).toBe("기타");
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
});
