// @ts-check
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoanAnalysis } from "./LoanAnalysis";
import { makeApt } from "@/__tests__/factories";
import { useLoanRates } from "@/hooks/useLoanRates";
import { FundingPlanner } from "./FundingPlanner";
import { LOAN_RULES_BASIS } from "@/constants/loanRules";
import { usePresaleDetail } from "@/hooks/usePresaleDetail";

// 주담대 은행권 금리 — LoanAnalysis 가 한 번 받아 "한 달에 갚을 돈"·은행 범위 줄이 같이 쓴다(세션593 D2·D3 · 세션665).
// 아파트·분할상환 4.2% 하나만 두면 월 상환액 줄 "대출 X · 30년 …" 에서 대출액(= 위 대출 막대와 같은 값)을 읽을 수 있다.
vi.mock("@/hooks/useLoanRates", () => ({
  useLoanRates: vi.fn(() => ({
    rates: [
      {
        bank: "아이엠뱅크",
        product: "p",
        mortgageType: "아파트",
        repayType: "분할상환방식",
        rateMin: 4.2,
        rateMax: 6.51,
      },
    ],
    disclosureMonth: "202609",
    loading: false,
    error: null,
  })),
}));

// 잔금 계획 카드(세션659) 모킹 — 자기 시험(FundingPlanner.test.tsx)이 따로 있다. 여기선 받은 값만 본다.
// 평수 단추(UnitChips)·배지 글자는 진짜를 쓴다 — 단추를 눌러 막대·한 달 상환이 같이 바뀌는지 본다(세션675).
vi.mock("./FundingPlanner", async (importOriginal) => ({
  .../** @type {any} */ (await importOriginal()),
  FundingPlanner: vi.fn(() => <div data-testid="funding-planner" />),
}));

// 평형표 — 기본은 없음(jsdom 에서 fetch 대신). 시험마다 갈아 끼운다.
const NO_UNITS = { schedule: null, units: [], firstRecruitDate: null, loading: false, error: null };
vi.mock("@/hooks/usePresaleDetail", () => ({
  usePresaleDetail: vi.fn(() => NO_UNITS),
}));

// LoanRatesSection 모킹 (단위 테스트 격리)
vi.mock("./LoanRatesSection", () => ({
  LoanRatesSection: vi.fn(() => <div data-testid="loan-rates-section" />),
}));

/** 월 상환액 블록의 작은 글 "대출 X · 30년 · …" 에서 대출액 X 를 찾는다 */
const loanLine = (/** @type {string} */ amount) => screen.getByText(new RegExp(`^대출 ${amount} · 30년 · `));

describe("LoanAnalysis", () => {
  // 시험 하나가 중간에 실패해도 갈아 끼운 평형표가 뒤 시험에 새지 않게(세션675 검사 F12)
  afterEach(() => {
    vi.mocked(usePresaleDetail).mockImplementation(() => NO_UNITS);
  });

  // 세션593 D1 — 숫자 3칸(분양가·LTV 대출한도·필요 자기자본)은 위 대출 막대로 합쳤다.
  // ⚠️ 변이 대상: 3칸을 되살리면 빨강.
  it("숫자 3칸(분양가·LTV 대출한도·필요 자기자본)이 없다", () => {
    const apt = /** @type {any} */ (makeApt({ price: 50000, region: "경기", gu: "수원시" }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.queryByText("분양가")).toBeNull();
    expect(screen.queryByText("LTV 대출한도")).toBeNull();
    expect(screen.queryByText("필요 자기자본")).toBeNull();
  });

  // 비규제지역 존 표시 (현재 ZONE_MAP 비어있으므로 모든 지역 = normal)
  it("비규제지역 배지를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ region: "경기", gu: "수원시" }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("비규제지역")).toBeTruthy();
  });

  // LTV 계산 검증 — 비규제 70% (월 상환액 블록의 대출액으로 읽는다)
  it("비규제지역 LTV 70%를 올바르게 계산한다", () => {
    const apt = /** @type {any} */ (makeApt({ price: 50000, region: "강원", gu: "춘천시" }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(loanLine("3억 5,000만")).toBeTruthy();
  });

  // 세션592 규정 정정 — 비규제 70% 하나 · 수도권 최대 6억 · DB 규제 표시 우선
  it("지방 비규제 10억 → 대출한도 7억 (옛 9억 나눔이면 6.9억)", () => {
    const apt = /** @type {any} */ (makeApt({ price: 100000, region: "부산", gu: "해운대구", isRegulated: false }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(loanLine("7억")).toBeTruthy();
    expect(screen.getByText("LTV: 70% (무주택자 기준)")).toBeTruthy();
  });

  it("경기 비규제 10억 → 대출한도 6억 (수도권 주택구입 대출 최대 6억) + 요약에 한도 문장", () => {
    const apt = /** @type {any} */ (makeApt({ price: 100000, region: "경기", gu: "평택시", isRegulated: false }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(loanLine("6억")).toBeTruthy();
    expect(screen.getByText("LTV: 70% (무주택자 기준) · 수도권 대출한도 최대 6억")).toBeTruthy();
  });

  it("DB 규제 표시가 이름보다 먼저 — 화성시 + isRegulated 참 → 규제지역 배지·40%", () => {
    const apt = /** @type {any} */ (makeApt({ price: 100000, region: "경기", gu: "화성시", isRegulated: true }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("규제지역")).toBeTruthy();
    expect(loanLine("4억")).toBeTruthy();
    // 기준일 글자는 상수 하나(LOAN_RULES_BASIS)에서 조립한다(세션659) — 글자 자체는 loanRules.test.ts 가 고정
    expect(
      screen.getByText(`정부가 조정대상지역·투기과열지구로 함께 지정한 곳이에요(${LOAN_RULES_BASIS} 기준).`)
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
    expect(reg.container.textContent).toContain("대출 4억 · "); // 금액은 그대로 40%
    reg.unmount();
    const normal = render(
      <LoanAnalysis
        apt={/** @type {any} */ (makeApt({ price: 50000, region: "부산", gu: "해운대구", isRegulated: false }))}
      />
    );
    expect(normal.container.textContent).not.toContain("종전 기준");
  });

  // 세션660 사장님 결정 — 4구(강남·서초·송파·용산)는 10·15 전부터 규제지역이라 9·7 기준일·종전 50% 문장, 그 밖은 옛 문장 그대로.
  // ⚠️ 변이 대상: 4구 갈래를 지우면(늘 70%) 송파가 빨강 · 늘 4구 문장이면 은평·구리가 빨강.
  it("경과 규정 문장 — 4구는 '2025-09-07까지 … 최대 50%', 은평구·구리시는 옛 70% 문장 글자 그대로", () => {
    const old =
      "규제지역 지정 전에 모집공고를 한 단지는 중도금·잔금(집단)대출에 종전 기준(최대 70%)이 적용될 수 있어요(분양권 전매는 강화 기준).";
    const g4 =
      "2025-09-07까지 모집공고를 한 단지는 중도금·잔금(집단)대출에 종전 기준(최대 50%)이 적용될 수 있어요(분양권 전매는 강화 기준).";
    for (const gu of ["송파구", "강남구", "서초구", "용산구"]) {
      const r = render(
        <LoanAnalysis apt={/** @type {any} */ (makeApt({ price: 100000, region: "서울", gu, isRegulated: true }))} />
      );
      expect(r.container.textContent).toContain(g4);
      expect(r.container.textContent).not.toContain("최대 70%");
      r.unmount();
    }
    for (const [region, gu] of [
      ["서울", "은평구"],
      ["경기", "구리시"],
    ]) {
      const r = render(
        <LoanAnalysis apt={/** @type {any} */ (makeApt({ price: 100000, region, gu, isRegulated: true }))} />
      );
      expect(r.container.textContent).toContain(old);
      expect(r.container.textContent).not.toContain("2025-09-07까지");
      r.unmount();
    }
  });

  it("법률 안내문은 기준일(LOAN_RULES_BASIS) 숫자 (DSR 은행 40%·2금융 50% · 디딤돌 · 보금자리)", () => {
    const apt = /** @type {any} */ (makeApt({ price: 50000 }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText("관련 법률/규정 안내"));
    const text = document.body.textContent ?? "";
    expect(text).toContain(`${LOAN_RULES_BASIS} 기준`);
    expect(text).toContain("은행권 40%, 2금융권 50%");
    expect(text).toContain("연 2.85~4.15%");
    expect(text).toContain("최대 2억");
    expect(text).toContain("주택가격 6억 이하");
    expect(text).not.toContain("9억 이하 70%");
    expect(text).not.toContain("전 금융권 40%");
    // 세션675 라 「숫자 유지 + 기준일·출처」 · 「빨간 '참고용' 문장 지우기」
    // 꼬리 꼴 = 사장님 결정 원문 「2026년 10월 기준 · 주택도시기금」(세션675 검사 F8)
    expect(text).toContain("금리 연 2.85~4.15% (2026년 10월 기준 · 주택도시기금)");
    expect(text).toContain("고정금리 (2026년 10월 기준 · 한국주택금융공사)");
    expect(text).not.toContain("누리집 · 2026년 10월 확인");
    expect(text).not.toContain("참고용");
    expect(text).not.toContain("금융기관에 확인하세요");
  });

  // region/gu가 null인 경우 — getZone은 normal 폴백
  it("region이 null이어도 크래시 없이 렌더링한다", () => {
    const apt = /** @type {any} */ (makeApt({ region: null, gu: null, price: 30000 }));
    expect(() => render(<LoanAnalysis apt={/** @type {any} */ (apt)} />)).not.toThrow();
    expect(screen.getByText("비규제지역")).toBeTruthy();
  });

  // price가 0인 경우 — 대출액이 0 이라 월 상환액 블록을 그리지 않는다(은행 금리 범위는 단지와 무관하게 그린다)
  it("price가 0이면 한 달에 갚을 돈을 그리지 않는다", () => {
    const apt = /** @type {any} */ (makeApt({ price: 0 }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.queryByText("한 달에 갚을 돈")).toBeNull();
    expect(screen.getByText("은행 주택담보대출 금리")).toBeTruthy();
  });

  // 세션593 D2 — 한 달에 갚을 돈이 본문(맨 위)에 있고 은행 금리 범위가 그 아래
  it("한 달에 갚을 돈과 은행 금리 범위가 접힘 없이 본문에 있다 (대출 5억 비규제 = 3.5억 · 4.2%)", () => {
    const apt = /** @type {any} */ (makeApt({ price: 50000, region: "부산", gu: "해운대구", isRegulated: false }));
    const { container } = render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    const block = screen.getByTestId("monthly-payment");
    // 세션675 「한 달 상환에 금리 2개」 — 35,000만 · 30년 원리금균등 · 4.2% = 171.15 → "171만" / 6.51% = 221.4 → "221만"
    expect(screen.getByTestId("monthly-payment-amount").textContent).toBe("171만 ~ 221만 원/월");
    expect(block.textContent).toContain("아파트·분할상환 은행 금리 4.20% ~ 6.51% 기준");
    expect(block.textContent).toContain("2026년 9월 공시");
    const order = [...container.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid"));
    expect(order.indexOf("monthly-payment")).toBeLessThan(order.indexOf("bank-rate-bars"));
    expect(order.indexOf("bank-rate-bars")).toBeLessThan(order.indexOf("loan-rates-section"));
    // 세션665 — 금융 탭 어디에도 은행 이름이 없다
    expect(container.textContent).not.toContain("아이엠뱅크");
  });

  // D2·D3 같은 응답 공유 — 주담대 은행권 훅은 한 번(권역 020000)만 부른다
  it("주담대 금리는 은행권(020000) 한 가지로만 부른다", () => {
    vi.mocked(useLoanRates).mockClear();
    render(<LoanAnalysis apt={/** @type {any} */ (makeApt({ price: 50000 }))} />);
    const groups = new Set(vi.mocked(useLoanRates).mock.calls.map((c) => c[0]));
    expect([...groups]).toEqual(["020000"]);
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

  // 세션675 결정 다 「3개 다 지우기」 — 면적별 매매/대출 표(시·군·구 전체 시세)와 그 표만 쓰던 전세 금리 조회를 지웠다.
  // ⚠️ 변이 대상: 표나 전세 금리 조회를 되살리면 빨강.
  it("면적별 표·월이자가 없다 — 상자 제목은 '지역 대출 규칙'(전세 금리 훅 파일은 세션675 검사 F10 에 지웠다)", () => {
    const apt = makeApt({
      price: 50000,
      area: 84,
      priceByArea: [{ area: 84, min: 48000, avg: 50000, max: 52000, count: 5 }],
      rentByArea: [{ area: 84, min: 20000, avg: 25000, max: 30000 }],
    });
    const { container } = render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(container.querySelectorAll("table")).toHaveLength(0);
    for (const w of ["월이자", "최저매매", "전세평균", "LTV한도", "매매/대출 분석", "84㎡"]) {
      expect(container.textContent).not.toContain(w);
    }
    expect(screen.getByText("지역 대출 규칙")).toBeTruthy();
  });

  // 키보드 접근성 — Enter 키로 토글
  it("Enter 키로 법률 섹션을 토글할 수 있다", () => {
    const apt = /** @type {any} */ (makeApt({ price: 50000 }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    const toggle = screen.getByRole("button", { name: /관련 법률/ });
    fireEvent.keyDown(toggle, { key: "Enter" });
    expect(screen.getByText(/LTV \(담보인정비율\)/)).toBeTruthy();
  });

  // LoanRatesSection(다른 금융권 더 보기)이 렌더링된다
  it("LoanRatesSection을 렌더링한다", () => {
    const apt = /** @type {any} */ (makeApt({ price: 50000 }));
    render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    expect(screen.getByTestId("loan-rates-section")).toBeTruthy();
  });

  // 세션659 — 잔금 계획 카드는 이 부품이 받은 은행권 금리 응답을 그대로 받는다(새 호출 0).
  // ⚠️ 변이 대상: rates 를 [] 로 넘기거나 카드를 지우면 빨강.
  it("순서 = 평수 단추 → 막대 → 잔금 카드 → 한 달 상환 · 카드는 같은 apt·같은 은행권 금리 응답을 받는다", () => {
    vi.mocked(FundingPlanner).mockClear();
    const apt = /** @type {any} */ (makeApt({ price: 50000 }));
    const { container } = render(<LoanAnalysis apt={/** @type {any} */ (apt)} />);
    const props = /** @type {any} */ (vi.mocked(FundingPlanner).mock.calls[0]?.[0]);
    expect(props.apt).toBe(apt);
    expect(props.rates).toEqual(vi.mocked(useLoanRates).mock.results[0]?.value.rates);
    expect(props.rates.length).toBeGreaterThan(0);
    expect(container.firstElementChild?.getAttribute("data-testid")).toBe("fp-unit-chips");
    const order = [...container.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid"));
    const at = (/** @type {string} */ id) => order.indexOf(id);
    expect(at("fp-unit-chips")).toBeLessThan(at("loan-stack-basis"));
    expect(at("loan-stack-basis")).toBeLessThan(at("funding-planner"));
    expect(at("funding-planner")).toBeLessThan(at("monthly-payment"));
    // 평형표가 없으면 대표 분양가 한 줄 + "대표 분양가 기준"
    expect(screen.getByTestId("fp-unit-chips").textContent).toContain("(대표 분양가)");
    expect(screen.getByTestId("loan-stack-basis").textContent).toBe("대표 분양가 기준");
  });

  // 세션675 결정 나 「막대도 손님이 누른 평수로」 — 단추 하나로 막대·잔금 카드·한 달 상환이 같은 값.
  // ⚠️ 변이 대상: 막대(LoanStack price)나 한 달 상환(calcLTV)이 unit.price 대신 대표 분양가를 쓰면 빨강
  //    (대표 4억 5,000만 → 70% 3억 1,500만 · 84A 4억 6,000만 → 3억 2,200만 · 59A 3억 9,800만 → 2억 7,860만).
  it("평수 단추 — 첫 값은 대표 분양가와 가장 가까운 평수, 누르면 막대·카드·한 달 상환이 그 평수 값으로", () => {
    vi.mocked(usePresaleDetail).mockReturnValue({
      ...NO_UNITS,
      units: /** @type {any} */ ([
        { house_manage_no: "H1", model_no: "01", house_ty: "059.9847A", top_amount: 39800 },
        { house_manage_no: "H1", model_no: "02", house_ty: "084.9916A", top_amount: 46000 },
      ]),
    });
    vi.mocked(FundingPlanner).mockClear();
    const apt = /** @type {any} */ (
      makeApt({ id: "ah-9", price: 45000, region: "부산", gu: "해운대구", isRegulated: false })
    );
    const { container } = render(<LoanAnalysis apt={apt} />);
    const lastUnit = () => vi.mocked(FundingPlanner).mock.calls.at(-1)?.[0]?.unit;

    expect(screen.getByRole("button", { name: "84A · 4억 6,000만" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("loan-stack-basis").textContent).toBe("84A 기준");
    expect(container.textContent).toContain("대출 3억 2,200만");
    expect(container.textContent).toContain("분양가 4억 6,000만 · ");
    expect(loanLine("3억 2,200만")).toBeTruthy();
    expect(lastUnit()?.price).toBe(46000);
    expect(container.textContent).not.toContain("3억 1,500만");

    fireEvent.click(screen.getByRole("button", { name: "59A · 3억 9,800만" }));
    expect(screen.getByTestId("loan-stack-basis").textContent).toBe("59A 기준");
    expect(container.textContent).toContain("대출 2억 7,860만");
    expect(loanLine("2억 7,860만")).toBeTruthy();
    expect(lastUnit()?.price).toBe(39800);
    expect(lastUnit()?.unitLabel).toBe("59A");
    // 평형표는 이 부품에서 한 번만 부른다(잔금 카드는 값을 받기만 한다)
    expect(new Set(vi.mocked(usePresaleDetail).mock.calls.map((c) => c[0]))).toEqual(new Set(["ah-9"]));
  });

  // 세션675 검사 F7 — 평형표가 오는 동안 금액을 대표 분양가로 먼저 그렸다가 바꾸지 않는다.
  // ⚠️ 변이 대상: 로딩 중에도 막대·카드·한 달 상환을 그리면 빨강.
  it("평형표를 불러오는 중이면 금액 자리는 회색 자리표시 — 막대·카드·한 달 상환·단추 없음, 은행 금리는 그대로", () => {
    vi.mocked(usePresaleDetail).mockReturnValue({ ...NO_UNITS, loading: true });
    vi.mocked(FundingPlanner).mockClear();
    const { container } = render(
      <LoanAnalysis apt={/** @type {any} */ (makeApt({ price: 45000, region: "부산", gu: "해운대구" }))} />
    );
    const pending = screen.getByTestId("fin-unit-pending");
    expect(pending.getAttribute("role")).toBe("status");
    expect(pending.textContent).toContain("불러오는 중");
    expect(container.textContent).not.toContain("빌릴 수 있는 돈");
    expect(container.textContent).not.toContain("3억 1,500만");
    expect(screen.queryByTestId("monthly-payment")).toBeNull();
    expect(screen.queryByTestId("fp-unit-chips")).toBeNull();
    expect(vi.mocked(FundingPlanner)).not.toHaveBeenCalled();
    expect(screen.getByTestId("bank-rate-bars")).toBeTruthy();
    for (const w of ["못 모았", "모으지 못"]) expect(container.textContent).not.toContain(w);
  });

  it("분양가가 없으면 평형표를 부르지 않고 단추 줄도 없다", () => {
    vi.mocked(usePresaleDetail).mockClear();
    render(<LoanAnalysis apt={/** @type {any} */ (makeApt({ price: null }))} />);
    expect(vi.mocked(usePresaleDetail)).toHaveBeenCalledWith(null);
    expect(screen.queryByTestId("fp-unit-chips")).toBeNull();
    expect(screen.queryByTestId("loan-stack-basis")).toBeNull();
  });
});
