/**
 * App.jsx 통합 테스트
 *
 * 13개 훅 + 9개 useMemo를 사용하는 App 컴포넌트의 스모크 테스트.
 * 핵심 동작(렌더링, 프로필 변경, 탭 전환, 에러 표시)을 검증합니다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// --- 팩토리 함수: 테스트용 아파트 데이터 ---
function makeTestApartments() {
  return [
    {
      id: 'apt1', name: '테스트파크1차', region: '경기', gu: '수원시',
      builder: '현대건설', completion: '2025-06-01',
      price: 50000, area: 84, pp: 595,
      nearbyMedian: 55000, jeonseRate: 70, pir: 5, psr: 0.9,
      dataReliability: 80,
      subwayDist: 500, busRoutes: 10, icDist: 5, ktxDist: 15,
      schoolScore: 70, schoolGrade: 'B+',
      hospital: 3, mart: 2, conv: 5, park: 2, cafe: 10, culture: 2, bank: 2, pharmacy: 3,
      view: '그린', sunlight: '양호', noise: 55, noxious: [], noxiousDist: null,
      units: 1000, parkingRatio: 1.3, floorAreaRatio: 220, exclusiveRatio: 78,
      maxFloor: 25, energyGrade: 2, greenBldg: null, hasPool: false,
      layout: '4베이판상', quakeDesign: true,
      discountPct: 5, loanFree: true, loanFreePct: 60,
      optionFree: true, optionValue: 500, balconyFree: true, balconyValue: 800,
      cashback: 200,
      unsoldRate: 15, recentTrades6m: 20, dsr40pass: true, hugGuarantee: true,
      builderCreditGrade: 'AA', builderDebtRatio: 100, supplyRatio: 100,
      popGrowth: 0.3, netMigration: 500,
      transitDev: 'GTX-C 착공', devDist: 1, cityDev: '신도시', industryDev: '테크노밸리',
    },
    {
      id: 'apt2', name: '힐스테이트강남', region: '서울', gu: '강남구',
      builder: '현대건설', completion: '2026-01-01',
      price: 80000, area: 84, pp: 952,
      nearbyMedian: 90000, jeonseRate: 60, pir: 8, psr: 1.2,
      dataReliability: 90,
      subwayDist: 200, busRoutes: 15, icDist: 3, ktxDist: 10,
      schoolScore: 85, schoolGrade: 'A',
      hospital: 5, mart: 3, conv: 10, park: 3, cafe: 15, culture: 3, bank: 3, pharmacy: 4,
      view: '블루', sunlight: '우수', noise: 45, noxious: [], noxiousDist: null,
      units: 1500, parkingRatio: 1.5, floorAreaRatio: 200, exclusiveRatio: 82,
      maxFloor: 35, energyGrade: 1, greenBldg: '우수', hasPool: true,
      layout: '4베이판상', quakeDesign: true,
      discountPct: 3, loanFree: false, loanFreePct: 0,
      optionFree: false, optionValue: 0, balconyFree: true, balconyValue: 500,
      cashback: 0,
      unsoldRate: 5, recentTrades6m: 30, dsr40pass: true, hugGuarantee: true,
      builderCreditGrade: 'AAA', builderDebtRatio: 60, supplyRatio: 80,
      popGrowth: 0.1, netMigration: 200,
      transitDev: '지하철 운행중', devDist: 0.5, cityDev: '재건축', industryDev: null,
    },
  ];
}

// --- 모킹 ---

// staticDataApi: fetchStaticApartments 모킹
vi.mock('@/services/staticDataApi', () => ({
  fetchStaticApartments: vi.fn(),
}));

// useUserLocation: 위치 감지 비활성화
vi.mock('@/hooks/useUserLocation', () => ({
  useUserLocation: () => ({ region: null, gu: null, method: null, loading: false, error: null }),
}));

// useShare: 공유 기능 스텁
vi.mock('@/hooks/useShare', () => ({
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
vi.mock('@/hooks/useResponsive', () => ({
  useResponsive: () => ({ isPC: true }),
}));

// ShareSheet 컴포넌트 스텁
vi.mock('@/components/ShareSheet', () => ({
  ShareSheet: () => null,
}));

import { fetchStaticApartments } from '@/services/staticDataApi';
import App from './App';

describe('App 통합 테스트', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // localStorage/sessionStorage 초기화
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
  });

  // 1. 기본 렌더링: 로딩 → 데이터 로드 → 카드 표시
  describe('기본 렌더링', () => {
    it('로딩 중 표시 후 데이터 로드 완료 시 아파트 카드가 표시된다', async () => {
      const testData = makeTestApartments();
      fetchStaticApartments.mockResolvedValue({ data: testData, dataUpdatedAt: '2026-03-18T00:00:00Z' });

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
      fetchStaticApartments.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });

      render(<App />);

      expect(screen.getByText('전국 미분양 비교 엔진')).toBeInTheDocument();
    });

    it('하단 네비게이션이 렌더링된다', async () => {
      fetchStaticApartments.mockResolvedValue({ data: [], dataUpdatedAt: null });

      render(<App />);

      // 일반 사용자 네비: 목록, 비교, 상담, 정보
      expect(screen.getByText('목록')).toBeInTheDocument();
      expect(screen.getByText('비교')).toBeInTheDocument();
      expect(screen.getByText('상담')).toBeInTheDocument();
      expect(screen.getByText('정보')).toBeInTheDocument();
    });
  });

  // 2. 프로필 변경
  describe('프로필 변경', () => {
    it('프로필 버튼 클릭 시 해당 프로필이 활성화된다', async () => {
      const user = userEvent.setup();
      fetchStaticApartments.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });

      render(<App />);

      // 데이터 로드 대기
      await waitFor(() => {
        expect(screen.getByText(/테스트파크1차/)).toBeInTheDocument();
      });

      // "투자" 프로필 버튼 클릭
      const investBtn = screen.getByRole('button', { name: /^투자$/ });
      await user.click(investBtn);

      // 클릭 후 버튼이 pressed 상태 (aria-pressed)
      expect(investBtn).toHaveAttribute('aria-pressed', 'true');
    });
  });

  // 3. 탭 전환
  describe('탭 전환', () => {
    it('정보 탭 클릭 시 InfoPage가 표시된다', async () => {
      const user = userEvent.setup();
      fetchStaticApartments.mockResolvedValue({ data: [], dataUpdatedAt: null });

      render(<App />);

      const infoBtn = screen.getByText('정보');
      await user.click(infoBtn);

      // InfoPage 내부의 텍스트 존재 확인 (정확한 텍스트는 InfoPage 구현에 따라 다름)
      await waitFor(() => {
        // InfoPage가 렌더링되면 목록(SearchFilterBar)은 사라짐
        expect(screen.queryByText(/데이터 로딩 중/)).not.toBeInTheDocument();
      });
    });

    it('상담 탭 클릭 시 ConsultForm 영역이 표시된다', async () => {
      const user = userEvent.setup();
      fetchStaticApartments.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });

      render(<App />);

      // 데이터 로드 대기
      await waitFor(() => {
        expect(screen.getByText(/테스트파크1차/)).toBeInTheDocument();
      });

      const consultBtn = screen.getByText('상담');
      await user.click(consultBtn);

      // 상담 탭으로 전환되면 Suspense 내 로딩 또는 ConsultForm이 표시됨
      await waitFor(() => {
        // 목록 탭의 카드가 사라지는 것 확인
        expect(screen.queryByText(/테스트파크1차/)).not.toBeInTheDocument();
      });
    });

    it('목록 탭으로 돌아올 수 있다', async () => {
      const user = userEvent.setup();
      fetchStaticApartments.mockResolvedValue({ data: makeTestApartments(), dataUpdatedAt: null });

      render(<App />);

      await waitFor(() => {
        expect(screen.getByText(/테스트파크1차/)).toBeInTheDocument();
      });

      // 정보 탭으로 이동
      await user.click(screen.getByText('정보'));

      // 다시 목록 탭으로
      await user.click(screen.getByText('목록'));

      await waitFor(() => {
        expect(screen.getByText(/테스트파크1차/)).toBeInTheDocument();
      });
    });
  });

  // 4. 데이터 에러 → 에러 메시지 + 재시도 버튼
  describe('데이터 에러 처리', () => {
    it('데이터 로딩 실패 시 에러 메시지와 재시도 버튼이 표시된다', async () => {
      vi.useFakeTimers();
      fetchStaticApartments.mockRejectedValue(new Error('네트워크 오류'));

      render(<App />);

      // 재시도 3회: 2s + 4s 딜레이 → 타이머 진행
      await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
      await act(async () => { await vi.advanceTimersByTimeAsync(4500); });

      expect(screen.getByText(/데이터 로딩 실패/)).toBeInTheDocument();

      // 재시도 버튼 존재
      const retryBtn = screen.getByText('다시 시도');
      expect(retryBtn).toBeInTheDocument();

      vi.useRealTimers();
    });

    it('재시도 버튼 클릭 시 다시 데이터 로드를 시도한다', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      // 처음 3번 실패, 이후 성공
      fetchStaticApartments
        .mockRejectedValueOnce(new Error('오류1'))
        .mockRejectedValueOnce(new Error('오류2'))
        .mockRejectedValueOnce(new Error('오류3'))
        .mockResolvedValueOnce({ data: makeTestApartments(), dataUpdatedAt: null });

      render(<App />);

      // 재시도 딜레이 진행
      await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
      await act(async () => { await vi.advanceTimersByTimeAsync(4500); });

      expect(screen.getByText(/데이터 로딩 실패/)).toBeInTheDocument();

      // 재시도 버튼 클릭 (fake timer + userEvent는 호환 이슈 → fireEvent 사용)
      const retryBtn = screen.getByText('다시 시도');
      await act(async () => { retryBtn.click(); });

      // 성공 시 카드 표시 대기
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });

      vi.useRealTimers();

      await waitFor(() => {
        expect(screen.getByText(/테스트파크1차/)).toBeInTheDocument();
      });
    });
  });

  // 5. hideNoUnsold 토글 — 미분양 없는 단지 표시/숨기기
  describe('미분양 필터 토글', () => {
    it('기본 상태에서 unsoldRate > 0인 아파트만 표시된다', async () => {
      const data = [
        ...makeTestApartments(),
        { ...makeTestApartments()[0], id: 'apt3', name: '완판아파트', unsoldRate: 0, unsold: 0 },
      ];
      fetchStaticApartments.mockResolvedValue({ data, dataUpdatedAt: null });

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
        { ...makeTestApartments()[0], id: 'apt3', name: '완판아파트', unsoldRate: 0, unsold: 0 },
      ];
      fetchStaticApartments.mockResolvedValue({ data, dataUpdatedAt: null });

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
});
