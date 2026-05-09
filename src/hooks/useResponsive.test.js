// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResponsive } from './useResponsive';

describe('useResponsive', () => {
  it('768 이상 → isPC=true', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
    const { result } = renderHook(() => useResponsive());
    expect(result.current.isPC).toBe(true);
  });

  it('768 미만 → isPC=false', () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, writable: true });
    const { result } = renderHook(() => useResponsive());
    expect(result.current.isPC).toBe(false);
  });

  it('정확히 768 → isPC=true', () => {
    Object.defineProperty(window, 'innerWidth', { value: 768, writable: true });
    const { result } = renderHook(() => useResponsive());
    expect(result.current.isPC).toBe(true);
  });

  // isDesktop 경계값 테스트
  it('1024 이상 → isDesktop=true', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true });
    const { result } = renderHook(() => useResponsive());
    expect(result.current.isDesktop).toBe(true);
  });

  it('1023 → isDesktop=false', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1023, writable: true });
    const { result } = renderHook(() => useResponsive());
    expect(result.current.isDesktop).toBe(false);
  });

  it('정확히 1024 → isDesktop=true', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
    const { result } = renderHook(() => useResponsive());
    expect(result.current.isDesktop).toBe(true);
  });

  // 디바운스 resize 테스트
  it('resize 이벤트 디바운스 후 업데이트', () => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
    const { result } = renderHook(() => useResponsive());
    expect(result.current.isPC).toBe(true);

    act(() => {
      Object.defineProperty(window, 'innerWidth', { value: 500, writable: true });
      window.dispatchEvent(new Event('resize'));
    });
    // 디바운스 전에는 아직 이전 값
    expect(result.current.isPC).toBe(true);

    act(() => { vi.advanceTimersByTime(150); });
    // 디바운스 후 업데이트
    expect(result.current.isPC).toBe(false);
    expect(result.current.isDesktop).toBe(false);

    vi.useRealTimers();
  });

  it('언마운트 시 리스너 제거', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useResponsive());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    removeSpy.mockRestore();
  });
});
