// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConsultForm } from "./ConsultForm";
import { makeScoredItem } from "@/__tests__/factories";

function makeForm(overrides = {}) {
  return {
    name: "",
    phone: "",
    budgetMin: "",
    budgetMax: "",
    consultType: "방문상담",
    message: "",
    ...overrides,
  };
}

/** @returns {any} */
function makeProps(overrides = {}) {
  return {
    scored: [makeScoredItem({ id: 1, name: "A아파트" }), makeScoredItem({ id: 2, name: "B아파트" })],
    favoriteIds: [],
    setFavoriteIds: vi.fn(),
    form: makeForm(),
    setForm: vi.fn(),
    onSubmit: vi.fn(),
    submitted: false,
    showToast: vi.fn(),
    ...overrides,
  };
}

describe("ConsultForm", () => {
  // 기본 렌더링
  it("상담 신청 제목 표시", () => {
    render(<ConsultForm {...makeProps()} />);
    expect(screen.getByText("전문가 상담 신청")).toBeInTheDocument();
  });

  // 이름/연락처 입력 필드
  it("이름과 연락처 입력 필드 렌더링", () => {
    render(<ConsultForm {...makeProps()} />);
    expect(screen.getByLabelText("이름 *")).toBeInTheDocument();
    expect(screen.getByLabelText("연락처 *")).toBeInTheDocument();
  });

  // 이름 미입력 시 토스트
  it("이름 미입력 시 상담 신청하면 토스트 표시", () => {
    const showToast = vi.fn();
    render(<ConsultForm {...makeProps({ showToast })} />);
    fireEvent.click(screen.getByText("상담 신청하기"));
    expect(showToast).toHaveBeenCalledWith("이름을 입력해주세요");
  });

  // 연락처 미입력 시 토스트
  it("연락처 미입력 시 상담 신청하면 토스트 표시", () => {
    const showToast = vi.fn();
    render(<ConsultForm {...makeProps({ form: makeForm({ name: "홍길동" }), showToast })} />);
    fireEvent.click(screen.getByText("상담 신청하기"));
    expect(showToast).toHaveBeenCalledWith("연락처를 입력해주세요");
  });

  // 관심매물 0건일 때 토스트
  it("관심매물 0건이면 토스트 표시", () => {
    const showToast = vi.fn();
    render(<ConsultForm {...makeProps({ form: makeForm({ name: "홍길동", phone: "010-1234-5678" }), showToast })} />);
    fireEvent.click(screen.getByText("상담 신청하기"));
    expect(showToast).toHaveBeenCalledWith("목록에서 관심매물을 1개 이상 추가해주세요");
  });

  // 유효한 폼 제출 시 onSubmit 호출 (동의 포함)
  it("유효한 폼 제출 시 onSubmit 호출", () => {
    const onSubmit = vi.fn();
    render(
      <ConsultForm
        {...makeProps({
          form: makeForm({ name: "홍길동", phone: "010-1234-5678", consent: true }),
          favoriteIds: [1],
          onSubmit,
        })}
      />
    );
    fireEvent.click(screen.getByText("상담 신청하기"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  // 개인정보 동의 미체크 시 제출 차단 (PIPA §15)
  it("동의 미체크 시 상담 신청하면 토스트 + onSubmit 미호출", () => {
    const showToast = vi.fn();
    const onSubmit = vi.fn();
    render(
      <ConsultForm
        {...makeProps({
          form: makeForm({ name: "홍길동", phone: "010-1234-5678", consent: false }),
          favoriteIds: [1],
          onSubmit,
          showToast,
        })}
      />
    );
    fireEvent.click(screen.getByText("상담 신청하기"));
    expect(showToast).toHaveBeenCalledWith("개인정보 수집·이용 동의가 필요합니다");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // 동의 체크박스 렌더링 + 클릭 시 updateField 호출
  it("개인정보 동의 체크박스 렌더링 및 토글", () => {
    const setForm = vi.fn();
    render(<ConsultForm {...makeProps({ form: makeForm({ name: "홍길동", phone: "010-1234-5678" }), setForm })} />);
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(setForm).toHaveBeenCalledWith(expect.objectContaining({ consent: true }));
  });

  // 관심매물 빈 상태 안내
  it("관심매물 0건이면 안내 메시지 표시", () => {
    render(<ConsultForm {...makeProps()} />);
    expect(screen.getByText(/관심매물 버튼을 눌러/)).toBeInTheDocument();
  });

  // 관심매물이 있으면 목록 표시
  it("관심매물이 있으면 단지 목록 표시", () => {
    render(<ConsultForm {...makeProps({ favoriteIds: [1] })} />);
    expect(screen.getByText("A아파트")).toBeInTheDocument();
  });

  // 관심매물 제거 버튼
  it("관심매물 제거 버튼 클릭 시 setFavoriteIds 호출", () => {
    const setFavoriteIds = vi.fn();
    render(<ConsultForm {...makeProps({ favoriteIds: [1], setFavoriteIds })} />);
    // IconClose 버튼 클릭 (SVG 아이콘으로 교체됨)
    const removeButtons = screen.getAllByLabelText("관심단지 제거");
    fireEvent.click(removeButtons[0]);
    expect(setFavoriteIds).toHaveBeenCalledTimes(1);
  });

  // 상담 유형 버튼
  it("3가지 상담 유형 버튼 표시", () => {
    render(<ConsultForm {...makeProps()} />);
    expect(screen.getByText("방문상담")).toBeInTheDocument();
    expect(screen.getByText("전화상담")).toBeInTheDocument();
    expect(screen.getByText("온라인상담")).toBeInTheDocument();
  });

  // 상담 유형 선택 시 aria-pressed
  it("현재 선택된 상담 유형에 aria-pressed=true", () => {
    render(<ConsultForm {...makeProps()} />);
    const visitBtn = screen.getByText("방문상담");
    expect(visitBtn.getAttribute("aria-pressed")).toBe("true");
  });

  // 예산 범위
  it("최소/최대 예산 입력 필드 렌더링", () => {
    render(<ConsultForm {...makeProps()} />);
    expect(screen.getByLabelText("최소 예산 (만원)")).toBeInTheDocument();
    expect(screen.getByLabelText("최대 예산 (만원)")).toBeInTheDocument();
  });

  // 예산 역전 경고
  it("최소 > 최대이면 경고 메시지 표시", () => {
    render(<ConsultForm {...makeProps({ form: makeForm({ budgetMin: "60000", budgetMax: "30000" }) })} />);
    expect(screen.getByText("최소 예산이 최대보다 큽니다")).toBeInTheDocument();
  });

  // submitted 상태 — 완료 화면
  it("submitted=true이면 완료 화면 표시", () => {
    render(
      <ConsultForm
        {...makeProps({
          submitted: true,
          form: makeForm({ name: "홍길동", phone: "010-1234-5678" }),
        })}
      />
    );
    expect(screen.getByText("상담 신청이 완료되었습니다")).toBeInTheDocument();
    expect(screen.getByText(/신청자: 홍길동/)).toBeInTheDocument();
  });

  // 데모 안내 메시지
  it("데모 안내 메시지 표시", () => {
    render(<ConsultForm {...makeProps()} />);
    expect(screen.getByText(/데모 버전/)).toBeInTheDocument();
  });

  // 추가 메시지 필드
  it("추가 메시지 textarea 렌더링", () => {
    render(<ConsultForm {...makeProps()} />);
    expect(screen.getByLabelText("추가 메시지")).toBeInTheDocument();
  });
});
