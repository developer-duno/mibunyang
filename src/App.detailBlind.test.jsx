// @ts-check
/**
 * App → DetailModal 블라인드 배선 통합 테스트 (세션 495 · 세션 503 갱신).
 *
 * 보는 것 = **App 이 isLoggedIn 을 실제로 DetailModal 에 넘기는지**. `isLoggedIn={isLoggedIn}`
 * 한 줄이 사라지면 DetailModal 기본값 true 로 되돌아가 블라인드가 통째로 사라진다.
 *
 * 세션 503(단계 2-B): 상세 진입 게이트가 폐지돼 이 파일이 쓰던 "게이트만 통과시키는 스텁"이
 * 필요 없어졌다 — 이제 비로그인도 그냥 상세가 열린다. useLoginGate 모킹도 함께 걷어냈다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { makeApt } from "@/__tests__/factories";

const BLIND_LABEL = "점수 비공개 — 로그인 후 확인 가능";

// --- 모킹 (App.test.jsx 패턴 답습) ---

vi.mock("@/services/staticDataApi", () => ({
  fetchStaticApartments: vi.fn(),
  fetchApartmentPrices: vi.fn().mockResolvedValue(null),
  fetchApartmentDetail: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/hooks/useUserLocation", () => ({
  useUserLocation: () => ({ region: null, gu: null, method: null, loading: false, error: null }),
}));

vi.mock("@/hooks/useShare", () => ({
  useShare: () => ({
    openShareSheet: vi.fn(),
    closeShareSheet: vi.fn(),
    shareKakao: vi.fn(),
    shareSMS: vi.fn(),
    shareCopy: vi.fn(),
    shareSheetOpen: false,
    isMobile: false,
  }),
}));

vi.mock("@/hooks/useResponsive", () => ({
  useResponsive: () => ({ isPC: true }),
}));

vi.mock("@/components/ShareSheet", () => ({
  ShareSheet: () => null,
}));

import { fetchStaticApartments } from "@/services/staticDataApi";
import App from "./App";

const mockFetch = /** @type {import('vitest').Mock} */ (fetchStaticApartments);

describe("App → DetailModal 블라인드 배선", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* noop: jsdom storage 미가용 환경 무시 */
    }
  });

  it("비로그인으로 상세를 열면 점수가 블라인드된다 (App 이 isLoggedIn 을 넘긴다)", async () => {
    mockFetch.mockResolvedValue({
      data: [makeApt({ id: "apt1", name: "테스트파크1차" })],
      dataUpdatedAt: null,
    });
    window.history.replaceState(null, "", "/?detail=apt1");

    render(<App />);

    // DetailModal 은 lazy — Suspense 해제까지 기다린다.
    // ⚠️ timeout 5초(기본 1초 아님): 세션 503 실측에서 이 대기가 여러 파일과 나란히 돌 때
    // 1,195ms 가 걸려 20~40% 확률로 깨졌다(코드 변경 전에도 재현 — 원래 있던 깜빡임).
    // 지연 로딩 컴포넌트 + 데이터 파이프라인이라 1초는 애초에 빠듯하다.
    await waitFor(
      () => {
        expect(screen.getAllByLabelText(BLIND_LABEL).length).toBeGreaterThan(0);
      },
      { timeout: 5000 }
    );

    window.history.replaceState(null, "", "/");
  });
});
