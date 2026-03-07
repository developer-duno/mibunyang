import { useState, useCallback } from "react";

export function useComparison(showToast) {
  const [compIds, setCompIds] = useState([]);
  const [showCompOpen, setShowCompOpen] = useState(false);
  const showComp = showCompOpen && compIds.length >= 2;
  const toggleComp = useCallback(id => {
    setCompIds(prev => {
      if (!prev.includes(id) && prev.length >= 4) {
        showToast("비교는 최대 4개까지 가능합니다");
        return prev;
      }
      return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
    });
  }, [showToast]);
  return { compIds, showComp, showCompOpen, setShowCompOpen, toggleComp };
}
