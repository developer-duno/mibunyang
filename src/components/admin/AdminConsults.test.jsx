// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AdminConsults } from "./AdminConsults";

// 세션 405: 구 expertConsults 탭(App.tsx 인라인) 이관 — 자체 fetch + 3상태

const NAMES = new Map([["apt-1", "테스트아파트"]]);

describe("AdminConsults", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("expertToken", "admin-token");
  });

  it("상담 목록을 fetch 해 카드로 표시한다 (관심단지 id→이름 매핑)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: [
        { id: "c1", name: "고객A", phone: "010-1111-2222", consultType: "방문상담", interestedApts: ["apt-1", "apt-x"], budgetMin: "", budgetMax: "", message: "문의합니다", submittedAt: "2026-06-12T00:00:00Z" },
      ] }),
    }));
    render(<AdminConsults aptNames={NAMES} />);
    expect(await screen.findByText("고객A")).toBeTruthy();
    expect(screen.getByText("1건")).toBeTruthy();
    // id→이름 매핑 + 미매핑 id 폴백
    expect(screen.getByText(/테스트아파트, apt-x/)).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/consults", expect.objectContaining({
      headers: { Authorization: "Bearer admin-token" },
    }));
  });

  it("상담이 없으면 빈 상태를 표시한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: [] }),
    }));
    render(<AdminConsults aptNames={NAMES} />);
    expect(await screen.findByText("아직 상담 요청이 없습니다")).toBeTruthy();
  });

  it("서버 에러 시 에러 배너를 표시한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error: "Forbidden" }),
    }));
    render(<AdminConsults aptNames={NAMES} />);
    expect(await screen.findByText("Forbidden")).toBeTruthy();
  });

  it("네트워크 실패 시 '서버 연결 실패' 표시", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    render(<AdminConsults aptNames={NAMES} />);
    expect(await screen.findByText("서버 연결 실패")).toBeTruthy();
  });

  it("토큰이 없으면 인증 필요 표시 (fetch 미발화)", async () => {
    localStorage.clear();
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    render(<AdminConsults aptNames={NAMES} />);
    await waitFor(() => expect(screen.getByText("인증이 필요합니다")).toBeTruthy());
    expect(f).not.toHaveBeenCalled();
  });
});
