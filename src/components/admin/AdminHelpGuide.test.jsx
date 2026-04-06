import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AdminHelpGuide } from "./AdminHelpGuide";

function makeProps(overrides = {}) {
  return { open: true, onClose: vi.fn(), ...overrides };
}

describe("AdminHelpGuide", () => {
  // open=false이면 아무것도 렌더링하지 않는다
  it("open=false → null", () => {
    const { container } = render(<AdminHelpGuide {...makeProps({ open: false })} />);
    expect(container.innerHTML).toBe("");
  });

  // open=true이면 제목을 표시한다
  it("open=true → 관리자 도움말 제목 표시", () => {
    render(<AdminHelpGuide {...makeProps()} />);
    expect(screen.getByText("관리자 도움말")).toBeTruthy();
  });

  // 닫기 버튼 클릭 시 onClose 호출
  it("닫기 버튼 클릭 → onClose 호출", () => {
    const onClose = vi.fn();
    render(<AdminHelpGuide {...makeProps({ onClose })} />);
    fireEvent.click(screen.getByText("닫기"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
