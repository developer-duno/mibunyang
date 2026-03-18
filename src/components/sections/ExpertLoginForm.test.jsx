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
  // 로그인 모드 기본 렌더링
  it("로그인 모드에서 제목이 '전문가 로그인'", () => {
    render(<ExpertLoginForm {...makeProps()} />);
    expect(screen.getByText("전문가 로그인")).toBeInTheDocument();
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
    fireEvent.submit(screen.getByText("로그인").closest("form"));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  // 회원가입 모드
  it("회원가입 모드에서 추가 필드 표시", () => {
    const expert = makeExpert({ authMode: "signup" });
    render(<ExpertLoginForm {...makeProps({ expert })} />);
    expect(screen.getByText("전문가 회원가입")).toBeInTheDocument();
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
    fireEvent.submit(screen.getByText("회원가입").closest("form"));
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

  // 모드 전환 버튼
  it("로그인 모드에서 '계정이 없으신가요? 회원가입' 버튼 표시", () => {
    render(<ExpertLoginForm {...makeProps()} />);
    expect(screen.getByText("계정이 없으신가요? 회원가입")).toBeInTheDocument();
  });

  it("회원가입 모드에서 '이미 계정이 있으신가요? 로그인' 버튼 표시", () => {
    const expert = makeExpert({ authMode: "signup" });
    render(<ExpertLoginForm {...makeProps({ expert })} />);
    expect(screen.getByText("이미 계정이 있으신가요? 로그인")).toBeInTheDocument();
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
