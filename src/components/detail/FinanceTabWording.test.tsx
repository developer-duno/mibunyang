import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { LoanAnalysis } from "./LoanAnalysis";
import { _resetFundingPlannerTracking } from "./FundingPlanner";
import { makeApt } from "@/__tests__/factories";

/**
 * 금융 탭 전체 글자 금지 낱말 가드(세션675 검사 F6) — 부품마다 따로 보던 시험은 법률 접힘·막대 DSR 문장에
 * 「추천·신청」을 넣어도 초록이었다. 여기선 금융 탭 본문(`LoanAnalysis` — 막대·잔금 카드·한 달 상환·은행 금리·
 * 지역 대출 규칙·법률 접힘·2금융 접힘)을 진짜 부품으로 그리고 접힘을 다 연 뒤 글자 + aria-label·title 전부를 훑는다.
 *
 * 금지 = 「신청·연결·해결·추천」(금소법상 중개·권유로 읽힐 낱말) + 금융회사 이름(가짜 응답의 은행 이름 포함).
 * 허용 = 법률 접힘의 정책 대출 두 이름(디딤돌대출·보금자리론) · 업권 이름(은행·저축은행·상호금융(농협·새마을금고 등)).
 */
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const RATES = [
  {
    bank: "아이엠뱅크",
    product: "아이엠 아파트론",
    mortgageType: "아파트",
    repayType: "분할상환방식",
    rateMin: 4.2,
    rateMax: 6.51,
  },
  {
    bank: "신한은행",
    product: "신한 주담대",
    mortgageType: "아파트",
    repayType: "분할상환방식",
    rateMin: 4.29,
    rateMax: 7.71,
  },
];
vi.mock("@/hooks/useLoanRates", () => ({
  useLoanRates: vi.fn(() => ({ rates: RATES, disclosureMonth: "202609", loading: false, error: null })),
}));
vi.mock("@/hooks/usePresaleDetail", () => ({
  usePresaleDetail: vi.fn(() => ({
    schedule: null,
    units: [
      { house_manage_no: "H1", model_no: "01", house_ty: "059.9847A", top_amount: 96140 },
      { house_manage_no: "H1", model_no: "02", house_ty: "084.9916A", top_amount: 124060 },
    ],
    firstRecruitDate: "2021-05-04",
    loading: false,
    error: null,
  })),
}));

const BANNED = [
  "신청",
  "연결",
  "해결",
  "추천",
  "국민은행",
  "신한",
  "하나은행",
  "우리은행",
  "농협은행",
  "카카오뱅크",
  "케이뱅크",
  "토스뱅크",
  "아이엠뱅크",
];

/** 화면 글자 + aria-label + title — 화면 읽기가 듣는 것까지 */
function everything(root: HTMLElement): string {
  const attrs = [...root.querySelectorAll("[aria-label],[title]")].map(
    (e) => `${e.getAttribute("aria-label") ?? ""} ${e.getAttribute("title") ?? ""}`
  );
  return `${root.textContent ?? ""} ${attrs.join(" ")}`;
}

function type(id: string, v: string) {
  fireEvent.change(document.getElementById(id) as HTMLInputElement, { target: { value: v } });
}

beforeEach(() => _resetFundingPlannerTracking());

describe("금융 탭 전체 — 금지 낱말·금융회사 이름 0", () => {
  const cases = [
    // 서울 규제(수도권 투기과열지구 꼬리 문장) · DSR 미통과 문장 · 경과규정 줄
    {
      name: "서울 규제 · DSR 미통과",
      apt: {
        price: 90870,
        region: "서울",
        gu: "중구",
        isRegulated: true,
        dsr40pass: false,
        presaleRecruitDate: "2022-12-19",
        presaleHousingType: "아파트",
        presaleMoveIn: "2099-12",
      },
    },
    // 지방 비규제 · DSR 통과 문장
    {
      name: "부산 비규제 · DSR 통과",
      apt: { price: 90870, region: "부산", gu: "해운대구", isRegulated: false, dsr40pass: true },
    },
  ];

  for (const c of cases) {
    it(`${c.name} — 접힘을 다 열고 소득 세 갈래(①②③)를 거치며 훑는다`, () => {
      const { container } = render(<LoanAnalysis apt={makeApt({ id: "ah-w", ...c.apt }) as any} />);
      fireEvent.click(screen.getByText("관련 법률/규정 안내"));
      fireEvent.click(screen.getByRole("button", { name: /저축은행 · 여신전문 · 보험 금리 보기/ }));
      fireEvent.click(screen.getByRole("button", { name: /더 자세히/ }));
      const seen: string[] = [];
      const check = () => {
        const t = everything(container);
        seen.push(screen.queryByTestId("fp-paths")?.getAttribute("data-state") ?? "none");
        for (const w of BANNED) expect(t, `금지 낱말 「${w}」`).not.toContain(w);
      };
      check(); // ① 소득 빈칸
      type("fp-income", "3000"); // ② 소득 한도 < 지역 한도
      check();
      type("fp-income", "90000"); // ③ 지역 한도에 걸림
      check();
      expect(seen).toEqual(["no-income", "income", "region"]);
      // 법률 접힘·막대 DSR 문장·2금융 접힘이 실제로 그려졌는지(안 그려지면 훑어도 의미 없다)
      expect(container.textContent).toContain("디딤돌대출");
      expect(container.textContent).toContain("소득 대비 상환 부담(DSR)");
      expect(
        screen.getByRole("button", { name: /저축은행 · 여신전문 · 보험 금리 보기/ }).getAttribute("aria-expanded")
      ).toBe("true");
    });
  }
});
