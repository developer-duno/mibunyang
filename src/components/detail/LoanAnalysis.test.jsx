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

  // 세션592 규정 정정 — 비규제 70% 하나 · 수도권 최대 6억 · DB 규제 표시 우선
  it("지방 비규제 10억 → 대출한도 7억 (옛 9억 나눔이면 6.9억)", () => {
    const apt = /** @type {any} */ (makeApt({ price: 100000, region: "부산", gu: "해운대구", isRegulated: false }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("7억")).toBeTruthy();
    expect(screen.getByText("LTV: 70% (무주택자 기준)")).toBeTruthy();
  });

  it("경기 비규제 10억 → 대출한도 6억 (수도권 주택구입 대출 최대 6억) + 요약에 한도 문장", () => {
    const apt = /** @type {any} */ (makeApt({ price: 100000, region: "경기", gu: "평택시", isRegulated: false }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getAllByText("6억").length).toBeGreaterThan(0);
    expect(screen.getByText("LTV: 70% (무주택자 기준) · 수도권 대출한도 최대 6억")).toBeTruthy();
  });

  it("DB 규제 표시가 이름보다 먼저 — 화성시 + isRegulated 참 → 규제지역 배지·40%", () => {
    const apt = /** @type {any} */ (makeApt({ price: 100000, region: "경기", gu: "화성시", isRegulated: true }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("규제지역")).toBeTruthy();
    expect(screen.getByText("4억")).toBeTruthy();
    expect(
      screen.getByText(/정부가 조정대상지역·투기과열지구로 함께 지정한 곳이에요\(2026년 10월 기준\)/)
    ).toBeTruthy();
  });

  // 세션592 보완 F8 — 경과 규정 한 줄은 규제지역일 때만(금액 계산은 그대로).
  // ⚠️ 변이 대상: `zone !== "normal" &&` 조건을 빼면 비규제 단지에도 나와 빨강.
  it("규제지역이면 경과 규정 한 줄(지정 전 모집공고 단지 종전 기준)이 있고 비규제면 없다", () => {
    const line =
      "규제지역 지정 전에 모집공고를 한 단지는 중도금·잔금(집단)대출에 종전 기준(최대 70%)이 적용될 수 있어요(분양권 전매는 강화 기준).";
    const reg = render(
      <LoanAnalysis
        apt={/** @type {any} */ (makeApt({ price: 100000, region: "경기", gu: "구리시", isRegulated: true }))}
      />
    );
    expect(reg.container.textContent).toContain(line);
    expect(reg.container.textContent).toContain("4억"); // 금액은 그대로 40%
    reg.unmount();
    const normal = render(
      <LoanAnalysis
        apt={/** @type {any} */ (makeApt({ price: 50000, region: "부산", gu: "해운대구", isRegulated: false }))}
      />
    );
    expect(normal.container.textContent).not.toContain("종전 기준");
  });

  it("법률 안내문은 2026년 10월 기준 숫자 (DSR 은행 40%·2금융 50% · 디딤돌 · 보금자리)", () => {
    const apt = /** @type {any} */ (makeApt({ price: 50000 }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText("관련 법률/규정 안내"));
    const text = document.body.textContent ?? "";
    expect(text).toContain("2026년 10월 기준");
    expect(text).toContain("은행권 40%, 2금융권 50%");
    expect(text).toContain("연 2.85~4.15%");
    expect(text).toContain("최대 2억");
    expect(text).toContain("주택가격 6억 이하");
    expect(text).not.toContain("9억 이하 70%");
    expect(text).not.toContain("전 금융권 40%");
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
      price: 50000,
      area: 84,
      priceByArea: [{ area: 84, min: 48000, avg: 50000, max: 52000, count: 5 }],
      rentByArea: [{ area: 84, min: 20000, avg: 25000, max: 30000 }],
    });
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("최저매매")).toBeTruthy();
    expect(screen.getByText("갭투자액")).toBeTruthy();
    expect(screen.getByText("월이자")).toBeTruthy();
    expect(screen.getByText("LTV한도")).toBeTruthy();
  });

  // 거래 건수 노출 (세션554) — 갭투자액·월이자는 이 건수 위에서 계산된다.
  // 실측(2026-09-21, apartments_flat 2,458행): 면적 구간의 8.8%가 거래 1건, 21.4%가 5건 미만.
  // 형제 화면 PriceTable 은 이미 "건수" 열을 보여주는데 여기만 숨겨 한 모달이 서로 다른 말을 했다.
  it("면적별 표에 거래 건수를 함께 보여준다", () => {
    const apt = makeApt({
      price: 50000,
      area: 84,
      priceByArea: [{ area: 84, min: 48000, avg: 50000, max: 52000, count: 3 }],
      rentByArea: [{ area: 84, min: 20000, avg: 25000, max: 30000 }],
    });
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("거래")).toBeTruthy();
    expect(screen.getByText("3건")).toBeTruthy();
  });

  // 건수가 적으면 눈에 띄게 — 5건 미만은 경고색으로 "믿을 만한가"를 말해 준다.
  it("거래 5건 미만이면 주의 표시를 함께 준다", () => {
    const apt = makeApt({
      price: 50000,
      area: 84,
      priceByArea: [{ area: 84, min: 48000, avg: 50000, max: 52000, count: 1 }],
      rentByArea: [{ area: 84, min: 20000, avg: 25000, max: 30000 }],
    });
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    const cell = screen.getByTestId("loan-trade-count-84");
    expect(cell.textContent).toContain("1건");
    expect(cell.getAttribute("data-few")).toBe("true");
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
      price: 50000,
      area: 84,
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
      price: 50000,
      area: 84,
      priceByArea: [{ area: 84, min: 48000, avg: 50000, max: 52000, count: 5 }],
      rentByArea: [{ area: 84, min: 20000, avg: 25000, max: 30000 }],
    });
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText(/\/월/)).toBeTruthy();
  });

  // 세션576 D2 — 면적이 없는(null) 단지도 면적별 표가 뜬다. 옛 코드는 null 을 0㎡ 로 바꿔
  // "0㎡ ±20㎡" 에 걸리는 행이 없어 표가 통째로 사라졌다.
  it("면적이 없어도 면적별 매매/대출 표를 거르지 않는다 (D2)", () => {
    const apt = makeApt({
      price: 50000,
      area: null,
      priceByArea: [{ area: 84, min: 48000, avg: 50000, max: 52000, count: 5 }],
      rentByArea: [{ area: 84, min: 23000, avg: 25000, max: 27000 }],
    });
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("84㎡")).toBeTruthy();
    expect(screen.getByTestId("loan-trade-count-84")).toBeTruthy();
  });

  it("면적이 0 이어도 면적별 매매/대출 표를 거르지 않는다 (D2 경계)", () => {
    const apt = makeApt({
      price: 50000,
      area: 0,
      priceByArea: [{ area: 84, min: 48000, avg: 50000, max: 52000, count: 5 }],
      rentByArea: [{ area: 84, min: 23000, avg: 25000, max: 27000 }],
    });
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("84㎡")).toBeTruthy();
    expect(screen.getByTestId("loan-trade-count-84")).toBeTruthy();
  });

  // 세션592 보완 F1 — 면적별 표의 줄마다 대출 한도도 같은 규칙(수도권 최대 6억)을 쓴다.
  // ⚠️ 변이 대상: 줄 계산 `calcLTV(p.min, zone, apt.region)` 에서 시도를 빼면 이 줄이 7억이 되어 빨강.
  it("면적별 표 — 경기 비규제·그 면적 최저가 10억이면 그 줄 대출 한도는 6억", () => {
    const apt = makeApt({
      price: 50000,
      area: 84,
      region: "경기",
      gu: "평택시",
      isRegulated: false,
      priceByArea: [{ area: 84, min: 100000, avg: 100000, max: 100000, count: 5 }],
      rentByArea: [{ area: 84, min: 20000, avg: 25000, max: 30000 }],
    });
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    const row = screen.getByTestId("loan-trade-count-84").closest("tr");
    const cells = [...(row?.querySelectorAll("td") ?? [])];
    expect(cells[cells.length - 1]?.textContent).toBe("6억");
  });
});
