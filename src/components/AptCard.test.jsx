// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AptCard } from "./AptCard";
import { makeApt } from "@/__tests__/factories";

// 테스트용 res 데이터 팩토리
/** @returns {any} */
function makeRes(overrides = {}) {
  return {
    total: 75,
    cats: {
      price: { label: "가격 매력도", total: 70, subs: [{ info: "-3.5%", name: "적정가괴리", score: 70 }] },
      location: { label: "입지·생활권", total: 80, subs: [{ info: "역세권(500m)", name: "지하철", score: 80 }] },
      product: { label: "상품성", total: 65, subs: [] },
      benefit: { label: "혜택·할인", total: 60, totalWon: 1500, rate: 3, subs: [] },
      risk: { label: "안전도", total: 85, subs: [] },
      future: { label: "미래가치", total: 72, subs: [] },
    },
    ...overrides,
  };
}

/** @returns {any} */
function makeProps(overrides = {}) {
  return {
    apt: makeApt(),
    res: makeRes(),
    rank: 1,
    onDetail: vi.fn(),
    isComp: false,
    onComp: vi.fn(),
    isFav: false,
    onFav: vi.fn(),
    profileWeights: { location: 40, product: 20, price: 20, risk: 10, benefit: 5, future: 5 },
    isDesktop: false,
    ...overrides,
  };
}

describe("AptCard", () => {
  // 기본 렌더링 — 이름, 순위, 점수
  it("아파트 이름과 순위 표시", () => {
    render(<AptCard {...makeProps()} />);
    expect(screen.getByText("테스트아파트")).toBeInTheDocument();
    expect(screen.getByText("1위")).toBeInTheDocument();
  });

  // ScoreBadge 렌더링
  it("점수 뱃지가 렌더링됨", () => {
    render(<AptCard {...makeProps()} />);
    // ScoreBadge의 aria-label 확인
    expect(screen.getByRole("img", { name: /점수: 75점/ })).toBeInTheDocument();
  });

  // 지역 태그 표시
  it("지역 태그가 표시됨", () => {
    render(<AptCard {...makeProps()} />);
    expect(screen.getByText("경기 수원시 영통동")).toBeInTheDocument();
  });

  // 상세보기 버튼 클릭
  it("상세보기 버튼 클릭 시 onDetail(apt.id) 호출", () => {
    const onDetail = vi.fn();
    render(<AptCard {...makeProps({ onDetail })} />);
    fireEvent.click(screen.getByText("상세보기"));
    expect(onDetail).toHaveBeenCalledWith(1);
  });

  // 카드 본문 클릭 시에도 onDetail 호출
  it("카드 본문 클릭 시 onDetail 호출", () => {
    const onDetail = vi.fn();
    render(<AptCard {...makeProps({ onDetail })} />);
    const body = screen.getByText("테스트아파트").closest('[role="button"]');
    fireEvent.click(body ?? document.body);
    expect(onDetail).toHaveBeenCalledWith(1);
  });

  // 관심매물 버튼
  it("관심매물 버튼 클릭 시 onFav 호출", () => {
    const onFav = vi.fn();
    render(<AptCard {...makeProps({ onFav })} />);
    fireEvent.click(screen.getByText("관심매물"));
    expect(onFav).toHaveBeenCalledWith(1);
  });

  it("isFav=true이면 '관심 해제' 텍스트 표시", () => {
    render(<AptCard {...makeProps({ isFav: true })} />);
    expect(screen.getByText("관심 해제")).toBeInTheDocument();
  });

  // 비교 버튼
  it("비교 버튼 클릭 시 onComp 호출", () => {
    const onComp = vi.fn();
    render(<AptCard {...makeProps({ onComp })} />);
    fireEvent.click(screen.getByText("비교"));
    expect(onComp).toHaveBeenCalledWith(1);
  });

  it("isComp=true이면 '비교 중' 텍스트 표시", () => {
    render(<AptCard {...makeProps({ isComp: true })} />);
    expect(screen.getByText("비교 중")).toBeInTheDocument();
  });

  // 혜택 표시 (totalWon > 0)
  it("혜택이 있으면 총 혜택 금액 표시", () => {
    render(<AptCard {...makeProps()} />);
    expect(screen.getByText(/총 혜택 약 1,500만원/)).toBeInTheDocument();
  });

  it("혜택이 0이면 혜택 영역 미표시", () => {
    const res = makeRes();
    res.cats.benefit.totalWon = 0;
    render(<AptCard {...makeProps({ res })} />);
    expect(screen.queryByText(/총 혜택/)).toBeNull();
  });

  // 입주 알림
  it("completion이 있으면 입주 알림 표시", () => {
    render(<AptCard {...makeProps()} />);
    expect(screen.getByText(/입주/)).toBeInTheDocument();
  });

  // 미분양률 30% 이상 경고
  it("unsoldRate 30% 이상이면 미분양 경고 태그 표시", () => {
    const apt = /** @type {any} */ (makeApt({ unsoldRate: 45 }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.getByText("미분양 45%")).toBeInTheDocument();
  });

  // 혐오시설 경고
  it("혐오시설이 있으면 경고 태그 표시", () => {
    const apt = /** @type {any} */ (makeApt({ noxious: ["공장", "묘지"] }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.getByText("혐오시설 2건")).toBeInTheDocument();
  });

  // 시공사 신용등급 경고
  it("시공사 신용등급이 안전 등급 밖이면 경고 표시", () => {
    const apt = /** @type {any} */ (makeApt({ builderCreditGrade: "BBB" }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.getByText("시공사 BBB")).toBeInTheDocument();
  });

  // 키보드 접근성
  it("Enter 키로 상세 보기 가능", () => {
    const onDetail = vi.fn();
    render(<AptCard {...makeProps({ onDetail })} />);
    const body = screen.getByText("테스트아파트").closest('[role="button"]');
    fireEvent.keyDown(body ?? document.body, { key: "Enter" });
    expect(onDetail).toHaveBeenCalledWith(1);
  });

  // 분양 배지 표시
  it("presaleStage가 있으면 분양 배지를 표시한다", () => {
    render(<AptCard {...makeProps({ apt: makeApt({ presaleStage: "분양중" }) })} />);
    expect(screen.getByText("분양중")).toBeTruthy();
  });

  it("presaleStage가 null이면 분양 배지 미표시", () => {
    render(<AptCard {...makeProps({ apt: makeApt({ presaleStage: null }) })} />);
    expect(screen.queryByText("분양중")).toBeNull();
    expect(screen.queryByText("분양예정")).toBeNull();
  });

  // 세션112: price=0 classifyNoPrice detail 노출 (info="데이터 부재"이고 detail 있으면 detail 표시)
  it("price.subs[0].info=\"데이터 부재\" + detail 있으면 detail 문구 표시", () => {
    const res = makeRes();
    res.cats.price.subs = [{ info: "데이터 부재", name: "적정가괴리", score: 30, detail: "정비사업 — 조합원 물량, 분양가 미정" }];
    render(<AptCard {...makeProps({ res })} />);
    expect(screen.getByText("정비사업 — 조합원 물량, 분양가 미정")).toBeInTheDocument();
    expect(screen.queryByText(/적정가 데이터 부재/)).toBeNull();
  });

  it("price.subs[0].info=정상값이면 \"적정가 {info}\" 형식 유지 (회귀 방지)", () => {
    render(<AptCard {...makeProps()} />);
    expect(screen.getByText("적정가 -3.5%")).toBeInTheDocument();
  });

  // 무순위 공고 발생 단지 — "추가 모집" 빨간 배지
  it("unsoldEventCount > 0 + ah- 단지면 '추가 모집' 배지 표시", () => {
    const apt = /** @type {any} */ (makeApt({ id: "ah-100", unsoldEventCount: 5 }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.getByText("추가 모집")).toBeInTheDocument();
  });

  it("unsoldEventCount = 0 이면 '추가 모집' 배지 미표시", () => {
    const apt = /** @type {any} */ (makeApt({ id: "ah-100", unsoldEventCount: 0 }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.queryByText("추가 모집")).toBeNull();
  });

  it("naver- 단지 (id prefix 가드) 면 '추가 모집' 배지 미표시 (정보 없음)", () => {
    const apt = /** @type {any} */ (makeApt({ id: "naver-9999", unsoldEventCount: 5 }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.queryByText("추가 모집")).toBeNull();
  });

  // memo comparator — alertRow 6필드 변경 시 카드 다시 그림 (BACKLOG 🟢)
  // 같은 apt.id 로 6필드 중 하나만 바꿨을 때 새 배지가 화면에 반영되어야 함
  describe("memo comparator — alertRow 6필드 변경 시 리렌더 (회귀 방지)", () => {
    const FIELD_CASES = [
      // 미래 시점으로 두어 "입주예정" 분기에 안정 진입 (NOW_YM 무관)
      { field: "completion", from: null, to: "210106", expectedText: /입주예정 2101년 06월/ },
      { field: "unsoldRate", from: 0, to: 50, expectedText: /미분양 50%/ },
      { field: "presaleStage", from: null, to: "분양중", expectedText: /분양중/ },
      { field: "crimeSafetyGrade", from: null, to: 5, expectedText: /치안위험/ },
      { field: "builderCreditGrade", from: null, to: "C", expectedText: /시공사 C/ },
      { field: "unsoldEventCount", from: 0, to: 3, expectedText: /추가 모집/ },
    ];

    for (const { field, from, to, expectedText } of FIELD_CASES) {
      it(`${field} 변경 시 카드 리렌더 (배지 표시)`, () => {
        // unsoldEventCount 는 ah- prefix 가드 필요
        const baseId = field === "unsoldEventCount" ? "ah-100" : "naver-100";
        const aptInitial = makeApt({ id: baseId, [field]: from });
        const aptUpdated = makeApt({ id: baseId, [field]: to });
        const { rerender } = render(<AptCard {...makeProps({ apt: aptInitial })} />);
        rerender(<AptCard {...makeProps({ apt: aptUpdated })} />);
        expect(screen.getByText(expectedText)).toBeInTheDocument();
      });
    }
  });

});
