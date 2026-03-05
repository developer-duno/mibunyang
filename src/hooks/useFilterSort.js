import { useState, useCallback } from "react";

export function useFilterSort({ onFilterChange }) {
  const [filterRegion, setFilterRegion] = useState("전체");
  const [filterGu, setFilterGu] = useState("전체");
  const [sortKey, setSortKey] = useState("total");
  const handleRegionChange = useCallback((r) => { setFilterRegion(r); setFilterGu("전체"); onFilterChange?.(); }, [onFilterChange]);
  const handleGuChange = useCallback((g) => { setFilterGu(g); onFilterChange?.(); }, [onFilterChange]);
  return { filterRegion, filterGu, sortKey, setSortKey, handleRegionChange, handleGuChange };
}
