/**
 * useDebouncedValue 훅 테스트
 *
 * 검색 입력 등에서 값 변경을 지연시키는 debounce 훅의 동작을 검증합니다.
 * - 초기값이 즉시 반환되는지
 * - 지정된 ms 후에 새 값이 반영되는지
 * - 연속 변경 시 마지막 값만 반영되는지
 */
// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  // 초기값이 즉시 반환되어야 한다
  it('초기값을 즉시 반환한다', () => {
    const { result } = renderHook(() => useDebouncedValue('hello', 300));
    expect(result.current).toBe('hello');
  });

  // 300ms 후에 새 값이 반영되어야 한다
  it('지정된 ms 후에 새 값이 반영된다', () => {
    const { result, rerender } = renderHook(
      ({ value, ms }) => useDebouncedValue(value, ms),
      { initialProps: { value: 'a', ms: 300 } },
    );
    expect(result.current).toBe('a');

    // 값 변경
    rerender({ value: 'b', ms: 300 });
    // 아직 반영 안됨
    expect(result.current).toBe('a');

    // 300ms 경과
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe('b');
  });

  // 연속 변경 시 마지막 값만 반영
  it('연속 변경 시 마지막 값만 반영된다', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: '1' } },
    );

    rerender({ value: '2' });
    act(() => { vi.advanceTimersByTime(100); });
    rerender({ value: '3' });
    act(() => { vi.advanceTimersByTime(100); });
    rerender({ value: '4' });

    // 300ms 경과 — 마지막 값 '4'만 반영
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe('4');
  });

  // 기본 ms = 300
  it('기본 딜레이는 300ms이다', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value),
      { initialProps: { value: 'init' } },
    );

    rerender({ value: 'updated' });
    act(() => { vi.advanceTimersByTime(299); });
    expect(result.current).toBe('init');

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe('updated');
  });

  // 0ms 딜레이 → 즉시 반영
  it('0ms 딜레이면 타이머 경과 후 즉시 반영된다', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 0),
      { initialProps: { value: 'a' } },
    );
    rerender({ value: 'b' });
    // setTimeout(fn, 0) 도 비동기이므로 타이머 진행 필요
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current).toBe('b');
  });

  // 연속 빠른 변경 10회 → 마지막 값만 반영
  it('연속 10회 빠른 변경 시 마지막 값만 반영된다', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: 'v0' } },
    );

    for (let i = 1; i <= 10; i++) {
      rerender({ value: `v${i}` });
      act(() => { vi.advanceTimersByTime(10); }); // 10ms 간격으로 변경 (200ms 미만)
    }

    // 아직 마지막 변경 후 200ms 안 지남 → v0 또는 중간값이 아닌 이전 값
    expect(result.current).not.toBe('v10');

    // 200ms 경과 → 마지막 값만 반영
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe('v10');
  });
});
