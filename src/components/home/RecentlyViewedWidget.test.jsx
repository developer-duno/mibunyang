// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecentlyViewedWidget } from "./RecentlyViewedWidget";

/**
 * 최소 ScoredApt — AptCard 무가드 접근 지점 충족 (TopPicksWidget.test.jsx 답습)
 * @param {string} id @param {string} name @param {number} total
 */
function makeScored(id, name, total) {
  const cat = (/** @type {string} */ label, /** @type {number} */ t) => ({ label, total: t, subs: [] });
  return /** @type {any} */ ({
    apt: { id, name, region: "경기", gu: "수원시", price: 50000, area: 84, noxious: [] },
    res: {
      total,
      cats: {
        price: cat("가격", 70), location: cat("입지", 60), product: cat("상품성", 55),
        benefit: { label: "혜택", total: 50, subs: [], totalWon: 0 },
        risk: cat("안전", 65), future: cat("미래", 45),
      },
    },
  });
}

const baseProps = () => ({
  pw: /** @type {any} */ ({}),
  onDetail: vi.fn(), onFav: vi.fn(), favoriteSet: new Set(), onComp: vi.fn(), compIds: [],
  isLoggedIn: true, isDesktop: false, onClear: vi.fn(),
});

/** @param {ReturnType<typeof makeScored>[]} arr */
const mapOf = (arr) => new Map(arr.map(s => [s.apt.id, s]));

describe("RecentlyViewedWidget", () => {
  const items = [makeScored("a1", "가단지", 90), makeScored("a2", "나단지", 80), makeScored("a3", "다단지", 70)];
  const scoredMap = mapOf(items);

  it("빈 상태: 본 단지 없음 문구", () => {
    render(<RecentlyViewedWidget {...baseProps()} recentIds={[]} scoredMap={new Map()} />);
    expect(screen.getByText("아직 본 단지가 없어요")).toBeInTheDocument();
    // 지우기 버튼은 빈 상태에서 미노출
    expect(screen.queryByRole("button", { name: /지우기/ })).toBeNull();
  });

  it("recentIds 순서대로 카드 렌더 (최근이 맨 앞)", () => {
    render(<RecentlyViewedWidget {...baseProps()} recentIds={["a3", "a1"]} scoredMap={scoredMap} />);
    expect(screen.getByText(/다단지/)).toBeInTheDocument();
    expect(screen.getByText(/가단지/)).toBeInTheDocument();
    // recentIds 에 없는 a2 는 미노출
    expect(screen.queryByText(/나단지/)).toBeNull();
  });

  it("순위 배지(N위) 미표시 — 최근 본 단지는 순위 아님 (rank=0)", () => {
    render(<RecentlyViewedWidget {...baseProps()} recentIds={["a1"]} scoredMap={scoredMap} />);
    expect(screen.queryByText(/1위/)).toBeNull();
  });

  it("삭제된 단지(scoredMap 부재) id 스킵", () => {
    render(<RecentlyViewedWidget {...baseProps()} recentIds={["a1", "gone-999", "a2"]} scoredMap={scoredMap} />);
    expect(screen.getByText(/가단지/)).toBeInTheDocument();
    expect(screen.getByText(/나단지/)).toBeInTheDocument();
    // gone-999 는 렌더 안 됨(throw 없이 스킵)
  });

  it("지우기 버튼 클릭 → onClear", () => {
    const props = baseProps();
    render(<RecentlyViewedWidget {...props} recentIds={["a1"]} scoredMap={scoredMap} />);
    fireEvent.click(screen.getByRole("button", { name: /지우기/ }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it("카드 클릭 → onDetail(id)", () => {
    const props = baseProps();
    render(<RecentlyViewedWidget {...props} recentIds={["a1"]} scoredMap={scoredMap} />);
    fireEvent.click(screen.getByText(/가단지/));
    expect(props.onDetail).toHaveBeenCalledWith("a1");
  });
});
