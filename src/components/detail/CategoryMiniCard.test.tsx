import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CategoryMiniCard } from "./CategoryMiniCard";
import type { Res } from "@/types/scoring";

// 세션 409 D2b — 종합 탭 카테고리 미니카드.
function mk(over: Partial<Res> = {}): Res {
  return { total: 80, label: "입지·생활권", subs: [], ...over };
}

describe("CategoryMiniCard", () => {
  it("SHORT_LABEL 은 cat.label(한글) 키로 인덱싱 — '입지·생활권' → '입지'", () => {
    render(<CategoryMiniCard k="location" cat={mk()} onJump={vi.fn()} />);
    expect(screen.getByText("입지")).toBeInTheDocument();
  });

  it("SHORT_LABEL 미스 시 cat.label 폴백", () => {
    render(<CategoryMiniCard k="x" cat={mk({ label: "알수없는라벨" })} onJump={vi.fn()} />);
    expect(screen.getByText("알수없는라벨")).toBeInTheDocument();
  });

  it("점수와 등급 배지 표시 (80점 → A)", () => {
    render(<CategoryMiniCard k="location" cat={mk({ total: 80 })} onJump={vi.fn()} />);
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("결론 1줄(catVerdict) 표시 — 입지 80점 → '입지 우수'", () => {
    render(<CategoryMiniCard k="location" cat={mk({ total: 80 })} onJump={vi.fn()} />);
    expect(screen.getByText("입지 우수")).toBeInTheDocument();
  });

  it("price 카테고리는 deviation 실측 결론", () => {
    render(
      <CategoryMiniCard
        k="price"
        cat={mk({ label: "가격 매력도", total: 40, fairPrice: 50000, deviation: "12.3" })}
        onJump={vi.fn()}
      />
    );
    expect(screen.getByText("적정가 대비 12% 저렴")).toBeInTheDocument();
  });

  it("클릭 시 onJump 호출", () => {
    const onJump = vi.fn();
    render(<CategoryMiniCard k="location" cat={mk()} onJump={onJump} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it("Enter/Space 키로 onJump 호출 (키보드 접근성)", () => {
    const onJump = vi.fn();
    render(<CategoryMiniCard k="location" cat={mk()} onJump={onJump} />);
    const card = screen.getByRole("button");
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(onJump).toHaveBeenCalledTimes(2);
  });

  it("emphasized=true 면 '중점' 칩 노출 (단 '★ 중점' 아님 — 점수 탭 카운트와 분리)", () => {
    render(<CategoryMiniCard k="location" cat={mk()} emphasized onJump={vi.fn()} />);
    expect(screen.getByText("중점")).toBeInTheDocument();
    expect(screen.queryByText(/★ 중점/)).toBeNull();
  });

  it("emphasized 미전달 시 '중점' 칩 없음", () => {
    render(<CategoryMiniCard k="location" cat={mk()} onJump={vi.fn()} />);
    expect(screen.queryByText("중점")).toBeNull();
  });

  it("aria-label 에 카테고리·점수·등급·결론 포함", () => {
    render(<CategoryMiniCard k="location" cat={mk({ total: 80 })} onJump={vi.fn()} />);
    const card = screen.getByRole("button");
    expect(card.getAttribute("aria-label")).toContain("입지");
    expect(card.getAttribute("aria-label")).toContain("80점");
    expect(card.getAttribute("aria-label")).toContain("입지 우수");
  });
});

// 비로그인 점수 블라인드 (단계 2-A). blind 기본값 false = 위 describe 전체가 그대로 통과 = 화면 변화 0.
describe("CategoryMiniCard — blind (비로그인 점수 블라인드)", () => {
  it("blind 미전달(기본 false)이면 점수·등급·결론 그대로 (회귀 가드)", () => {
    render(<CategoryMiniCard k="location" cat={mk({ total: 80 })} onJump={vi.fn()} />);
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("입지 우수")).toBeInTheDocument();
    expect(screen.queryByText("??")).toBeNull();
  });

  it("blind=true 면 점수 숫자가 뿌연 '??' 로 바뀐다", () => {
    render(<CategoryMiniCard k="location" cat={mk({ total: 80 })} onJump={vi.fn()} blind />);
    expect(screen.queryByText("80")).toBeNull();
    const q = screen.getByText("??");
    expect(q.style.filter).toContain("blur");
    // 뿌옇게 만든 물음표는 장식 — 스크린리더엔 카드 aria-label 이 정책을 1회 설명한다(세션 463 답습)
    expect(q).toHaveAttribute("aria-hidden", "true");
  });

  it("blind=true 면 등급 배지·결론 1줄도 사라진다 (점수를 글자로 흘리지 않게)", () => {
    render(<CategoryMiniCard k="location" cat={mk({ total: 80 })} onJump={vi.fn()} blind />);
    expect(screen.queryByText("A")).toBeNull();
    expect(screen.queryByText("입지 우수")).toBeNull();
  });

  it("blind=true 면 price 결론(적정가 괴리)도 미노출 — 그 값은 핵심지표 행에 남는다", () => {
    render(
      <CategoryMiniCard
        k="price"
        cat={mk({ label: "가격 매력도", total: 40, fairPrice: 50000, deviation: "12.3" })}
        onJump={vi.fn()}
        blind
      />
    );
    expect(screen.queryByText("적정가 대비 12% 저렴")).toBeNull();
  });

  it("blind=true 면 aria-label 이 점수 대신 비공개 사유를 읽어준다", () => {
    render(<CategoryMiniCard k="location" cat={mk({ total: 80 })} onJump={vi.fn()} blind />);
    const label = screen.getByRole("button").getAttribute("aria-label") ?? "";
    expect(label).toContain("입지");
    expect(label).toContain("점수 비공개 — 로그인 후 확인 가능");
    expect(label).not.toContain("80");
  });

  it("blind=true 여도 카테고리 라벨·중점 칩·클릭 점프는 그대로", () => {
    const onJump = vi.fn();
    render(<CategoryMiniCard k="location" cat={mk({ total: 80 })} emphasized onJump={onJump} blind />);
    expect(screen.getByText("입지")).toBeInTheDocument();
    expect(screen.getByText("중점")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onJump).toHaveBeenCalledTimes(1);
  });
});
