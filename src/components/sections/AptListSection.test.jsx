// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AptListSection } from "./AptListSection";
import { makeScoredItem } from "@/__tests__/factories";

/** @returns {any} */
function makeProps(overrides = {}) {
  return {
    visible: [],
    filteredLength: 0,
    visibleCount: 0,
    onLoadMore: vi.fn(),
    onDetail: vi.fn(),
    onFav: vi.fn(),
    onComp: vi.fn(),
    favoriteSet: new Set(),
    compIds: [],
    pw: { location: 40, product: 20, price: 20, risk: 10, benefit: 5, future: 5 },
    profile: "live",
    isPC: false,
    isDesktop: false,
    isPending: false,
    budgetMin: "",
    budgetMax: "",
    filterRegion: "전체",
    dataLoading: false,
    dataFreshnessText: "",

    ...overrides,
  };
}

describe("AptListSection", () => {
  // 빈 상태 — 결과 없음 메시지
  it("필터된 결과 0건이면 빈 상태 메시지 표시", () => {
    render(<AptListSection {...makeProps()} />);
    expect(screen.getByText("해당 조건에 맞는 미분양 단지가 없습니다")).toBeInTheDocument();
  });

  // 예산으로 빈 결과
  it("예산 필터로 결과 0건이면 예산 관련 빈 메시지", () => {
    render(<AptListSection {...makeProps({ budgetMin: "10" })} />);
    expect(screen.getByText("예산 범위에 맞는 단지가 없습니다")).toBeInTheDocument();
  });

  // 더 보기 버튼 — visibleCount < filteredLength일 때만 표시
  it("더 보기 버튼이 남은 항목이 있을 때만 표시", () => {
    const items = [makeScoredItem({ id: 1 }), makeScoredItem({ id: 2 })];
    render(<AptListSection {...makeProps({ visible: items, filteredLength: 5, visibleCount: 2 })} />);
    const btn = screen.getByText(/더 보기/);
    expect(btn).toBeInTheDocument();
    expect(screen.getByText(/3개 남음/)).toBeInTheDocument();
  });

  it("모든 항목이 보이면 더 보기 버튼 미표시", () => {
    const items = [makeScoredItem({ id: 1 })];
    render(<AptListSection {...makeProps({ visible: items, filteredLength: 1, visibleCount: 1 })} />);
    expect(screen.queryByText(/더 보기/)).toBeNull();
  });

  // 더 보기 클릭 시 콜백
  it("더 보기 클릭 시 onLoadMore 호출", () => {
    const onLoadMore = vi.fn();
    const items = [makeScoredItem({ id: 1 })];
    render(<AptListSection {...makeProps({ visible: items, filteredLength: 3, visibleCount: 1, onLoadMore })} />);
    fireEvent.click(screen.getByText(/더 보기/));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  // 단지 수 표시
  it("filteredLength를 카운트로 표시", () => {
    render(<AptListSection {...makeProps({ filteredLength: 15 })} />);
    expect(screen.getByText(/15개 단지/)).toBeInTheDocument();
  });

  // 데이터 로딩 중이면 빈 상태 미표시
  it("데이터 로딩 중이면 빈 상태 메시지를 표시하지 않음", () => {
    render(<AptListSection {...makeProps({ dataLoading: true })} />);
    expect(screen.queryByText("해당 지역에 미분양 단지가 없습니다")).toBeNull();
  });

  // 지역 필터 — 서울 카드만 렌더링되는지 확인
  it("visible에 서울 아파트만 전달하면 서울 카드만 렌더링", () => {
    const seoulItems = [
      makeScoredItem({ id: 10, name: "서울아파트A", region: "서울" }),
      makeScoredItem({ id: 11, name: "서울아파트B", region: "서울" }),
    ];
    render(<AptListSection {...makeProps({ visible: seoulItems, filteredLength: 2, visibleCount: 2, filterRegion: "서울" })} />);
    expect(screen.getByText(/서울아파트A/)).toBeInTheDocument();
    expect(screen.getByText(/서울아파트B/)).toBeInTheDocument();
    expect(screen.getByText(/2개 단지/)).toBeInTheDocument();
  });

  // 빈 지역 — 0건
  it("존재하지 않는 지역으로 필터하면 빈 상태 표시", () => {
    render(<AptListSection {...makeProps({ visible: [], filteredLength: 0, visibleCount: 0, filterRegion: "제주" })} />);
    expect(screen.getByText("해당 조건에 맞는 미분양 단지가 없습니다")).toBeInTheDocument();
  });

});
