// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TopPicksWidget } from "./TopPicksWidget";

/** 최소 ScoredApt — AptCard 무가드 접근 지점(res.total/res.cats 6키의 label·total·subs) 충족 */
function makeScored(id, name, total) {
  const cat = (label, t) => ({ label, total: t, subs: [] });
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
  isLoggedIn: true, isDesktop: false, isPC: false, onExpand: vi.fn(),
});

describe("TopPicksWidget", () => {
  const scored = [makeScored("a1", "일위단지", 90), makeScored("a2", "이위단지", 80), makeScored("a3", "삼위단지", 70), makeScored("a4", "사위단지", 60)];

  it("점수 내림차순 상위 3개만 렌더", () => {
    render(<TopPicksWidget {...baseProps()} scored={[...scored].reverse()} />);
    expect(screen.getByText(/일위단지/)).toBeInTheDocument();
    expect(screen.getByText(/삼위단지/)).toBeInTheDocument();
    expect(screen.queryByText(/사위단지/)).toBeNull();
  });
  it("비로그인: 점수 '??' 블라인드 (isLoggedIn 명시 전달 — 기본값 true 함정 가드)", () => {
    render(<TopPicksWidget {...baseProps()} isLoggedIn={false} scored={scored} />);
    expect(screen.getAllByText("??").length).toBeGreaterThanOrEqual(1);
  });
  it("빈 scored: 빈 상태 문구", () => {
    render(<TopPicksWidget {...baseProps()} scored={[]} />);
    expect(screen.getByText("표시할 단지가 없습니다")).toBeInTheDocument();
  });
  it("'전체 목록' 펼치기 클릭 → onExpand", () => {
    const props = baseProps();
    render(<TopPicksWidget {...props} scored={scored} />);
    fireEvent.click(screen.getByRole("button", { name: /전체 목록/ }));
    expect(props.onExpand).toHaveBeenCalledTimes(1);
  });
});
