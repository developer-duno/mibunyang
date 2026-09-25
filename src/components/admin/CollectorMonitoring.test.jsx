// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { CollectorMonitoring } from "./CollectorMonitoring";
import { describeRunMarker, collectorLabel } from "./collectorLabels";

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
    stubFetch(
      200,
      makeResponse({
        collectors: [
          {
            collector: "some-unknown-collector",
            lastRun: null,
            recentQuota: [],
          },
        ],
      })
    );
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
    stubFetch(
      200,
      makeResponse({
        collectors: [
          {
            collector: "naver-listings",
            lastRun: null,
            recentQuota: [{ logDate: "2026-05-17", apiName: "naver", callCount: 30, recordedAt: recentIso() }],
          },
        ],
      })
    );
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

/**
 * 마지막 실행 한 개짜리 응답(세션571 — 마커 색 시험용)
 * @param {string} status
 * @param {string|null} errorMessage
 */
function oneRun(status, errorMessage) {
  return makeResponse({
    collectors: [
      {
        collector: "naver-pipeline",
        lastRun: {
          status,
          okCount: 5,
          failCount: status === "failure" ? 1 : 0,
          skipCount: 0,
          elapsedSec: 10,
          errorMessage,
          startedAt: recentIso(),
          finishedAt: recentIso(),
        },
        recentQuota: [],
      },
    ],
  });
}

describe("수집기 상태 마커 색 (세션571 — WARN_STEPS 등)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("authToken", "admin-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("success + WARN_STEPS → 배지 '성공(경고)' + 펼치면 '경고 단계: molit-units'", async () => {
    stubFetch(200, oneRun("success", "WARN_STEPS: molit-units"));
    render(<CollectorMonitoring showToast={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("성공(경고)")).toBeTruthy();
    });
    expect(screen.queryByText("성공")).toBeNull();
    fireEvent.click(screen.getByText("네이버 로컬 파이프라인"));
    await waitFor(() => {
      expect(screen.getByText("경고 단계: molit-units")).toBeTruthy();
    });
    expect(screen.queryByText("WARN_STEPS: molit-units")).toBeNull();
  });

  it("success + null → 배지 '성공' 그대로", async () => {
    stubFetch(200, oneRun("success", null));
    render(<CollectorMonitoring showToast={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("성공")).toBeTruthy();
    });
    expect(screen.queryByText("성공(경고)")).toBeNull();
  });

  it("failure + STEP_FAILED → 배지 '실패' + '치명 단계 실패 3/6 naver-presale'", async () => {
    stubFetch(200, oneRun("failure", "STEP_FAILED: 3/6 naver-presale"));
    render(<CollectorMonitoring showToast={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("실패")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("네이버 로컬 파이프라인"));
    await waitFor(() => {
      expect(screen.getByText("치명 단계 실패 3/6 naver-presale")).toBeTruthy();
    });
  });

  it("warn 마커 배경색이 error 마커와 다르고 amber 팔레트 값과 같다 (세션571 검사관 지적 — 색 검사)", async () => {
    const { C } = await import("@/theme");
    // jsdom 은 style.background 를 rgb() 로 정규화해 반환하므로 팔레트 hex 를 같은 형식으로 변환해 비교한다
    /** @param {string} hex */
    const hexToRgb = (hex) => {
      const h = hex.replace("#", "");
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return `rgb(${r}, ${g}, ${b})`;
    };
    stubFetch(200, oneRun("success", "WARN_STEPS: molit-units"));
    render(<CollectorMonitoring showToast={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("성공(경고)")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("네이버 로컬 파이프라인"));
    /** @type {any} */
    let warnEl;
    await waitFor(() => {
      warnEl = screen.getByText("경고 단계: molit-units");
      expect(warnEl).toBeTruthy();
    });
    expect(warnEl.getAttribute("data-tone")).toBe("warn");
    expect(warnEl.style.background).toBe(hexToRgb(C.amberLight));

    cleanup();
    vi.unstubAllGlobals();
    stubFetch(200, oneRun("failure", "STEP_FAILED: 3/6 naver-presale"));
    render(<CollectorMonitoring showToast={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("실패")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("네이버 로컬 파이프라인"));
    /** @type {any} */
    let errorEl;
    await waitFor(() => {
      errorEl = screen.getByText("치명 단계 실패 3/6 naver-presale");
      expect(errorEl).toBeTruthy();
    });
    expect(errorEl.getAttribute("data-tone")).toBe("error");
    // error 쪽은 background 가 없어(runError 스타일에 background 미지정) warn 배경색과 다르다
    expect(errorEl.style.background).not.toBe(hexToRgb(C.amberLight));
  });

  it("collectorLabel('naver-pipeline') — 네이버 로컬 파이프라인 라벨 (세션572 G4)", () => {
    expect(collectorLabel("naver-pipeline")).toBe("네이버 로컬 파이프라인");
  });

  it("describeRunMarker — 마커 4종·그 밖·빈 값", () => {
    expect(describeRunMarker("WARN_STEPS: a,b")).toEqual({ tone: "warn", text: "경고 단계: a, b" });
    expect(describeRunMarker("STEP_FAILED: 3/6 naver-presale")).toEqual({
      tone: "error",
      text: "치명 단계 실패 3/6 naver-presale",
    });
    expect(describeRunMarker("REGION_UNRESOLVED n=2: 전남광주, 광주")).toEqual({
      tone: "warn",
      text: "시도 이름 못 맞춤 2건: 전남광주, 광주",
    });
    expect(describeRunMarker("APPLYHOME_NO_DATE n=3: ah-1, ah-2, ah-3")).toEqual({
      tone: "warn",
      text: "공고일 없는 청약홈 행 3건: ah-1, ah-2, ah-3",
    });
    expect(describeRunMarker("timeout 60s")).toEqual({ tone: "error", text: "timeout 60s" });
    expect(describeRunMarker(null)).toBeNull();
    expect(describeRunMarker("")).toBeNull();
  });
});
