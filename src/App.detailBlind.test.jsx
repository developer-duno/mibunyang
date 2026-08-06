// @ts-check
/**
 * App → DetailModal 블라인드 배선 통합 테스트 (세션 495).
 *
 * 왜 별도 파일인가 — App.test.jsx 는 "비로그인은 상세를 못 연다"(세션 413 게이트)를 지키는
 * 테스트를 갖고 있어서, 그 파일에서 useLoginGate 를 통째로 모킹하면 그 가드가 죽는다.
 * 여기서는 게이트만 통과시켜(단계 2-B 를 앞당겨 흉내) **App 이 isLoggedIn 을 실제로 넘기는지**를
 * 본다. `isLoggedIn={isLoggedIn}` 한 줄이 사라지면 DetailModal 기본값 true 로 되돌아가
 * 블라인드가 통째로 사라지는데, 지금까지는 그걸 잡는 테스트가 하나도 없었다.
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

// 게이트만 통과시키는 스텁 — 단계 2-B(비로그인도 상세를 연다)를 미리 흉내낸다.
// 로그인 상태(useAuth)는 손대지 않으므로 App 이 넘기는 isLoggedIn 은 계속 false 다.
vi.mock("@/hooks/useLoginGate", () => ({
  useLoginGate: (/** @type {any} */ { detail }) => ({
    showLoginPrompt: false,
    setShowLoginPrompt: vi.fn(),
    loginTrigger: null,
    setLoginTrigger: vi.fn(),
    handleDetailGated: (/** @type {string} */ id) => detail.handleOpenDetail(id),
    handleKakaoFromPrompt: vi.fn(),
    requestLoginForDetail: vi.fn(),
    closeLoginPrompt: vi.fn(),
  }),
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

    // DetailModal 은 lazy — Suspense 해제까지 기다린다
    await waitFor(() => {
      expect(screen.getAllByLabelText(BLIND_LABEL).length).toBeGreaterThan(0);
    });

    window.history.replaceState(null, "", "/");
  });
});
