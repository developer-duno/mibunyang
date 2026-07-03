// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminSubscribers } from "./AdminSubscribers";

// 세션 467 PR2: 분양 알림 구독자 통계 + 발송 로그 (AdminConsults 자체 fetch 패턴 답습)

const STATS = {
  total: 3,
  active: 2,
  optedOut: 1,
  byScope: { apartment: 1, region: 1, nationwide: 0 },
};

describe("AdminSubscribers", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("authToken", "admin-token");
  });

  it("통계와 발송 로그를 fetch 해 표시한다 (phone 은 서버 마스킹값 그대로)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            ok: true,
            stats: STATS,
            logs: [
              {
                id: 1,
                apartmentId: "ap-1",
                apartmentName: "테스트단지",
                houseManageNo: "2026000001",
                eventDate: "2026-07-08",
                channel: "dry_run",
                status: "dry_run",
                failReason: null,
                createdAt: "2026-07-06T05:00:00Z",
                phoneMasked: "+8210****5678",
              },
            ],
          }),
      })
    );
    render(<AdminSubscribers />);
    expect(await screen.findByText("테스트단지")).toBeTruthy();
    expect(screen.getByText(/활성 2명 \/ 철회 1명/)).toBeTruthy();
    expect(screen.getByText(/\+8210\*\*\*\*5678/)).toBeTruthy();
    expect(screen.getByText("모의")).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/admin/subscribers",
      expect.objectContaining({ headers: { Authorization: "Bearer admin-token" } })
    );
  });

  it("발송 이력이 없으면 빈 상태 안내를 보여준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, stats: STATS, logs: [] }),
      })
    );
    render(<AdminSubscribers />);
    expect(await screen.findByText(/아직 발송 이력이 없습니다/)).toBeTruthy();
  });

  it("logsError(마이그 미적용 등) 는 통계는 두고 로그 자리에만 안내한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, stats: STATS, logs: [], logsError: "발송 로그 조회 실패" }),
      })
    );
    render(<AdminSubscribers />);
    expect(await screen.findByText(/발송 로그 조회 실패/)).toBeTruthy();
    expect(screen.getByText(/활성 2명/)).toBeTruthy();
  });

  it("API 실패 시 에러 상태를 보여준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: false, error: "권한 없음" }),
      })
    );
    render(<AdminSubscribers />);
    expect(await screen.findByText("권한 없음")).toBeTruthy();
  });

  it("토큰이 없으면 인증 필요 안내를 보여준다", async () => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
    render(<AdminSubscribers />);
    expect(await screen.findByText("인증이 필요합니다")).toBeTruthy();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
