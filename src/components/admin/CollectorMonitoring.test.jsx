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
    localStorage.setItem("authToken", "admin-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("수집기 이름을 한글 라벨로 표시한다", async () => {
    stubFetch(200, makeResponse());
    render(<CollectorMonitoring showToast={vi.fn()} />);
    await waitFor(() => {
      // molit-units → "단지 세대수" 로 매핑
      expect(screen.getByText("단지 세대수")).toBeTruthy();
    });
    expect(screen.queryByText("molit-units")).toBeNull();
    expect(screen.getByText("수집기 모니터링")).toBeTruthy();
    expect(screen.getByText("성공")).toBeTruthy();
  });

  it("매핑에 없는 수집기는 영어 이름을 그대로 표시한다", async () => {
    stubFetch(200, makeResponse({
      collectors: [{
        collector: "some-unknown-collector",
        lastRun: null,
        recentQuota: [],
      }],
    }));
    render(<CollectorMonitoring showToast={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("some-unknown-collector")).toBeTruthy();
    });
  });

  it("접힌 상태에서는 상세(처리 건수)가 보이지 않는다", async () => {
    stubFetch(200, makeResponse());
    render(<CollectorMonitoring showToast={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("단지 세대수")).toBeTruthy();
    });
    // 펼치기 전에는 "성공 120" 같은 상세가 없음
    expect(screen.queryByText("성공 120")).toBeNull();
  });

  it("행을 클릭하면 상세가 펼쳐진다", async () => {
    stubFetch(200, makeResponse());
    render(<CollectorMonitoring showToast={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("단지 세대수")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("단지 세대수"));
    await waitFor(() => {
      expect(screen.getByText("성공 120")).toBeTruthy();
    });
    expect(screen.getByText("실패 0")).toBeTruthy();
    expect(screen.getByText("스킵 3")).toBeTruthy();
  });

  it("데이터 갱신 시각 카드를 테이블별로 한글 라벨로 표시한다", async () => {
    stubFetch(200, makeResponse());
    render(<CollectorMonitoring showToast={vi.fn()} />);
    await waitFor(() => {
      // apartments → "아파트", regions → "지역 통계"
      expect(screen.getByText("아파트")).toBeTruthy();
    });
    expect(screen.getByText("지역 통계")).toBeTruthy();
    expect(screen.queryByText("apartments")).toBeNull();
  });

  it("partial 응답이면 경고 배너를 표시한다", async () => {
    stubFetch(200, makeResponse({ partial: true, errors: ["api_quota_log"] }));
    render(<CollectorMonitoring showToast={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/일부 데이터 조회에 실패/)).toBeTruthy();
    });
  });

  it("lastRun 이 null 이면 '실행 기록 없음' 배지를 표시하고 펼치면 안내 문구가 나온다", async () => {
    stubFetch(200, makeResponse({
      collectors: [{
        collector: "naver-listings",
        lastRun: null,
        recentQuota: [{ logDate: "2026-05-17", apiName: "naver", callCount: 30, recordedAt: recentIso() }],
      }],
    }));
    render(<CollectorMonitoring showToast={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("네이버 매물")).toBeTruthy();
    });
    expect(screen.getByText("실행 기록 없음")).toBeTruthy();
    fireEvent.click(screen.getByText("네이버 매물"));
    await waitFor(() => {
      expect(screen.getByText(/수집 실행 기록이 아직 없습니다/)).toBeTruthy();
    });
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
      expect(screen.getByText("단지 세대수")).toBeTruthy();
    });
    const callsBefore = /** @type {any} */ (globalThis.fetch).mock.calls.length;
    fireEvent.click(screen.getByText("새로고침"));
    await waitFor(() => {
      expect(/** @type {any} */ (globalThis.fetch).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});
