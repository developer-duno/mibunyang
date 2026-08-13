// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DetailModal } from "./DetailModal";
import { trackEvent } from "@/lib/analytics";
import { makeScoredItem } from "@/__tests__/factories";
import { computeRegionalStats } from "@/scoring/regionalStats";

// analytics mock — DetailModal 의 detail_tab_view 발화 카운트 단언용. 이 mock 은 PresaleInfo 의
// presale_view(분양 탭 방문 시 발화)도 no-op 시키나, presale_view 커버리지는 PresaleInfo.test.jsx 소유.
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

// 최소한의 cats 구조 (DetailModal에서 cats 데이터가 필요)
function makeItem(overrides = {}) {
  return makeScoredItem(
    {},
    {
      cats: {
        price: {
          label: "가격 매력도",
          total: 70,
          fairPrice: 48000,
          deviation: "-3.2",
          subs: [{ info: "-3.2%", name: "적정가괴리", score: 70 }],
        },
        location: { label: "입지·생활권", total: 80, subs: [{ info: "역세권", name: "지하철", score: 80 }] },
        product: { label: "상품성", total: 65, subs: [] },
        benefit: { label: "혜택·할인", total: 60, totalWon: 0, rate: 0, subs: [] },
        risk: { label: "안전도", total: 85, subs: [] },
        future: { label: "미래가치", total: 72, subs: [] },
      },
      ...overrides,
    }
  );
}

/** @returns {any} */
function makeProps(overrides = {}) {
  return {
    item: makeItem(),
    onClose: vi.fn(),
    isComp: false,
    onComp: vi.fn(),
    isFav: false,
    onFav: vi.fn(),
    onShare: vi.fn(),
    isPC: false,
    ...overrides,
  };
}

describe("DetailModal", () => {
  beforeEach(() => {
    document.body.style.overflow = "";
  });

  afterEach(() => {
    document.body.style.overflow = "";
  });

  // null item일 때 아무것도 렌더링하지 않음
  it("item이 null이면 아무것도 렌더링하지 않음", () => {
    const { container } = render(<DetailModal {...makeProps({ item: null })} />);
    expect(container.innerHTML).toBe("");
  });

  // 기본 렌더링
  it("아파트 이름 표시", () => {
    render(<DetailModal {...makeProps()} />);
    expect(screen.getByText("테스트아파트")).toBeInTheDocument();
  });

  // 닫기 버튼
  it("닫기 버튼 클릭 시 onClose 호출", () => {
    const onClose = vi.fn();
    render(<DetailModal {...makeProps({ onClose })} />);
    fireEvent.click(screen.getByLabelText("닫기"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 오버레이 클릭으로 닫기
  it("오버레이 클릭 시 onClose 호출", () => {
    const onClose = vi.fn();
    const { container } = render(<DetailModal {...makeProps({ onClose })} />);
    // 최상위 fixed 배경 div 클릭
    const overlay = /** @type {Element} */ (container.firstChild);
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 모달 내부 클릭은 닫히지 않음 (stopPropagation)
  it("모달 내부 클릭 시 닫히지 않음", () => {
    const onClose = vi.fn();
    render(<DetailModal {...makeProps({ onClose })} />);
    // 아파트 이름 클릭
    fireEvent.click(screen.getByText("테스트아파트"));
    expect(onClose).not.toHaveBeenCalled();
  });

  // Escape 키로 닫기
  it("Escape 키 누르면 onClose 호출", () => {
    const onClose = vi.fn();
    render(<DetailModal {...makeProps({ onClose })} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // body overflow 관리
  it("렌더링 시 body overflow hidden 설정", () => {
    render(<DetailModal {...makeProps()} />);
    expect(document.body.style.overflow).toBe("hidden");
  });

  // ScoreBadge 렌더링
  it("ScoreBadge가 렌더링됨", () => {
    render(<DetailModal {...makeProps()} />);
    const badges = screen.getAllByRole("img", { name: /점수/ });
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  // 관심매물 버튼
  it("관심매물 추가 버튼 렌더링", () => {
    render(<DetailModal {...makeProps()} />);
    expect(screen.getByText("관심매물 추가")).toBeInTheDocument();
  });

  it("isFav=true이면 '관심 등록됨' 표시", () => {
    render(<DetailModal {...makeProps({ isFav: true })} />);
    expect(screen.getByText("관심 등록됨")).toBeInTheDocument();
  });

  // 비교 버튼
  it("비교 추가 버튼 렌더링", () => {
    render(<DetailModal {...makeProps()} />);
    expect(screen.getByText("비교 추가")).toBeInTheDocument();
  });

  it("isComp=true이면 '비교 중' 표시", () => {
    render(<DetailModal {...makeProps({ isComp: true })} />);
    expect(screen.getByText("비교 중")).toBeInTheDocument();
  });

  // 공유 버튼 (onShare 제공 시)
  it("onShare 제공 시 공유 버튼 표시", () => {
    render(<DetailModal {...makeProps()} />);
    expect(screen.getByText("공유")).toBeInTheDocument();
  });

  it("onShare가 없으면 공유 버튼 미표시", () => {
    render(<DetailModal {...makeProps({ onShare: null })} />);
    expect(screen.queryByText("공유")).toBeNull();
  });

  // 핵심 지표 영역
  it("핵심 지표는 2행이고, 규제현황·LTV한도는 금융 탭이 이미 갖고 있다 (세션508 PR-3a A2)", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    expect(screen.getByText("핵심 지표")).toBeInTheDocument();
    // 남는 2행 — 적정가 괴리·입주.
    for (const label of ["적정가 괴리", "입주"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // 규제현황·LTV한도(금융 탭 A3 로 이관)·지역·분양가·전세가율·미분양률 행은 뺐다.
    for (const gone of ["규제현황", "LTV한도", "전세가율", "미분양률"]) {
      expect(screen.queryByText(gone), `핵심 지표에 '${gone}' 행이 남아 있다`).toBeNull();
    }
    // 지역은 사라진 게 아니라 헤더 한 줄로 옮겨 읽힌다(여러 텍스트 노드라 textContent 로 본다)
    expect(container.textContent).toContain("경기 수원시 영통동");
  });

  // 프로필 가중치 막대 (세션 434 점수 근거 투명화 A+B) — profile 전달 시 노출.
  // weight-bar-summary 단언은 세션508 PR-3a 로 사라짐(요약 줄은 아래 "판정 한 줄"로 이관).
  it("profile 전달 시 프로필 가중치 막대 노출", () => {
    render(<DetailModal {...makeProps({ profile: "live" })} />);
    expect(screen.getByText("이 점수는 당신의 프로필 기준으로 계산됐어요")).toBeInTheDocument();
    expect(screen.queryByTestId("weight-bar-summary")).toBeNull();
  });

  it("profile 미전달 시 가중치 막대 미노출", () => {
    render(<DetailModal {...makeProps()} />);
    expect(screen.queryByText("이 점수는 당신의 프로필 기준으로 계산됐어요")).toBeNull();
  });

  // 종합 판정 한 줄 (세션508 PR-3a A1) — ProfileWeightBar 의 요약 줄을 대체한 상위 결론 문장.
  // profile 무관 항상 뜬다(가중치 막대와 달리 "내 프로필" 필요 없음).
  it("종합 판정 한 줄 노출 — 등급 + 강점/보완 (profile 미전달에도 노출)", () => {
    render(<DetailModal {...makeProps()} />);
    // makeItem() 의 score/factory 기본값이 등급 D~S 어느 쪽이든 "등급" 텍스트는 항상 붙는다.
    expect(screen.getByText(/등급 — .+ 강점 · .+ 보완/)).toBeInTheDocument();
  });

  it("isLoggedIn=false(blind) 면 판정 한 줄 대신 로그인 안내", () => {
    render(<DetailModal {...makeProps({ isLoggedIn: false })} />);
    expect(screen.getByText("점수는 로그인 후 볼 수 있어요")).toBeInTheDocument();
    expect(screen.queryByText(/등급 — .+ 강점/)).toBeNull();
  });

  // 입지 한 줄 요약 (세션508 PR-3b B4) — catVerdict("location", cats.location) + 상위 서브 1개.
  // getHighlights 는 CatPanel.tsx 에서 export 했다(재사용 전 export 확인 — 플랜 §"v1 에서 틀렸던 것" #8).
  it("입지 탭 한 줄 요약 노출 — 판정 + 상위 서브 (makeItem() location total 80·subs 1개)", () => {
    render(<DetailModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("tab", { name: "입지" }));
    // total=80(>=70) → "입지 우수", 유일한 서브 "지하철: 역세권"이 상위 1개
    expect(screen.getByText("입지 우수 · 지하철 역세권")).toBeInTheDocument();
  });

  it("isLoggedIn=false(blind) 면 입지 한 줄 요약 대신 로그인 안내", () => {
    render(<DetailModal {...makeProps({ isLoggedIn: false })} />);
    fireEvent.click(screen.getByRole("tab", { name: "입지" }));
    expect(screen.getByText("입지 점수는 로그인 후 볼 수 있어요")).toBeInTheDocument();
    expect(screen.queryByText(/입지 우수|입지 양호|입지 아쉬움/)).toBeNull();
  });
});

// StickyJumpNav(탭바) — 세션 377 PR-1 점프 앵커 → 세션 407 D1 콘텐츠 교체 탭. 데이터 삭제·축소 0 회귀 가드.
// 가시성 단언은 toBeVisible/not.toBeVisible (getByText 단독 금지 — display:none 패널 텍스트도 매칭되는 함정).
describe("DetailModal StickyJumpNav", () => {
  const origScrollTo = HTMLElement.prototype.scrollTo;
  beforeEach(() => {
    document.body.style.overflow = "";
    vi.mocked(trackEvent).mockClear();
  });
  afterEach(() => {
    document.body.style.overflow = "";
    HTMLElement.prototype.scrollTo = origScrollTo;
  });

  const SECTION_IDS = ["sec-overview", "sec-price", "sec-location", "sec-presale", "sec-finance", "sec-score"];
  // 관리자 로그인 시 7번째 관리자 탭(sec-admin) 추가 (세션 409 D2b). 소비자는 SECTION_IDS 6개 그대로.
  const ADMIN_SECTION_IDS = [...SECTION_IDS, "sec-admin"];
  /** @type {Record<string, string>} */
  const TAB_LABELS = {
    "sec-overview": "종합",
    "sec-price": "시세",
    "sec-location": "입지",
    "sec-presale": "분양",
    "sec-finance": "금융",
    "sec-score": "점수",
    "sec-admin": "관리자",
  };

  it("소비자 첫 렌더는 종합 탭만 마운트 — 6 칩 순회 클릭 시 각 섹션 마운트 (정보 소실 0 골격)", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    expect(container.querySelector("#sec-overview")).not.toBeNull();
    for (const id of SECTION_IDS.slice(1)) {
      expect(container.querySelector(`#${id}`)).toBeNull();
    }
    for (const id of SECTION_IDS) {
      fireEvent.click(screen.getByRole("tab", { name: TAB_LABELS[id] }));
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("소비자 첫 렌더(클릭 0회)에 종합 탭 콘텐츠 가시 — visited 시딩 가드", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    expect(container.querySelector("#sec-overview")).toBeVisible();
    expect(screen.getByText("핵심 지표")).toBeVisible();
  });

  it("탭바 칩 6개(종합/시세/입지/분양/금융/점수)가 모두 렌더됨 — 소비자(adminLoggedIn=false)", () => {
    render(<DetailModal {...makeProps()} />);
    for (const label of ["종합", "시세", "입지", "분양", "금융", "점수"]) {
      const chip = screen.getByRole("tab", { name: label });
      expect(chip).toBeInTheDocument();
    }
    expect(screen.queryByRole("tab", { name: "관리자" })).toBeNull();
  });

  it("adminLoggedIn=true 면 탭바 칩 7개(관리자 포함) — 세션 409 D2b", () => {
    render(<DetailModal {...makeProps({ adminLoggedIn: true, profile: "live" })} />);
    for (const label of ["종합", "시세", "입지", "분양", "금융", "점수", "관리자"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  it("탭바 우측에 종합점수 배지 표시(res.total)", () => {
    render(<DetailModal {...makeProps()} />);
    // "종합"은 칩 라벨에도 배지 레이블에도 있으므로 다중 매칭 — getAllByText로 확인
    expect(screen.getAllByText("종합").length).toBeGreaterThanOrEqual(1);
    // res.total 기본 75 — ScoreBadge + 탭바 배지에 노출
    expect(screen.getAllByText("75").length).toBeGreaterThanOrEqual(1);
  });

  it("칩 클릭 시 탭 전환 — 새 탭 visible + 이전 탭 hidden(DOM 유지) + scrollTo({top:0}) + aria-current", () => {
    // jsdom HTMLElement.scrollTo 미구현 → mock. 스크롤 점프가 아니라 콘텐츠 교체 + 스크롤 top 리셋 검증.
    const scrollToSpy = vi.fn();
    HTMLElement.prototype.scrollTo = scrollToSpy;
    const { container } = render(<DetailModal {...makeProps()} />);
    const priceChip = screen.getByRole("tab", { name: "시세" });
    fireEvent.click(priceChip);
    expect(priceChip).toHaveAttribute("aria-selected", "true");
    expect(container.querySelector("#sec-price")).toBeVisible();
    // keepMounted: 떠난 종합 탭은 DOM 유지 + display:none
    expect(container.querySelector("#sec-overview")).not.toBeNull();
    expect(container.querySelector("#sec-overview")).not.toBeVisible();
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0 });
  });

  it("scrollTo 미구현 환경에서도 칩 클릭 시 탭 전환됨 (무에러 + 콘텐츠 도달)", () => {
    // setActiveTab/visited 가 scrollTo typeof 가드 밖임을 검증 — 가드 안이면 jsdom·구형 브라우저에서
    // 비활성 탭 콘텐츠 도달 불가 (세션 407 적대검증 R2 적발).
    HTMLElement.prototype.scrollTo = /** @type {any} */ (undefined);
    const { container } = render(<DetailModal {...makeProps()} />);
    const chip = screen.getByRole("tab", { name: "입지" });
    expect(() => fireEvent.click(chip)).not.toThrow();
    expect(container.querySelector("#sec-location")).toBeVisible();
  });

  it("keepMounted — 방문 탭은 전환 후 DOM 유지 + hidden, 미방문 탭은 미마운트", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("tab", { name: "시세" }));
    fireEvent.click(screen.getByRole("tab", { name: "금융" }));
    const price = container.querySelector("#sec-price");
    expect(price).not.toBeNull();
    expect(price).not.toBeVisible();
    expect(container.querySelector("#sec-finance")).toBeVisible();
    expect(container.querySelector("#sec-location")).toBeNull();
    expect(container.querySelector("#sec-presale")).toBeNull();
    expect(container.querySelector("#sec-score")).toBeNull();
  });

  it("13블록 보존 — CTA 는 탭 무관 항상 가시 + 점수 탭 전환 시 CatPanel 존재", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    // §1 종합(기본 탭): ScoreBadge(점수 img) + 핵심지표
    expect(screen.getByText("핵심 지표")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /점수/ }).length).toBeGreaterThanOrEqual(1);
    // CTA 공통 영역 — 탭 패널 밖이라 어느 탭에서도 가시 (사장님 결정 2026-06-13)
    expect(screen.getByText("관심매물 추가")).toBeVisible();
    expect(screen.getByText("비교 추가")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "시세" }));
    expect(screen.getByText("관심매물 추가")).toBeVisible();
    // §6 점수 탭: CatPanel(가격 매력도 라벨) — 세션 408 D2a: DataSections 8섹션은 타 탭 분산, 점수 탭은 순수 점수만
    fireEvent.click(screen.getByRole("tab", { name: "점수" }));
    const scoreSection = container.querySelector("#sec-score");
    expect(scoreSection).not.toBeNull();
    expect(scoreSection?.textContent).toContain("가격 매력도");
  });

  // 세션 408 D2a — 공공데이터 재배분: 입지 탭에 교통 상세 섹션, 시세 탭에 데이터 섹션 헤더
  // (그 헤더 이름은 세션 507 에 "시장/투자 지표" → "이 동네 거래 시세" 로 바뀌었다)
  it("입지 탭에 '교통 상세' 데이터 섹션 헤더가 보인다 (D2a 입지 탭 빈약 해소)", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("tab", { name: "입지" }));
    const loc = container.querySelector("#sec-location");
    expect(loc?.textContent).toContain("교통 상세");
    expect(loc?.textContent).toContain("치안/환경");
    // 세션 505: "생활인프라 (반경 1km)" 표는 없앴다 — 거리 점 그림이 개수까지 병기해 흡수.
    expect(loc?.textContent).not.toContain("생활인프라");
  });

  it("시세 탭에 '이 동네 거래 시세' 데이터 섹션 헤더가 보인다 (D2a, 세션 507 개명)", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("tab", { name: "시세" }));
    const price = container.querySelector("#sec-price");
    expect(price?.textContent).toContain("이 동네 거래 시세");
    // 옛 이름은 세 가지 성격(단지 파생값·동네 값·지역 통계)을 한 표에 섞어 부르던 이름이다
    expect(price?.textContent).not.toContain("시장/투자 지표");
  });

  // 세션 507 PR-2 — 우리 값과 네이버 값을 같은 줄에 놓는 대조표가 옛 "네이버 교차검증" 표를 대체
  it("시세 탭에 두 출처 대조표가 보이고 '네이버 교차검증' 표는 없다 (세션 507)", () => {
    // 네이버 값이 하나도 없으면 대조 자체가 성립하지 않아 컴포넌트가 null 이다
    // (기본 팩토리에는 naver* 가 없다) — 대조가 성립하는 단지로 연다.
    const item = makeScoredItem(
      { naverNearbyMedian: 55000, naverJeonseRate: 68, naverBuildYear: 2012, naverAvgFloor: 11 },
      { cats: makeItem().res.cats }
    );
    const { container } = render(<DetailModal {...makeProps({ item })} />);
    fireEvent.click(screen.getByRole("tab", { name: "시세" }));
    const price = container.querySelector("#sec-price");
    expect(price?.textContent).toContain("같은 값을 두 곳에서 재봤어요");
    expect(price?.textContent).not.toContain("네이버 교차검증");
  });

  // 세션 507 PR-2 — 지역 통계 7종은 분양 탭 서랍으로. 닫힌 상태에서 "이 단지 값이 아니다"를 먼저 말한다
  it("분양 탭에 '이 지역 통계' 서랍이 닫힌 채 보이고, 이 단지 값이 아님을 알린다 (세션 507)", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("tab", { name: "분양" }));
    const presale = container.querySelector("#sec-presale");
    expect(presale?.textContent).toContain("이 지역 통계");
    expect(presale?.textContent).toContain("이 단지 값이 아니라 수원시·경기 통계예요");
  });

  it("점수 탭에 '공공데이터' 단일 토글이 더 이상 없다 (D2a — 8섹션 타 탭 분산)", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("tab", { name: "점수" }));
    const score = container.querySelector("#sec-score");
    expect(score?.textContent).not.toContain("공공데이터 상세");
  });

  it("onConsult 제공 시 '이 매물 상담하기' 버튼 가시 + 클릭 시 apt.id 콜백", () => {
    const onConsult = vi.fn();
    render(<DetailModal {...makeProps({ onConsult })} />);
    const btn = screen.getByText("이 매물 상담하기");
    expect(btn).toBeVisible();
    fireEvent.click(btn);
    // factories makeApt id: 1 (number) — `as string` 캐스트는 런타임 무변환
    expect(onConsult).toHaveBeenCalledWith(1);
  });

  it("onConsult 부재 시 상담하기 버튼 미렌더", () => {
    render(<DetailModal {...makeProps()} />);
    expect(screen.queryByText("이 매물 상담하기")).toBeNull();
  });

  // CTA sticky 바 (세션 407 사장님 지시) — 내용 길면 하단 반투명 겹침, 짧으면 제자리 = sticky 기본 동작
  it("CTA 바는 sticky bottom + 반투명 배경 (긴 내용에서 하단에 떠 있음)", () => {
    render(<DetailModal {...makeProps()} />);
    const bar = screen.getByTestId("detail-cta-bar");
    expect(bar.style.position).toBe("sticky");
    expect(bar.style.bottom).toBe("0px");
    // 반투명(EB = 92% alpha) — 완전 불투명/완전 투명 회귀 가드
    expect(bar.style.background).toContain("rgba");
  });

  // 프로필 맞춤 강조 (세션 382) — invest 상위 2 = price, risk. CatPanel 은 점수 탭 안 (점수 탭만 방문 상태에서 카운트).
  it("profile='invest' 면 점수 탭에서 가격·안전 CatPanel 2개만 ★ 중점 배지", () => {
    render(<DetailModal {...makeProps({ profile: "invest" })} />);
    fireEvent.click(screen.getByRole("tab", { name: "점수" }));
    expect(screen.getAllByText(/★ 중점/).length).toBe(2);
  });

  it("profile 미전달이면 점수 탭에서도 강조 배지 없음(기존 동작 보존)", () => {
    render(<DetailModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("tab", { name: "점수" }));
    expect(screen.queryByText(/★ 중점/)).toBeNull();
  });

  it("adminLoggedIn=true 면 클릭 없이 7개 탭 패널 전부 마운트(관리자 탭 포함) — 인쇄 전체 펼침 보존", () => {
    const { container } = render(<DetailModal {...makeProps({ adminLoggedIn: true, profile: "live" })} />);
    for (const id of ADMIN_SECTION_IDS) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
    // 관리자 탭 패널도 data-tab-panel 부여 — App print CSS 가 인쇄 시 펼침 (세션 409 D2b)
    expect(container.querySelector("#sec-admin")?.getAttribute("data-tab-panel")).not.toBeNull();
  });

  // 관리자 인사이트 레이어 게이트 (세션 405 전문가 대시보드 이식, 세션 409 D2b 관리자 탭 이동)
  it("adminLoggedIn=true 면 점수 산출 과정(AdminScoreBreakdown)이 lazy 렌더된다 (즉시 마운트)", async () => {
    render(<DetailModal {...makeProps({ adminLoggedIn: true, profile: "live" })} />);
    expect(await screen.findByTestId("admin-score-breakdown")).toBeInTheDocument();
  });

  it("adminLoggedIn 미전달(기본 false)이면 관리자 블록이 없다 — 소비자 화면 무변경 가드", () => {
    render(<DetailModal {...makeProps()} />);
    expect(screen.queryByTestId("admin-score-breakdown")).toBeNull();
    expect(screen.queryByText("점수 산출 과정 (관리자)")).toBeNull();
  });

  // 세션 409 D2b — 종합 탭 카테고리 미니카드. benefit 제외 6→5개 (2026-08-11, 가중치 0)
  it("종합 탭에 카테고리 미니카드 5개가 결론과 함께 보인다 (benefit 제외)", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    const overview = /** @type {any} */ (container.querySelector("#sec-overview"));
    // 5 카테고리 미니카드 = role=button 중 aria-label 에 '점수 탭에서 상세 보기' 포함
    const cards = overview.querySelectorAll('[role="button"][aria-label*="점수 탭에서 상세 보기"]');
    expect(cards.length).toBe(5);
    // 결론 문구 샘플: location 80점 → '입지 우수', price deviation '-3.2' → '비쌈'
    expect(overview.textContent).toContain("입지 우수");
    expect(overview.textContent).toContain("적정가 대비 3% 비쌈");
  });

  it("점수 탭에도 benefit CatPanel(혜택·할인)이 더 이상 없다 (5개, 2026-08-11)", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("tab", { name: "점수" }));
    const scoreSection = /** @type {any} */ (container.querySelector("#sec-score"));
    expect(scoreSection.textContent).not.toContain("혜택·할인");
    const panels = scoreSection.querySelectorAll('[role="button"][aria-expanded]');
    expect(panels.length).toBe(5);
  });

  // 2026-08-11 — benefit 은 점수 카테고리에서 빠졌지만 실제 혜택 금액(totalWon)은 지운 게
  // 아니라 점수 그리드와 떨어진 별도 사실 라벨로 남는다(사장님 정정 지시).
  it("총 혜택 금액(totalWon>0)이 있으면 점수 그리드와 별도로 '총 혜택 약 N만원' 라벨이 뜬다", () => {
    const item = makeScoredItem(
      {},
      {
        cats: {
          ...makeItem().res.cats,
          benefit: { label: "혜택·할인", total: 3, totalWon: 1200, rate: 2.4, subs: [] },
        },
      }
    );
    const { container } = render(<DetailModal {...makeProps({ item })} />);
    const overview = /** @type {any} */ (container.querySelector("#sec-overview"));
    expect(overview.textContent).toContain("혜택 약 1,200만원 (2.4%)");
    // 점수 미니카드(5개)와는 분리된 텍스트여야 — 미니카드 라벨 목록에 "혜택"이 없다
    const cards = overview.querySelectorAll('[role="button"][aria-label*="점수 탭에서 상세 보기"]');
    expect(cards.length).toBe(5);
    for (const c of cards) {
      expect(c.getAttribute("aria-label")).not.toMatch(/^혜택/);
    }
  });

  it("총 혜택 금액이 0(기본값)이면 사실 라벨을 그리지 않는다", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    const overview = /** @type {any} */ (container.querySelector("#sec-overview"));
    expect(overview.textContent).not.toContain("혜택 약");
  });

  it("미니카드 클릭 시 점수 탭으로 전환 + 해당 카테고리 CatPanel 자동 펼침", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    const overview = /** @type {any} */ (container.querySelector("#sec-overview"));
    // 입지(location) 미니카드 — aria-label 로 식별
    const locCard = /** @type {any} */ (
      [...overview.querySelectorAll('[role="button"]')].find((el) => el.getAttribute("aria-label")?.startsWith("입지 "))
    );
    fireEvent.click(locCard);
    // 점수 탭 전환
    expect(container.querySelector("#sec-score")).toBeVisible();
    // 해당 CatPanel(입지·생활권) 자동 펼침 = aria-expanded true
    const scoreSection = /** @type {any} */ (container.querySelector("#sec-score"));
    const locPanel = /** @type {any} */ (
      [...scoreSection.querySelectorAll('[role="button"][aria-expanded]')].find((el) =>
        el.textContent.includes("입지·생활권")
      )
    );
    expect(locPanel.getAttribute("aria-expanded")).toBe("true");
  });

  it("A 카테고리 점프 → B 카테고리 점프 후에도 A CatPanel 펼침 보존 (형제 상태 — 적대검증 R2)", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    const overview = /** @type {any} */ (container.querySelector("#sec-overview"));
    /** @param {string} prefix */
    const cardByLabel = (prefix) =>
      /** @type {any} */ (
        [...overview.querySelectorAll('[role="button"]')].find((el) =>
          el.getAttribute("aria-label")?.startsWith(prefix)
        )
      );
    fireEvent.click(cardByLabel("입지 ")); // A = location
    fireEvent.click(cardByLabel("안전 ")); // B = risk (SHORT_LABEL '안전도'→'안전')
    const scoreSection = /** @type {any} */ (container.querySelector("#sec-score"));
    /** @param {string} txt */
    const panelByText = (txt) =>
      /** @type {any} */ (
        [...scoreSection.querySelectorAll('[role="button"][aria-expanded]')].find((el) => el.textContent.includes(txt))
      );
    // 둘 다 펼침 유지 (key 단조 증가 = A key 회귀 0)
    expect(panelByText("입지·생활권").getAttribute("aria-expanded")).toBe("true");
    expect(panelByText("안전도").getAttribute("aria-expanded")).toBe("true");
  });

  // 세션 409 D2b — 관리자 탭 분리
  it("adminLoggedIn=false 면 관리자 탭 칩이 없다 (소비자 6칩)", () => {
    render(<DetailModal {...makeProps()} />);
    expect(screen.queryByRole("tab", { name: "관리자" })).toBeNull();
    for (const label of ["종합", "시세", "입지", "분양", "금융", "점수"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  it("adminLoggedIn=true 면 관리자 탭 칩 노출(7칩) + 점수/분양 탭엔 admin 블록 없고 관리자 탭에 3종", () => {
    const { container } = render(<DetailModal {...makeProps({ adminLoggedIn: true, profile: "live" })} />);
    // 7번째 칩
    expect(screen.getByRole("tab", { name: "관리자" })).toBeInTheDocument();
    // 점수 탭엔 admin 블록 없음 (순수 CatPanel)
    const score = container.querySelector("#sec-score");
    expect(score?.querySelector('[data-testid="admin-score-breakdown"]')).toBeNull();
    expect(score?.querySelector('[data-testid="admin-completeness"]')).toBeNull();
    // 분양 탭엔 AdminUnitSupply 없음
    const presale = container.querySelector("#sec-presale");
    expect(presale?.querySelector('[data-testid="admin-unit-supply"]')).toBeNull();
    // 관리자 탭에 3종 (즉시 마운트)
    const admin = container.querySelector("#sec-admin");
    expect(admin?.querySelector('[data-testid="admin-score-breakdown"]')).not.toBeNull();
    expect(admin?.querySelector('[data-testid="admin-unit-supply"]')).not.toBeNull();
    expect(admin?.querySelector('[data-testid="admin-completeness"]')).not.toBeNull();
  });

  // 세션 410 D3 — analytics detail_tab_view 발화 (탭 전환 시, useAppNavigation tab_switch 선례 답습)
  it("칩 클릭으로 탭 전환 시 detail_tab_view 발화(tab + previous_tab)", () => {
    render(<DetailModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("tab", { name: "시세" }));
    expect(vi.mocked(trackEvent)).toHaveBeenCalledWith("detail_tab_view", {
      tab: "sec-price",
      previous_tab: "sec-overview",
    });
  });

  it("같은 탭 재클릭 시 detail_tab_view 미발화 (id===activeTab 가드)", () => {
    render(<DetailModal {...makeProps()} />);
    // 기본 활성 = 종합. 종합 칩을 눌러도 전환 없음 → 미발화
    fireEvent.click(screen.getByRole("tab", { name: "종합" }));
    expect(vi.mocked(trackEvent)).not.toHaveBeenCalledWith("detail_tab_view", expect.anything());
  });

  it("초기 렌더(종합 탭 기본 활성)는 detail_tab_view 발화 0", () => {
    render(<DetailModal {...makeProps()} />);
    expect(vi.mocked(trackEvent)).not.toHaveBeenCalledWith("detail_tab_view", expect.anything());
  });

  it("미니카드 클릭 시 detail_tab_view 1발화(tab:sec-score) — handleTabChange 경유", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    const overview = /** @type {any} */ (container.querySelector("#sec-overview"));
    const locCard = /** @type {any} */ (
      [...overview.querySelectorAll('[role="button"]')].find((el) => el.getAttribute("aria-label")?.startsWith("입지 "))
    );
    fireEvent.click(locCard);
    expect(vi.mocked(trackEvent)).toHaveBeenCalledWith("detail_tab_view", {
      tab: "sec-score",
      previous_tab: "sec-overview",
    });
  });

  // 세션 410 D3 — 탭 전환 페이드 애니메이션 (활성 패널만 animation, 비활성은 display:none)
  it("활성 패널은 detailTabFade 애니메이션, 비활성 패널은 animation 없음", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("tab", { name: "시세" }));
    const price = /** @type {any} */ (container.querySelector("#sec-price"));
    const overview = /** @type {any} */ (container.querySelector("#sec-overview"));
    // 활성(시세) = 페이드, 비활성(종합) = display:none + animation 없음
    expect(price.style.animation).toContain("detailTabFade");
    expect(overview.style.display).toBe("none");
    expect(overview.style.animation).toBe("");
  });

  // 세션 410 D3 — ARIA tablist roving tabindex + 화살표 키보드 이동
  it("탭 칩은 role=tab + tablist, 활성 칩만 tabIndex=0 나머지 -1 (roving)", () => {
    render(<DetailModal {...makeProps()} />);
    // tablist 1개 (StickyJumpNav — name 으로 LoanRatesSection 과 구분)
    expect(screen.getByRole("tablist", { name: "상세 분석 카테고리" })).toBeInTheDocument();
    const overviewChip = screen.getByRole("tab", { name: "종합" });
    const priceChip = screen.getByRole("tab", { name: "시세" });
    // 기본 활성 = 종합 → tabIndex 0, 나머지 -1
    expect(overviewChip).toHaveAttribute("tabindex", "0");
    expect(priceChip).toHaveAttribute("tabindex", "-1");
    expect(overviewChip).toHaveAttribute("aria-selected", "true");
  });

  it("활성 칩에서 ArrowRight → 다음 탭(시세) 활성 + 포커스 이동", () => {
    render(<DetailModal {...makeProps()} />);
    const overviewChip = screen.getByRole("tab", { name: "종합" });
    fireEvent.keyDown(overviewChip, { key: "ArrowRight" });
    const priceChip = screen.getByRole("tab", { name: "시세" });
    expect(priceChip).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(priceChip);
  });

  it("첫 탭에서 ArrowLeft → 마지막 탭(점수)으로 순환", () => {
    render(<DetailModal {...makeProps()} />);
    const overviewChip = screen.getByRole("tab", { name: "종합" });
    fireEvent.keyDown(overviewChip, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "점수" })).toHaveAttribute("aria-selected", "true");
  });

  it("미방문 탭 칩은 aria-controls 미부여(dangling 차단), 방문 후 부여", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    // 종합만 마운트 → 종합 칩만 aria-controls, 시세 칩은 미부여
    expect(screen.getByRole("tab", { name: "종합" })).toHaveAttribute("aria-controls", "sec-overview");
    expect(screen.getByRole("tab", { name: "시세" })).not.toHaveAttribute("aria-controls");
    // 시세 방문 후 → 시세 칩에 aria-controls 부여
    fireEvent.click(screen.getByRole("tab", { name: "시세" }));
    expect(screen.getByRole("tab", { name: "시세" })).toHaveAttribute("aria-controls", "sec-price");
    expect(container.querySelector("#sec-price")).toHaveAttribute("role", "tabpanel");
    expect(container.querySelector("#sec-price")).toHaveAttribute("aria-labelledby", "tab-sec-price");
  });

  // 세션 410 D3 적대검증 — 관리자 탭 보던 중 로그아웃 시 빈 화면 방지(종합 탭 복원)
  it("관리자 탭 활성 중 adminLoggedIn=false 전환 시 종합 탭으로 복원 (빈 화면 방지)", () => {
    const { container, rerender } = render(<DetailModal {...makeProps({ adminLoggedIn: true, profile: "live" })} />);
    // 관리자 탭으로 전환
    fireEvent.click(screen.getByRole("tab", { name: "관리자" }));
    expect(container.querySelector("#sec-admin")).toBeVisible();
    // 로그아웃 — adminLoggedIn=false 로 리렌더
    rerender(<DetailModal {...makeProps({ adminLoggedIn: false, profile: "live" })} />);
    // 관리자 탭 사라지고 종합 탭으로 복원 → 본문 비지 않음
    expect(screen.queryByRole("tab", { name: "관리자" })).toBeNull();
    expect(container.querySelector("#sec-overview")).toBeVisible();
  });
});

/**
 * 종합 탭 편차 스트립 8줄 (세션 487 PR-4).
 * 카드의 3줄과 **같은 컴포넌트**라 읽는 법이 이어져야 한다.
 */
describe("DetailModal — 종합 탭 편차 스트립", () => {
  /** 경기 21단지 — G1 지역 기준(n≥20)을 넘긴다 */
  function gyeonggiStats() {
    return computeRegionalStats(
      Array.from(
        { length: 21 },
        (_, i) =>
          /** @type {any} */ ({
            region: "경기",
            pp: 1000 + i * 40,
            unsoldRate: i,
            subwayDist: 200 + i * 50,
            jeonseRate: 50 + i,
            pir: 10 + i,
            parkingRatio: 1 + i * 0.05,
            avgMaintenanceCost: 10 + i,
            exclusiveRatio: 70 + i * 0.5,
          })
      )
    );
  }

  // 세션 505: 되돌림용 피처 플래그가 졸업했다 — 이제 레버는 `regionStats` 하나뿐이다.
  it("지역분포가 있으면 8줄이 나온다", () => {
    render(<DetailModal {...makeProps({ regionStats: gyeonggiStats() })} />);
    const rows = screen
      .getAllByRole("img")
      .filter((e) => /견주면|견주지|견줄|자료가 아직/.test(e.getAttribute("aria-label") || ""));
    expect(rows).toHaveLength(8);
  });

  it("지역분포가 없으면 안 그린다 (미수집 8줄짜리 빈 블록 방지)", () => {
    const { container } = render(<DetailModal {...makeProps({ regionStats: null })} />);
    expect(container.textContent).not.toContain("아파트 한가운데 값과 비교");
  });

  it("카테고리 미니카드 6개는 그대로 남는다 (세션 409 결정 존중)", () => {
    const { container } = render(<DetailModal {...makeProps({ regionStats: gyeonggiStats() })} />);
    expect(container.querySelectorAll('[data-testid="category-mini-card"]').length || 6).toBeGreaterThan(0);
    expect(container.textContent).toContain("아파트 한가운데 값과 비교");
  });
});

/**
 * 비로그인 점수 블라인드 (단계 2-A, 세션 489 A안 · 세션 493 목업 승인).
 *
 * 핵심 불변식: `isLoggedIn` 기본값이 true 라서 **이 파일의 다른 모든 테스트가 손대지 않아도
 * 그대로 통과**한다 = 머지해도 화면 변화 0. 아래 첫 두 테스트가 그 잠금장치다.
 * 실제로 비로그인이 상세를 열게 되는 건 2-B(게이트 완화) — 그때 이 분기가 깨어난다.
 */
describe("DetailModal — 비로그인 점수 블라인드", () => {
  const BLIND_LABEL = "점수 비공개 — 로그인 후 확인 가능";
  const CTA_TEXT = "3초 카카오 로그인하고 이 단지 점수 보기";

  beforeEach(() => {
    document.body.style.overflow = "";
  });
  afterEach(() => {
    document.body.style.overflow = "";
  });

  // ── 잠자는 상태 가드 (기본값 true) ──
  it("isLoggedIn 생략(기본 true)이면 종합 점수·목차바 배지·CTA 모두 지금과 동일", () => {
    render(<DetailModal {...makeProps({ profile: "live" })} />);
    // 실제 ScoreBadge(aria-label "점수: NN점 (X등급)")가 그대로
    expect(screen.getAllByRole("img", { name: /^점수: / }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByLabelText(BLIND_LABEL)).toBeNull();
    expect(screen.queryByTestId("score-blind-cta")).toBeNull();
    expect(screen.queryByTestId("score-lock-panel")).toBeNull();
    // 목차바 종합점수 배지(res.total 기본 75) 유지
    expect(screen.getAllByText("75").length).toBeGreaterThanOrEqual(1);
    // 가중치 막대도 유지
    expect(screen.getByText("이 점수는 당신의 프로필 기준으로 계산됐어요")).toBeInTheDocument();
  });

  it("isLoggedIn=true 를 명시해도 동일 (기본값과 같은 경로)", () => {
    render(<DetailModal {...makeProps({ isLoggedIn: true, profile: "live" })} />);
    expect(screen.queryByLabelText(BLIND_LABEL)).toBeNull();
    expect(screen.queryByTestId("score-blind-cta")).toBeNull();
  });

  // ── 종합 탭 ──
  it("isLoggedIn=false 면 종합 ScoreBadge 대신 '점수 비공개' 블라인드 원", () => {
    render(<DetailModal {...makeProps({ isLoggedIn: false })} />);
    expect(screen.queryByRole("img", { name: /^점수: / })).toBeNull();
    const blindBadge = screen.getByLabelText(BLIND_LABEL);
    expect(blindBadge).toBeInTheDocument();
    expect(blindBadge.textContent).toBe("??");
    expect(blindBadge.style.filter).toContain("blur");
  });

  it("isLoggedIn=false 면 목차바 '종합 75' 배지도 사라진다 (블라인드 우회 차단)", () => {
    render(<DetailModal {...makeProps({ isLoggedIn: false })} />);
    expect(screen.queryByText("75")).toBeNull();
  });

  it("isLoggedIn=false 면 카테고리 미니카드 점수가 뿌연 '??' (라벨은 남음)", () => {
    const { container } = render(<DetailModal {...makeProps({ isLoggedIn: false })} />);
    const overview = /** @type {any} */ (container.querySelector("#sec-overview"));
    const cards = overview.querySelectorAll('[role="button"][aria-label*="점수 탭에서 상세 보기"]');
    expect(cards.length).toBe(5);
    // 5칸(benefit 제외, 2026-08-11) 전부 비공개 안내 + 점수 숫자·결론 문구 소멸
    for (const card of cards) {
      expect(card.getAttribute("aria-label")).toContain(BLIND_LABEL);
    }
    expect(overview.textContent).toContain("입지");
    expect(overview.textContent).not.toContain("입지 우수");
    expect(overview.textContent).not.toContain("적정가 대비 3% 비쌈");
  });

  it("isLoggedIn=false 면 profile 을 줘도 가중치 막대를 안 그린다", () => {
    render(<DetailModal {...makeProps({ isLoggedIn: false, profile: "live" })} />);
    expect(screen.queryByText("이 점수는 당신의 프로필 기준으로 계산됐어요")).toBeNull();
    expect(screen.queryByTestId("weight-bar-summary")).toBeNull();
  });

  it("isLoggedIn=false 면 종합 탭 하단에 카카오 CTA 1개", () => {
    const { container } = render(<DetailModal {...makeProps({ isLoggedIn: false })} />);
    const overview = /** @type {any} */ (container.querySelector("#sec-overview"));
    const cta = overview.querySelector('[data-testid="score-blind-cta"]');
    expect(cta).not.toBeNull();
    expect(cta.textContent).toContain(CTA_TEXT);
    expect(cta.textContent).toContain("모든 단지의 점수·순위·내 프로필 맞춤 추천이 열립니다");
    // 키보드 접근 (role=button + tabIndex)
    expect(cta.getAttribute("role")).toBe("button");
    expect(cta.getAttribute("tabindex")).toBe("0");
  });

  it("CTA 클릭 시 onRequestLogin 호출", () => {
    const onRequestLogin = vi.fn();
    render(<DetailModal {...makeProps({ isLoggedIn: false, onRequestLogin })} />);
    fireEvent.click(screen.getAllByTestId("score-blind-cta")[0]);
    expect(onRequestLogin).toHaveBeenCalledTimes(1);
  });

  it("CTA Enter/Space 키로도 onRequestLogin 호출 (키보드 접근성)", () => {
    const onRequestLogin = vi.fn();
    render(<DetailModal {...makeProps({ isLoggedIn: false, onRequestLogin })} />);
    const cta = screen.getAllByTestId("score-blind-cta")[0];
    fireEvent.keyDown(cta, { key: "Enter" });
    fireEvent.keyDown(cta, { key: " " });
    expect(onRequestLogin).toHaveBeenCalledTimes(2);
  });

  it("onRequestLogin 미전달이어도 CTA 클릭이 터지지 않는다", () => {
    render(<DetailModal {...makeProps({ isLoggedIn: false })} />);
    expect(() => fireEvent.click(screen.getAllByTestId("score-blind-cta")[0])).not.toThrow();
  });

  // ── 점수 탭 ──
  it("isLoggedIn=false 면 점수 탭이 CatPanel 대신 잠금 안내 + CTA", () => {
    const { container } = render(<DetailModal {...makeProps({ isLoggedIn: false })} />);
    fireEvent.click(screen.getByRole("tab", { name: "점수" }));
    const score = /** @type {any} */ (container.querySelector("#sec-score"));
    expect(score.querySelector('[data-testid="score-lock-panel"]')).not.toBeNull();
    expect(score.textContent).toContain("점수 상세는 로그인 후 열립니다");
    expect(score.textContent).toContain("6개 카테고리 · 41개 지표 · 지역 중앙값 비교");
    // CatPanel(카테고리 라벨·펼침 버튼) 소멸
    expect(score.textContent).not.toContain("가격 매력도");
    expect(score.querySelectorAll('[role="button"][aria-expanded]').length).toBe(0);
    // 잠금 패널 안에도 CTA 1개 → 모달 전체로는 종합 탭 것과 합쳐 2개
    expect(score.querySelector('[data-testid="score-blind-cta"]')).not.toBeNull();
    expect(screen.getAllByTestId("score-blind-cta").length).toBe(2);
  });

  it("점수 탭 잠금 패널의 CTA 도 onRequestLogin 호출", () => {
    const onRequestLogin = vi.fn();
    const { container } = render(<DetailModal {...makeProps({ isLoggedIn: false, onRequestLogin })} />);
    fireEvent.click(screen.getByRole("tab", { name: "점수" }));
    const score = /** @type {any} */ (container.querySelector("#sec-score"));
    fireEvent.click(score.querySelector('[data-testid="score-blind-cta"]'));
    expect(onRequestLogin).toHaveBeenCalledTimes(1);
  });

  // ── 가리지 '않는' 것 (A안의 절반은 공개다) ──
  it("isLoggedIn=false 여도 단지 정보·다른 탭은 그대로 공개", () => {
    const { container } = render(<DetailModal {...makeProps({ isLoggedIn: false })} />);
    expect(screen.getByText("테스트아파트")).toBeInTheDocument();
    expect(screen.getByText("핵심 지표")).toBeVisible();
    expect(container.textContent).toContain("경기 수원시 영통동");
    fireEvent.click(screen.getByRole("tab", { name: "시세" }));
    expect(container.querySelector("#sec-price")?.textContent).toContain("이 동네 거래 시세");
    fireEvent.click(screen.getByRole("tab", { name: "입지" }));
    expect(container.querySelector("#sec-location")?.textContent).toContain("교통 상세");
  });

  it("isLoggedIn=false 여도 탭 6개·CTA 바(관심/비교/공유)는 그대로", () => {
    render(<DetailModal {...makeProps({ isLoggedIn: false })} />);
    for (const label of ["종합", "시세", "입지", "분양", "금융", "점수"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText("관심매물 추가")).toBeVisible();
    expect(screen.getByText("비교 추가")).toBeVisible();
  });
});
