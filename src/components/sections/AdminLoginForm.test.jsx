// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AdminLoginForm } from "./AdminLoginForm";

// 세션 405: 구 ExpertLoginForm.test 대체 — 관리자 전용 폼 (가입 tablist·카카오 절·승인 배너 제거)

function makeAuth(overrides = {}) {
  return {
    authForm: { email: "", password: "" },
    authLoading: false,
    authError: null,
    setAuthForm: vi.fn(),
    ...overrides,
  };
}

describe("AdminLoginForm", () => {
  it("관리자 로그인 폼(이메일·비밀번호·제출)을 렌더링한다", () => {
    render(<AdminLoginForm auth={/** @type {any} */ (makeAuth())} onLogin={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText("관리자 전용 로그인입니다")).toBeTruthy();
    expect(screen.getByLabelText("이메일")).toBeTruthy();
    expect(screen.getByLabelText("비밀번호")).toBeTruthy();
    expect(screen.getByRole("button", { name: "로그인" })).toBeTruthy();
    // e2e admin.spec 셀렉터 계약: input[type=email]/[type=password]/button[type=submit]
    expect(document.querySelector('input[type="email"]')).not.toBeNull();
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
    expect(document.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it("가입 탭·카카오 버튼이 없다 (전문가 가입 폐지 가드)", () => {
    render(<AdminLoginForm auth={/** @type {any} */ (makeAuth())} onLogin={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByText("회원가입")).toBeNull();
    expect(screen.queryByText(/카카오로 시작하기/)).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("폼 제출 시 onLogin 이 호출된다", () => {
    const onLogin = vi.fn();
    render(<AdminLoginForm auth={/** @type {any} */ (makeAuth())} onLogin={onLogin} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it("authError 가 있으면 에러 배너를 표시한다", () => {
    render(<AdminLoginForm auth={/** @type {any} */ (makeAuth({ authError: "이메일 또는 비밀번호가 일치하지 않습니다" }))} onLogin={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText("이메일 또는 비밀번호가 일치하지 않습니다")).toBeTruthy();
  });

  it("authLoading 이면 제출 버튼이 비활성·'처리 중...' 표시", () => {
    render(<AdminLoginForm auth={/** @type {any} */ (makeAuth({ authLoading: true }))} onLogin={vi.fn()} onBack={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "처리 중..." });
    expect(/** @type {HTMLButtonElement} */ (btn).disabled).toBe(true);
  });

  it("돌아가기 클릭 시 onBack 호출", () => {
    const onBack = vi.fn();
    render(<AdminLoginForm auth={/** @type {any} */ (makeAuth())} onLogin={vi.fn()} onBack={onBack} />);
    fireEvent.click(screen.getByText("돌아가기"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
