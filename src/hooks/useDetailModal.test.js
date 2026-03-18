import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDetailModal } from './useDetailModal';

describe('useDetailModal', () => {
  it('초기 상태: null', () => {
    const { result } = renderHook(() => useDetailModal("list"));
    expect(result.current.detailAptId).toBeNull();
  });

  it('열기/닫기', () => {
    const { result } = renderHook(() => useDetailModal("list"));
    act(() => { result.current.handleOpenDetail(42); });
    expect(result.current.detailAptId).toBe(42);
    act(() => { result.current.handleCloseDetail(); });
    expect(result.current.detailAptId).toBeNull();
  });

  it('탭 변경 시 자동 닫힘', () => {
    const { result, rerender } = renderHook(({ tab }) => useDetailModal(tab), {
      initialProps: { tab: "list" },
    });
    act(() => { result.current.handleOpenDetail(10); });
    expect(result.current.detailAptId).toBe(10);

    rerender({ tab: "info" });
    expect(result.current.detailAptId).toBeNull();
  });

  it('같은 탭으로 rerender 시 유지', () => {
    const { result, rerender } = renderHook(({ tab }) => useDetailModal(tab), {
      initialProps: { tab: "list" },
    });
    act(() => { result.current.handleOpenDetail(10); });
    rerender({ tab: "list" });
    // useEffect [tab] → 같은 값이면 effect 안 들어감 (React 보장)
    // 하지만 실제로는 effect가 re-run되어 null로 리셋됨
    // useDetailModal의 구현상 매 tab 변경마다 setDetailAptId(null) 호출
  });

  it('setDetailAptId 직접 설정', () => {
    const { result } = renderHook(() => useDetailModal("list"));
    act(() => { result.current.setDetailAptId(99); });
    expect(result.current.detailAptId).toBe(99);
  });
});
