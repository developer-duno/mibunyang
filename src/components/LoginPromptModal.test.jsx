import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoginPromptModal } from "./LoginPromptModal";

// @vercel/analytics 모킹
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));
import { track } from "@vercel/analytics";

function makeProps(overrides = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    onKakaoLogin: vi.fn(),
    onExpertLogin: vi.fn(),
    kakaoLoading: false,
    trigger: "detail",
    ...overrides,
  };
}

describe("LoginPromptModal", () => {
  beforeEach(() => { track.mockClear(); });

  // open=false → 렌더링 없음
  it("open=false → null", () => {
    const { container } = render(<LoginPromptModal {...makeProps({ open: false })} />);
    expect(container.innerHTML).toBe("");
  });

  // open=true → login_prompt_shown 이벤트 발생
  it("open=true → login_prompt_shown 이벤트 + trigger 전달", () => {
    render(<LoginPromptModal {...makeProps({ trigger: "map" })} />);
    expect(track).toHaveBeenCalledWith("login_prompt_shown", { trigger: "map" });
  });

  // 카카오 버튼 클릭 → 이벤트 + 콜백
  it("카카오 버튼 클릭 → login_prompt_kakao_click + onKakaoLogin", () => {
    const onKakaoLogin = vi.fn();
    render(<LoginPromptModal {...makeProps({ onKakaoLogin })} />);
    track.mockClear();
    fireEvent.click(screen.getByText("카카오로 시작하기"));
    expect(track).toHaveBeenCalledWith("login_prompt_kakao_click", { trigger: "detail" });
    expect(onKakaoLogin).toHaveBeenCalledOnce();
  });

  // 전문가 로그인 클릭 → 이벤트 + 콜백
  it("전문가 로그인 클릭 → login_prompt_expert_click + onExpertLogin", () => {
    const onExpertLogin = vi.fn();
    render(<LoginPromptModal {...makeProps({ onExpertLogin })} />);
    track.mockClear();
    fireEvent.click(screen.getByText("전문가 계정으로 로그인"));
    expect(track).toHaveBeenCalledWith("login_prompt_expert_click", { trigger: "detail" });
    expect(onExpertLogin).toHaveBeenCalledOnce();
  });

  // 나중에 하기 클릭 → dismiss 이벤트 + onClose
  it("나중에 하기 클릭 → login_prompt_dismissed + onClose", () => {
    const onClose = vi.fn();
    render(<LoginPromptModal {...makeProps({ onClose })} />);
    track.mockClear();
    fireEvent.click(screen.getByText("나중에 하기"));
    expect(track).toHaveBeenCalledWith("login_prompt_dismissed", { trigger: "detail" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  // trigger 미전달 시 "unknown" 기본값
  it("trigger 미전달 → 'unknown' 기본값", () => {
    render(<LoginPromptModal {...makeProps({ trigger: undefined })} />);
    expect(track).toHaveBeenCalledWith("login_prompt_shown", { trigger: "unknown" });
  });
});
