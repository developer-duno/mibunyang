// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FeedbackForm, FEEDBACK_CONSENT_TEXT } from "./FeedbackForm";

/** @returns {any} */
function makeProps(overrides = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    kind: null,
    onKindChange: vi.fn(),
    message: "",
    onMessageChange: vi.fn(),
    consent: false,
    onConsentChange: vi.fn(),
    submitting: false,
    canSubmit: false,
    onSubmit: vi.fn(),
    contextLabel: "상세 · 힐스테이트테스트 (ap-6028351)",
    isPC: false,
    ...overrides,
  };
}

describe("FeedbackForm (세션574)", () => {
  it("open=false 면 아무것도 그리지 않는다", () => {
    const { container } = render(<FeedbackForm {...makeProps({ open: false })} />);
    expect(container.innerHTML).toBe("");
  });

  it("대화상자 + 종류 라디오 4개(기본 선택 없음) + 자동 첨부 줄 + 동의 문구", () => {
    render(<FeedbackForm {...makeProps()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("radiogroup", { name: "의견 종류" })).toBeTruthy();
    const radios = /** @type {HTMLInputElement[]} */ (screen.getAllByRole("radio"));
    expect(radios.map((r) => r.value)).toEqual(["bug", "data", "suggest", "other"]);
    expect(radios.some((r) => r.checked)).toBe(false);
    for (const label of ["버그·오류", "정보가 틀려요", "건의·제안", "기타"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByTestId("feedback-context").textContent).toBe("현재 화면: 상세 · 힐스테이트테스트 (ap-6028351)");
    expect(screen.getByText(FEEDBACK_CONSENT_TEXT)).toBeTruthy();
    expect(FEEDBACK_CONSENT_TEXT).toBe(
      "답장을 위해 카카오 계정 이메일·이름, 의견 내용, 보던 화면과 접속 환경(브라우저 정보)을 저장하는 데 동의합니다 (1년 뒤 자동 삭제)"
    );
  });

  it("종류 미선택이면 보내기 disabled (canSubmit=false)", () => {
    render(<FeedbackForm {...makeProps({ kind: null, consent: true, message: "열 글자가 넘는 의견 내용입니다" })} />);
    const btn = /** @type {HTMLButtonElement} */ (screen.getByRole("button", { name: "보내기" }));
    expect(btn.disabled).toBe(true);
  });

  it("canSubmit=true 면 보내기가 켜지고 누르면 onSubmit", () => {
    const onSubmit = vi.fn();
    render(<FeedbackForm {...makeProps({ kind: "bug", consent: true, canSubmit: true, onSubmit })} />);
    const btn = /** @type {HTMLButtonElement} */ (screen.getByRole("button", { name: "보내기" }));
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("라디오·내용·동의 조작이 콜백으로 올라간다", () => {
    const onKindChange = vi.fn();
    const onMessageChange = vi.fn();
    const onConsentChange = vi.fn();
    render(<FeedbackForm {...makeProps({ onKindChange, onMessageChange, onConsentChange })} />);
    fireEvent.click(screen.getByLabelText("정보가 틀려요"));
    expect(onKindChange).toHaveBeenCalledWith("data");
    fireEvent.change(screen.getByLabelText("내용"), { target: { value: "세대수가 달라요" } });
    expect(onMessageChange).toHaveBeenCalledWith("세대수가 달라요");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onConsentChange).toHaveBeenCalledWith(true);
  });

  it("남은 글자 수와 10자 안내를 보여 준다, textarea 상한 1000", () => {
    render(<FeedbackForm {...makeProps({ message: "짧아요" })} />);
    expect(screen.getByText("남은 글자 997자")).toBeTruthy();
    expect(screen.getByText("10자 이상 적어 주세요")).toBeTruthy();
    expect(screen.getByLabelText("내용").getAttribute("maxlength")).toBe("1000");
  });

  it("Esc·바깥 클릭·닫기 버튼으로 닫힌다, 안쪽 클릭은 안 닫힌다", () => {
    const onClose = vi.fn();
    render(<FeedbackForm {...makeProps({ onClose })} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(/** @type {HTMLElement} */ (screen.getByRole("dialog").parentElement));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByLabelText("닫기"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("보내는 중이면 버튼 문구가 바뀐다", () => {
    render(<FeedbackForm {...makeProps({ submitting: true })} />);
    expect(screen.getByRole("button", { name: "보내는 중..." })).toBeTruthy();
  });

  it("문맥이 비면 자동 첨부 줄을 그리지 않는다", () => {
    render(<FeedbackForm {...makeProps({ contextLabel: "" })} />);
    expect(screen.queryByTestId("feedback-context")).toBeNull();
  });
});
