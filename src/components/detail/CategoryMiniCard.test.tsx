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
    render(<CategoryMiniCard k="price" cat={mk({ label: "가격 매력도", total: 40, fairPrice: 50000, deviation: "12.3" })} onJump={vi.fn()} />);
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
