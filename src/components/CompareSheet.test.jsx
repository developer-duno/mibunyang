import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CompareSheet } from "./CompareSheet";
import { makeScoredItem } from "@/__tests__/factories";

function makeItem(id, name, total = 75) {
  return makeScoredItem(
    { id, name, region: "경기", gu: "수원시", price: 50000 },
    {
      total,
      cats: {
        price: { label: "가격 매력도", total: 70, subs: [] },
        location: { label: "입지·생활권", total: 80, subs: [] },
        product: { label: "상품성", total: 65, subs: [] },
        benefit: { label: "혜택·할인", total: 60, totalWon: 1000, subs: [] },
        risk: { label: "안전도", total: 85, subs: [] },
        future: { label: "미래가치", total: 72, subs: [] },
      },
    }
  );
}

describe("CompareSheet", () => {
  // 2개 미만이면 null 반환
  it("items가 1개면 아무것도 렌더링하지 않음", () => {
    const { container } = render(<CompareSheet items={[makeItem(1, "아파트A")]} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("items가 0개면 아무것도 렌더링하지 않음", () => {
    const { container } = render(<CompareSheet items={[]} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  // 2개 이상이면 비교 테이블 렌더링
  it("2개 이상이면 비교 분석 제목 표시", () => {
    const items = [makeItem(1, "아파트A"), makeItem(2, "아파트B")];
    render(<CompareSheet items={items} onClose={vi.fn()} />);
    expect(screen.getByText("비교 분석")).toBeInTheDocument();
  });

  // 아파트 이름 표시 (마지막 단어만 사용)
  it("아파트 이름이 테이블 헤더에 표시", () => {
    const items = [makeItem(1, "힐스테이트 수원"), makeItem(2, "래미안 판교")];
    render(<CompareSheet items={items} onClose={vi.fn()} />);
    expect(screen.getByText("수원")).toBeInTheDocument();
    expect(screen.getByText("판교")).toBeInTheDocument();
  });

  // 종합 점수 표시
  it("종합 점수가 표시됨", () => {
    const items = [makeItem(1, "A", 82), makeItem(2, "B", 63)];
    render(<CompareSheet items={items} onClose={vi.fn()} />);
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("63")).toBeInTheDocument();
  });

  // 최고 점수에 '최고' 하이라이트
  it("최고 종합 점수에 '최고' 라벨 표시", () => {
    const items = [makeItem(1, "A", 80), makeItem(2, "B", 65)];
    render(<CompareSheet items={items} onClose={vi.fn()} />);
    expect(screen.getByText("최고")).toBeInTheDocument();
  });

  // 닫기 버튼
  it("닫기 버튼 클릭 시 onClose 호출", () => {
    const onClose = vi.fn();
    const items = [makeItem(1, "A"), makeItem(2, "B")];
    render(<CompareSheet items={items} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("비교 닫기"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 공유 버튼 (onShare 제공 시)
  it("onShare 제공 시 공유 버튼 표시", () => {
    const items = [makeItem(1, "A"), makeItem(2, "B")];
    render(<CompareSheet items={items} onShare={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText("비교 결과 공유하기")).toBeInTheDocument();
  });

  it("onShare 미제공 시 공유 버튼 미표시", () => {
    const items = [makeItem(1, "A"), makeItem(2, "B")];
    render(<CompareSheet items={items} onClose={vi.fn()} />);
    expect(screen.queryByLabelText("비교 결과 공유하기")).toBeNull();
  });

  // 카테고리별 점수 행 표시
  it("카테고리별 점수 행이 표시됨", () => {
    const items = [makeItem(1, "A"), makeItem(2, "B")];
    render(<CompareSheet items={items} onClose={vi.fn()} />);
    expect(screen.getByText("종합")).toBeInTheDocument();
    expect(screen.getByText("분양가")).toBeInTheDocument();
    expect(screen.getByText("총혜택")).toBeInTheDocument();
    expect(screen.getByText("규제현황")).toBeInTheDocument();
    expect(screen.getByText("LTV한도")).toBeInTheDocument();
    expect(screen.getByText("필요자본")).toBeInTheDocument();
  });

  // 3개 비교
  it("3개 아이템도 정상 렌더링", () => {
    const items = [makeItem(1, "A", 80), makeItem(2, "B", 70), makeItem(3, "C", 60)];
    render(<CompareSheet items={items} onClose={vi.fn()} />);
    const headers = screen.getAllByRole("columnheader");
    // 항목 헤더(1) + 아파트 3개 = 4
    expect(headers).toHaveLength(4);
  });
});
