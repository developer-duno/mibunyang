import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFavorites } from './useFavorites';

describe('useFavorites', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('초기 상태: 빈 배열', () => {
    const { result } = renderHook(() => useFavorites(vi.fn()));
    expect(result.current.favoriteIds).toEqual([]);
  });

  // v1→v2 마이그레이션: 배열 → 객체 자동 변환
  it('v1 배열 형식 localStorage → 객체로 마이그레이션 후 favoriteIds 유지', () => {
    localStorage.setItem("mibunyang_fav", JSON.stringify(["apt-1", "apt-2"]));
    const { result } = renderHook(() => useFavorites(vi.fn()));
    expect(result.current.favoriteIds).toEqual(["apt-1", "apt-2"]);
    // 마이그레이션 후 내부 객체 구조 확인
    expect(result.current.favoritesObj["apt-1"]).toHaveProperty("memo", "");
    expect(result.current.favoritesObj["apt-1"]).toHaveProperty("tags");
  });

  // v2 객체 형식은 그대로 로드
  it('v2 객체 형식 localStorage → 그대로 로드 (no-op)', () => {
    const obj = { "apt-1": { memo: "좋음", tags: ["투자용"], addedAt: "2026-01-01" } };
    localStorage.setItem("mibunyang_fav", JSON.stringify(obj));
    const { result } = renderHook(() => useFavorites(vi.fn()));
    expect(result.current.favoriteIds).toEqual(["apt-1"]);
    expect(result.current.favoritesObj["apt-1"].memo).toBe("좋음");
  });

  it('마이그레이션 시 백업 생성', () => {
    const arr = ["apt-1", "apt-2"];
    localStorage.setItem("mibunyang_fav", JSON.stringify(arr));
    renderHook(() => useFavorites(vi.fn()));
    const backup = JSON.parse(localStorage.getItem("mibunyang_fav_backup"));
    expect(backup).toEqual(arr);
  });

  it('localStorage JSON 파싱 실패 → 빈 객체', () => {
    localStorage.setItem("mibunyang_fav", "invalid json{{{");
    const { result } = renderHook(() => useFavorites(vi.fn()));
    expect(result.current.favoriteIds).toEqual([]);
  });

  it('토글 추가', () => {
    const { result } = renderHook(() => useFavorites(vi.fn()));
    act(() => { result.current.toggleFavorite("apt-1"); });
    expect(result.current.favoriteIds).toEqual(["apt-1"]);
    expect(result.current.favoritesObj["apt-1"]).toHaveProperty("memo", "");
  });

  it('토글 제거', () => {
    const { result } = renderHook(() => useFavorites(vi.fn()));
    act(() => { result.current.toggleFavorite("apt-1"); });
    act(() => { result.current.toggleFavorite("apt-1"); });
    expect(result.current.favoriteIds).toEqual([]);
  });

  it('변경 시 localStorage에 객체 형식으로 저장', () => {
    const { result } = renderHook(() => useFavorites(vi.fn()));
    act(() => { result.current.toggleFavorite("apt-5"); });
    const saved = JSON.parse(localStorage.getItem("mibunyang_fav"));
    expect(saved).toHaveProperty("apt-5");
    expect(saved["apt-5"]).toHaveProperty("memo", "");
  });

  it('cross-tab: 배열 수신 → 객체로 변환', () => {
    const { result } = renderHook(() => useFavorites(vi.fn()));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: "mibunyang_fav", newValue: JSON.stringify(["apt-10", "apt-20"]),
      }));
    });
    expect(result.current.favoriteIds).toEqual(["apt-10", "apt-20"]);
  });

  it('cross-tab: 객체 수신 → 그대로 적용', () => {
    const { result } = renderHook(() => useFavorites(vi.fn()));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: "mibunyang_fav", newValue: JSON.stringify({ "apt-7": { memo: "test", tags: [], addedAt: "" } }),
      }));
    });
    expect(result.current.favoriteIds).toEqual(["apt-7"]);
    expect(result.current.favoritesObj["apt-7"].memo).toBe("test");
  });

  it('관련 없는 storage 이벤트 무시', () => {
    const { result } = renderHook(() => useFavorites(vi.fn()));
    act(() => { result.current.toggleFavorite("apt-1"); });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "other_key", newValue: "something" }));
    });
    expect(result.current.favoriteIds).toEqual(["apt-1"]);
  });

  it('setFavoriteIds 배열 → 객체 래핑', () => {
    const { result } = renderHook(() => useFavorites(vi.fn()));
    act(() => { result.current.setFavoriteIds(["apt-100", "apt-200"]); });
    expect(result.current.favoriteIds).toEqual(["apt-100", "apt-200"]);
  });

  it('quota exceeded 시 showToast 호출', () => {
    const showToast = vi.fn();
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn((key) => {
      if (key === "mibunyang_fav") {
        const err = new DOMException("quota", "QuotaExceededError");
        throw err;
      }
    });
    const { result } = renderHook(() => useFavorites(showToast));
    act(() => { result.current.toggleFavorite("apt-1"); });
    expect(showToast).toHaveBeenCalledWith("저장 실패: 저장소가 가득 찼습니다");
    Storage.prototype.setItem = origSet;
  });
});
