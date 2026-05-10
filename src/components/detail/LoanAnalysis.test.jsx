// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoanAnalysis } from "./LoanAnalysis";
import { makeApt } from "@/__tests__/factories";

// useRentLoanRates 모킹
vi.mock("@/hooks/useRentLoanRates", () => ({
  useRentLoanRates: vi.fn(() => ({
    rates: [{ bank: "테스트은행", product: "전세대출A", rateMin: 3.8, rateMax: 4.5 }],
    loading: false,
    error: null,
  })),
}));

// LoanRatesSection 모킹 (단위 테스트 격리)
vi.mock("./LoanRatesSection", () => ({
  LoanRatesSection: vi.fn(() => <div data-testid="loan-rates-section" />),
}));

describe("LoanAnalysis", () => {
  // 기본 렌더링 — 분양가, LTV, 자기자본 카드 표시
  it("분양가, LTV 대출한도, 필요 자기자본을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ price: 50000, region: "경기", gu: "수원시" }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("분양가")).toBeTruthy();
    expect(screen.getByText("LTV 대출한도")).toBeTruthy();
    expect(screen.getByText("필요 자기자본")).toBeTruthy();
  });

  // 비규제지역 존 표시 (현재 ZONE_MAP 비어있으므로 모든 지역 = normal)
  it("비규제지역 배지를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ region: "경기", gu: "수원시" }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("비규제지역")).toBeTruthy();
  });

  // LTV 계산 검증 — 비규제 9억 이하 70%
  it("비규제지역 9억 이하 LTV 70%를 올바르게 계산한다", () => {
    const apt = /** @type {any} */ (makeApt({ price: 50000, region: "강원", gu: "춘천시" }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("3억 5,000만")).toBeTruthy();
  });

  // region/gu가 null인 경우 — getZone은 normal 폴백
  it("region이 null이어도 크래시 없이 렌더링한다", () => {
    const apt = /** @type {any} */ (makeApt({ region: null, gu: null, price: 30000 }));
    expect(() => render(<LoanAnalysis apt={/** @type {any} */ (apt)} />)).not.toThrow();
    expect(screen.getByText("비규제지역")).toBeTruthy();
  });

  // price가 0인 경우
  it("price가 0이면 분양가에 '-'을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ price: 0 }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    const dashes = screen.getAllByText("-");
    expect(dashes.length).toBeGreaterThan(0);
  });

  // 관련 법률 토글
  it("관련 법률 섹션을 클릭하면 내용이 토글된다", () => {
    const apt = /** @type {any} */ (makeApt({ price: 50000 }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    const toggle = screen.getByText("관련 법률/규정 안내");
    expect(screen.queryByText(/LTV \(담보인정비율\)/)).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText(/LTV \(담보인정비율\)/)).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByText(/LTV \(담보인정비율\)/)).toBeNull();
  });

  // aria-expanded 속성 검증
  it("토글 버튼의 aria-expanded가 올바르게 변경된다", () => {
    const apt = /** @type {any} */ (makeApt({ price: 50000 }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    const toggle = screen.getByRole("button", { name: /관련 법률/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  // priceByArea가 있으면 상세 테이블 표시 (월이자 열 포함)
  it("priceByArea가 있으면 면적별 테이블에 월이자 열을 표시한다", () => {
    const apt = makeApt({
      price: 50000, area: 84,
      priceByArea: [{ area: 84, min: 48000, avg: 50000, max: 52000, count: 5 }],
      rentByArea: [{ area: 84, min: 20000, avg: 25000, max: 30000 }],
    });
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("최저매매")).toBeTruthy();
    expect(screen.getByText("갭투자액")).toBeTruthy();
    expect(screen.getByText("월이자")).toBeTruthy();
    expect(screen.getByText("LTV한도")).toBeTruthy();
  });

  // priceByArea가 null이면 상세 테이블 미표시
  it("priceByArea가 null이면 상세 테이블을 표시하지 않는다", () => {
    const apt = /** @type {any} */ (makeApt({ price: 50000, priceByArea: null }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.queryByText("최저매매")).toBeNull();
  });

  // 키보드 접근성 — Enter 키로 토글
  it("Enter 키로 법률 섹션을 토글할 수 있다", () => {
    const apt = /** @type {any} */ (makeApt({ price: 50000 }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    const toggle = screen.getByRole("button", { name: /관련 법률/ });
    fireEvent.keyDown(toggle, { key: "Enter" });
    expect(screen.getByText(/LTV \(담보인정비율\)/)).toBeTruthy();
  });

  // LoanRatesSection이 렌더링된다
  it("LoanRatesSection을 렌더링한다", () => {
    const apt = /** @type {any} */ (makeApt({ price: 50000 }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getByTestId("loan-rates-section")).toBeTruthy();
  });

  // 전세대출 데이터 없으면 안내 메시지 표시
  it("전세 데이터 없으면 안내 메시지를 표시한다", () => {
    const apt = makeApt({
      price: 50000, area: 84,
      priceByArea: [{ area: 84, min: 48000, avg: 50000, max: 52000, count: 5 }],
      rentByArea: null,
    });
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText(/전세 시세 데이터가 없어/)).toBeTruthy();
  });

  // 갭투자액이 양수이고 전세대출 금리가 있으면 월이자 계산
  it("갭투자액 양수 + 전세대출 금리 시 월이자를 계산한다", () => {
    // gap = 48000 - 25000 = 23000만원, rate = 3.8%
    // 월이자 = 23000 * 3.8 / 100 / 12 = 72.8 → 73만원
    const apt = makeApt({
      price: 50000, area: 84,
      priceByArea: [{ area: 84, min: 48000, avg: 50000, max: 52000, count: 5 }],
      rentByArea: [{ area: 84, min: 20000, avg: 25000, max: 30000 }],
    });
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText(/\/월/)).toBeTruthy();
  });
});
