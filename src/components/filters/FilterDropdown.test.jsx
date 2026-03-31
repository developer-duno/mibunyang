import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FilterDropdown } from "./FilterDropdown";

/* 테스트용 기본 props 팩토리 */
function makeProps(overrides = {}) {
  return {
    isOpen: true,
    label: "지역",
    isDesktop: false,
    children: <span data-testid="child">패널 내용</span>,
    ...overrides,
  };
}

describe("FilterDropdown", () => {
  // isOpen=false → 아무것도 렌더링하지 않음
  it("isOpen=false이면 렌더링하지 않음", () => {
    const { container } = render(<FilterDropdown {...makeProps({ isOpen: false })} />);
    expect(container.innerHTML).toBe("");
  });

  // isOpen=true → children 렌더링
  it("isOpen=true이면 children 렌더링", () => {
    render(<FilterDropdown {...makeProps()} />);
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  // aria-label="{label} 필터" 속성
  it('aria-label이 "{label} 필터" 형태', () => {
    render(<FilterDropdown {...makeProps({ label: "금액" })} />);
    expect(screen.getByRole("region")).toHaveAttribute("aria-label", "금액 필터");
  });

  // role="region" 속성
  it("role=region 속성이 있음", () => {
    render(<FilterDropdown {...makeProps()} />);
    expect(screen.getByRole("region")).toBeInTheDocument();
  });

  // isDesktop=true → padding 14px
  it("isDesktop=true이면 padding 14px", () => {
    render(<FilterDropdown {...makeProps({ isDesktop: true })} />);
    expect(screen.getByRole("region").style.padding).toBe("14px");
  });

  // isDesktop=false → padding 10px
  it("isDesktop=false이면 padding 10px", () => {
    render(<FilterDropdown {...makeProps({ isDesktop: false })} />);
    expect(screen.getByRole("region").style.padding).toBe("10px");
  });
});
