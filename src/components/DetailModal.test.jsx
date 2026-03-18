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
    const overlay = container.firstChild;
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
    expect(screen.getByText("경기 수원시")).toBeInTheDocument();
  });
});
