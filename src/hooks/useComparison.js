import { useState, useRef, useCallback } from "react";

export function useComparison(showToast) {
  const [compIds, setCompIds] = useState([]);
  const [showCompOpen, setShowCompOpen] = useState(false);
  const showComp = showCompOpen && compIds.length >= 2;
  const compIdsRef = useRef(compIds);
  compIdsRef.current = compIds;
  const toggleComp = useCallback(id => {
    if (!compIdsRef.current.includes(id) && compIdsRef.current.length >= 4) {
      showToast("비교는 최대 4개까지 가능합니다");
      return;
    }
    setCompIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }, [showToast]);
  return { compIds, showComp, showCompOpen, setShowCompOpen, toggleComp };
}
