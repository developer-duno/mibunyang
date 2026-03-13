import { useState, useCallback, useRef } from "react";

export function useFilterSort({ onFilterChange }) {
  const [filterRegion, setFilterRegion] = useState("전체");
  const [filterGu, setFilterGu] = useState("전체");
  const [sortKey, setSortKey] = useState("total");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [searchText, setSearchText] = useState("");
  const userTouched = useRef(false);
  const handleRegionChange = useCallback((r) => { userTouched.current = true; setFilterRegion(r); setFilterGu("전체"); onFilterChange?.(); }, [onFilterChange]);
  const handleGuChange = useCallback((g) => { setFilterGu(g); onFilterChange?.(); }, [onFilterChange]);
  const handleBudgetMinChange = useCallback((val) => { setBudgetMin(val); onFilterChange?.(); }, [onFilterChange]);
  const handleBudgetMaxChange = useCallback((val) => { setBudgetMax(val); onFilterChange?.(); }, [onFilterChange]);
  const handleBudgetReset = useCallback(() => { setBudgetMin(""); setBudgetMax(""); onFilterChange?.(); }, [onFilterChange]);
  const handleSearchChange = useCallback((val) => { setSearchText(val); onFilterChange?.(); }, [onFilterChange]);
  // 위치 감지 결과를 자동 적용 (사용자가 직접 지역을 변경하지 않았을 때만)
  const applyDetectedRegion = useCallback((region, regionOptions) => {
    if (userTouched.current) return false;
    if (!region || !regionOptions.includes(region)) return false;
    setFilterRegion(region);
    return true;
  }, []);
  return { filterRegion, filterGu, sortKey, setSortKey, handleRegionChange, handleGuChange, budgetMin, handleBudgetMinChange, budgetMax, handleBudgetMaxChange, handleBudgetReset, searchText, handleSearchChange, applyDetectedRegion };
}
