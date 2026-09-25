// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FeedbackFab } from "./FeedbackFab";

describe("FeedbackFab (세션574)", () => {
  // 세션 577(A-12): 글자 "의견" → "문의", 이름·툴팁 "문의하기" (문의 모달 = 의견·업체 문의 탭)
  it("문의 버튼이 보이고 누르면 onClick", () => {
    const onClick = vi.fn();
    render(<FeedbackFab onClick={onClick} isDesktop={false} />);
    const btn = screen.getByTestId("feedback-fab");
    expect(screen.getByLabelText("문의하기")).toBe(btn);
    expect(btn.getAttribute("title")).toBe("문의하기");
    expect(btn.tagName).toBe("BUTTON"); // 네이티브 버튼 = Enter·Space 키보드 동작 기본 제공
    expect(btn.textContent).toBe("문의");
    expect(screen.getByText("문의")).toBeTruthy();
    expect(screen.queryByText("의견")).toBeNull();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("z-index 310 — 상세 모달(300) 위, 공유 시트(350)·로그인 모달 아래", () => {
    render(<FeedbackFab onClick={vi.fn()} isDesktop={false} />);
    const btn = /** @type {HTMLElement} */ (screen.getByTestId("feedback-fab"));
    expect(btn.style.position).toBe("fixed");
    expect(btn.style.zIndex).toBe("310");
  });

  it("휴대폰(하단 메뉴 있음)은 메뉴 위 76px + 안전 영역, 데스크톱은 바닥 24px", () => {
    const { unmount } = render(<FeedbackFab onClick={vi.fn()} isDesktop={false} />);
    const mobile = /** @type {HTMLElement} */ (screen.getByTestId("feedback-fab"));
    expect(mobile.getAttribute("style")).toContain("calc(76px + env(safe-area-inset-bottom, 0px))");
    unmount();

    render(<FeedbackFab onClick={vi.fn()} isDesktop />);
    const desktop = /** @type {HTMLElement} */ (screen.getByTestId("feedback-fab"));
    expect(desktop.style.bottom).toBe("24px");
    expect(desktop.style.right).toBe("24px");
  });

  it("휴대폰 상세 모달이 열려 있으면 하단 CTA 바(119px) 위 12px = 131px 로 올라간다", () => {
    const { unmount } = render(<FeedbackFab onClick={vi.fn()} isDesktop={false} detailOpen />);
    expect(screen.getByTestId("feedback-fab").getAttribute("style")).toContain(
      "calc(131px + env(safe-area-inset-bottom, 0px))"
    );
    unmount();
    // 데스크톱은 상세가 열려 있어도 그대로 바닥 24px
    render(<FeedbackFab onClick={vi.fn()} isDesktop detailOpen />);
    expect(/** @type {HTMLElement} */ (screen.getByTestId("feedback-fab")).style.bottom).toBe("24px");
  });
});
