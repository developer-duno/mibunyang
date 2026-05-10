// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ShareSheet } from "./ShareSheet";

/** @returns {any} */
function makeProps(overrides = {}) {
  return {
    open: true,
    onKakao: vi.fn(),
    onSMS: vi.fn(),
    onCopy: vi.fn(),
    onClose: vi.fn(),
    isMobile: false,
    isPC: false,
    ...overrides,
  };
}

describe("ShareSheet", () => {
  // open=false이면 아무것도 렌더링하지 않는다
  it("open=false → null", () => {
    const { container } = render(<ShareSheet {...makeProps({ open: false })} />);
    expect(container.innerHTML).toBe("");
  });

  // open=true이면 공유하기 제목과 버튼을 표시한다
  it("open=true → 공유하기 제목 + 카카오톡/링크복사 버튼", () => {
    render(<ShareSheet {...makeProps()} />);
    expect(screen.getByText("공유하기")).toBeTruthy();
    expect(screen.getByLabelText("카카오톡으로 공유")).toBeTruthy();
    expect(screen.getByLabelText("링크 복사")).toBeTruthy();
  });

  // 카카오톡 버튼 클릭 시 onKakao 호출
  it("카카오톡 버튼 클릭 → onKakao 호출", () => {
    const onKakao = vi.fn();
    render(<ShareSheet {...makeProps({ onKakao })} />);
    fireEvent.click(screen.getByLabelText("카카오톡으로 공유"));
    expect(onKakao).toHaveBeenCalledOnce();
  });

  // isMobile=true이면 문자 버튼 표시, false이면 미표시
  it("isMobile=true → 문자 버튼 표시 / false → 미표시", () => {
    const { rerender } = render(<ShareSheet {...makeProps({ isMobile: false })} />);
    expect(screen.queryByLabelText("문자로 공유")).toBeNull();

    rerender(<ShareSheet {...makeProps({ isMobile: true })} />);
    expect(screen.getByLabelText("문자로 공유")).toBeTruthy();
  });

  // Escape 키 입력 시 onClose 호출
  it("Escape 키 → onClose 호출", () => {
    const onClose = vi.fn();
    render(<ShareSheet {...makeProps({ onClose })} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
