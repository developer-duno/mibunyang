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

  it('resize 이벤트로 업데이트', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
    const { result } = renderHook(() => useResponsive());
    expect(result.current.isPC).toBe(true);

    act(() => {
      Object.defineProperty(window, 'innerWidth', { value: 500, writable: true });
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.isPC).toBe(false);
  });

  it('언마운트 시 리스너 제거', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useResponsive());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    removeSpy.mockRestore();
  });
});
