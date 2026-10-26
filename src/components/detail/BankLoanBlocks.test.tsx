import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonthlyPaymentBlock, BankRateBars, RateRangeSummary } from "./BankLoanBlocks";

const base = { mortgageType: "아파트", repayType: "분할상환방식" };
/** 10/02 은행권 응답 사본에서 뽑은 줄(값 그대로) + 맨 위 3.7% 아파트외·만기일시. 상품 이름은 이름 0 가드용 가짜 */
const RATES = [
  { bank: "경남은행", mortgageType: "아파트외", repayType: "만기일시상환방식", rateMin: 3.7, rateMax: 5.51 },
  { ...base, bank: "아이엠뱅크", product: "아이엠 아파트론", rateMin: 4.2, rateMax: 6.51 },
  { ...base, bank: "신한은행", product: "신한 주택담보대출", rateMin: 4.29, rateMax: 6.37 },
  { ...base, bank: "우리은행", product: "우리 아파트론", rateMin: 4.41, rateMax: 6.91 },
  { ...base, bank: "농협은행주식회사", product: "NH 주택담보대출", rateMin: 4.49, rateMax: 7.71 },
  { ...base, bank: "주식회사 하나은행", product: "하나 아파트론", rateMin: 4.5, rateMax: 6.5 },
  { ...base, bank: "주식회사 카카오뱅크", product: "카카오 주택담보대출", rateMin: 4.51, rateMax: 6.07 },
];

/** 픽스처의 회사·상품 이름 전부(법인 표기 "주식회사"를 뗀 짧은 이름까지) — 화면 어디에도 없어야 한다 */
function namesOf(rows: ReadonlyArray<{ bank?: string; product?: string }>): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    for (const v of [r.bank, r.product]) {
      if (!v) continue;
      out.add(v);
      const short = v.replace(/주식회사/g, "").trim();
      if (short) out.add(short);
    }
  }
  return [...out];
}

/** 렌더된 글자 + 모든 aria-label·title — 화면 읽기가 듣는 것까지 */
function everythingShown(root: HTMLElement): string {
  const attrs = [...root.querySelectorAll("[aria-label],[title]")].map(
    (e) => `${e.getAttribute("aria-label") ?? ""} ${e.getAttribute("title") ?? ""}`
  );
  return `${root.textContent ?? ""} ${attrs.join(" ")}`;
}

describe("MonthlyPaymentBlock — 한 달에 갚을 돈 (세션593 D2)", () => {
  // ⚠️ 변이 대상(세션593 후속 F4): toFixed(2) 를 빼면 "4.2%" 가 되어 빨강 — 은행 범위 줄 "4.20%"와 자릿수를 맞춘다.
  it("대표 단지 대출 2억 1,208만 · 사본 → 104만 원/월 · 4.20% · 공시월", () => {
    render(<MonthlyPaymentBlock loan={21208} rates={RATES} disclosureMonth="202609" />);
    const block = screen.getByTestId("monthly-payment");
    expect(block.textContent).toContain("한 달에 갚을 돈");
    expect(block.textContent).toContain("104만 원/월");
    expect(block.textContent).toContain(
      "대출 2억 1,208만 · 30년 · 아파트·분할상환 최저 금리 4.20% 기준 · 2026년 9월 공시"
    );
    expect(block.textContent).not.toContain("3.7%");
  });

  // ⚠️ 변이 대상: 공시월 전달을 빼면 "2026년 9월 공시"가 사라져 빨강.
  it("공시월이 없으면 그 글자만 뺀다", () => {
    render(<MonthlyPaymentBlock loan={21208} rates={RATES} disclosureMonth={null} />);
    const t = screen.getByTestId("monthly-payment").textContent ?? "";
    expect(t).toContain("104만 원/월");
    expect(t).not.toContain("공시");
    expect(t.endsWith("4.20% 기준")).toBe(true);
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

describe("BankRateBars — 은행 금리 범위 한 줄 · 은행 이름 0 (세션665)", () => {
  it("제목 · 큰 글자 범위 · 범위 줄 1줄(aria '6개 은행 4.20% ~ 7.71%') · 양 끝 X.XX%", () => {
    render(<BankRateBars rates={RATES} disclosureMonth="202609" />);
    const box = screen.getByTestId("bank-rate-bars");
    expect(box.textContent).toContain("은행 주택담보대출 금리");
    expect(box.textContent).toContain("4.20% ~ 7.71%");
    const rows = screen.getAllByTestId("bank-rate-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("aria-label")).toBe("6개 은행 4.20% ~ 7.71%");
    expect(rows[0].textContent).toContain("6개 은행");
    const band = rows[0].querySelector('[data-band="rate"]') as HTMLElement;
    expect(band.firstElementChild?.textContent).toBe("4.20%");
    expect(band.lastElementChild?.textContent).toBe("7.71%");
    expect(box.textContent).not.toContain("3.70%"); // 아파트외·만기일시는 범위에 안 든다
    expect(everythingShown(box)).not.toContain("점수");
  });

  it("눈금은 최저 내림 ~ 최고 올림 — 4~8% 에서 띠가 5% ~ 92.75%", () => {
    render(<BankRateBars rates={RATES} disclosureMonth="202609" />);
    const track = screen.getByTestId("bank-rate-row").querySelector('[data-band="rate"] > div') as HTMLElement;
    expect(track.children).toHaveLength(1); // 평균 선 없음
    const bar = track.firstElementChild as HTMLElement;
    expect(parseFloat(bar.style.left)).toBeCloseTo(5, 5);
    expect(parseFloat(bar.style.width)).toBeCloseTo(87.75, 5);
  });

  it("최저 = 최고 면 눈금 +1 — 띠가 눈금 안(왼쪽 0%)에 있다", () => {
    render(<BankRateBars rates={[{ ...base, bank: "가", rateMin: 4, rateMax: 4 }]} disclosureMonth={null} />);
    const bar = screen.getByTestId("bank-rate-row").querySelector('[data-band="rate"] > div > div') as HTMLElement;
    expect(parseFloat(bar.style.left)).toBeCloseTo(0, 5);
  });

  it("작은 글에 회사 수·상품 기준·공시월·출처 · 공시월이 없으면 그 조각만 뺀다", () => {
    const a = render(<BankRateBars rates={RATES} disclosureMonth="202609" />);
    expect(a.container.textContent).toContain(
      "공시한 6개 은행의 가장 낮은 금리 ~ 가장 높은 금리 · 아파트·분할상환 상품 · 2026년 9월 공시 · 출처: 금융감독원 금융상품통합비교공시"
    );
    a.unmount();
    const b = render(<BankRateBars rates={RATES} disclosureMonth={null} />);
    expect(b.container.textContent).toContain(
      "가장 높은 금리 · 아파트·분할상환 상품 · 출처: 금융감독원 금융상품통합비교공시"
    );
    expect(b.container.textContent).not.toContain("공시 ·");
  });

  it("금감원 비교공시 링크 — 새 창 · noopener noreferrer · 은행별 금리 글", () => {
    render(<BankRateBars rates={RATES} disclosureMonth="202609" />);
    const a = screen.getByRole("link", { name: "은행별 금리는 금감원 비교공시에서 보기 →" });
    expect(a.getAttribute("href")).toBe("https://finlife.fss.or.kr");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("쓸 상품이 0건이면 블록을 그리지 않는다", () => {
    const a = render(<BankRateBars rates={[RATES[0]]} disclosureMonth="202609" />);
    expect(a.container.innerHTML).toBe("");
    a.unmount();
    const b = render(<BankRateBars rates={[]} disclosureMonth={null} />);
    expect(b.container.innerHTML).toBe("");
  });

  // ⚠️ 변이 대상(세션665): 부품이 회사·상품 이름을 하나라도 그리면(글자·aria-label·title) 빨강.
  it("이름 0 가드 — 픽스처의 은행·상품 이름이 글자·aria-label·title 어디에도 없다", () => {
    render(<BankRateBars rates={RATES} disclosureMonth="202609" />);
    const shown = everythingShown(screen.getByTestId("bank-rate-bars"));
    const leaked = namesOf(RATES).filter((n) => shown.includes(n));
    expect(leaked).toEqual([]);
  });
});

describe("RateRangeSummary — 2금융 탭과 같은 부품 (세션665)", () => {
  const SAVINGS = [
    { ...base, bank: "가나저축은행", product: "가나 아파트담보", rateMin: 5.5, rateMax: 9.9 },
    { ...base, bank: "가나저축은행", product: "가나 아파트담보2", rateMin: 6.0, rateMax: 12.0 },
    { ...base, bank: "다라저축은행", product: "다라 주담대", rateMin: 3.9, rateMax: 15 },
    {
      bank: "마바저축은행",
      product: "마바 토지",
      mortgageType: "아파트외",
      repayType: "분할상환방식",
      rateMin: 2,
      rateMax: 3,
    },
  ];
  it("단위 낱말을 받아 '2개 저축은행' · 회사 수 = 서로 다른 이름 수 · 링크 글도 받는다", () => {
    const { container } = render(
      <RateRangeSummary
        rates={SAVINGS}
        unit="저축은행"
        disclosureMonth="202610"
        linkText="회사별 금리는 금감원 비교공시에서 보기 →"
        rowTestId="group-rate-row"
      />
    );
    expect(container.textContent).toContain("3.90% ~ 15.00%");
    expect(screen.getByTestId("group-rate-row").getAttribute("aria-label")).toBe("2개 저축은행 3.90% ~ 15.00%");
    expect(container.textContent).toContain("공시한 2개 저축은행의 가장 낮은 금리 ~ 가장 높은 금리");
    expect(container.textContent).toContain("2026년 10월 공시");
    expect(screen.getByRole("link", { name: "회사별 금리는 금감원 비교공시에서 보기 →" })).toBeTruthy();
    const leaked = namesOf(SAVINGS).filter((n) => everythingShown(container).includes(n));
    expect(leaked).toEqual([]);
  });
});

describe("큰 숫자 금리 = 은행 범위 줄의 최저 (세션593 후속 F1)", () => {
  // 최고 금리가 빈 4.1% 상품 — 옛 판은 큰 숫자만 4.1 을 쓰고 막대는 4.20 에서 시작해 어긋났다.
  const MIXED = [
    { ...base, bank: "가은행", rateMin: 4.1, rateMax: undefined },
    { ...base, bank: "나은행", rateMin: 4.2, rateMax: 6.5 },
  ];
  it("최고 금리가 빈 상품은 양쪽 다 안 쓴다 — 큰 숫자 4.20% · 범위 줄 최저 4.20%", () => {
    render(
      <>
        <MonthlyPaymentBlock loan={21208} rates={MIXED} disclosureMonth="202609" />
        <BankRateBars rates={MIXED} disclosureMonth="202609" />
      </>
    );
    const big = screen.getByTestId("monthly-payment").textContent ?? "";
    expect(big).toContain("최저 금리 4.20% 기준");
    expect(big).not.toContain("4.10%");
    const rows = screen.getAllByTestId("bank-rate-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("aria-label")).toBe("1개 은행 4.20% ~ 6.50%");
    const first = rows[0].querySelector('[data-band="rate"]')?.firstElementChild?.textContent;
    expect(first).toBe("4.20%");
    expect(big).toContain(`최저 금리 ${first} 기준`);
  });

  it("10/02 사본 전체 — 큰 숫자 = 범위 줄 최저 = 4.20%", () => {
    render(
      <>
        <MonthlyPaymentBlock loan={21208} rates={RATES} disclosureMonth="202609" />
        <BankRateBars rates={RATES} disclosureMonth="202609" />
      </>
    );
    const row = screen.getByTestId("bank-rate-row");
    const first = row.querySelector('[data-band="rate"]')?.firstElementChild?.textContent;
    expect(first).toBe("4.20%");
    expect(screen.getByTestId("monthly-payment").textContent).toContain(`최저 금리 ${first} 기준`);
  });
});
