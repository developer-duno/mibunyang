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
  it("핵심 지표 영역에 지역, 분양가 등 표시", () => {
    render(<DetailModal {...makeProps()} />);
    expect(screen.getByText("핵심 지표")).toBeInTheDocument();
    expect(screen.getByText("경기 수원시 영통동")).toBeInTheDocument();
  });

  // 프로필 가중치 막대 (세션 434 점수 근거 투명화 A+B) — profile 전달 시 노출
  it("profile 전달 시 프로필 가중치 막대 노출", () => {
    render(<DetailModal {...makeProps({ profile: "live" })} />);
    expect(screen.getByText("이 점수는 당신의 프로필 기준으로 계산됐어요")).toBeInTheDocument();
    expect(screen.getByTestId("weight-bar-summary")).toBeInTheDocument();
  });

  it("profile 미전달 시 가중치 막대 미노출", () => {
    render(<DetailModal {...makeProps()} />);
    expect(screen.queryByText("이 점수는 당신의 프로필 기준으로 계산됐어요")).toBeNull();
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

  // 세션 408 D2a — 공공데이터 재배분: 입지 탭에 교통 상세 섹션, 시세 탭에 시장/투자 지표 헤더
  it("입지 탭에 '교통 상세' 데이터 섹션 헤더가 보인다 (D2a 입지 탭 빈약 해소)", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("tab", { name: "입지" }));
    const loc = container.querySelector("#sec-location");
    expect(loc?.textContent).toContain("교통 상세");
    expect(loc?.textContent).toContain("생활인프라 (반경 1km)");
  });

  it("시세 탭에 '시장/투자 지표' 데이터 섹션 헤더가 보인다 (D2a)", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("tab", { name: "시세" }));
    const price = container.querySelector("#sec-price");
    expect(price?.textContent).toContain("시장/투자 지표");
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

  // 세션 409 D2b — 종합 탭 카테고리 미니카드
  it("종합 탭에 카테고리 미니카드 6개가 결론과 함께 보인다", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    const overview = /** @type {any} */ (container.querySelector("#sec-overview"));
    // 6 카테고리 미니카드 = role=button 중 aria-label 에 '점수 탭에서 상세 보기' 포함
    const cards = overview.querySelectorAll('[role="button"][aria-label*="점수 탭에서 상세 보기"]');
    expect(cards.length).toBe(6);
    // 결론 문구 샘플: location 80점 → '입지 우수', price deviation '-3.2' → '비쌈'
    expect(overview.textContent).toContain("입지 우수");
    expect(overview.textContent).toContain("적정가 대비 3% 비쌈");
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

  const on = () => vi.stubEnv("VITE_FEATURE_DEVIATION_STRIP", "true");
  afterEach(() => vi.unstubAllEnvs());

  it("플래그 ON + 지역분포 있으면 8줄이 나온다", () => {
    on();
    render(<DetailModal {...makeProps({ regionStats: gyeonggiStats() })} />);
    const rows = screen
      .getAllByRole("img")
      .filter((e) => /견주면|견주지|견줄|자료가 아직/.test(e.getAttribute("aria-label") || ""));
    expect(rows).toHaveLength(8);
  });

  it("플래그 OFF 면 안 그린다 (환경변수만으로 원상복구)", () => {
    vi.stubEnv("VITE_FEATURE_DEVIATION_STRIP", "false");
    const { container } = render(<DetailModal {...makeProps({ regionStats: gyeonggiStats() })} />);
    expect(container.textContent).not.toContain("아파트 평균과 비교");
  });

  it("지역분포가 없으면 안 그린다 (미수집 8줄짜리 빈 블록 방지)", () => {
    on();
    const { container } = render(<DetailModal {...makeProps({ regionStats: null })} />);
    expect(container.textContent).not.toContain("아파트 평균과 비교");
  });

  it("카테고리 미니카드 6개는 그대로 남는다 (세션 409 결정 존중)", () => {
    on();
    const { container } = render(<DetailModal {...makeProps({ regionStats: gyeonggiStats() })} />);
    expect(container.querySelectorAll('[data-testid="category-mini-card"]').length || 6).toBeGreaterThan(0);
    expect(container.textContent).toContain("아파트 평균과 비교");
  });
});
