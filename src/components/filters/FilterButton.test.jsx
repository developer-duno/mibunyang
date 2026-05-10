// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterButton } from "./FilterButton";

/* 테스트용 기본 props 팩토리 */
/** @returns {any} */
function makeProps(overrides = {}) {
  return {
    label: "지역",
    summary: "",
    isOpen: false,
    isActive: false,
    onClick: vi.fn(),
    ...overrides,
  };
}

describe("FilterButton", () => {
  // 기본 렌더링 — label 텍스트 표시
  it("label 텍스트가 렌더링됨", () => {
    render(<FilterButton {...makeProps()} />);
    expect(screen.getByRole("button")).toHaveTextContent("지역");
  });

  // summary가 있을 때 ": {summary}" 표시
  it("summary가 있으면 label: summary 형태로 표시", () => {
    render(<FilterButton {...makeProps({ summary: "서울" })} />);
    expect(screen.getByRole("button")).toHaveTextContent("지역: 서울");
  });

  // summary가 없으면 label만 표시 (콜론 없음)
  it("summary가 없으면 콜론 없이 label만 표시", () => {
    render(<FilterButton {...makeProps({ summary: "" })} />);
    const text = screen.getByRole("button").textContent;
    expect(text).not.toContain(":");
  });

  // aria-expanded 속성 — isOpen=true
  it("isOpen=true이면 aria-expanded=true", () => {
    render(<FilterButton {...makeProps({ isOpen: true })} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });

  // aria-expanded 속성 — isOpen=false
  it("isOpen=false이면 aria-expanded=false", () => {
    render(<FilterButton {...makeProps({ isOpen: false })} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  // onClick 콜백 호출
  it("클릭 시 onClick 콜백 호출", () => {
    const onClick = vi.fn();
    render(<FilterButton {...makeProps({ onClick })} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // isActive=true — fontWeight 700 적용
  it("isActive=true이면 fontWeight 700", () => {
    render(<FilterButton {...makeProps({ isActive: true })} />);
    expect(screen.getByRole("button").style.fontWeight).toBe("700");
  });

  // isActive=false, isOpen=false — fontWeight 500
  it("비활성 상태면 fontWeight 500", () => {
    render(<FilterButton {...makeProps({ isActive: false, isOpen: false })} />);
    expect(screen.getByRole("button").style.fontWeight).toBe("500");
  });
});
