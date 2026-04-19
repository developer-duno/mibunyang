import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLoginGate } from './useLoginGate';

describe('useLoginGate', () => {
  const makeDeps = (overrides = {}) => ({
    isLoggedIn: false,
    detail: { handleOpenDetail: vi.fn() },
    kakao: { initKakaoLogin: vi.fn() },
    setTab: vi.fn(),
    ...overrides,
  });

  it('초기 상태: 모달 닫힘, trigger/pendingId null', () => {
    const { result } = renderHook(() => useLoginGate(makeDeps()));
    expect(result.current.showLoginPrompt).toBe(false);
    expect(result.current.loginTrigger).toBeNull();
  });

  it('로그인 상태 + 카드 클릭 → 상세 모달 바로 열림 (게이트 통과)', () => {
    const detail = { handleOpenDetail: vi.fn() };
    const { result } = renderHook(() => useLoginGate(makeDeps({ isLoggedIn: true, detail })));

    act(() => { result.current.handleDetailGated(42); });

    expect(detail.handleOpenDetail).toHaveBeenCalledWith(42);
    expect(result.current.showLoginPrompt).toBe(false);
  });

  it('비로그인 + 카드 클릭 → 로그인 모달 + trigger="detail" 세팅', () => {
    const detail = { handleOpenDetail: vi.fn() };
    const { result } = renderHook(() => useLoginGate(makeDeps({ isLoggedIn: false, detail })));

    act(() => { result.current.handleDetailGated(99); });

    expect(detail.handleOpenDetail).not.toHaveBeenCalled();
    expect(result.current.showLoginPrompt).toBe(true);
    expect(result.current.loginTrigger).toBe('detail');
  });

  it('카카오 버튼 → 모달 닫히고 pendingDetailId 전달', () => {
    const kakao = { initKakaoLogin: vi.fn() };
    const detail = { handleOpenDetail: vi.fn() };
    const { result } = renderHook(() => useLoginGate(makeDeps({ kakao, detail })));

    // 비로그인 상태에서 상세 게이트 → pendingDetailId=77 저장
    act(() => { result.current.handleDetailGated(77); });
    act(() => { result.current.handleKakaoFromPrompt(); });

    expect(result.current.showLoginPrompt).toBe(false);
    expect(kakao.initKakaoLogin).toHaveBeenCalledWith(77);
  });

  it('전문가 로그인 버튼 → 모달 닫히고 expertLogin 탭으로 전환', () => {
    const setTab = vi.fn();
    const { result } = renderHook(() => useLoginGate(makeDeps({ setTab })));

    act(() => { result.current.setShowLoginPrompt(true); });
    act(() => { result.current.handleExpertFromPrompt(); });

    expect(result.current.showLoginPrompt).toBe(false);
    expect(setTab).toHaveBeenCalledWith('expertLogin');
  });
});
