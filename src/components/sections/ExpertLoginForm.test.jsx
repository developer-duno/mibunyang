import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExpertLoginForm } from "./ExpertLoginForm";

// 테스트용 expert 상태 팩토리
function makeExpert(overrides = {}) {
  return {
    authMode: "login",
    authForm: { email: "", password: "", name: "", affiliation: "", phone: "", specialty: "", license: "", experience: "", bio: "" },
    authLoading: false,
    authError: null,
    authStatus: null,
    setAuthMode: vi.fn(),
    setAuthForm: vi.fn(),
    handleExpertSignup: vi.fn(),
    ...overrides,
  };
}

function makeProps(overrides = {}) {
  return {
    expert: makeExpert(),
    onLogin: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
}

describe("ExpertLoginForm", () => {
  // 로그인 모드 기본 렌더링 — 탭 UI 사용
  it("로그인 모드에서 '로그인' 탭이 활성화", () => {
    render(<ExpertLoginForm {...makeProps()} />);
    expect(screen.getByRole("tab", { name: "로그인", selected: true })).toBeInTheDocument();
    expect(screen.getByText("파트너 전문가 전용 대시보드입니다")).toBeInTheDocument();
  });

  // 이메일/비밀번호 입력 필드
  it("이메일과 비밀번호 입력 필드 렌더링", () => {
    render(<ExpertLoginForm {...makeProps()} />);
    expect(screen.getByLabelText("이메일")).toBeInTheDocument();
    expect(screen.getByLabelText("비밀번호")).toBeInTheDocument();
  });

  // 로그인 폼 제출 시 onLogin 호출
  it("로그인 모드에서 폼 제출 시 onLogin 호출", () => {
    const onLogin = vi.fn();
    render(<ExpertLoginForm {...makeProps({ onLogin })} />);
    fireEvent.submit(screen.getByRole("button", { name: "로그인" }).closest("form"));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  // 회원가입 모드
  it("회원가입 모드에서 추가 필드 표시", () => {
    const expert = makeExpert({ authMode: "signup" });
    render(<ExpertLoginForm {...makeProps({ expert })} />);
    expect(screen.getByRole("tab", { name: "회원가입", selected: true })).toBeInTheDocument();
    expect(screen.getByLabelText("이름")).toBeInTheDocument();
    expect(screen.getByLabelText("연락처")).toBeInTheDocument();
    expect(screen.getByLabelText("전문 분야")).toBeInTheDocument();
    expect(screen.getByLabelText(/자기소개/)).toBeInTheDocument();
  });

  // 회원가입 모드에서 비밀번호 라벨에 "8자 이상" 포함
  it("회원가입 모드에서 비밀번호 라벨에 8자 이상 안내", () => {
    const expert = makeExpert({ authMode: "signup" });
    render(<ExpertLoginForm {...makeProps({ expert })} />);
    expect(screen.getByLabelText(/비밀번호 \(8자 이상\)/)).toBeInTheDocument();
  });

  // 회원가입 폼 제출 시 handleExpertSignup 호출
  it("회원가입 모드에서 폼 제출 시 handleExpertSignup 호출", () => {
    const handleExpertSignup = vi.fn();
    const expert = makeExpert({ authMode: "signup", handleExpertSignup });
    render(<ExpertLoginForm {...makeProps({ expert })} />);
    fireEvent.submit(screen.getByRole("button", { name: "회원가입" }).closest("form"));
    expect(handleExpertSignup).toHaveBeenCalledTimes(1);
  });

  // 로딩 상태
  it("로딩 중이면 버튼이 '처리 중...'으로 변경되고 disabled", () => {
    const expert = makeExpert({ authLoading: true });
    render(<ExpertLoginForm {...makeProps({ expert })} />);
    const submitBtn = screen.getByText("처리 중...");
    expect(submitBtn).toBeDisabled();
  });

  // 에러 메시지 표시
  it("authError가 있으면 에러 메시지 표시", () => {
    const expert = makeExpert({ authError: "이메일 또는 비밀번호가 틀렸습니다" });
    render(<ExpertLoginForm {...makeProps({ expert })} />);
    expect(screen.getByText("이메일 또는 비밀번호가 틀렸습니다")).toBeInTheDocument();
  });

  // 승인 대기 상태
  it("authStatus=pending일 때 대기 메시지 표시", () => {
    const expert = makeExpert({ authStatus: "pending" });
    render(<ExpertLoginForm {...makeProps({ expert })} />);
    expect(screen.getByText("승인 대기중")).toBeInTheDocument();
  });

  // 승인 거부 상태
  it("authStatus=rejected일 때 거부 메시지 표시", () => {
    const expert = makeExpert({ authStatus: "rejected" });
    render(<ExpertLoginForm {...makeProps({ expert })} />);
    expect(screen.getByText("승인 거부")).toBeInTheDocument();
  });

  // 탭 전환 — 로그인 모드에서 회원가입 탭 클릭
  it("로그인 모드에서 회원가입 탭 클릭 시 setAuthMode 호출", () => {
    const expert = makeExpert();
    render(<ExpertLoginForm {...makeProps({ expert })} />);
    const signupTab = screen.getByRole("tab", { name: "회원가입" });
    expect(signupTab).toBeInTheDocument();
    fireEvent.click(signupTab);
    expect(expert.setAuthMode).toHaveBeenCalledWith("signup");
  });

  // 탭 전환 — 회원가입 모드에서 로그인 탭 클릭
  it("회원가입 모드에서 로그인 탭 클릭 시 setAuthMode 호출", () => {
    const expert = makeExpert({ authMode: "signup" });
    render(<ExpertLoginForm {...makeProps({ expert })} />);
    const loginTab = screen.getByRole("tab", { name: "로그인" });
    expect(loginTab).toBeInTheDocument();
    fireEvent.click(loginTab);
    expect(expert.setAuthMode).toHaveBeenCalledWith("login");
  });

  // 돌아가기 버튼
  it("돌아가기 클릭 시 onBack 호출", () => {
    const onBack = vi.fn();
    render(<ExpertLoginForm {...makeProps({ onBack })} />);
    fireEvent.click(screen.getByText("돌아가기"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  // bio 글자 수 카운트 (회원가입 모드)
  it("회원가입 모드에서 bio 글자 수 표시", () => {
    const expert = makeExpert({ authMode: "signup", authForm: { ...makeExpert().authForm, bio: "테스트 소개글입니다" } });
    render(<ExpertLoginForm {...makeProps({ expert })} />);
    expect(screen.getByText("10/500")).toBeInTheDocument();
  });
});
