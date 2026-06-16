// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MarketingConsentModal } from "./MarketingConsentModal";

// @vercel/analytics 모킹 (trackEvent → track 위임)
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));
import { track as trackOrig } from "@vercel/analytics";
const track = /** @type {import('vitest').Mock} */ (trackOrig);

/** @returns {any} */
function makeProps(overrides = {}) {
  return {
    open: true,
    onSubmit: vi.fn(),
    submitting: false,
    ...overrides,
  };
}

describe("MarketingConsentModal", () => {
  beforeEach(() => { track.mockClear(); });

  it("open=false → null", () => {
    const { container } = render(<MarketingConsentModal {...makeProps({ open: false })} />);
    expect(container.innerHTML).toBe("");
  });

  it("open=true → 동의 문구 노출", () => {
    render(<MarketingConsentModal {...makeProps()} />);
    expect(screen.getByText(/마케팅 정보 수신에 동의/)).toBeTruthy();
  });

  // 체크 안 함 → "동의 없이 시작하기" + onSubmit(false)
  it("체크 없이 버튼 클릭 → onSubmit(false) + consent=false 이벤트", () => {
    const onSubmit = vi.fn();
    render(<MarketingConsentModal {...makeProps({ onSubmit })} />);
    fireEvent.click(screen.getByText("동의 없이 시작하기"));
    expect(track).toHaveBeenCalledWith("marketing_consent", { consent: false });
    expect(onSubmit).toHaveBeenCalledWith(false);
  });

  // 체크 → 버튼 라벨 변경 + onSubmit(true)
  it("체크 후 버튼 클릭 → onSubmit(true) + consent=true 이벤트", () => {
    const onSubmit = vi.fn();
    render(<MarketingConsentModal {...makeProps({ onSubmit })} />);
    fireEvent.click(screen.getByRole("checkbox"));
    const btn = screen.getByText("동의하고 시작하기");
    fireEvent.click(btn);
    expect(track).toHaveBeenCalledWith("marketing_consent", { consent: true });
    expect(onSubmit).toHaveBeenCalledWith(true);
  });

  // submitting=true → 버튼 비활성 + "처리 중..."
  it("submitting=true → 처리 중 표시 + 버튼 disabled", () => {
    render(<MarketingConsentModal {...makeProps({ submitting: true })} />);
    const btn = /** @type {HTMLButtonElement} */ (screen.getByText("처리 중...").closest("button"));
    expect(btn.disabled).toBe(true);
  });
});
