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
      benefit: { label: "혜택·할인", total: 60, totalWon: 1500, rate: 3, wonSource: "관리비 절감", subs: [] },
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
  // ⚠️ 적대검증이 잡은 자리 — /혜택 약 …/ 는 옛 "총 혜택 약 …" 도 통과시킨다(부분 문자열).
  //    파생 라벨(wonSource)이 실제로 쓰이는지 잠그고, 옛 하드코딩의 부재를 함께 단언한다.
  it("혜택 금액 라벨은 wonSource 에서 파생한다 — 손으로 적은 '총 혜택'이 아니다", () => {
    render(<AptCard {...makeProps()} />);
    expect(screen.getByText(/관리비 절감 약 1,500만원/)).toBeInTheDocument();
    expect(screen.queryByText(/총 ?혜택 약/)).toBeNull();
  });

  it("혜택이 0이면 혜택 영역 미표시", () => {
    const res = makeRes();
    res.cats.benefit.totalWon = 0;
    render(<AptCard {...makeProps({ res })} />);
    expect(screen.queryByText(/혜택 약/)).toBeNull();
  });

  // 세션 461 — benefits 전 단지 0% 채움이라 noData 박스는 숨김(점수 무관 순수 화면)
  it("benefit noData여도 '혜택 데이터 미수집' 박스 미표시", () => {
    const res = makeRes();
    res.cats.benefit.totalWon = 0;
    res.cats.benefit.noData = true;
    render(<AptCard {...makeProps({ res })} />);
    expect(screen.queryByText(/혜택 데이터 미수집/)).toBeNull();
    expect(screen.queryByText(/혜택 약/)).toBeNull();
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

  // 미분양률 100% 초과는 "100%+" 로 캡 (units 잔여공급분 오류 방어, 세션 444)
  it("unsoldRate 100% 초과면 '미분양 100%+' 로 캡 표시 (818% 같은 이상값 숨김)", () => {
    const apt = /** @type {any} */ (makeApt({ unsoldRate: 818.2 }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.getByText("미분양 100%+")).toBeInTheDocument();
    expect(screen.queryByText(/818/)).toBeNull();
  });

  // 세션 445 회귀: 회차 폭발 단지(unsoldRate 무력화 null + unsold 잔여 보존)가 과거 입주월이어도
  //   "입주완료"로 둔갑하면 안 됨. moveInDone 판정은 unsold(수) 기준 (classify.ts:33 일치).
  it("과거 입주월 + unsold>0 + unsoldRate=null → '입주완료' 둔갑 안 함 (미분양 단지 유지)", () => {
    const apt = /** @type {any} */ (makeApt({ completion: "202001", unsold: 39, unsoldRate: null }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.queryByText(/입주완료/)).toBeNull();
  });

  // 과거 입주월 + unsold=0 → 진짜 입주완료 (정상 동작)
  it("과거 입주월 + unsold=0 → '입주완료' 배지 표시", () => {
    const apt = /** @type {any} */ (makeApt({ completion: "202001", unsold: 0, unsoldRate: 0 }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.getByText(/입주완료/)).toBeInTheDocument();
  });

  // 혐오시설 경고
  // 세션510 ①-2: 뭉뚱그린 "혐오시설 N건" 대신 **실제 시설 이름**을 적고,
  // 빨간 경고는 점수를 깎는 시설(NOXIOUS_PENALTY 등재분)에만 붙인다.
  // 실측 근거: 혐오시설 보유 1,119곳 중 감점을 받는 건 56곳(5.0%)뿐이었다 —
  // 나머지 1,063곳은 빨간 경고만 뜨고 점수는 그대로여서 화면과 점수가 다른 말을 했다.
  it("점수를 깎는 시설이 섞이면 그 이름을 앞세운 경고 태그", () => {
    // 소각장은 NOXIOUS_PENALTY 등재(-18), 공장은 미등재(너무 흔해 감점 0 — brands.ts NOXIOUS_NO_PENALTY)
    const apt = /** @type {any} */ (makeApt({ noxious: ["공장", "소각장"] }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.getByText("소각장 등 2곳")).toBeInTheDocument();
  });

  it("감점 없는 시설만 있으면 경고가 아니라 회색 사실 칩 (접힘 안에 남는다)", () => {
    const apt = /** @type {any} */ (makeApt({ noxious: ["공장", "장례식장"] }));
    render(<AptCard {...makeProps({ apt })} />);
    // 회색 정보라 기본은 접혀 있다 — 펼쳐야 보인다(정보를 지운 게 아니다)
    expect(screen.queryByText("공장·장례식장")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^지표 \d+개 더/ }));
    expect(screen.getByText("공장·장례식장")).toBeInTheDocument();
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
  it('price.subs[0].info="데이터 부재" + detail 있으면 detail 문구 표시', () => {
    const res = makeRes();
    res.cats.price.subs = [
      { info: "데이터 부재", name: "적정가괴리", score: 30, detail: "정비사업 — 조합원 물량, 분양가 미정" },
    ];
    render(<AptCard {...makeProps({ res })} />);
    expect(screen.getByText("정비사업 — 조합원 물량, 분양가 미정")).toBeInTheDocument();
    expect(screen.queryByText(/적정가 데이터 부재/)).toBeNull();
  });

  // 세션 510 PR-4: 회색 "적정가 {info}" 중복 칩은 폐지됐다 — subs[0].info 와 deviation 이
  // 운영 실측(1,525곳)에서 같은 숫자였다. 이제 문장형 "적정가보다 N%" 하나만 남는다.
  // (뒤집은 가드: 옛 표기가 다시 뜨면 잡히고, 새 문장형이 안 뜨면 잡힌다 — 정보가 사라진 게 아님을 확인)
  it('price.subs[0].info=정상값이어도 회색 "적정가 {info}" 칩은 안 뜬다 — 문장형만 남는다 (세션 510 PR-4)', () => {
    const res = makeRes();
    res.cats.price.fairPrice = 90000; // 세션 510 PR-4: fairPrice>0 게이트(가격 데이터 보유 판별자)
    res.cats.price.deviation = "-3.5";
    render(<AptCard {...makeProps({ res })} />);
    expect(screen.queryByText("적정가 -3.5%")).toBeNull();
    expect(screen.getByText("적정가보다 3% 비쌈")).toBeInTheDocument(); // Math.abs(Math.round(-3.5))=3 (JS는 -3.5를 -3으로 반올림)
  });

  // 세션411: 적정가 괴리(deviation) 부호 — 양수(+)=적정가보다 저렴(좋음). scorePrice.ts:127
  // dev=((fairPrice-price)/fairPrice)*100. 역부호 회귀 가드 (세션409 적대검증 발굴).
  it("deviation 양수(저렴)면 녹색 '+N% 저렴' 배지 표시", () => {
    const res = makeRes();
    res.cats.price.fairPrice = 90000; // 세션 510 PR-4: fairPrice>0 게이트 추가 — 옛 픽스처엔 없어 칩이 안 떴다
    res.cats.price.deviation = "8.4";
    render(<AptCard {...makeProps({ res })} />);
    expect(screen.getByText("적정가보다 8% 저렴")).toBeInTheDocument(); // Math.round("8.4")=8
  });

  it("deviation 음수(비쌈)면 빨강 '비쌈' 배지 표시 + '저렴' 미표시 (세션420 A)", () => {
    const res = makeRes();
    res.cats.price.fairPrice = 90000; // 세션 510 PR-4: fairPrice>0 게이트
    res.cats.price.deviation = "-8.4";
    render(<AptCard {...makeProps({ res })} />);
    expect(screen.getByText("적정가보다 8% 비쌈")).toBeInTheDocument(); // Math.abs(Math.round("-8.4"))=8
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
    expect(screen.queryByText(/적정가보다/)).toBeNull();
  });

  it('deviation "0.0"(데이터 부재 분기) 이면 배지 미표시 (저렴·비쌈 둘 다)', () => {
    // scorePrice.ts:116 데이터 부재 분기가 fairPrice=0 + deviation="0.0" 산출 → 0>0 false, 0<0 false
    const res = makeRes();
    res.cats.price.deviation = "0.0";
    render(<AptCard {...makeProps({ res })} />);
    expect(screen.queryByText(/적정가보다/)).toBeNull();
  });

  // 세션422: 청약 경쟁률 배지 — 분양중/청약중/분양계획 + competitionRate>0 일 때만 (미분양 제외)
  // 세션 510 PR-4: 강점 칩 상한(2개)에 밀려 기본 접힘으로 이동했다(기본 픽스처가 discount·transitDev
  // 두 강점을 이미 채우고 있어서). 정보는 지운 게 아니라 "지표 N개 더"에서 펼치면 있다.
  it("분양중 + competitionRate>0 이면 '청약 N:1' 배지 표시 (접힘 펼쳐서 확인)", () => {
    const apt = /** @type {any} */ (makeApt({ presaleStage: "분양중", competitionRate: 477.8 }));
    render(<AptCard {...makeProps({ apt })} />);
    fireEvent.click(screen.getByRole("button", { name: /^지표 \d+개 더/ }));
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

  it("극단값 competitionRate=437995 → '청약 437,995:1' (천단위 콤마, fmtCompetitionRate 위임, 접힘 펼쳐서 확인)", () => {
    const apt = /** @type {any} */ (makeApt({ presaleStage: "청약중", competitionRate: 437995 }));
    render(<AptCard {...makeProps({ apt })} />);
    fireEvent.click(screen.getByRole("button", { name: /^지표 \d+개 더/ }));
    expect(screen.getByText("청약 437,995:1")).toBeInTheDocument();
  });

  it("competitionRate 변경 시 카드 리렌더 (memo comparator 회귀 방지, 접힘 펼쳐서 확인)", () => {
    const aptInitial = /** @type {any} */ (makeApt({ id: "naver-200", presaleStage: "분양중", competitionRate: null }));
    const aptUpdated = /** @type {any} */ (makeApt({ id: "naver-200", presaleStage: "분양중", competitionRate: 50 }));
    const { rerender } = render(<AptCard {...makeProps({ apt: aptInitial })} />);
    // expanded 상태는 rerender 사이에도 같은 컴포넌트 인스턴스라 유지된다
    fireEvent.click(screen.getByRole("button", { name: /^지표 \d+개 더/ }));
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

  // 세션510 PR-4: 판정 한 줄(aptVerdict)은 **등급 문자를 담는다** — 비로그인에게 새면 점수 블라인드가 뚫린다.
  // ⚠️ 이 테스트가 없으면 `aptVerdict(isLoggedIn ? res.total : null, ...)` 의 조건을 지워도 아무도 안 잡는다
  //    (뮤테이션으로 실증: 조건을 없애도 105건이 전부 초록이었다).
  it("비로그인이면 판정 한 줄이 아예 안 뜬다 — 등급 문자 누설 차단 (세션510)", () => {
    const res = makeRes();
    const { rerender } = render(<AptCard {...makeProps({ res, isLoggedIn: false })} />);
    // "✓ A등급 — … 강점 · … 보완" 형태. 등급 문자든 강점/보완 문구든 하나도 없어야 한다
    expect(screen.queryByText(/등급 —/)).toBeNull();
    expect(screen.queryByText(/강점 ·/)).toBeNull();
    rerender(<AptCard {...makeProps({ res, isLoggedIn: true })} />);
    expect(screen.getByText(/등급 —/)).toBeInTheDocument();
  });

  // 세션463: 비로그인 블라인드 스크린리더 정합 — 원형 ??는 설명 보유, blur ?? 숫자는 장식(aria-hidden)
  it("비로그인 점수 원은 role=img+설명 라벨 보유, 로그인이면 블라인드 원 미노출 (세션463)", () => {
    const { rerender } = render(<AptCard {...makeProps({ isLoggedIn: false })} />);
    expect(screen.getByRole("img", { name: "점수 비공개 — 로그인 후 확인 가능" })).toBeInTheDocument();
    rerender(<AptCard {...makeProps({ isLoggedIn: true })} />);
    expect(screen.queryByRole("img", { name: "점수 비공개 — 로그인 후 확인 가능" })).toBeNull();
  });

  it("비로그인 카테고리 blur '??' 숫자는 aria-hidden, 로그인 실점수는 aria-hidden 없음 (세션463)", () => {
    const { rerender } = render(<AptCard {...makeProps({ isLoggedIn: false })} />);
    const blurred = screen.getAllByText("??").filter((el) => el.getAttribute("aria-hidden") === "true");
    expect(blurred.length).toBeGreaterThan(0); // topCats 카테고리 blur 숫자들
    rerender(<AptCard {...makeProps({ isLoggedIn: true })} />);
    expect(screen.queryAllByText("??")).toHaveLength(0);
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
  // 세션 510 PR-4: 강점 상한(2개)에 밀려 기본 접힘 — 펼쳐서 확인(정보는 지운 게 아니다)
  it("치안 1등급이면 '치안우수' 배지 표시 (치안위험 미표시, 접힘 펼쳐서 확인)", () => {
    const apt = /** @type {any} */ (makeApt({ crimeSafetyGrade: 1 }));
    render(<AptCard {...makeProps({ apt })} />);
    fireEvent.click(screen.getByRole("button", { name: /^지표 \d+개 더/ }));
    expect(screen.getByText("치안우수")).toBeInTheDocument();
    expect(screen.queryByText("치안위험")).toBeNull();
    expect(screen.queryByText("치안주의")).toBeNull();
  });

  it("치안 2등급이면 '치안우수' 배지 표시 (접힘 펼쳐서 확인)", () => {
    const apt = /** @type {any} */ (makeApt({ crimeSafetyGrade: 2 }));
    render(<AptCard {...makeProps({ apt })} />);
    fireEvent.click(screen.getByRole("button", { name: /^지표 \d+개 더/ }));
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
  // 세션 510 PR-4: 이 초록 칩 자체가 폐지되고 `aptVerdict` 판정 한 줄로 대체됐다(비고: 4개 프로필에서
  // 97.5%가 항상 뜨고 투자 프로필만 28.8% — 있으나 마나였다). 판정 한 줄은 프로필과 무관하게
  // res.cats 의 최고/최저 total 만 본다. 아래 두 테스트는 "옛 칩이 다시 뜨면 잡히고, 새 판정 한 줄이
  // 프로필 바뀌어도 안정적으로 뜨는지"를 확인하도록 뒤집었다.
  describe("맞춤 추천 이유 칩 → 판정 한 줄(aptVerdict)로 대체", () => {
    const EDU_W = { location: 45, product: 20, price: 15, risk: 10, benefit: 5, future: 5 };
    const INVEST_W = { location: 15, product: 10, price: 30, risk: 25, benefit: 10, future: 10 };

    it("자녀교육(입지 최우선)이어도 옛 '입지 우수' 칩은 안 뜨고, 판정 한 줄이 프로필과 무관하게 뜬다", () => {
      // makeRes 기본값: risk(85)가 최고, **product(65)가 최저** — location(80)이 최우선 가중치여도
      // aptVerdict 는 profileWeights 를 보지 않으므로 결과가 안 바뀐다(이게 회귀 가드다).
      //
      // ⚠️ 원래 이 단언은 "혜택 보완"이었다. 혜택(60)이 최저였기 때문인데, 같은 세션의 다른 PR 이
      //    **혜택을 판정 후보에서 뺐다**(전 단지 0점이라 비교에 못 쓴다 — `aptVerdict.ts` CAT_KEYS).
      //    그래서 최저가 그다음인 상품(65)으로 넘어갔다. 두 PR 이 각자 main 에서 분기해 서로의 변경을
      //    모른 채 머지된 탓이고, **합쳐진 main 에서만 드러났다**(각 PR 의 CI 는 통과했다).
      render(<AptCard {...makeProps({ profileWeights: EDU_W })} />);
      expect(screen.queryByText(/입지 우수/)).toBeNull();
      expect(screen.getByText(/안전 강점 · 상품 보완/)).toBeInTheDocument();
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

    it("투자(가격 최우선) + 가격 매력이어도 옛 '적정가 대비 N% 저렴' 문구는 안 뜨고, core 층 '적정가보다 N% 저렴'가 뜬다", () => {
      const cats = makeRes().cats;
      cats.price = { ...cats.price, total: 75, fairPrice: 50000, deviation: 12 };
      render(<AptCard {...makeProps({ profileWeights: INVEST_W, res: makeRes({ cats }) })} />);
      expect(screen.queryByText(/적정가 대비 12% 저렴/)).toBeNull();
      expect(screen.getByText("적정가보다 12% 저렴")).toBeInTheDocument();
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

  describe("향 칩 (세션 444) — 북쪽 계열만 약점", () => {
    it("북향 → '북향' 칩 노출 (1.9% 희소 약점)", () => {
      const apt = /** @type {any} */ (makeApt({ primaryDirection: "북향" }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.getByText("북향")).toBeInTheDocument();
    });

    it("북동향 → '북동향' 칩 노출 (북쪽 계열 = startsWith 북)", () => {
      const apt = /** @type {any} */ (makeApt({ primaryDirection: "북동향" }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.getByText("북동향")).toBeInTheDocument();
    });

    it("남향 → 칩 미노출 (58.9% 다수, 강조 노이즈)", () => {
      const apt = /** @type {any} */ (makeApt({ primaryDirection: "남향" }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText("남향")).toBeNull();
    });

    it("동향 → 칩 미노출 (중립, 북쪽 아님)", () => {
      const apt = /** @type {any} */ (makeApt({ primaryDirection: "동향" }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText("동향")).toBeNull();
    });

    it("primaryDirection null → 칩 미노출", () => {
      const apt = /** @type {any} */ (makeApt({ primaryDirection: null }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText(/향$/)).toBeNull();
    });
  });

  // 세션 510 PR-4: ≤5분(good 층)은 강점 상한 2개에 밀리고, 6분~(neutral 층)은 상한과 무관하게
  // 항상 접힘이다 — 둘 다 "지표 N개 더"를 펼쳐서 확인(정보는 지운 게 아니다).
  describe("초등 도보거리 칩 (세션 437)", () => {
    it("≤5분 → '초등 도보 N분' 칩 노출 (초록 강조, 접힘 펼쳐서 확인)", () => {
      const apt = /** @type {any} */ (makeApt({ naverSchoolWalkMin: 3 }));
      render(<AptCard {...makeProps({ apt })} />);
      fireEvent.click(screen.getByRole("button", { name: /^지표 \d+개 더/ }));
      expect(screen.getByText("초등 도보 3분")).toBeInTheDocument();
    });

    it("6분~ → 칩 노출 (회색 중립, neutral 층은 항상 접힘 — 펼쳐서 확인)", () => {
      const apt = /** @type {any} */ (makeApt({ naverSchoolWalkMin: 10 }));
      render(<AptCard {...makeProps({ apt })} />);
      fireEvent.click(screen.getByRole("button", { name: /^지표 \d+개 더/ }));
      expect(screen.getByText("초등 도보 10분")).toBeInTheDocument();
    });

    it("naverSchoolWalkMin null → 칩 미노출", () => {
      const apt = /** @type {any} */ (makeApt({ naverSchoolWalkMin: null }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText(/초등 도보/)).toBeNull();
    });
  });

  // 세션 510 PR-4: ≥80%(good 층)는 강점 상한에 밀리고, <80%(neutral 층)는 항상 접힘 — 펼쳐서 확인
  describe("전용률 칩 (세션 437)", () => {
    it("≥80% → '전용률 N%' 칩 노출 (초록 강조, 접힘 펼쳐서 확인)", () => {
      const apt = /** @type {any} */ (makeApt({ exclusiveRatio: 82 }));
      render(<AptCard {...makeProps({ apt })} />);
      fireEvent.click(screen.getByRole("button", { name: /^지표 \d+개 더/ }));
      expect(screen.getByText("전용률 82%")).toBeInTheDocument();
    });

    it("<80% → 칩 노출 (회색 중립, neutral 층은 항상 접힘 — 펼쳐서 확인)", () => {
      const apt = /** @type {any} */ (makeApt({ exclusiveRatio: 75 }));
      render(<AptCard {...makeProps({ apt })} />);
      fireEvent.click(screen.getByRole("button", { name: /^지표 \d+개 더/ }));
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

  // 세션 510 PR-4: 강점 상한(2개)에 밀려 기본 접힘 — 펼쳐서 확인
  describe("DSR 통과 칩 (세션 440)", () => {
    it("dsr40pass=true → 'DSR 통과' 칩 노출 (초록 강점, 접힘 펼쳐서 확인)", () => {
      const apt = /** @type {any} */ (makeApt({ dsr40pass: true }));
      render(<AptCard {...makeProps({ apt })} />);
      fireEvent.click(screen.getByRole("button", { name: /^지표 \d+개 더/ }));
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

    it("dsr40pass 변경(false→true) 시 카드 리렌더 (comparator 회귀 가드, 접힘 펼쳐서 확인)", () => {
      const aptInitial = /** @type {any} */ (makeApt({ dsr40pass: false }));
      const aptUpdated = /** @type {any} */ (makeApt({ dsr40pass: true }));
      const { rerender } = render(<AptCard {...makeProps({ apt: aptInitial })} />);
      // expanded 상태는 rerender 사이에도 같은 컴포넌트 인스턴스라 유지된다
      fireEvent.click(screen.getByRole("button", { name: /^지표 \d+개 더/ }));
      expect(screen.queryByText("DSR 통과")).toBeNull();
      rerender(<AptCard {...makeProps({ apt: aptUpdated })} />);
      expect(screen.getByText("DSR 통과")).toBeInTheDocument();
    });
  });

  describe("학군 등급 칩 (세션 441 · 세션524 게이트 C→D)", () => {
    // 세션441 당시 실측은 A=84.4%·B=12.2%·C=3.4%·D=0% 였고, 그래서 C 가 곧 바닥이었다.
    // 세션524 상대 척도 전환 후 A=17.2%·B=33.4%·C=39.8%·D=9.6% —
    // C 는 "흔한 중간"이 됐고 바닥은 D 다. 칩은 드문 약점을 알리는 자리라 게이트를 옮겼다.
    it("schoolGrade='D' → '학군 D' 칩 노출 (주황 약점, 실측 9.6% 소수)", () => {
      const apt = /** @type {any} */ (makeApt({ schoolGrade: "D" }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.getByText("학군 D")).toBeInTheDocument();
    });

    it("schoolGrade='C' → 칩 미노출 (39.8% 흔한 중간, 옛 게이트면 red)", () => {
      const apt = /** @type {any} */ (makeApt({ schoolGrade: "C" }));
      render(<AptCard {...makeProps({ apt })} />);
      expect(screen.queryByText(/학군/)).toBeNull();
    });

    it("schoolGrade='A' → 칩 미노출 (상위 17%, 약점이 아니다)", () => {
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

    it("schoolGrade 변경(A→D) 시 카드 리렌더 (comparator 회귀 가드)", () => {
      const aptInitial = /** @type {any} */ (makeApt({ schoolGrade: "A" }));
      const aptUpdated = /** @type {any} */ (makeApt({ schoolGrade: "D" }));
      const { rerender } = render(<AptCard {...makeProps({ apt: aptInitial })} />);
      expect(screen.queryByText("학군 D")).toBeNull();
      rerender(<AptCard {...makeProps({ apt: aptUpdated })} />);
      expect(screen.getByText("학군 D")).toBeInTheDocument();
    });
  });
});

describe("AptCard — 면적 자료가 없을 때", () => {
  it("숫자 없이 단위만 남은 '㎡' 를 안 그린다 (실측 670단지 42.4%가 이 경우)", () => {
    const apt = /** @type {any} */ (makeApt({ area: null }));
    render(<AptCard {...makeProps({ apt })} />);
    // ⚠️ `${apt.area ?? ""}㎡` 로 쓰면 "㎡" 한 글자가 남고, 빈 문자열이 아니라
    //    filter(Boolean) 도 못 걸러낸다. 라이브에서 실제로 그렇게 떠 있었다.
    expect(screen.queryByText("㎡")).toBeNull();
  });

  it("면적이 있으면 그대로 보여준다", () => {
    const apt = /** @type {any} */ (makeApt({ area: 84.93 }));
    render(<AptCard {...makeProps({ apt })} />);
    expect(screen.getByText("84.93㎡")).toBeInTheDocument();
  });
});
