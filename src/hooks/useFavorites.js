import { useState, useCallback, useEffect, useMemo } from "react";

const STORAGE_KEY = "mibunyang_fav";
const BACKUP_KEY = "mibunyang_fav_backup";

/** v1(배열) → v2(객체) 자동 마이그레이션 */
function loadFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (Array.isArray(raw)) {
      // v1→v2 마이그레이션: 배열→객체
      try { localStorage.setItem(BACKUP_KEY, JSON.stringify(raw)); } catch { /* backup 실패 무시 */ }
      return Object.fromEntries(raw.map(id => [id, { memo: "", tags: [], addedAt: new Date().toISOString() }]));
    }
    return typeof raw === "object" && raw !== null ? raw : {};
  } catch { return {}; }
}

export function useFavorites(showToast) {
  const [favoritesObj, setFavoritesObj] = useState(loadFavorites);

  // 파생 배열 — 기존 소비자(filterEngine, AptListSection, ConsultForm 등) 하위 호환
  const favoriteIds = useMemo(() => Object.keys(favoritesObj), [favoritesObj]);

  const toggleFavorite = useCallback(id => {
    setFavoritesObj(prev => {
      if (id in prev) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: { memo: "", tags: [], addedAt: new Date().toISOString() } };
    });
  }, []);

  // setFavoriteIds — 하위 호환 래퍼 (배열을 받아서 객체로 변환)
  const setFavoriteIds = useCallback((ids) => {
    if (Array.isArray(ids)) {
      setFavoritesObj(prev => {
        const next = {};
        for (const id of ids) {
          next[id] = prev[id] || { memo: "", tags: [], addedAt: new Date().toISOString() };
        }
        return next;
      });
    }
  }, []);

  // localStorage 저장 (quota exceeded 시 토스트)
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(favoritesObj)); }
    catch (e) { if (e.name === "QuotaExceededError") showToast?.("저장 실패: 저장소가 가득 찼습니다"); }
  }, [favoritesObj, showToast]);

  // 크로스탭 동기화
  useEffect(() => {
    const h = (e) => {
      if (e.key !== STORAGE_KEY) return;
      try {
        const raw = JSON.parse(e.newValue || "{}");
        if (Array.isArray(raw)) {
          setFavoritesObj(Object.fromEntries(raw.map(id => [id, { memo: "", tags: [], addedAt: new Date().toISOString() }])));
        } else if (typeof raw === "object" && raw !== null) {
          setFavoritesObj(raw);
        }
      } catch { /* ignore */ }
    };
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);

  return { favoriteIds, setFavoriteIds, toggleFavorite, favoritesObj };
}
