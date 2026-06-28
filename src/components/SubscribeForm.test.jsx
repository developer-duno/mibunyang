// @ts-check
// SubscribeForm 단위 테스트 — 휴대폰 정규식 + 동의 미체크 차단
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SubscribeForm } from "./SubscribeForm";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

describe("SubscribeForm — 휴대폰 알림 신청", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it("동의 미체크 + 신청 → '동의가 필요합니다' 메시지", async () => {
    render(<SubscribeForm />);
    fireEvent.change(screen.getByPlaceholderText("010-1234-5678"), { target: { value: "010-1234-5678" } });
    fireEvent.click(screen.getByRole("button", { name: /알림 받기/ }));
    await waitFor(() => {
      expect(screen.getByText(/개인정보 수집·이용 동의/)).toBeInTheDocument();
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("잘못된 휴대폰 형식 → '올바른 휴대폰 번호' 메시지", async () => {
    render(<SubscribeForm />);
    fireEvent.change(screen.getByPlaceholderText("010-1234-5678"), { target: { value: "02-123-4567" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /알림 받기/ }));
    await waitFor(() => {
      expect(screen.getByText(/올바른 휴대폰 번호/)).toBeInTheDocument();
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("정상 입력 + 동의 → fetch 호출 + 성공 메시지", async () => {
    /** @type {import('vitest').Mock} */ (globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    render(<SubscribeForm />);
    fireEvent.change(screen.getByPlaceholderText("010-1234-5678"), { target: { value: "010-1234-5678" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /알림 받기/ }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/subscribers",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("010-1234-5678"),
        })
      );
    });
    await waitFor(() => {
      expect(screen.getByText(/알림 신청 완료/)).toBeInTheDocument();
    });
  });

  it("API 실패 → 에러 메시지", async () => {
    /** @type {import('vitest').Mock} */ (globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ ok: false, error: "Rate limit" }),
    });

    render(<SubscribeForm />);
    fireEvent.change(screen.getByPlaceholderText("010-1234-5678"), { target: { value: "010-1234-5678" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /알림 받기/ }));

    await waitFor(() => {
      expect(screen.getByText(/Rate limit/)).toBeInTheDocument();
    });
  });

  it("aria-required + aria-invalid 접근성 속성 존재", () => {
    render(<SubscribeForm />);
    const phoneInput = screen.getByPlaceholderText("010-1234-5678");
    expect(phoneInput).toHaveAttribute("aria-required", "true");
    expect(phoneInput).toHaveAttribute("aria-invalid", "false");
  });
});
