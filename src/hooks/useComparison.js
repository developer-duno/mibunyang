import { useState, useRef, useCallback, useEffect } from "react";

const STORAGE_KEY = "mibunyang_comp";
export const MAX_COMPARE = 4;

export function useComparison(showToast) {
  const [compIds, setCompIds] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(raw) ? raw.slice(0, MAX_COMPARE) : [];
    } catch { return []; }
  });
  const [showCompOpen, setShowCompOpen] = useState(false);
  const initCountRef = useRef(compIds.length);
  const showComp = showCompOpen && compIds.length >= 2;
  const toggleComp = useCallback(id => {
    setCompIds(prev => {
      if (!prev.includes(id) && prev.length >= MAX_COMPARE) {
        showToast(`비교는 최대 ${MAX_COMPARE}개까지 가능합니다`);
        return prev;
      }
      return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
    });
  }, [showToast]);
  useEffect(() => {
    if (initCountRef.current > 0) showToast(`이전 비교 ${initCountRef.current}개 복원됨`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(compIds)); } catch (e) { if (e.name === "QuotaExceededError") showToast("저장 실패: 저장소가 가득 찼습니다"); } }, [compIds, showToast]);
  useEffect(() => {
    const h = (e) => { if (e.key === STORAGE_KEY) { try { setCompIds(JSON.parse(e.newValue || "[]")); } catch { /* ignore */ } } };
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);
  return { compIds, setCompIds, showComp, showCompOpen, setShowCompOpen, toggleComp };
}
