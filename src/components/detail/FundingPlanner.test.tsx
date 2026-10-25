import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FundingPlanner, DSR_GAP_NOTICE, _resetFundingPlannerTracking } from "./FundingPlanner";
import { usePresaleDetail } from "@/hooks/usePresaleDetail";
import { trackEvent } from "@/lib/analytics";
import { makeApt } from "@/__tests__/factories";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
// 평형표·첫 공고일 — 기본은 없음(jsdom 에서 fetch 대신). 시험마다 갈아 끼운다.
vi.mock("@/hooks/usePresaleDetail", () => ({
  usePresaleDetail: vi.fn(() => ({ schedule: null, units: [], firstRecruitDate: null, loading: false, error: null })),
}));

/** 은행권 아파트·분할상환 최저 4.38% 한 상품 */
const RATES = [{ bank: "x", mortgageType: "아파트", repayType: "분할상환방식", rateMin: 4.38, rateMax: 6.0 }];

const apt = (o: Record<string, unknown> = {}) =>
  makeApt({
    id: "ah-1",
    price: 39800,
    region: "인천",
    gu: "남동구",
    isRegulated: false,
    presaleRecruitDate: null,
    ...o,
  }) as any;

function type(id: string, v: string) {
  fireEvent.change(document.getElementById(id) as HTMLInputElement, { target: { value: v } });
}
const text = () => document.body.textContent ?? "";

beforeEach(() => {
  vi.mocked(trackEvent).mockClear();
  vi.mocked(usePresaleDetail).mockClear();
  _resetFundingPlannerTracking();
});

describe("FundingPlanner — 그리기 조건", () => {
  it("분양가가 없으면 카드 자체를 안 그리고 평형표도 부르지 않는다", () => {
    const { container } = render(<FundingPlanner apt={apt({ price: null })} rates={RATES} />);
    expect(container.innerHTML).toBe("");
    expect(vi.mocked(usePresaleDetail)).toHaveBeenCalledWith(null);
  });

  it("평형표가 없으면 칩 없이 대표 분양가 한 줄 · 입력 칸 id 고정", () => {
    render(<FundingPlanner apt={apt()} rates={RATES} />);
    expect(screen.getByTestId("funding-planner")).toBeTruthy();
    expect(text()).toContain("(대표 분양가)");
    expect(document.getElementById("fp-income")).toBeTruthy();
    expect(document.getElementById("fp-cash")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "평형 고르기" })).toBeNull();
  });
});

describe("FundingPlanner — 계산 화면", () => {
  it("소득 빈칸 → 지역 한도만 · 소득 안내 · 안내 문장 없음", () => {
    render(<FundingPlanner apt={apt()} rates={RATES} />);
    expect(screen.getByTestId("fp-income-skip").textContent).toBe("연소득을 넣으면 소득 기준 한도도 계산해요");
    expect(screen.getByTestId("fp-loan").textContent).toContain("잔금 때 주담대 예상액 (지역 한도 기준)");
    expect(screen.getByTestId("fp-loan").textContent).toContain("2억 7,860만");
    expect(screen.queryByTestId("fp-dsr-notice")).toBeNull();
  });

  it("목업 예시 — 소득 4,800·가진 돈 8,000 → 작은 값 2억 3,154만 · 월 116만 · 더 필요한 돈 8,646만 · DSR 안내 문장 그대로", () => {
    render(<FundingPlanner apt={apt()} rates={RATES} />);
    type("fp-income", "4,800");
    type("fp-cash", "8000");
    expect((document.getElementById("fp-income") as HTMLInputElement).value).toBe("4,800");
    expect(screen.getByTestId("fp-region-limit").textContent).toContain("LTV 70%");
    expect(screen.getByTestId("fp-income-limit").textContent).toContain("스트레스 금리 7.38%, 은행 최저 금리 기준");
    expect(screen.getByTestId("fp-income-limit").textContent).toContain("2억 3,154만");
    expect(screen.getByTestId("fp-loan").textContent).toContain("둘 중 작은 값");
    expect(screen.getByTestId("fp-loan").textContent).toContain("2억 3,154만");
    expect(screen.getByTestId("fp-monthly").textContent).toContain("116만 원");
    expect(screen.getByTestId("fp-shortfall").textContent).toBe("더 필요한 돈 8,646만");
    expect(screen.getByTestId("fp-dsr-notice").textContent).toBe(DSR_GAP_NOTICE);
    expect(DSR_GAP_NOTICE).toBe(
      "은행 DSR 40% 기준으로 계산했어요. 저축은행·여신전문(캐피탈)·보험사는 DSR 50% 를 적용해 한도가 다를 수 있고 금리가 은행보다 높아요. 금융사별 조건은 아래 공시에서 비교해 보세요."
    );
    expect(text()).toContain("취득세·등기비 등은 빼고 계산했어요");
  });

  it("부족분이 없으면 소득 한도 < 지역 한도여도 안내 문장 없음(부족할 때만 — 결정 14)", () => {
    render(<FundingPlanner apt={apt()} rates={RATES} />);
    type("fp-income", "4800"); // 소득 한도 2억 3,154만 < 지역 2억 7,860만
    type("fp-cash", "20000");
    expect(screen.getByTestId("fp-enough")).toBeTruthy();
    expect(screen.queryByTestId("fp-dsr-notice")).toBeNull();
  });

  it("지역 한도에 걸린 부족분이면 안내 문장 없음(소득이 넉넉 · 가진 돈 적음)", () => {
    render(<FundingPlanner apt={apt()} rates={RATES} />);
    type("fp-income", "20000");
    expect(screen.getByTestId("fp-shortfall")).toBeTruthy();
    expect(screen.queryByTestId("fp-dsr-notice")).toBeNull();
  });

  it("더 필요한 돈 ≤ 0 — 소득까지 계산했으면 초록 문장, 소득 빈칸이면 중립 문장(초록 금지)", () => {
    const a = render(<FundingPlanner apt={apt()} rates={RATES} />);
    type("fp-cash", "30000");
    expect(screen.queryByTestId("fp-enough")).toBeNull();
    // 소득 빈칸이면 위 줄 안내는 숨기지 않는다(숨김은 금리 없음일 때만 — 세션660)
    expect(screen.getByTestId("fp-income-skip").textContent).toBe("연소득을 넣으면 소득 기준 한도도 계산해요");
    expect(screen.getByTestId("fp-enough-region").textContent).toBe(
      "지역 한도 기준이에요. 연소득을 넣으면 소득 기준 한도까지 볼 수 있어요"
    );
    type("fp-income", "20000");
    expect(screen.getByTestId("fp-enough").textContent).toBe("지금 가진 돈과 주담대로 분양가를 맞출 수 있어요");
    a.unmount();
  });

  it("금리를 못 받으면 소득 한도·월 상환 줄 없이 한 줄 안내", () => {
    render(<FundingPlanner apt={apt()} rates={[]} />);
    type("fp-income", "4800");
    expect(screen.getByTestId("fp-income-skip").textContent).toBe("금리를 아직 못 받아 소득 기준은 계산하지 않았어요");
    expect(screen.queryByTestId("fp-monthly")).toBeNull();
    expect(text()).not.toContain("0원");
  });

  it("연소득 있음 + 금리 없음 + 더 필요한 돈 ≤ 0 → 금리 문장(중립) · '연소득을 넣으면…' 없음", () => {
    render(<FundingPlanner apt={apt()} rates={[]} />);
    type("fp-income", "4800");
    type("fp-cash", "30000");
    expect(screen.getByTestId("fp-enough-norate").textContent).toBe(
      "금리를 아직 못 받아 소득 기준은 계산하지 않았어요."
    );
    expect(screen.queryByTestId("fp-enough-region")).toBeNull();
    expect(screen.queryByTestId("fp-enough")).toBeNull();
    expect(screen.queryByTestId("fp-income-skip")).toBeNull(); // 같은 문장 두 번 금지(세션660)
    expect(text().split("금리를 아직 못 받아").length - 1).toBe(1);
  });

  it("금리 없음 + 더 필요한 돈이 정확히 0 — 금리 문장은 아래 상자에 한 번만", () => {
    render(<FundingPlanner apt={apt()} rates={[]} />);
    type("fp-income", "4800");
    type("fp-cash", "11940"); // 3억 9,800만 − 지역 한도 70% 2억 7,860만 = 1억 1,940만
    expect(screen.queryByTestId("fp-shortfall")).toBeNull();
    expect(screen.getByTestId("fp-enough-norate")).toBeTruthy();
    expect(screen.queryByTestId("fp-income-skip")).toBeNull();
    expect(text().split("금리를 아직 못 받아").length - 1).toBe(1);
  });

  it("비율 합이 100 이 아니면 빨간 안내 + 계산 중단", () => {
    render(<FundingPlanner apt={apt()} rates={RATES} />);
    fireEvent.click(screen.getByRole("button", { name: /더 자세히/ }));
    expect(screen.getByRole("button", { name: /더 자세히/ }).getAttribute("aria-expanded")).toBe("true");
    expect(text()).toContain("3,980만"); // 계약금 10%
    type("fp-split-balance", "20");
    expect(screen.getByTestId("fp-split-error").textContent).toContain("지금 90%");
    expect(screen.queryByTestId("fp-loan")).toBeNull();
  });

  it("기존 대출 월 상환이 소득 한도를 다 먹으면 주담대 0 · 월 상환 줄 없음", () => {
    render(<FundingPlanner apt={apt()} rates={RATES} />);
    fireEvent.click(screen.getByRole("button", { name: /더 자세히/ }));
    type("fp-income", "4800");
    type("fp-debt", "200");
    expect(screen.getByTestId("fp-loan").textContent).toContain("0원");
    expect(screen.queryByTestId("fp-monthly")).toBeNull();
  });
});

describe("FundingPlanner — 지역 갈래 문구", () => {
  it("수도권·규제지역이면 기준 줄에 3.0%p 만, 지방 비규제면 0.75%p(2026-12-31까지) 만 · 무주택 줄은 머리로", () => {
    const m = render(<FundingPlanner apt={apt()} rates={RATES} />);
    expect(screen.getByTestId("fp-basis").textContent).toBe(
      "2026년 10월 기준 · 금융위 10·15 대책 · 스트레스 DSR 3단계(수도권·규제지역 가산 3.0%p) · 실제 한도는 금융사 심사로 정해져요"
    );
    expect(screen.getByTestId("fp-homeless").textContent).toBe(
      "무주택자 기준이에요(1주택자·생애최초는 한도가 달라요)."
    );
    expect(screen.getByTestId("fp-transfer").textContent).toBe(
      "중도금 대출을 늘리지 않고 잔금대출로 바꾸면 중도금을 받을 때의 기준이 적용될 수 있어요(금융위 FAQ)."
    );
    expect(text()).toContain(
      "위 막대와 아래 '한 달에 갚을 돈'은 소득을 모르고 낸 값이에요. 이 카드는 입력한 소득 기준이에요."
    );
    expect(text()).toContain("분양가 기준이에요(입주 때 감정가가 더 낮으면 줄어요).");
    m.unmount();
    render(<FundingPlanner apt={apt({ region: "부산", gu: "해운대구" })} rates={RATES} />);
    expect(screen.getByTestId("fp-basis").textContent).toContain("스트레스 DSR 3단계(지방 0.75%p(2026-12-31까지))");
    expect(screen.getByTestId("fp-basis").textContent).not.toContain("3.0%p");
  });

  const regulated = (o: Record<string, unknown> = {}) =>
    apt({
      price: 38850,
      region: "서울",
      gu: "중구",
      isRegulated: true,
      presaleRecruitDate: "2022-12-19",
      presaleHousingType: "아파트",
      presaleMoveIn: "2099-12",
      ...o,
    });
  const withFirst = (first: string | null, moveInYm: string | null = null) =>
    vi.mocked(usePresaleDetail).mockReturnValue({
      schedule: moveInYm ? ({ house_manage_no: "H", recruit_date: "2022-12-19", move_in_ym: moveInYm } as any) : null,
      units: [],
      firstRecruitDate: first,
      loading: false,
      error: null,
    });
  const resetDetail = () =>
    vi.mocked(usePresaleDetail).mockImplementation(() => ({
      schedule: null,
      units: [],
      firstRecruitDate: null,
      loading: false,
      error: null,
    }));

  it("큰 숫자는 늘 지금 규정 · 첫 공고가 기준일 전이면 '될 수 있어요 — 최대 N' 한 줄(두 날짜 함께)", () => {
    withFirst("2021-05-04");
    render(<FundingPlanner apt={regulated()} rates={RATES} />);
    expect(screen.getByTestId("fp-region-limit").textContent).toContain("LTV 40%");
    expect(screen.getByTestId("fp-region-limit").textContent).toContain("1억 5,540만");
    expect(screen.getByTestId("fp-loan").textContent).toContain("1억 5,540만");
    expect(screen.getByTestId("fp-grandfather").textContent).toBe(
      "첫 모집공고 2021-05-04 (최근 공고 2022-12-19) — 규제지역 지정(2025-10-16) 전 공고라 금융사 심사에 따라 종전 규정(LTV 70%)이 적용될 수 있어요. 그 경우 최대 2억 7,195만이에요. 2025-10-16 이후 전매로 산 분양권은 제외예요."
    );
    resetDetail();
  });

  it("4구 — 9·7 기준 50% 줄 · 효력일 2025-09-08 · 이름 '규제지역 LTV 강화'", () => {
    withFirst(null);
    render(
      <FundingPlanner apt={regulated({ price: 94085, gu: "송파구", presaleRecruitDate: "2019-08-19" })} rates={RATES} />
    );
    expect(screen.getByTestId("fp-region-limit").textContent).toContain("3억 7,634만");
    expect(screen.getByTestId("fp-grandfather").textContent).toBe(
      "첫 모집공고 2019-08-19 — 규제지역 LTV 강화(2025-09-08) 전 공고라 금융사 심사에 따라 종전 규정(LTV 50%)이 적용될 수 있어요. 그 경우 최대 4억 7,043만이에요. 2025-09-08 이후 전매로 산 분양권은 제외예요."
    );
    resetDetail();
  });

  it("줄을 숨기는 경우 — 비주택(오피스텔·이름 (오)) · 입주 시작(카드·일정 어느 쪽이든) · 종전이 지금보다 크지 않음", () => {
    withFirst("2021-05-04");
    const cases = [
      regulated({ presaleHousingType: "오피스텔" }),
      regulated({ presaleHousingType: null, name: "어떤단지(오)" }),
      regulated({ presaleMoveIn: "2000-01" }),
      regulated({ price: 151440, gu: "서초구", presaleRecruitDate: "2024-08-16" }), // 종전도 4억 = 지금 4억
    ];
    for (const a of cases) {
      const r = render(<FundingPlanner apt={a} rates={RATES} />);
      expect(screen.queryByTestId("fp-grandfather")).toBeNull();
      r.unmount();
    }
    withFirst("2021-05-04", "200001"); // 일정의 입주월만 지남
    const r = render(<FundingPlanner apt={regulated({ presaleMoveIn: "미정" })} rates={RATES} />);
    expect(screen.queryByTestId("fp-grandfather")).toBeNull();
    r.unmount();
    withFirst("2021-05-04");
    render(<FundingPlanner apt={regulated({ presaleMoveIn: "미정" })} rates={RATES} />); // 모름 = 숨기지 않음
    expect(screen.getByTestId("fp-grandfather")).toBeTruthy();
    resetDetail();
  });

  // 세션660 사장님 결정 — 사전청약의 첫 공고는 사전당첨자모집공고라 경과규정의 입주자모집공고가 아니다.
  // ⚠️ 변이 대상: showGrandfather 의 `!isPreSubscription(...)` 줄을 지우면 첫 단언이 빨강.
  it("사전청약 단지(이름에 '사전청약')는 종전 줄 숨김 · 큰 숫자는 그대로 · 이름만 다르면 줄 있음", () => {
    withFirst("2023-12-29");
    const base = { price: 94085, gu: "송파구", presaleRecruitDate: "2023-12-29" };
    const pre = render(
      <FundingPlanner apt={regulated({ ...base, name: "위례지구A1-14 사전청약(나눔형)" })} rates={RATES} />
    );
    expect(screen.queryByTestId("fp-grandfather")).toBeNull();
    expect(screen.getByTestId("fp-region-limit").textContent).toContain("3억 7,634만");
    pre.unmount();
    render(<FundingPlanner apt={regulated({ ...base, name: "위례 어떤단지" })} rates={RATES} />);
    expect(screen.getByTestId("fp-grandfather").textContent).toContain("첫 모집공고 2023-12-29");
    expect(screen.getByTestId("fp-region-limit").textContent).toContain("3억 7,634만");
    resetDetail();
  });

  it("규제지역 + 공고일이 기준일 뒤면 지금 규정(40%) · 사실 줄 없음", () => {
    render(
      <FundingPlanner
        apt={apt({ price: 94573, region: "서울", gu: "강북구", isRegulated: true, presaleRecruitDate: "2026-06-12" })}
        rates={RATES}
      />
    );
    expect(screen.queryByTestId("fp-grandfather")).toBeNull();
    expect(screen.getByTestId("fp-region-limit").textContent).toContain("LTV 40%");
  });
});

describe("FundingPlanner — 평형 칩·계측·링크·금지 문구", () => {
  const units = [
    { house_manage_no: "H1", model_no: "01", house_ty: "059.9847A", top_amount: 39800 },
    { house_manage_no: "H1", model_no: "02", house_ty: "084.9916A", top_amount: 46000 },
  ];

  it("첫 칩 = 대표 분양가와 가장 가까운 평형 · 누르면 그 분양가로 계산 · 칩 계측은 한 번(값 없이)", () => {
    vi.mocked(usePresaleDetail).mockReturnValue({
      schedule: null,
      units: units as any,
      firstRecruitDate: null,
      loading: false,
      error: null,
    });
    render(<FundingPlanner apt={apt({ price: 45000 })} rates={RATES} />);
    const chip84 = screen.getByRole("button", { name: "84A · 4억 6,000만" });
    expect(chip84.getAttribute("aria-pressed")).toBe("true");
    const chip59 = screen.getByRole("button", { name: "59A · 3억 9,800만" });
    fireEvent.click(chip59);
    expect(chip59.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("fp-region-limit").textContent).toContain("2억 7,860만");
    fireEvent.click(chip84);
    const unitCalls = vi.mocked(trackEvent).mock.calls.filter((c) => c[0] === "funding_planner_unit");
    expect(unitCalls).toEqual([["funding_planner_unit", { aptId: "ah-1" }]]);
    vi.mocked(usePresaleDetail).mockImplementation(() => ({
      schedule: null,
      units: [],
      firstRecruitDate: null,
      loading: false,
      error: null,
    }));
  });

  it("처음 입력할 때 한 번만 funding_planner_use — 개인 수치 없이 aptId 만", () => {
    render(<FundingPlanner apt={apt()} rates={RATES} />);
    type("fp-income", "4800");
    type("fp-cash", "8000");
    type("fp-income", "5000");
    expect(vi.mocked(trackEvent).mock.calls).toEqual([["funding_planner_use", { aptId: "ah-1" }]]);
  });

  it("공시 링크 두 곳은 새 탭 · noopener noreferrer · 언제나 보인다", () => {
    render(<FundingPlanner apt={apt()} rates={RATES} />);
    type("fp-cash", "90000"); // 더 필요한 돈 ≤ 0
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["https://finlife.fss.or.kr", "https://portal.kfb.or.kr"]);
    for (const l of links) {
      expect(l.getAttribute("target")).toBe("_blank");
      expect(l.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("금지 문구 0 — 안내 문장·종전 줄·자세히까지 다 연 상태에서", () => {
    const BANNED = ["미분양이라 대출이 더", "후순위로 해결", "연결", "신청하면", "대부", "해결", "보장"];
    const r = render(<FundingPlanner apt={apt()} rates={RATES} />);
    fireEvent.click(screen.getByRole("button", { name: /더 자세히/ }));
    type("fp-income", "4800");
    type("fp-cash", "100");
    expect(screen.getByTestId("fp-dsr-notice")).toBeTruthy();
    for (const w of BANNED) {
      expect(text()).not.toContain(w);
    }
    r.unmount();
    // 종전 줄이 실제로 보이는 상태도 거친다(세션660 — 위 단지는 비규제라 종전 줄이 안 그려졌다):
    // 서울 중구 규제 · 첫 공고 2021-05-04(기준일 2025-10-15 전) · 입주 2099-12(전) · 아파트
    vi.mocked(usePresaleDetail).mockReturnValue({
      schedule: null,
      units: [],
      firstRecruitDate: "2021-05-04",
      loading: false,
      error: null,
    });
    render(
      <FundingPlanner
        apt={apt({
          price: 38850,
          region: "서울",
          gu: "중구",
          isRegulated: true,
          presaleRecruitDate: "2022-12-19",
          presaleHousingType: "아파트",
          presaleMoveIn: "2099-12",
        })}
        rates={RATES}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /더 자세히/ }));
    type("fp-income", "2000"); // 소득 한도 < 지역 한도 1억 5,540만 → 안내 문장도 함께
    type("fp-cash", "100");
    expect(screen.getByTestId("fp-grandfather")).toBeTruthy();
    expect(screen.getByTestId("fp-dsr-notice")).toBeTruthy();
    for (const w of BANNED) {
      expect(text()).not.toContain(w);
    }
    vi.mocked(usePresaleDetail).mockImplementation(() => ({
      schedule: null,
      units: [],
      firstRecruitDate: null,
      loading: false,
      error: null,
    }));
  });
});
