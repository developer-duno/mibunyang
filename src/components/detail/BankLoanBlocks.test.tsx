import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonthlyPaymentBlock, BankRateBars } from "./BankLoanBlocks";

const base = { mortgageType: "아파트", repayType: "분할상환방식" };
/** 10/02 은행권 응답 사본에서 뽑은 줄(값 그대로) + 맨 위 3.7% 아파트외·만기일시 */
const RATES = [
  { bank: "경남은행", mortgageType: "아파트외", repayType: "만기일시상환방식", rateMin: 3.7, rateMax: 5.51 },
  { ...base, bank: "아이엠뱅크", rateMin: 4.2, rateMax: 6.51 },
  { ...base, bank: "신한은행", rateMin: 4.29, rateMax: 6.37 },
  { ...base, bank: "우리은행", rateMin: 4.41, rateMax: 6.91 },
  { ...base, bank: "농협은행주식회사", rateMin: 4.49, rateMax: 7.71 },
  { ...base, bank: "주식회사 하나은행", rateMin: 4.5, rateMax: 6.5 },
  { ...base, bank: "주식회사 카카오뱅크", rateMin: 4.51, rateMax: 6.07 },
];

describe("MonthlyPaymentBlock — 한 달에 갚을 돈 (세션593 D2)", () => {
  it("대표 단지 대출 2억 1,208만 · 사본 → 104만 원/월 · 4.2% · 공시월", () => {
    render(<MonthlyPaymentBlock loan={21208} rates={RATES} disclosureMonth="202609" />);
    const block = screen.getByTestId("monthly-payment");
    expect(block.textContent).toContain("한 달에 갚을 돈");
    expect(block.textContent).toContain("104만 원/월");
    expect(block.textContent).toContain(
      "대출 2억 1,208만 · 30년 · 아파트·분할상환 최저 금리 4.2% 기준 · 2026년 9월 공시"
    );
    expect(block.textContent).not.toContain("3.7%");
  });

  // ⚠️ 변이 대상: 공시월 전달을 빼면 "2026년 9월 공시"가 사라져 빨강.
  it("공시월이 없으면 그 글자만 뺀다", () => {
    render(<MonthlyPaymentBlock loan={21208} rates={RATES} disclosureMonth={null} />);
    const t = screen.getByTestId("monthly-payment").textContent ?? "";
    expect(t).toContain("104만 원/월");
    expect(t).not.toContain("공시");
    expect(t.endsWith("4.2% 기준")).toBe(true);
  });

  it("아파트·분할상환 상품이 없거나 응답이 비면 그리지 않는다", () => {
    const a = render(<MonthlyPaymentBlock loan={21208} rates={[RATES[0]]} disclosureMonth="202609" />);
    expect(a.container.innerHTML).toBe("");
    a.unmount();
    const b = render(<MonthlyPaymentBlock loan={21208} rates={[]} disclosureMonth={null} />);
    expect(b.container.innerHTML).toBe("");
  });

  it("대출액이 0 이면 그리지 않는다", () => {
    const { container } = render(<MonthlyPaymentBlock loan={0} rates={RATES} disclosureMonth="202609" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("BankRateBars — 은행 범위 막대 5줄 (세션593 D3)", () => {
  it("최저 낮은 순 5줄 · 이름은 법인 표기만 떼고 · 양 끝에 X.XX%", () => {
    render(<BankRateBars rates={RATES} disclosureMonth="202609" />);
    const rows = screen.getAllByTestId("bank-rate-row");
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "아이엠뱅크 4.20% ~ 6.51%",
      "신한은행 4.29% ~ 6.37%",
      "우리은행 4.41% ~ 6.91%",
      "농협은행 4.49% ~ 7.71%",
      "하나은행 4.50% ~ 6.50%",
    ]);
    const band = rows[0].querySelector('[data-band="rate"]') as HTMLElement;
    expect(band.firstElementChild?.textContent).toBe("4.20%");
    expect(band.lastElementChild?.textContent).toBe("6.51%");
    expect(rows.every((r) => !(r.getAttribute("aria-label") ?? "").includes("점수"))).toBe(true);
  });

  it("눈금은 5줄 최저 내림 ~ 최고 올림 — 4~8% 에서 아이엠뱅크 띠가 5%~62.75%", () => {
    render(<BankRateBars rates={RATES} disclosureMonth="202609" />);
    const track = screen.getAllByTestId("bank-rate-row")[0].querySelector('[data-band="rate"] > div') as HTMLElement;
    expect(track.children).toHaveLength(1); // 평균 선 없음
    const bar = track.firstElementChild as HTMLElement;
    expect(parseFloat(bar.style.left)).toBeCloseTo(5, 5);
    expect(parseFloat(bar.style.width)).toBeCloseTo(57.75, 5);
  });

  it("작은 글에 상품 기준·공시월·출처 · 공시월이 없으면 그 조각만 뺀다", () => {
    const a = render(<BankRateBars rates={RATES} disclosureMonth="202609" />);
    expect(a.container.textContent).toContain(
      "아파트·분할상환 상품 · 2026년 9월 공시 · 출처: 금융감독원 금융상품통합비교공시"
    );
    a.unmount();
    const b = render(<BankRateBars rates={RATES} disclosureMonth={null} />);
    expect(b.container.textContent).toContain("아파트·분할상환 상품 · 출처: 금융감독원 금융상품통합비교공시");
    expect(b.container.textContent).not.toContain("공시 ·");
  });

  it("0줄이면 블록을 그리지 않는다", () => {
    const { container } = render(<BankRateBars rates={[RATES[0]]} disclosureMonth="202609" />);
    expect(container.innerHTML).toBe("");
  });
});
