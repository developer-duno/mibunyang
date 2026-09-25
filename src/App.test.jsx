// @ts-check
/**
 * App.jsx 통합 테스트
 *
 * 13개 훅 + 9개 useMemo를 사용하는 App 컴포넌트의 스모크 테스트.
 * 핵심 동작(렌더링, 프로필 변경, 탭 전환, 에러 표시)을 검증합니다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- 팩토리 함수: 테스트용 아파트 데이터 ---
function makeTestApartments() {
  return [
    {
      id: "apt1",
      name: "테스트파크1차",
      region: "경기",
      gu: "수원시",
      builder: "현대건설",
      completion: "2025-06-01",
      price: 50000,
      area: 84,
      pp: 595,
      nearbyMedian: 55000,
      jeonseRate: 70,
      pir: 5,
      psr: 0.9,
      dataReliability: 80,
      subwayDist: 500,
      busRoutes: 10,
      icDist: 5,
      ktxDist: 15,
      schoolScore: 70,
      schoolGrade: "B+",
      hospital: 3,
      mart: 2,
      conv: 5,
      park: 2,
      cafe: 10,
      culture: 2,
      bank: 2,
      pharmacy: 3,
      view: "그린",
      sunlight: "양호",
      noise: 55,
      noxious: [],
      noxiousDist: null,
      units: 1000,
      parkingRatio: 1.3,
      floorAreaRatio: 220,
      exclusiveRatio: 78,
      maxFloor: 25,
      energyGrade: 2,
      greenBldg: null,
      hasPool: false,
      layout: "4베이판상",
      quakeDesign: true,
      discountPct: 5,
      loanFree: true,
      loanFreePct: 60,
      optionFree: true,
      optionValue: 500,
      balconyFree: true,
      balconyValue: 800,
      cashback: 200,
      unsold: 150,
      unsoldRate: 15,
      recentTrades6m: 20,
      dsr40pass: true,
      hugGuarantee: true,
      builderCreditGrade: "AA",
      builderDebtRatio: 100,
      supplyRatio: 100,
      popGrowth: 0.3,
      netMigration: 500,
      transitDev: "GTX-C 착공",
      devDist: 1,
      cityDev: "신도시",
      industryDev: "테크노밸리",
    },
    {
      id: "apt2",
      name: "힐스테이트강남",
      region: "서울",
      gu: "강남구",
      builder: "현대건설",
      completion: "2026-01-01",
      price: 80000,
      area: 84,
      pp: 952,
      nearbyMedian: 90000,
      jeonseRate: 60,
      pir: 8,
      psr: 1.2,
      dataReliability: 90,
      subwayDist: 200,
      busRoutes: 15,
      icDist: 3,
      ktxDist: 10,
      schoolScore: 85,
      schoolGrade: "A",
      hospital: 5,
      mart: 3,
      conv: 10,
      park: 3,
      cafe: 15,
      culture: 3,
      bank: 3,
      pharmacy: 4,
      view: "블루",
      sunlight: "우수",
      noise: 45,
      noxious: [],
      noxiousDist: null,
      units: 1500,
      parkingRatio: 1.5,
      floorAreaRatio: 200,
      exclusiveRatio: 82,
      maxFloor: 35,
      energyGrade: 1,
      greenBldg: "우수",
      hasPool: true,
      layout: "4베이판상",
      quakeDesign: true,
      discountPct: 3,
      loanFree: false,
      loanFreePct: 0,
      optionFree: false,
      optionValue: 0,
      balconyFree: true,
      balconyValue: 500,
      cashback: 0,
      unsold: 75,
      unsoldRate: 5,
      recentTrades6m: 30,
      dsr40pass: true,
      hugGuarantee: true,
      builderCreditGrade: "AAA",
      builderDebtRatio: 60,
      supplyRatio: 80,
      popGrowth: 0.1,
      netMigration: 200,
      transitDev: "지하철 운행중",
      devDist: 0.5,
      cityDev: "재건축",
      industryDev: null,
    },
  ];
}

// --- 모킹 ---

// staticDataApi: fetchStaticApartments 모킹
// fetchApartmentDetail: DetailModal(lazy) 마운트 시 priceByArea=undefined 면 버킷 fetch 발동 — mock 누락 시 VitestMocker 에러
vi.mock("@/services/staticDataApi", () => ({
  fetchStaticApartments: vi.fn(),
  fetchApartmentDetail: vi.fn().mockResolvedValue(null),
}));

// useUserLocation: 위치 감지 비활성화
vi.mock("@/hooks/useUserLocation", () => ({
  useUserLocation: () => ({ region: null, gu: null, method: null, loading: false, error: null }),
}));

// useShare: 공유 기능 스텁
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

// useResponsive: PC 모드 고정
vi.mock("@/hooks/useResponsive", () => ({
  useResponsive: () => ({ isPC: true }),
}));

// ShareSheet 컴포넌트 스텁
vi.mock("@/components/ShareSheet", () => ({
  ShareSheet: () => null,
}));

import { fetchStaticApartments } from "@/services/staticDataApi";
import App from "./App";

const mockFetch = /** @type {import('vitest').Mock} */ (fetchStaticApartments);

describe("App 통합 테스트", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // localStorage/sessionStorage 초기화
    try {
      localStorage.clear();
    } catch {
      /* noop: jsdom storage 미가용 환경 무시 */
    }
    try {
      sessionStorage.clear();
    } catch {
      /* noop: jsdom storage 미가용 환경 무시 */
    }
  });

  // 1. 기본 렌더링: 로딩 → 데이터 로드 → 카드 표시
  describe("기본 렌더링", () => {
    it("로딩 중 표시 후 데이터 로드 완료 시 아파트 카드가 표시된다", async () => {
      const testData = makeTestApartments();
      mockFetch.mockResolvedValue({ data: testData, dataUpdatedAt: "2026-03-18T00:00:00Z" });

      render(<App />);

      // 로딩 상태 확인
      expect(screen.getByText(/데이터 로딩 중/)).toBeInTheDocument();

      // 데이터 로드 완료 대기
      await waitFor(() => {
        expect(screen.getByText(/테스트파크1차/)).toBeInTheDocument();
      });

      // 헤더의 단지 수 표시 (여러 곳에 나올 수 있으므로 getAllByText)
      expect(screen.getAllByText(/2개 단지/).length).toBeGreaterThanOrEqual(1);
    });

    it('헤더에 "전국 미분양 비교 엔진" 텍스트가 표시된다', async () => {
      mockFetch.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });

      render(<App />);

      expect(screen.getByText("전국 미분양 비교 엔진")).toBeInTheDocument();
    });

    it("하단 네비게이션이 렌더링된다", async () => {
      mockFetch.mockResolvedValue({ data: [], dataUpdatedAt: null });

      render(<App />);

      // 세션 577(A-12): 손님 네비 = 목록·지도·(곧 분양 — 테스트 기본 OFF)·문의
      const nav = screen.getByRole("navigation", { name: "메인 내비게이션" });
      expect(Array.from(nav.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["목록", "지도", "문의"]);
    });
  });

  // 2. 프로필 변경
  describe("프로필 변경", () => {
    it("프로필 버튼 클릭 시 해당 프로필이 활성화된다", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });

      render(<App />);

      // 데이터 로드 대기
      await waitFor(() => {
        expect(screen.getByText(/테스트파크1차/)).toBeInTheDocument();
      });

      // "투자" 프로필 버튼 클릭
      const investBtn = screen.getByRole("button", { name: /^투자$/ });
      await user.click(investBtn);

      // 클릭 후 버튼이 pressed 상태 (aria-pressed)
      expect(investBtn).toHaveAttribute("aria-pressed", "true");
    });
  });

  // 3. 탭 전환
  describe("탭 전환", () => {
    // 세션 577(A-12): 정보 탭 → 도움말(?) 패널, 상담 탭 → 문의 모달
    it("도움말(?) 클릭 시 InfoPage 본문이 패널로 뜨고 목록은 그대로다", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });

      render(<App />);
      await waitFor(() => {
        expect(screen.getByText(/테스트파크1차/)).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("도움말"));
      expect(screen.getByText("미분양 아파트 비교 엔진")).toBeInTheDocument();
      expect(screen.getByText("카카오로 시작하기")).toBeInTheDocument();
      expect(screen.queryByText("전문가 상담 신청")).toBeNull();
      expect(screen.getByText(/테스트파크1차/)).toBeInTheDocument();
    });

    it("메뉴 '문의' 클릭 시 문의 모달이 열리고 탭은 목록 그대로다", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });

      render(<App />);
      await waitFor(() => {
        expect(screen.getByText(/테스트파크1차/)).toBeInTheDocument();
      });

      const nav = screen.getByRole("navigation", { name: "메인 내비게이션" });
      const inquiryBtn = /** @type {HTMLButtonElement} */ (
        Array.from(nav.querySelectorAll("button")).find((b) => b.textContent === "문의")
      );
      await user.click(inquiryBtn);
      expect(await screen.findByRole("dialog", { name: "문의하기" })).toBeInTheDocument();
      expect(inquiryBtn.getAttribute("aria-current")).toBeNull();
      const listBtn = Array.from(nav.querySelectorAll("button")).find((b) => b.textContent === "목록");
      expect(listBtn?.getAttribute("aria-current")).toBe("page");
      expect(screen.getByText(/테스트파크1차/)).toBeInTheDocument();
    });

    it("문의 모달을 닫고 목록을 누르면 목록 그대로다", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });

      render(<App />);

      await waitFor(() => {
        expect(screen.getByText(/테스트파크1차/)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("feedback-fab"));
      await screen.findByRole("dialog", { name: "문의하기" });
      await user.keyboard("{Escape}");
      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "문의하기" })).not.toBeInTheDocument();
      });

      await user.click(screen.getByText("목록"));

      await waitFor(() => {
        expect(screen.getByText(/테스트파크1차/)).toBeInTheDocument();
      });
    });
  });

  // 4. 데이터 에러 → 에러 메시지 + 재시도 버튼
  describe("데이터 에러 처리", () => {
    it("데이터 로딩 실패 시 에러 메시지와 재시도 버튼이 표시된다", async () => {
      vi.useFakeTimers();
      mockFetch.mockRejectedValue(new Error("네트워크 오류"));

      render(<App />);

      // 재시도 3회: 2s + 4s 딜레이 → 타이머 진행
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4500);
      });

      expect(screen.getByText(/데이터 로딩 실패/)).toBeInTheDocument();

      // 재시도 버튼 존재
      const retryBtn = screen.getByText("다시 시도");
      expect(retryBtn).toBeInTheDocument();

      vi.useRealTimers();
    });

    it("재시도 버튼 클릭 시 다시 데이터 로드를 시도한다", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      // 처음 3번 실패, 이후 성공
      mockFetch
        .mockRejectedValueOnce(new Error("오류1"))
        .mockRejectedValueOnce(new Error("오류2"))
        .mockRejectedValueOnce(new Error("오류3"))
        .mockResolvedValueOnce({ data: makeTestApartments(), dataUpdatedAt: null });

      render(<App />);

      // 재시도 딜레이 진행
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4500);
      });

      expect(screen.getByText(/데이터 로딩 실패/)).toBeInTheDocument();

      // 재시도 버튼 클릭 (fake timer + userEvent는 호환 이슈 → fireEvent 사용)
      const retryBtn = screen.getByText("다시 시도");
      await act(async () => {
        retryBtn.click();
      });

      // 성공 시 카드 표시 대기
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(screen.getByText(/테스트파크1차/)).toBeInTheDocument();
      });
    });
  });

  // 5. hideNoUnsold 토글 — 미분양 없는 단지 표시/숨기기
  describe("미분양 필터 토글", () => {
    it("기본 상태에서 unsoldRate > 0인 아파트만 표시된다", async () => {
      const data = [
        ...makeTestApartments(),
        { ...makeTestApartments()[0], id: "apt3", name: "완판아파트", unsoldRate: 0, unsold: 0 },
      ];
      mockFetch.mockResolvedValue({ data, dataUpdatedAt: null });

      render(<App />);

      await waitFor(() => {
        expect(screen.getByText(/테스트파크1차/)).toBeInTheDocument();
      });

      // unsoldRate=0인 완판아파트는 기본 숨김
      expect(screen.queryByText(/완판아파트/)).not.toBeInTheDocument();
    });

    it('"완판 포함" 버튼 클릭 시 모든 아파트가 표시된다', async () => {
      const user = userEvent.setup();
      const data = [
        ...makeTestApartments(),
        { ...makeTestApartments()[0], id: "apt3", name: "완판아파트", unsoldRate: 0, unsold: 0 },
      ];
      mockFetch.mockResolvedValue({ data, dataUpdatedAt: null });

      render(<App />);

      await waitFor(() => {
        expect(screen.getByText(/테스트파크1차/)).toBeInTheDocument();
      });

      // "완판 포함" 버튼 클릭
      const toggleBtn = screen.getByLabelText("미분양 없는 단지 보기");
      await user.click(toggleBtn);

      // 완판아파트가 이제 보여야 함
      await waitFor(() => {
        expect(screen.getByText(/완판아파트/)).toBeInTheDocument();
      });
    });
  });

  // 8. 통합 홈 (VITE_FEATURE_HOME ON) — OFF 경로는 위 기존 테스트 전체가 회귀 가드
  describe("VITE_FEATURE_HOME flag ON", () => {
    beforeEach(() => {
      // 깃발이 켜지면 App 이 /api/upcoming fetch 를 실행 — 실 fetch reject 의 act 밖 setState flaky 방지.
      // (옛 주석은 "CI 가 VITE_FEATURE_UPCOMING=true" 라 했으나 **vitest 를 돌리는 `ci.yml` 의 Test
      //  스텝에는 env 주입이 0 건**이다. 이제 그 기본값은 setup.js 가 OFF 로 고정한다 — 세션555.
      //  ⚠️ 별개로 `e2e.yml:59~60` 은 두 깃발을 "true" 로 주입한다. Playwright 는 vitest setup 을
      //  안 타므로 충돌하지 않지만, "CI 는 언제나 OFF" 로 읽지 말 것.)
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            ok: true,
            stages: { plan: [], apply: [], sale: [] },
            totals: { plan: 0, apply: 0, sale: 0 },
            calendar: {},
          }),
        })
      );
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    // ── 회귀 가드 (세션 487) ──
    // 사장님 지시로 도메인 착륙 지점을 홈 → 목록으로 바꿨다. 이 두 건이 없으면
    // 누가 `isFeatureHome() ? "home" : "list"` 로 되돌려도 아무도 모른다.
    it("홈 기능이 켜져 있어도 도메인 착륙 지점은 **목록**이다", async () => {
      vi.stubEnv("VITE_FEATURE_HOME", "true");
      mockFetch.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });
      render(<App />);
      // 목록 화면의 표식(필터 바의 지역 버튼)이 먼저 보이고,
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: /지역/ }).length).toBeGreaterThan(0);
      });
      // 홈 위젯은 안 보인다.
      expect(screen.queryByText("📊 시장 현황판")).toBeNull();
    });

    // 세션 577(A-12): 메뉴에서 홈을 뺐다 — 깃발을 켜도 홈 버튼이 없다(HomePage 코드는 한 달 뒤 삭제 전까지 남는다)
    it("홈 기능이 켜져 있어도 메뉴에 홈 버튼이 없다", async () => {
      vi.stubEnv("VITE_FEATURE_HOME", "true");
      mockFetch.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });
      render(<App />);
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: /지역/ }).length).toBeGreaterThan(0);
      });
      expect(screen.queryAllByRole("button", { name: "홈" })).toHaveLength(0);
    });

    it("?compare= 딥링크: list 탭 전환 + 비교 시트 열림 (홈이 기본 탭이어도 보존)", async () => {
      vi.stubEnv("VITE_FEATURE_HOME", "true");
      window.history.replaceState(null, "", "/?compare=apt1,apt2");
      mockFetch.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });
      render(<App />);
      await waitFor(() => {
        expect(screen.getByText(/2개 비교/)).toBeInTheDocument();
      });
      window.history.replaceState(null, "", "/");
    });

    // ── 세션 503(단계 2-B): 상세 진입 게이트 폐지 ──
    // 세션413 의 "게이트 일괄 차단"을 뒤집은 것. 구글봇은 언제나 비로그인이라, 게이트가 있으면
    // 색인할 내용이 0 이라 sitemap 을 아무리 늘려도 헛수고였다. 이제 상세는 열리고 점수만 가린다(2-A).
    it("옛 ?detail= 딥링크 (비로그인): 상세가 열리고 주소가 /apt/{id} 로 승격된다", async () => {
      vi.stubEnv("VITE_FEATURE_HOME", "true");
      window.history.replaceState(null, "", "/?detail=apt1");
      mockFetch.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });
      render(<App />);
      await waitFor(() => {
        expect(screen.getByRole("dialog", { name: /상세 분석/ })).toBeInTheDocument();
      });
      expect(screen.queryByRole("dialog", { name: "로그인 안내" })).not.toBeInTheDocument();
      await waitFor(() => {
        expect(window.location.pathname).toBe("/apt/apt1");
      });
      window.history.replaceState(null, "", "/");
    });

    it("경로형 /apt/{id} 직진입 (비로그인): 그 단지 상세가 열린다", async () => {
      vi.stubEnv("VITE_FEATURE_HOME", "true");
      window.history.replaceState(null, "", "/apt/apt1");
      mockFetch.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });
      render(<App />);
      await waitFor(() => {
        expect(screen.getByRole("dialog", { name: /상세 분석/ })).toBeInTheDocument();
      });
      // 복원 전에 주소가 지워지면 안 된다 (첫 렌더 prev=null 가드)
      expect(window.location.pathname).toBe("/apt/apt1");
      window.history.replaceState(null, "", "/");
    });

    // (세션 577: "홈 추천 카드 상세 클릭" 시험 삭제 — 메뉴에서 홈이 빠져 손님이 홈 탭에 갈 길이 없다. HomePage 는 한 달 뒤 코드째 삭제)
  });

  // 세션574: 떠 있는 "의견" 버튼 → 세션 577(A-12): "문의" 버튼 + 문의 모달(의견·업체 문의 탭)
  describe("문의 버튼", () => {
    it("비로그인이 누르면 문의 모달이 열리고, 의견 탭의 로그인 버튼 → 로그인 안내(의견 문구)", async () => {
      mockFetch.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });
      render(<App />);
      const fab = screen.getByTestId("feedback-fab");
      await act(async () => {
        fab.click();
      });
      await waitFor(() => {
        expect(screen.getByTestId("feedback-form")).toBeInTheDocument();
      });
      expect(screen.queryByRole("dialog", { name: "로그인 안내" })).not.toBeInTheDocument();
      await act(async () => {
        screen.getByRole("button", { name: "카카오 로그인하고 의견 보내기" }).click();
      });
      expect(screen.getByRole("dialog", { name: "로그인 안내" })).toBeInTheDocument();
      expect(screen.getAllByText(/의견은 카카오 로그인 후/).length).toBeGreaterThan(0);
      expect(screen.queryByTestId("feedback-form")).not.toBeInTheDocument();
    });

    it("지도 탭에서는 의견 버튼을 그리지 않는다 (현위치·선택 단지 카드와 겹침 — 사장님 결정)", async () => {
      localStorage.setItem("authToken", "user-token");
      mockFetch.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });
      render(<App />);
      expect(screen.getByTestId("feedback-fab")).toBeInTheDocument();
      const mapNav = screen.getByRole("navigation", { name: "메인 내비게이션" }).querySelectorAll("button");
      const mapBtn = Array.from(mapNav).find((b) => b.textContent === "지도");
      expect(mapBtn).toBeTruthy();
      await act(async () => {
        /** @type {HTMLButtonElement} */ (mapBtn).click();
      });
      await waitFor(() => {
        expect(screen.queryByTestId("feedback-fab")).not.toBeInTheDocument();
      });
    });

    it("로그인 손님이 누르면 의견 폼이 열리고 현재 화면이 첨부된다", async () => {
      localStorage.setItem("authToken", "user-token");
      mockFetch.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });
      render(<App />);
      await act(async () => {
        screen.getByTestId("feedback-fab").click();
      });
      await waitFor(() => {
        expect(screen.getByTestId("feedback-form")).toBeInTheDocument();
      });
      expect(screen.getByTestId("feedback-context").textContent).toMatch(/^현재 화면: /);
      expect(screen.queryByRole("dialog", { name: "로그인 안내" })).not.toBeInTheDocument();
    });
  });
});
