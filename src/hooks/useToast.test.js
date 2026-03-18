/**
 * useToast 훅 테스트
 *
 * 토스트 메시지 표시/자동 소멸 훅의 동작을 검증합니다.
 * - showToast 호출 시 toast 상태가 설정되는지
 * - 2200ms 후 자동으로 빈 문자열로 초기화되는지
 * - 연속 호출 시 이전 타이머가 취소되는지
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToast } from './useToast';

describe('useToast', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  // 초기 상태는 빈 문자열
  it('초기 toast는 빈 문자열이다', () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toast).toBe('');
  });

  // showToast 호출 시 메시지가 설정된다
  it('showToast 호출 시 toast가 설정된다', () => {
    const { result } = renderHook(() => useToast());
    act(() => { result.current.showToast('저장 완료'); });
    expect(result.current.toast).toBe('저장 완료');
  });

  // 2200ms 후 자동으로 빈 문자열
  it('2200ms 후 toast가 자동으로 빈 문자열이 된다', () => {
    const { result } = renderHook(() => useToast());
    act(() => { result.current.showToast('알림'); });
    expect(result.current.toast).toBe('알림');

    // 2199ms — 아직 남아있음
    act(() => { vi.advanceTimersByTime(2199); });
    expect(result.current.toast).toBe('알림');

    // 2200ms — 소멸
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.toast).toBe('');
  });

  // 연속 호출 시 이전 타이머 취소, 마지막 메시지만 유지
  it('연속 호출 시 이전 타이머가 취소되고 마지막 메시지만 유지된다', () => {
    const { result } = renderHook(() => useToast());

    act(() => { result.current.showToast('첫번째'); });
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { result.current.showToast('두번째'); });

    // 두번째 호출 후 1200ms (첫번째 기준 2200ms 지남) — 여전히 두번째
    act(() => { vi.advanceTimersByTime(1200); });
    expect(result.current.toast).toBe('두번째');

    // 두번째 기준 2200ms 경과
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.toast).toBe('');
  });

  // 빈 문자열 메시지 → 여전히 설정됨 (빈 문자열도 유효한 메시지)
  it('빈 문자열 메시지도 설정된다', () => {
    const { result } = renderHook(() => useToast());
    act(() => { result.current.showToast(''); });
    // showToast는 setToast(msg)를 호출하므로 빈 문자열이 설정됨
    // 단, 빈 문자열은 falsy이므로 UI에서 렌더링되지 않을 수 있음
    expect(result.current.toast).toBe('');
  });

  // 동시 다중 호출 → 마지막 메시지만 유지
  it('동시 다중 호출 시 마지막 메시지만 유지된다', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('첫번째');
      result.current.showToast('두번째');
      result.current.showToast('세번째');
    });

    // 마지막 호출 메시지만 남음
    expect(result.current.toast).toBe('세번째');

    // 2200ms 후 소멸
    act(() => { vi.advanceTimersByTime(2200); });
    expect(result.current.toast).toBe('');
  });
});
