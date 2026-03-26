import { useState, useCallback } from "react";

export function useFilterSort({ onFilterChange }) {
  const [filterRegion, setFilterRegion] = useState("전체");
  const [filterGu, setFilterGu] = useState("전체");
  const [sortKey, setSortKeyRaw] = useState(() => {
    try { const v = localStorage.getItem("mibunyang_sort"); return v && ["total","price","priceScore","location","safe","benefit","newest"].includes(v) ? v : "total"; } catch { return "total"; }
  });
  const setSortKey = useCallback((k) => { setSortKeyRaw(k); try { localStorage.setItem("mibunyang_sort", k); } catch {} }, []);
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [searchText, setSearchText] = useState("");
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [areaMin, setAreaMin] = useState("");
  const [areaMax, setAreaMax] = useState("");
  const [unitsMin, setUnitsMin] = useState("");
  const [unitsMax, setUnitsMax] = useState("");
  const [moveInFilter, setMoveInFilter] = useState("전체");
  const [filterCollapsed, setFilterCollapsed] = useState(false);
  const handleMoveInChange = useCallback((val) => { setMoveInFilter(val); onFilterChange?.(); }, [onFilterChange]);
  const toggleFilterCollapsed = useCallback(() => setFilterCollapsed(p => !p), []);
  const handleRegionChange = useCallback((r) => { setFilterRegion(r); setFilterGu("전체"); onFilterChange?.(); }, [onFilterChange]);
  const handleGuChange = useCallback((g) => { setFilterGu(g); onFilterChange?.(); }, [onFilterChange]);
  const handleBudgetMinChange = useCallback((val) => { setBudgetMin(val); onFilterChange?.(); }, [onFilterChange]);
  const handleBudgetMaxChange = useCallback((val) => { setBudgetMax(val); onFilterChange?.(); }, [onFilterChange]);
  const handleBudgetReset = useCallback(() => { setBudgetMin(""); setBudgetMax(""); onFilterChange?.(); }, [onFilterChange]);
  const handleSearchChange = useCallback((val) => { setSearchText(val); onFilterChange?.(); }, [onFilterChange]);
  const toggleFavOnly = useCallback(() => { setShowFavOnly(p => !p); onFilterChange?.(); }, [onFilterChange]);
  const handleAreaMinChange = useCallback((val) => { setAreaMin(val); onFilterChange?.(); }, [onFilterChange]);
  const handleAreaMaxChange = useCallback((val) => { setAreaMax(val); onFilterChange?.(); }, [onFilterChange]);
  const handleUnitsMinChange = useCallback((val) => { setUnitsMin(val); onFilterChange?.(); }, [onFilterChange]);
  const handleUnitsMaxChange = useCallback((val) => { setUnitsMax(val); onFilterChange?.(); }, [onFilterChange]);
  const handleAreaUnitsReset = useCallback(() => { setAreaMin(""); setAreaMax(""); setUnitsMin(""); setUnitsMax(""); onFilterChange?.(); }, [onFilterChange]);
  return { filterRegion, filterGu, sortKey, setSortKey, handleRegionChange, handleGuChange, budgetMin, handleBudgetMinChange, budgetMax, handleBudgetMaxChange, handleBudgetReset, searchText, handleSearchChange, showFavOnly, toggleFavOnly, areaMin, handleAreaMinChange, areaMax, handleAreaMaxChange, unitsMin, handleUnitsMinChange, unitsMax, handleUnitsMaxChange, handleAreaUnitsReset, moveInFilter, handleMoveInChange, filterCollapsed, toggleFilterCollapsed };
}
