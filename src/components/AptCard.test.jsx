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

  // 세션411: 적정가 괴리(deviation) 부호 — 양수(+)=적정가보다 저렴(좋음). scorePrice.ts:127
  // dev=((fairPrice-price)/fairPrice)*100. 역부호 회귀 가드 (세션409 적대검증 발굴).
  it("deviation 양수(저렴)면 녹색 '+N% 저렴' 배지 표시", () => {
    const res = makeRes();
    res.cats.price.deviation = "8.4";
    render(<AptCard {...makeProps({ res })} />);
    expect(screen.getByText("주변대비 +8% 저렴")).toBeInTheDocument(); // Math.round("8.4")=8
  });

  it("deviation 음수(비쌈)면 빨강 '비쌈' 배지 표시 + '저렴' 미표시 (세션420 A)", () => {
    const res = makeRes();
    res.cats.price.deviation = "-8.4";
    render(<AptCard {...makeProps({ res })} />);
    expect(screen.getByText("주변대비 8% 비쌈")).toBeInTheDocument(); // Math.abs(Math.round("-8.4"))=8
    expect(screen.queryByText(/저렴/)).toBeNull(); // 음수는 저렴 배지 안 뜸 (상호배타)
  });

  it("deviation 양수(저렴)면 '비쌈' 배지 미표시 (세션420 A 상호배타)", () => {
    const res = makeRes();
    res.cats.price.deviation = "8.4";
    render(<AptCard {...makeProps({ res })} />);
    expect(screen.queryByText(/비쌈/)).toBeNull();
  });

  it("deviation null 이면 배지 미표시", () => {
    const res = makeRes();
    res.cats.price.deviation = null;
    render(<AptCard {...makeProps({ res })} />);
    expect(screen.queryByText(/주변대비/)).toBeNull();
  });

  it("deviation \"0.0\"(데이터 부재 분기) 이면 배지 미표시 (저렴·비쌈 둘 다)", () => {
    // scorePrice.ts:116 데이터 부재 분기가 fairPrice=0 + deviation="0.0" 산출 → 0>0 false, 0<0 false
    const res = makeRes();
    res.cats.price.deviation = "0.0";
    render(<AptCard {...makeProps({ res })} />);
    expect(screen.queryByText(/주변대비/)).toBeNull();
  });

  // 세션422: 청약 경쟁률 배지 — 분양중/청약중/분양계획 + competitionRate>0 일 때만 (미분양 제외)
  it("분양중 + competitionRate>0 이면 '청약 N:1' 배지 표시", () => {
    const apt = /** @type {any} */ (makeApt({ presaleStage: "분양중", competitionRate: 477.8 }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.getByText("청약 477.8:1")).toBeInTheDocument();
  });

  it("미분양 단계면 competitionRate>0 라도 청약 배지 미표시 (게이트 제외)", () => {
    const apt = /** @type {any} */ (makeApt({ presaleStage: "미분양", competitionRate: 155 }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.queryByText(/청약 /)).toBeNull();
  });

  it("presaleStage=null 이면 청약 배지 미표시", () => {
    const apt = /** @type {any} */ (makeApt({ presaleStage: null, competitionRate: 50 }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.queryByText(/청약 /)).toBeNull();
  });

  it("competitionRate=null 또는 0 이면 청약 배지 미표시 (분양중이어도)", () => {
    const aptNull = /** @type {any} */ (makeApt({ presaleStage: "분양중", competitionRate: null }));
    const { rerender } = render(<AptCard {...makeProps({ apt: aptNull })} />);
    expect(screen.queryByText(/청약 /)).toBeNull();
    const aptZero = /** @type {any} */ (makeApt({ presaleStage: "분양중", competitionRate: 0 }));
    rerender(<AptCard {...makeProps({ apt: aptZero })} />);
    expect(screen.queryByText(/청약 /)).toBeNull();
  });

  it("극단값 competitionRate=437995 → '청약 437,995:1' (천단위 콤마, fmtCompetitionRate 위임)", () => {
    const apt = /** @type {any} */ (makeApt({ presaleStage: "청약중", competitionRate: 437995 }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.getByText("청약 437,995:1")).toBeInTheDocument();
  });

  it("competitionRate 변경 시 카드 리렌더 (memo comparator 회귀 방지)", () => {
    const aptInitial = /** @type {any} */ (makeApt({ id: "naver-200", presaleStage: "분양중", competitionRate: null }));
    const aptUpdated = /** @type {any} */ (makeApt({ id: "naver-200", presaleStage: "분양중", competitionRate: 50 }));
    const { rerender } = render(<AptCard {...makeProps({ apt: aptInitial })} />);
    expect(screen.queryByText(/청약 /)).toBeNull();
    rerender(<AptCard {...makeProps({ apt: aptUpdated })} />);
    expect(screen.getByText("청약 50.0:1")).toBeInTheDocument();
  });

  // 세션420 C: 비로그인 점수 계열 블라인드 (api/CLAUDE.md "점수 블라인드" 정책 정합)
  it("비로그인이면 카테고리 점수바(progressbar) 미노출, 로그인이면 노출", () => {
    const { rerender } = render(<AptCard {...makeProps({ isLoggedIn: false })} />);
    // 비로그인: 카테고리 점수바(Bar=role progressbar) DOM 부재 — 실점수 width%·aria-valuenow 누설 차단
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
    // 로그인: 상위 3개 카테고리 점수바 노출
    rerender(<AptCard {...makeProps({ isLoggedIn: true })} />);
    expect(screen.getAllByRole("progressbar").length).toBeGreaterThan(0);
  });

  it("비로그인이면 '안전 ?등급', 로그인이면 실제 등급 노출 (세션420 C)", () => {
    const res = makeRes(); // risk.total=85 → gr=A
    const { rerender } = render(<AptCard {...makeProps({ res, isLoggedIn: false })} />);
    expect(screen.getByText("안전 ?등급")).toBeInTheDocument();
    expect(screen.queryByText("안전 A등급")).toBeNull();
    rerender(<AptCard {...makeProps({ res, isLoggedIn: true })} />);
    expect(screen.getByText("안전 A등급")).toBeInTheDocument();
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

  // 치안 우수 배지 (세션 423) — 1·2등급 안전 단지 강점 노출, 위험(4·5)과 상호배타
  it("치안 1등급이면 '치안우수' 배지 표시 (치안위험 미표시)", () => {
    const apt = /** @type {any} */ (makeApt({ crimeSafetyGrade: 1 }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.getByText("치안우수")).toBeInTheDocument();
    expect(screen.queryByText("치안위험")).toBeNull();
    expect(screen.queryByText("치안주의")).toBeNull();
  });

  it("치안 2등급이면 '치안우수' 배지 표시", () => {
    const apt = /** @type {any} */ (makeApt({ crimeSafetyGrade: 2 }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.getByText("치안우수")).toBeInTheDocument();
  });

  it("치안 5등급이면 '치안위험' 빨강 (치안우수 미표시, 기존 동작 회귀 가드)", () => {
    const apt = /** @type {any} */ (makeApt({ crimeSafetyGrade: 5 }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.getByText("치안위험")).toBeInTheDocument();
    expect(screen.queryByText("치안우수")).toBeNull();
  });

  it("치안 3등급이면 두 배지 모두 미표시 (상호배타 경계)", () => {
    const apt = /** @type {any} */ (makeApt({ crimeSafetyGrade: 3 }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.queryByText("치안우수")).toBeNull();
    expect(screen.queryByText("치안위험")).toBeNull();
    expect(screen.queryByText("치안주의")).toBeNull();
  });

  it("crimeSafetyGrade null 이면 치안 배지 미표시", () => {
    const apt = /** @type {any} */ (makeApt({ crimeSafetyGrade: null }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.queryByText("치안우수")).toBeNull();
    expect(screen.queryByText("치안위험")).toBeNull();
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

  // 맞춤 추천 이유 칩 (세션 432) — 프로필 최우선 카테고리가 긍정일 때만 노출
  describe("맞춤 추천 이유 칩", () => {
    const EDU_W = { location: 45, product: 20, price: 15, risk: 10, benefit: 5, future: 5 };
    const INVEST_W = { location: 15, product: 10, price: 30, risk: 25, benefit: 10, future: 10 };

    it("자녀교육(입지 최우선) + 입지 우수 → '입지 우수' 칩 노출", () => {
      // makeRes 기본 location.total=80(>=70 우수)
      render(<AptCard {...makeProps({ profileWeights: EDU_W })} />);
      expect(screen.getByText(/입지 우수/)).toBeInTheDocument();
    });

    it("투자(가격 최우선) + 가격 비쌈(deviation<0) → 칩 미노출 (부정 게이트)", () => {
      const cats = makeRes().cats;
      cats.price = { ...cats.price, total: 60, fairPrice: 50000, deviation: -8 };
      render(<AptCard {...makeProps({ profileWeights: INVEST_W, res: makeRes({ cats }) })} />);
      // price total>=50 이지만 deviation<0 이라 부정 → 칩 미노출
      expect(screen.queryByText(/적정가 대비/)).toBeNull();
      expect(screen.queryByText(/가격 매력/)).toBeNull();
    });

    it("최우선 카테고리 점수 미흡(<50) → 칩 미노출 (부정 문구도 숨김)", () => {
      const cats = makeRes().cats;
      cats.location = { ...cats.location, total: 40 };
      render(<AptCard {...makeProps({ profileWeights: EDU_W, res: makeRes({ cats }) })} />);
      expect(screen.queryByText(/입지 우수/)).toBeNull();
      expect(screen.queryByText(/입지 아쉬움/)).toBeNull();
    });

    it("비로그인(isLoggedIn=false) → 칩 미노출 (점수 블라인드)", () => {
      render(<AptCard {...makeProps({ profileWeights: EDU_W, isLoggedIn: false })} />);
      expect(screen.queryByText(/입지 우수/)).toBeNull();
    });

    it("투자(가격 최우선) + 가격 매력(deviation>0) → '적정가 대비 N% 저렴' 칩 노출", () => {
      const cats = makeRes().cats;
      cats.price = { ...cats.price, total: 75, fairPrice: 50000, deviation: 12 };
      render(<AptCard {...makeProps({ profileWeights: INVEST_W, res: makeRes({ cats }) })} />);
      expect(screen.getByText(/적정가 대비 12% 저렴/)).toBeInTheDocument();
    });
  });

  describe("복도유형 칩 (세션 433)", () => {
    it("복도식 → '복도식' 칩 노출 (소음·프라이버시 약점 신호)", () => {
      const apt = /** @type {any} */ (makeApt({ corridorType: "복도식" }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.getByText("복도식")).toBeInTheDocument();
    });

    it("계단식 → 칩 미노출 (70% 다수라 변별력 0)", () => {
      const apt = /** @type {any} */ (makeApt({ corridorType: "계단식" }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText("복도식")).toBeNull();
    });

    it("corridorType null → 칩 미노출", () => {
      const apt = /** @type {any} */ (makeApt({ corridorType: null }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText("복도식")).toBeNull();
    });
  });

  describe("초등 도보거리 칩 (세션 437)", () => {
    it("≤5분 → '초등 도보 N분' 칩 노출 (초록 강조)", () => {
      const apt = /** @type {any} */ (makeApt({ naverSchoolWalkMin: 3 }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.getByText("초등 도보 3분")).toBeInTheDocument();
    });

    it("6분~ → 칩 노출 (회색 중립)", () => {
      const apt = /** @type {any} */ (makeApt({ naverSchoolWalkMin: 10 }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.getByText("초등 도보 10분")).toBeInTheDocument();
    });

    it("naverSchoolWalkMin null → 칩 미노출", () => {
      const apt = /** @type {any} */ (makeApt({ naverSchoolWalkMin: null }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText(/초등 도보/)).toBeNull();
    });
  });

  describe("전용률 칩 (세션 437)", () => {
    it("≥80% → '전용률 N%' 칩 노출 (초록 강조)", () => {
      const apt = /** @type {any} */ (makeApt({ exclusiveRatio: 82 }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.getByText("전용률 82%")).toBeInTheDocument();
    });

    it("<80% → 칩 노출 (회색 중립)", () => {
      const apt = /** @type {any} */ (makeApt({ exclusiveRatio: 75 }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.getByText("전용률 75%")).toBeInTheDocument();
    });

    it("exclusiveRatio null → 칩 미노출", () => {
      const apt = /** @type {any} */ (makeApt({ exclusiveRatio: null }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText(/전용률/)).toBeNull();
    });
  });

  describe("난방연료 칩 (세션 437)", () => {
    it("LPG → 'LPG난방' 칩 노출 (주황 약점 신호)", () => {
      const apt = /** @type {any} */ (makeApt({ heatFuel: "LPG" }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.getByText("LPG난방")).toBeInTheDocument();
    });

    it("도시가스 → 칩 미노출 (다수라 생략)", () => {
      const apt = /** @type {any} */ (makeApt({ heatFuel: "도시가스" }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText("LPG난방")).toBeNull();
    });

    it("heatFuel null → 칩 미노출", () => {
      const apt = /** @type {any} */ (makeApt({ heatFuel: null }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText("LPG난방")).toBeNull();
    });
  });

  describe("교통호재 칩 (세션 440)", () => {
    it("transitDev 있고 devDist≤2km → '🚆 노선 역' 칩 노출 (파랑 강조, 라벨=2토큰)", () => {
      const apt = /** @type {any} */ (makeApt({ transitDev: "GTX-A 동탄역 공사중", devDist: 1.5 }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.getByText("🚆 GTX-A 동탄역")).toBeInTheDocument();
    });

    it("devDist>2km → 칩 미노출 (멀면 점수도 낮음, 거짓 강조 차단)", () => {
      const apt = /** @type {any} */ (makeApt({ transitDev: "GTX-A 동탄역 공사중", devDist: 3.5 }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText(/🚆/)).toBeNull();
    });

    it("transitDev '없음' → 칩 미노출", () => {
      const apt = /** @type {any} */ (makeApt({ transitDev: "없음", devDist: 1 }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText(/🚆/)).toBeNull();
    });

    it("transitDev null → 칩 미노출", () => {
      const apt = /** @type {any} */ (makeApt({ transitDev: null, devDist: 1 }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText(/🚆/)).toBeNull();
    });

    it("devDist 변경(3.5→1.5) 시 카드 리렌더 (comparator 회귀 가드)", () => {
      const aptInitial = /** @type {any} */ (makeApt({ transitDev: "GTX-A 동탄역 공사중", devDist: 3.5 }));
      const aptUpdated = /** @type {any} */ (makeApt({ transitDev: "GTX-A 동탄역 공사중", devDist: 1.5 }));
      const { rerender } = render(<AptCard {...makeProps({ apt: aptInitial })} />);
      expect(screen.queryByText(/🚆/)).toBeNull();
      rerender(<AptCard {...makeProps({ apt: aptUpdated })} />);
      expect(screen.getByText("🚆 GTX-A 동탄역")).toBeInTheDocument();
    });
  });

  describe("DSR 통과 칩 (세션 440)", () => {
    it("dsr40pass=true → 'DSR 통과' 칩 노출 (초록 강점)", () => {
      const apt = /** @type {any} */ (makeApt({ dsr40pass: true }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.getByText("DSR 통과")).toBeInTheDocument();
    });

    it("dsr40pass=false → 칩 미노출 (다수라 생략)", () => {
      const apt = /** @type {any} */ (makeApt({ dsr40pass: false }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText("DSR 통과")).toBeNull();
    });

    it("dsr40pass null → 칩 미노출", () => {
      const apt = /** @type {any} */ (makeApt({ dsr40pass: null }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText("DSR 통과")).toBeNull();
    });

    it("dsr40pass 변경(false→true) 시 카드 리렌더 (comparator 회귀 가드)", () => {
      const aptInitial = /** @type {any} */ (makeApt({ dsr40pass: false }));
      const aptUpdated = /** @type {any} */ (makeApt({ dsr40pass: true }));
      const { rerender } = render(<AptCard {...makeProps({ apt: aptInitial })} />);
      expect(screen.queryByText("DSR 통과")).toBeNull();
      rerender(<AptCard {...makeProps({ apt: aptUpdated })} />);
      expect(screen.getByText("DSR 통과")).toBeInTheDocument();
    });
  });

  describe("학군 등급 칩 (세션 441)", () => {
    // 라이브 실측 분포 A=84.4%·B=12.2%·C=3.4%·D=0% → C(소수)만 변별 신호로 약점 노출
    it("schoolGrade='C' → '학군 C' 칩 노출 (주황 약점, 실측 3.4% 소수)", () => {
      const apt = /** @type {any} */ (makeApt({ schoolGrade: "C" }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.getByText("학군 C")).toBeInTheDocument();
    });

    it("schoolGrade='A' → 칩 미노출 (84% 다수라 강조 안 함)", () => {
      const apt = /** @type {any} */ (makeApt({ schoolGrade: "A" }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText(/학군/)).toBeNull();
    });

    it("schoolGrade='B' → 칩 미노출 (양호 다수라 생략)", () => {
      const apt = /** @type {any} */ (makeApt({ schoolGrade: "B" }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText(/학군/)).toBeNull();
    });

    it("schoolGrade null → 칩 미노출", () => {
      const apt = /** @type {any} */ (makeApt({ schoolGrade: null }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText(/학군/)).toBeNull();
    });

    it("schoolGrade 변경(A→C) 시 카드 리렌더 (comparator 회귀 가드)", () => {
      const aptInitial = /** @type {any} */ (makeApt({ schoolGrade: "A" }));
      const aptUpdated = /** @type {any} */ (makeApt({ schoolGrade: "C" }));
      const { rerender } = render(<AptCard {...makeProps({ apt: aptInitial })} />);
      expect(screen.queryByText("학군 C")).toBeNull();
      rerender(<AptCard {...makeProps({ apt: aptUpdated })} />);
      expect(screen.getByText("학군 C")).toBeInTheDocument();
    });
  });

});
