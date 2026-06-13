import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HelpHint } from "./HelpHint";

// 세션 411 — ? 도움말 래퍼. Tooltip(클릭/탭 toggle) + IconHelp 재사용.
describe("HelpHint", () => {
  it("text 가 있으면 ? 트리거 렌더 (aria-label 에 label 반영)", () => {
    render(<HelpHint text="설명문" label="평균분양가격" />);
    // Tooltip 의 aria-label = "{term} 풀이 보기" → label 전달로 동음 해소
    expect(screen.getByLabelText("평균분양가격 풀이 보기")).toBeInTheDocument();
  });

  it("클릭 시 설명 텍스트(role=tooltip) 표시", () => {
    render(<HelpHint text="이건 설명이에요" label="지표" />);
    expect(screen.queryByRole("tooltip")).toBeNull(); // 기본 닫힘
    fireEvent.click(screen.getByLabelText("지표 풀이 보기"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("이건 설명이에요");
  });

  it("text 가 비면 null (도움말 미정의 → 자동 미표시)", () => {
    const { container } = render(<HelpHint text="" label="없음" />);
    expect(container.innerHTML).toBe("");
  });
});
