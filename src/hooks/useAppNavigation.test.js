/**
 * useAppNavigation 훅 테스트
 *
 * 탭 전환/인증 네비게이션 훅의 동작을 검증합니다.
 * - handleExpertLogin: 결과 role 에 따라 admin/expert 탭 + userRole 저장
 * - handleExpertLogout: expert.handleExpertLogout 에 reset 콜백 전달
 * - switchTo* / handleExpertView: 단순 탭 전환
 * - handleNavClick: logout/list/map(비로그인 차단)/compare/consult 분기
 *
 * admin 은 AdminMode 전체 타입이지만 본 훅이 쓰는 필드만 mock → 객체에 any cast.
 */
// @ts-check
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppNavigation } from './useAppNavigation';

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

/** 기본 args — 테스트별 override 로 일부만 교체. */
function makeArgs(override = {}) {
  const base = {
    tab: 'list',
    setTab: vi.fn(),
    expert: {
      expertLoggedIn: false,
      handleExpertLogin: vi.fn().mockResolvedValue({ ok: true, role: 'expert' }),
      handleExpertLogout: vi.fn(),
      setExpertExpandedApt: vi.fn(),
    },
    admin: { adminLoggedIn: false, setAdminLoggedIn: vi.fn() },
    consult: {
      consultSubmitted: false,
      setConsultSubmitted: vi.fn(),
      setConsultForm: vi.fn(),
      fetchConsults: vi.fn(),
    },
    detail: { setDetailAptId: vi.fn() },
    compIds: [],
    setShowCompOpen: vi.fn(),
    showToast: vi.fn(),
    budgetMin: null,
    budgetMax: null,
    isLoggedIn: true,
    onLoginRequired: vi.fn(),
  };
  return /** @type {any} */ ({ ...base, ...override });
}

describe('useAppNavigation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // 레거시 비admin(expert) 결과 → 일반 손님 취급 (세션 405 — PR-3 에서 백엔드가 401 차단)
  it('handleAdminLogin: 비admin 결과면 list/home 으로 폴스루한다', async () => {
    const args = makeArgs();
    const { result } = renderHook(() => useAppNavigation(args));

    await result.current.handleAdminLogin();
    expect(args.setTab).toHaveBeenCalledWith('list'); // featureFlag OFF 테스트 환경 = list
    expect(args.setTab).not.toHaveBeenCalledWith('expert');
    expect(localStorage.getItem('userRole')).toBe('expert'); // 서버 role 그대로 보존
  });

  // admin 로그인 → admin 탭 + setAdminLoggedIn + userRole=admin
  it('handleAdminLogin: admin 결과면 admin 탭으로 전환한다', async () => {
    const args = makeArgs({
      expert: {
        expertLoggedIn: false,
        handleExpertLogin: vi.fn().mockResolvedValue({ ok: true, role: 'admin' }),
        handleExpertLogout: vi.fn(),
      },
    });
    const { result } = renderHook(() => useAppNavigation(args));

    await result.current.handleAdminLogin();
    expect(args.admin.setAdminLoggedIn).toHaveBeenCalledWith(true);
    expect(args.setTab).toHaveBeenCalledWith('admin');
    expect(localStorage.getItem('userRole')).toBe('admin');
  });

  // 로그인 실패(ok=false) → 탭 미전환
  it('handleAdminLogin: ok=false 면 탭을 전환하지 않는다', async () => {
    const args = makeArgs({
      expert: {
        expertLoggedIn: false,
        handleExpertLogin: vi.fn().mockResolvedValue({ ok: false }),
        handleExpertLogout: vi.fn(),
      },
    });
    const { result } = renderHook(() => useAppNavigation(args));

    await result.current.handleAdminLogin();
    expect(args.setTab).not.toHaveBeenCalled();
  });

  // 로그아웃 → expert.handleExpertLogout 에 reset 콜백 전달, 콜백 실행 시 list 탭
  it('handleLogout: reset 콜백이 list 탭으로 되돌린다', () => {
    const args = makeArgs();
    const { result } = renderHook(() => useAppNavigation(args));

    result.current.handleLogout();
    expect(args.expert.handleExpertLogout).toHaveBeenCalledTimes(1);

    // 전달된 reset 콜백을 직접 실행 → list 탭 + 비교창 닫기
    const resetCb = args.expert.handleExpertLogout.mock.calls[0][0];
    resetCb();
    expect(args.setTab).toHaveBeenCalledWith('list');
    expect(args.setShowCompOpen).toHaveBeenCalledWith(false);
  });

  // switchToInfo 단순 탭 전환 (switchToAdmin/Expert·handleExpertView 는 세션 405 전문가 폐지로 제거)
  it('switchToInfo 가 info 탭으로 전환한다', () => {
    const args = makeArgs();
    const { result } = renderHook(() => useAppNavigation(args));

    result.current.switchToInfo();
    expect(args.setTab).toHaveBeenCalledWith('info');
  });

  // handleConsultFromDetail → 관심단지 추가 + 상세 닫기 + consult 탭
  it('handleConsultFromDetail: 관심단지 추가 후 consult 탭으로 전환한다', () => {
    const args = makeArgs();
    const { result } = renderHook(() => useAppNavigation(args));

    result.current.handleConsultFromDetail('apt-3');
    expect(args.consult.setConsultForm).toHaveBeenCalledTimes(1);
    expect(args.detail.setDetailAptId).toHaveBeenCalledWith(null);
    expect(args.setTab).toHaveBeenCalledWith('consult');
  });

  // handleNavClick logout → handleExpertLogout 경유
  it('handleNavClick: logout 키는 로그아웃을 호출한다', () => {
    const args = makeArgs();
    const { result } = renderHook(() => useAppNavigation(args));

    result.current.handleNavClick('logout');
    expect(args.expert.handleExpertLogout).toHaveBeenCalledTimes(1);
  });

  // handleNavClick map (비로그인) → onLoginRequired 호출 + 탭 미전환
  it('handleNavClick: 비로그인 상태의 map 키는 로그인 요구 콜백을 부른다', () => {
    const args = makeArgs({ isLoggedIn: false });
    const { result } = renderHook(() => useAppNavigation(args));

    result.current.handleNavClick('map');
    expect(args.onLoginRequired).toHaveBeenCalledTimes(1);
    expect(args.setTab).not.toHaveBeenCalled();
  });

  // handleNavClick compare (선택 2개 미만) → 토스트 + list 탭
  it('handleNavClick: compare 키에 선택이 2개 미만이면 토스트를 띄운다', () => {
    const args = makeArgs({ compIds: ['a'] });
    const { result } = renderHook(() => useAppNavigation(args));

    result.current.handleNavClick('compare');
    expect(args.showToast).toHaveBeenCalledWith('카드에서 2개 이상 선택해주세요');
    expect(args.setTab).toHaveBeenCalledWith('list');
    expect(args.setShowCompOpen).not.toHaveBeenCalledWith(true);
  });

  // handleNavClick compare (선택 2개 이상) → 비교창 열기
  it('handleNavClick: compare 키에 선택이 2개 이상이면 비교창을 연다', () => {
    const args = makeArgs({ compIds: ['a', 'b'] });
    const { result } = renderHook(() => useAppNavigation(args));

    result.current.handleNavClick('compare');
    expect(args.setShowCompOpen).toHaveBeenCalledWith(true);
    expect(args.setTab).toHaveBeenCalledWith('list');
  });

  // handleNavClick list → list 탭 + 비교창 닫기
  it('handleNavClick: list 키는 list 탭으로 가고 비교창을 닫는다', () => {
    const args = makeArgs();
    const { result } = renderHook(() => useAppNavigation(args));

    result.current.handleNavClick('list');
    expect(args.setTab).toHaveBeenCalledWith('list');
    expect(args.setShowCompOpen).toHaveBeenCalledWith(false);
  });

  // useEffect: expert 로그아웃됐는데 admin 켜져 있으면 admin 상태 동기화
  it('expert 로그아웃 + admin 켜짐 상태면 admin 을 끄고 list 로 보낸다', () => {
    const args = makeArgs({
      tab: 'admin',
      expert: {
        expertLoggedIn: false,
        handleExpertLogin: vi.fn(),
        handleExpertLogout: vi.fn(),
        setExpertExpandedApt: vi.fn(),
      },
      admin: { adminLoggedIn: true, setAdminLoggedIn: vi.fn() },
    });
    renderHook(() => useAppNavigation(args));

    expect(args.admin.setAdminLoggedIn).toHaveBeenCalledWith(false);
    expect(args.setTab).toHaveBeenCalledWith('list');
  });
});
