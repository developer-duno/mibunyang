// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DetailModal } from "./DetailModal";
import { makeScoredItem } from "@/__tests__/factories";

// 최소한의 cats 구조 (DetailModal에서 cats 데이터가 필요)
function makeItem(overrides = {}) {
  return makeScoredItem(
    {},
    {
      cats: {
        price: { label: "가격 매력도", total: 70, deviation: "-3.2", subs: [{ info: "-3.2%", name: "적정가괴리", score: 70 }] },
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
});

// StickyJumpNav(탭바) — 세션 377 PR-1 점프 앵커 → 세션 407 D1 콘텐츠 교체 탭. 데이터 삭제·축소 0 회귀 가드.
// 가시성 단언은 toBeVisible/not.toBeVisible (getByText 단독 금지 — display:none 패널 텍스트도 매칭되는 함정).
describe("DetailModal StickyJumpNav", () => {
  const origScrollTo = HTMLElement.prototype.scrollTo;
  beforeEach(() => { document.body.style.overflow = ""; });
  afterEach(() => {
    document.body.style.overflow = "";
    HTMLElement.prototype.scrollTo = origScrollTo;
  });

  const SECTION_IDS = ["sec-overview", "sec-price", "sec-location", "sec-presale", "sec-finance", "sec-score"];
  /** @type {Record<string, string>} */
  const TAB_LABELS = { "sec-overview": "종합", "sec-price": "시세", "sec-location": "입지", "sec-presale": "분양", "sec-finance": "금융", "sec-score": "점수" };

  it("소비자 첫 렌더는 종합 탭만 마운트 — 6 칩 순회 클릭 시 각 섹션 마운트 (정보 소실 0 골격)", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    expect(container.querySelector("#sec-overview")).not.toBeNull();
    for (const id of SECTION_IDS.slice(1)) {
      expect(container.querySelector(`#${id}`)).toBeNull();
    }
    for (const id of SECTION_IDS) {
      fireEvent.click(screen.getByRole("button", { name: TAB_LABELS[id] }));
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("소비자 첫 렌더(클릭 0회)에 종합 탭 콘텐츠 가시 — visited 시딩 가드", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    expect(container.querySelector("#sec-overview")).toBeVisible();
    expect(screen.getByText("핵심 지표")).toBeVisible();
  });

  it("탭바 칩 6개(종합/시세/입지/분양/금융/점수)가 모두 렌더됨", () => {
    render(<DetailModal {...makeProps()} />);
    for (const label of ["종합", "시세", "입지", "분양", "금융", "점수"]) {
      const chip = screen.getByRole("button", { name: label });
      expect(chip).toBeInTheDocument();
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
    const priceChip = screen.getByRole("button", { name: "시세" });
    fireEvent.click(priceChip);
    expect(priceChip).toHaveAttribute("aria-current", "true");
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
    const chip = screen.getByRole("button", { name: "입지" });
    expect(() => fireEvent.click(chip)).not.toThrow();
    expect(container.querySelector("#sec-location")).toBeVisible();
  });

  it("keepMounted — 방문 탭은 전환 후 DOM 유지 + hidden, 미방문 탭은 미마운트", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "시세" }));
    fireEvent.click(screen.getByRole("button", { name: "금융" }));
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
    fireEvent.click(screen.getByRole("button", { name: "시세" }));
    expect(screen.getByText("관심매물 추가")).toBeVisible();
    // §6 점수 탭: CatPanel(가격 매력도 라벨) — 세션 408 D2a: DataSections 8섹션은 타 탭 분산, 점수 탭은 순수 점수만
    fireEvent.click(screen.getByRole("button", { name: "점수" }));
    const scoreSection = container.querySelector("#sec-score");
    expect(scoreSection).not.toBeNull();
    expect(scoreSection?.textContent).toContain("가격 매력도");
  });

  // 세션 408 D2a — 공공데이터 재배분: 입지 탭에 교통 상세 섹션, 시세 탭에 시장/투자 지표 헤더
  it("입지 탭에 '교통 상세' 데이터 섹션 헤더가 보인다 (D2a 입지 탭 빈약 해소)", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "입지" }));
    const loc = container.querySelector("#sec-location");
    expect(loc?.textContent).toContain("교통 상세");
    expect(loc?.textContent).toContain("생활인프라 (반경 1km)");
  });

  it("시세 탭에 '시장/투자 지표' 데이터 섹션 헤더가 보인다 (D2a)", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "시세" }));
    const price = container.querySelector("#sec-price");
    expect(price?.textContent).toContain("시장/투자 지표");
  });

  it("점수 탭에 '공공데이터' 단일 토글이 더 이상 없다 (D2a — 8섹션 타 탭 분산)", () => {
    const { container } = render(<DetailModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "점수" }));
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
    fireEvent.click(screen.getByRole("button", { name: "점수" }));
    expect(screen.getAllByText(/★ 중점/).length).toBe(2);
  });

  it("profile 미전달이면 점수 탭에서도 강조 배지 없음(기존 동작 보존)", () => {
    render(<DetailModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "점수" }));
    expect(screen.queryByText(/★ 중점/)).toBeNull();
  });

  it("adminLoggedIn=true 면 클릭 없이 6개 탭 패널 전부 마운트 — 인쇄 전체 펼침 보존", () => {
    const { container } = render(<DetailModal {...makeProps({ adminLoggedIn: true, profile: "live" })} />);
    for (const id of SECTION_IDS) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  // 관리자 인사이트 레이어 게이트 (세션 405 전문가 대시보드 이식)
  it("adminLoggedIn=true 면 점수 산출 과정(AdminScoreBreakdown)이 lazy 렌더된다", async () => {
    render(<DetailModal {...makeProps({ adminLoggedIn: true, profile: "live" })} />);
    expect(await screen.findByTestId("admin-score-breakdown")).toBeInTheDocument();
  });

  it("adminLoggedIn 미전달(기본 false)이면 관리자 블록이 없다 — 소비자 화면 무변경 가드", () => {
    render(<DetailModal {...makeProps()} />);
    expect(screen.queryByTestId("admin-score-breakdown")).toBeNull();
    expect(screen.queryByText("점수 산출 과정 (관리자)")).toBeNull();
  });
});
