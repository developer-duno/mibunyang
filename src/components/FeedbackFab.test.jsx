// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FeedbackFab } from "./FeedbackFab";

describe("FeedbackFab (세션574)", () => {
  it("의견 보내기 버튼이 보이고 누르면 onClick", () => {
    const onClick = vi.fn();
    render(<FeedbackFab onClick={onClick} isDesktop={false} />);
    const btn = screen.getByTestId("feedback-fab");
    expect(btn.getAttribute("aria-label")).toBe("의견 보내기");
    expect(btn.tagName).toBe("BUTTON"); // 네이티브 버튼 = Enter·Space 키보드 동작 기본 제공
    expect(btn.textContent).toContain("의견");
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

  it("지도 탭은 현위치 버튼을 피해 52px 더 위로", () => {
    const { unmount } = render(<FeedbackFab onClick={vi.fn()} isDesktop liftForMap />);
    expect(/** @type {HTMLElement} */ (screen.getByTestId("feedback-fab")).style.bottom).toBe("76px");
    unmount();
    render(<FeedbackFab onClick={vi.fn()} isDesktop={false} liftForMap />);
    expect(screen.getByTestId("feedback-fab").getAttribute("style")).toContain("calc(128px + env(");
  });
});
