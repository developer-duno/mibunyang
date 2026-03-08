import { useState, useCallback, useEffect } from "react";

export function useFavorites() {
  const [favoriteIds, setFavoriteIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mibunyang_fav") || "[]"); } catch { return []; }
  });
  const toggleFavorite = useCallback(id => {
    setFavoriteIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }, []);
  useEffect(() => { try { localStorage.setItem("mibunyang_fav", JSON.stringify(favoriteIds)); } catch { /* quota exceeded */ } }, [favoriteIds]);
  useEffect(() => {
    const h = (e) => { if (e.key === "mibunyang_fav") { try { setFavoriteIds(JSON.parse(e.newValue || "[]")); } catch { /* ignore */ } } };
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);
  return { favoriteIds, setFavoriteIds, toggleFavorite };
}
