import { useState, useCallback, useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import type { UseRecentlyViewedReturn } from "@/types/hooks";

const STORAGE_KEY = "mibunyang_recent";
export const MAX_RECENT = 8;

/** localStorage 복원 — 문자열 배열만, slice 로 상한 강제 (오염/구버전 방어) */
function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/**
 * 최근 본 단지 — useFavorites.ts / useComparison.ts 답습.
 * 순서 의미 있음(최근이 맨 앞)이라 Set 파생 없이 배열 순서 보존.
 * 기록은 상세 진입(로그인 게이트 통과)에서만 — useDetailModal.handleOpenDetail 경유.
 */
export function useRecentlyViewed(showToast?: (_msg: string) => void): UseRecentlyViewedReturn {
  const [recentIds, setRecentIds] = useState<string[]>(loadRecent);

  // 본 단지를 맨 앞으로 — 이미 있으면 제거 후 앞에 (중복 제거 + 최근순 유지)
  const recordView = useCallback((id: string) => {
    if (!id) return;
    setRecentIds((prev) => {
      if (prev[0] === id) return prev; // 같은 단지 연속 열람 = no-op (리렌더 방지)
      return [id, ...prev.filter((x) => x !== id)].slice(0, MAX_RECENT);
    });
  }, []);

  const clearRecent = useCallback(() => {
    trackEvent("recent_clear", {});
    setRecentIds([]);
  }, []);

  // localStorage 저장 (quota exceeded 시 토스트) — useComparison.ts L68 2단계 분리 (DOMException 호환)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recentIds));
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "QuotaExceededError") showToast?.("저장 실패: 저장소가 가득 찼습니다");
    }
  }, [recentIds, showToast]);

  // 크로스탭 동기화 — useFavorites.ts L77-92 답습
  useEffect(() => {
    const h = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      try {
        const raw = JSON.parse(e.newValue || "[]") as unknown;
        if (Array.isArray(raw)) {
          setRecentIds(raw.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, MAX_RECENT));
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);

  return { recentIds, recordView, clearRecent };
}
