// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { CollectorMonitoring } from "./CollectorMonitoring";

// 최근(=초록) 시각 — Date.now() 기준 1시간 전
const recentIso = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();
// 오래된(=빨강) 시각 — 10일 전
const staleIso = () => new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

/** collector-status 응답 한 벌 생성 */
function makeResponse(overrides = {}) {
  return {
    ok: true,
    fetchedAt: recentIso(),
    partial: false,
    errors: [],
    collectors: [
      {
        collector: "molit-units",
        lastRun: {
          status: "success",
          okCount: 120,
          failCount: 0,
          skipCount: 3,
          elapsedSec: 42.5,
          errorMessage: null,
          startedAt: recentIso(),
          finishedAt: recentIso(),
        },
        recentQuota: [{ logDate: "2026-05-17", apiName: "molit", callCount: 50, recordedAt: recentIso() }],
      },
    ],
    dataFreshness: {
      apartments: recentIso(),
      regions: staleIso(),
    },
    ...overrides,
  };
}

/**
 * fetch 를 status + body 로 mock
 * @param {number} status
 * @param {any} body
 */
function stubFetch(status, body) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    })
  );
}

describe("CollectorMonitoring", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("expertToken", "admin-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("정상 응답이면 수집기명과 상태 배지를 표시한다", async () => {
    stubFetch(200, makeResponse());
    render(<CollectorMonitoring showToast={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("molit-units")).toBeTruthy();
    });
    expect(screen.getByText("성공")).toBeTruthy();
    expect(screen.getByText("수집기 모니터링")).toBeTruthy();
  });

  it("데이터 갱신 시각 카드를 테이블별로 표시한다", async () => {
    stubFetch(200, makeResponse());
    render(<CollectorMonitoring showToast={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("apartments")).toBeTruthy();
    });
    expect(screen.getByText("regions")).toBeTruthy();
  });

  it("partial 응답이면 경고 배너를 표시한다", async () => {
    stubFetch(200, makeResponse({ partial: true, errors: ["api_quota_log"] }));
    render(<CollectorMonitoring showToast={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/일부 데이터 조회에 실패/)).toBeTruthy();
    });
  });

  it("lastRun 이 null 이면 '실행 기록 없음' 배지를 표시한다", async () => {
    stubFetch(200, makeResponse({
      collectors: [{
        collector: "naver-listings",
        lastRun: null,
        recentQuota: [{ logDate: "2026-05-17", apiName: "naver", callCount: 30, recordedAt: recentIso() }],
      }],
    }));
    render(<CollectorMonitoring showToast={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("naver-listings")).toBeTruthy();
    });
    expect(screen.getByText("실행 기록 없음")).toBeTruthy();
  });

  it("401 응답이면 토스트를 띄우고 에러 메시지를 표시한다", async () => {
    const showToast = vi.fn();
    stubFetch(401, { ok: false });
    render(<CollectorMonitoring showToast={showToast} />);
    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith("관리자 세션이 만료되었습니다");
    });
    expect(screen.getByText("관리자 세션이 만료되었습니다")).toBeTruthy();
  });

  it("새로고침 버튼을 누르면 fetch 를 다시 호출한다", async () => {
    stubFetch(200, makeResponse());
    render(<CollectorMonitoring showToast={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("molit-units")).toBeTruthy();
    });
    const callsBefore = /** @type {any} */ (globalThis.fetch).mock.calls.length;
    fireEvent.click(screen.getByText("새로고침"));
    await waitFor(() => {
      expect(/** @type {any} */ (globalThis.fetch).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});
