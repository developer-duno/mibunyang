import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFavorites } from './useFavorites';

describe('useFavorites', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('초기 상태: 빈 배열', () => {
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favoriteIds).toEqual([]);
  });

  it('localStorage에서 즐겨찾기 복원', () => {
    localStorage.setItem("mibunyang_fav", JSON.stringify([1, 2, 3]));
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favoriteIds).toEqual([1, 2, 3]);
  });

  it('localStorage JSON 파싱 실패 → 빈 배열', () => {
    localStorage.setItem("mibunyang_fav", "invalid json{{{");
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favoriteIds).toEqual([]);
  });

  it('토글 추가', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => { result.current.toggleFavorite(1); });
    expect(result.current.favoriteIds).toEqual([1]);
  });

  it('토글 제거', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => { result.current.toggleFavorite(1); });
    act(() => { result.current.toggleFavorite(1); });
    expect(result.current.favoriteIds).toEqual([]);
  });

  it('변경 시 localStorage에 자동 저장', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => { result.current.toggleFavorite(5); });
    expect(JSON.parse(localStorage.getItem("mibunyang_fav"))).toEqual([5]);
  });

  it('cross-tab storage 이벤트로 동기화', () => {
    const { result } = renderHook(() => useFavorites());
    // 다른 탭에서 변경 시뮬레이션
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: "mibunyang_fav",
        newValue: JSON.stringify([10, 20]),
      }));
    });
    expect(result.current.favoriteIds).toEqual([10, 20]);
  });

  it('관련 없는 storage 이벤트 무시', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => { result.current.toggleFavorite(1); });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: "other_key",
        newValue: "something",
      }));
    });
    expect(result.current.favoriteIds).toEqual([1]);
  });

  it('setFavoriteIds 직접 설정', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => { result.current.setFavoriteIds([100, 200]); });
    expect(result.current.favoriteIds).toEqual([100, 200]);
  });
});
