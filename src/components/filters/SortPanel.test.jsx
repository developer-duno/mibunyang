// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SortPanel } from "./SortPanel";
import { SORT_OPTIONS } from "@/constants/sortOptions";

/* 테스트용 기본 props 팩토리 */
/** @returns {any} */
function makeProps(overrides = {}) {
  return {
    sortKey: "total",
    onSortChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe("SortPanel", () => {
  // SORT_OPTIONS 개수만큼 버튼 렌더링
  it("SORT_OPTIONS 개수만큼 버튼 렌더링", () => {
    render(<SortPanel {...makeProps()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(SORT_OPTIONS.length);
  });

  // 각 버튼에 mobileLabel 표시
  it("각 버튼에 mobileLabel 텍스트 표시", () => {
    render(<SortPanel {...makeProps()} />);
    SORT_OPTIONS.forEach((opt) => {
      expect(screen.getByText(opt.mobileLabel)).toBeInTheDocument();
    });
  });

  // 선택된 정렬 키에 aria-current="true"
  it('선택된 정렬 키에 aria-current="true"', () => {
    render(<SortPanel {...makeProps({ sortKey: "price" })} />);
    const priceBtn = screen.getByText("저가순");
    expect(priceBtn.closest("button")).toHaveAttribute("aria-current", "true");
  });

  // 미선택 항목에 aria-current 없음
  it("미선택 항목에 aria-current 속성 없음", () => {
    render(<SortPanel {...makeProps({ sortKey: "total" })} />);
    const priceBtn = screen.getByText("저가순");
    expect(priceBtn.closest("button")).not.toHaveAttribute("aria-current");
  });

  // 클릭 시 onSortChange + onClose 동시 호출
  it("클릭 시 onSortChange + onClose 호출", () => {
    const onSortChange = vi.fn();
    const onClose = vi.fn();
    render(<SortPanel {...makeProps({ onSortChange, onClose })} />);
    fireEvent.click(screen.getByText("저가순"));
    expect(onSortChange).toHaveBeenCalledWith("price");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
