import { useState, useCallback } from "react";

export function useFilterSort({ onFilterChange }) {
  const [filterRegion, setFilterRegion] = useState("전체");
  const [filterGu, setFilterGu] = useState("전체");
  const [sortKey, setSortKey] = useState("total");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [searchText, setSearchText] = useState("");
  const handleRegionChange = useCallback((r) => { setFilterRegion(r); setFilterGu("전체"); onFilterChange?.(); }, [onFilterChange]);
  const handleGuChange = useCallback((g) => { setFilterGu(g); onFilterChange?.(); }, [onFilterChange]);
  const handleBudgetMinChange = useCallback((val) => { setBudgetMin(val); onFilterChange?.(); }, [onFilterChange]);
  const handleBudgetMaxChange = useCallback((val) => { setBudgetMax(val); onFilterChange?.(); }, [onFilterChange]);
  const handleBudgetReset = useCallback(() => { setBudgetMin(""); setBudgetMax(""); onFilterChange?.(); }, [onFilterChange]);
  const handleSearchChange = useCallback((val) => { setSearchText(val); onFilterChange?.(); }, [onFilterChange]);
  return { filterRegion, filterGu, sortKey, setSortKey, handleRegionChange, handleGuChange, budgetMin, handleBudgetMinChange, budgetMax, handleBudgetMaxChange, handleBudgetReset, searchText, handleSearchChange };
}
