// @ts-check
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecentlyViewed, MAX_RECENT } from './useRecentlyViewed';

describe('useRecentlyViewed', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('초기 상태: 빈 배열', () => {
    const { result } = renderHook(() => useRecentlyViewed(vi.fn()));
    expect(result.current.recentIds).toEqual([]);
  });

  it('recordView: 본 단지를 맨 앞에 추가', () => {
    const { result } = renderHook(() => useRecentlyViewed(vi.fn()));
    act(() => { result.current.recordView('apt-1'); });
    act(() => { result.current.recordView('apt-2'); });
    // 최근이 맨 앞 (apt-2가 더 최근)
    expect(result.current.recentIds).toEqual(['apt-2', 'apt-1']);
  });

  it('recordView: 이미 본 단지 다시 보면 맨 앞으로 이동 (중복 제거)', () => {
    const { result } = renderHook(() => useRecentlyViewed(vi.fn()));
    act(() => { result.current.recordView('apt-1'); });
    act(() => { result.current.recordView('apt-2'); });
    act(() => { result.current.recordView('apt-1'); }); // apt-1 다시
    expect(result.current.recentIds).toEqual(['apt-1', 'apt-2']);
    // 중복 없음
    expect(result.current.recentIds).toHaveLength(2);
  });

  it('recordView: 같은 단지 연속 열람 = no-op (맨 앞 동일)', () => {
    const { result } = renderHook(() => useRecentlyViewed(vi.fn()));
    act(() => { result.current.recordView('apt-1'); });
    const before = result.current.recentIds;
    act(() => { result.current.recordView('apt-1'); }); // 맨 앞 동일
    expect(result.current.recentIds).toBe(before); // 참조 동일(리렌더 방지)
  });

  it('recordView: 빈 id 무시', () => {
    const { result } = renderHook(() => useRecentlyViewed(vi.fn()));
    act(() => { result.current.recordView(''); });
    expect(result.current.recentIds).toEqual([]);
  });

  it(`MAX_RECENT(${MAX_RECENT}) 초과 시 가장 오래된 것 절단`, () => {
    const { result } = renderHook(() => useRecentlyViewed(vi.fn()));
    act(() => {
      for (let i = 0; i < MAX_RECENT + 3; i++) result.current.recordView(`apt-${i}`);
    });
    expect(result.current.recentIds).toHaveLength(MAX_RECENT);
    // 가장 최근(마지막 기록)이 맨 앞
    expect(result.current.recentIds[0]).toBe(`apt-${MAX_RECENT + 2}`);
    // 가장 오래된 apt-0, apt-1, apt-2 는 밀려남
    expect(result.current.recentIds).not.toContain('apt-0');
  });

  it('clearRecent: 전체 비우기', () => {
    const { result } = renderHook(() => useRecentlyViewed(vi.fn()));
    act(() => { result.current.recordView('apt-1'); });
    act(() => { result.current.recordView('apt-2'); });
    act(() => { result.current.clearRecent(); });
    expect(result.current.recentIds).toEqual([]);
  });

  it('localStorage 복원: 저장된 배열 로드 (상한 절단)', () => {
    const arr = Array.from({ length: MAX_RECENT + 5 }, (_, i) => `saved-${i}`);
    localStorage.setItem('mibunyang_recent', JSON.stringify(arr));
    const { result } = renderHook(() => useRecentlyViewed(vi.fn()));
    expect(result.current.recentIds).toHaveLength(MAX_RECENT);
    expect(result.current.recentIds[0]).toBe('saved-0');
  });

  it('localStorage 복원: 오염 값(객체) → 빈 배열', () => {
    localStorage.setItem('mibunyang_recent', JSON.stringify({ foo: 'bar' }));
    const { result } = renderHook(() => useRecentlyViewed(vi.fn()));
    expect(result.current.recentIds).toEqual([]);
  });

  it('localStorage 복원: 비문자열·빈 문자열 원소 필터링', () => {
    localStorage.setItem('mibunyang_recent', JSON.stringify(['apt-1', 123, null, '', 'apt-2']));
    const { result } = renderHook(() => useRecentlyViewed(vi.fn()));
    expect(result.current.recentIds).toEqual(['apt-1', 'apt-2']);
  });

  it('localStorage JSON 파싱 실패 → 빈 배열', () => {
    localStorage.setItem('mibunyang_recent', 'invalid json{{{');
    const { result } = renderHook(() => useRecentlyViewed(vi.fn()));
    expect(result.current.recentIds).toEqual([]);
  });

  it('변경 시 localStorage에 배열로 저장', () => {
    const { result } = renderHook(() => useRecentlyViewed(vi.fn()));
    act(() => { result.current.recordView('apt-9'); });
    const saved = JSON.parse(localStorage.getItem('mibunyang_recent') ?? '[]');
    expect(saved).toEqual(['apt-9']);
  });

  it('cross-tab: 다른 탭 storage 이벤트 수신 → 동기화', () => {
    const { result } = renderHook(() => useRecentlyViewed(vi.fn()));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'mibunyang_recent', newValue: JSON.stringify(['apt-10', 'apt-20']),
      }));
    });
    expect(result.current.recentIds).toEqual(['apt-10', 'apt-20']);
  });

  it('관련 없는 storage 이벤트 무시', () => {
    const { result } = renderHook(() => useRecentlyViewed(vi.fn()));
    act(() => { result.current.recordView('apt-1'); });
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'other_key', newValue: 'something' }));
    });
    expect(result.current.recentIds).toEqual(['apt-1']);
  });

  it('quota exceeded 시 showToast 호출', () => {
    const showToast = vi.fn();
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn((key) => {
      if (key === 'mibunyang_recent') {
        throw new DOMException('quota', 'QuotaExceededError');
      }
    });
    const { result } = renderHook(() => useRecentlyViewed(showToast));
    act(() => { result.current.recordView('apt-1'); });
    expect(showToast).toHaveBeenCalledWith('저장 실패: 저장소가 가득 찼습니다');
    Storage.prototype.setItem = origSet;
  });
});
