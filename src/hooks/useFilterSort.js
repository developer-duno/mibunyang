import { useState, useCallback, useEffect, useRef } from "react";
import { VALID_SORT_KEYS } from "@/constants/sortOptions";

/* ── URL 필터 직렬화 스키마 (Phase 2: 14개) ── */
const FILTER_URL_MAP = [
  // [state키, URL파라미터명, 기본값, 파서]
  ["filterRegion", "region", "전체", "string"],
  ["filterGu", "gu", "전체", "string"],
  ["sortKey", "sort", "total", "sortKey"],
  ["budgetMin", "bmin", "", "num"],
  ["budgetMax", "bmax", "", "num"],
  ["minScore", "score", "", "numClamp100"],
  ["builderTier", "tier", "전체", "tier"],
  ["benefitOnly", "benefit", false, "bool"],
  // Phase 2
  ["areaMin", "amin", "", "num"],
  ["areaMax", "amax", "", "num"],
  ["unitsMin", "umin", "", "num"],
  ["unitsMax", "umax", "", "num"],
  ["moveInFilter", "movein", "전체", "moveIn"],
  ["searchText", "q", "", "text50"],
];

const VALID_TIERS = new Set(["전체", "1군", "2군", "기타"]);
const VALID_MOVEIN = new Set(["전체", "입주예정", "미입주", "입주완료"]);

/** 숫자 파라미터 파싱 — isFinite + 하한 0 클램핑 */
function parseNumParam(str, max = Infinity) {
  if (str == null || str === "") return "";
  const n = Number(str);
  if (!Number.isFinite(n)) return "";
  return String(Math.max(0, Math.min(max, n)));
}

/** URL 쿼리스트링에서 필터 초기값 읽기 */
function deserializeFromURL() {
  try {
    const params = new URLSearchParams(window.location.search);
    const result = {};
    for (const [stateKey, urlKey, defaultVal, parser] of FILTER_URL_MAP) {
      const raw = params.get(urlKey);
      if (raw == null) continue;
      if (parser === "string") { result[stateKey] = raw || defaultVal; }
      else if (parser === "sortKey") { result[stateKey] = VALID_SORT_KEYS.has(raw) ? raw : defaultVal; }
      else if (parser === "num") { const v = parseNumParam(raw); if (v !== "") result[stateKey] = v; }
      else if (parser === "numClamp100") { const v = parseNumParam(raw, 100); if (v !== "") result[stateKey] = v; }
      else if (parser === "tier") { result[stateKey] = VALID_TIERS.has(raw) ? raw : defaultVal; }
      else if (parser === "moveIn") { result[stateKey] = VALID_MOVEIN.has(raw) ? raw : defaultVal; }
      else if (parser === "text50") { const t = (raw || "").slice(0, 50).trim(); if (t) result[stateKey] = t; }
      else if (parser === "bool") { result[stateKey] = raw === "1"; }
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch { return null; }
}

/** 필터 상태를 URL 쿼리스트링으로 직렬화 (비기본값만) */
function serializeToURL(state) {
  const params = new URLSearchParams(window.location.search);
  // 기존 딥링크 파라미터 보존 (detail, compare, profile)
  for (const [stateKey, urlKey, defaultVal, parser] of FILTER_URL_MAP) {
    const val = state[stateKey];
    if (parser === "bool") {
      if (val) params.set(urlKey, "1"); else params.delete(urlKey);
    } else if (val === defaultVal || val === "" || val == null) {
      params.delete(urlKey);
    } else {
      params.set(urlKey, val);
    }
  }
  const search = params.toString();
  return search ? `?${search}` : window.location.pathname;
}

export function useFilterSort({ onFilterChange }) {
  // URL에서 초기값 읽기 (lazy — 1회만)
  const urlInit = useRef(deserializeFromURL());

  const [filterRegion, setFilterRegion] = useState(() => urlInit.current?.filterRegion ?? "전체");
  const [filterGu, setFilterGu] = useState(() => urlInit.current?.filterGu ?? "전체");
  const [sortKey, setSortKeyRaw] = useState(() => {
    if (urlInit.current?.sortKey) return urlInit.current.sortKey;
    try { const v = localStorage.getItem("mibunyang_sort"); return v && VALID_SORT_KEYS.has(v) ? v : "total"; } catch { return "total"; }
  });
  const setSortKey = useCallback((k) => { setSortKeyRaw(k); try { localStorage.setItem("mibunyang_sort", k); } catch {} }, []);
  const [budgetMin, setBudgetMin] = useState(() => urlInit.current?.budgetMin ?? "");
  const [budgetMax, setBudgetMax] = useState(() => urlInit.current?.budgetMax ?? "");
  const [searchText, setSearchText] = useState(() => urlInit.current?.searchText ?? "");
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [areaMin, setAreaMin] = useState(() => urlInit.current?.areaMin ?? "");
  const [areaMax, setAreaMax] = useState(() => urlInit.current?.areaMax ?? "");
  const [unitsMin, setUnitsMin] = useState(() => urlInit.current?.unitsMin ?? "");
  const [unitsMax, setUnitsMax] = useState(() => urlInit.current?.unitsMax ?? "");
  const [moveInFilter, setMoveInFilter] = useState(() => urlInit.current?.moveInFilter ?? "전체");
  const [filterCollapsed, setFilterCollapsed] = useState(false);
  const [minScore, setMinScore] = useState(() => urlInit.current?.minScore ?? "");
  const [builderTier, setBuilderTier] = useState(() => urlInit.current?.builderTier ?? "전체");
  const [benefitOnly, setBenefitOnly] = useState(() => urlInit.current?.benefitOnly ?? false);

  // URL 동기화 (debounce 300ms, replaceState)
  const isInitialLoad = useRef(true);
  useEffect(() => {
    if (isInitialLoad.current) { isInitialLoad.current = false; return; }
    const state = { filterRegion, filterGu, sortKey, budgetMin, budgetMax, minScore, builderTier, benefitOnly, areaMin, areaMax, unitsMin, unitsMax, moveInFilter, searchText };
    const timer = setTimeout(() => {
      try {
        const newUrl = serializeToURL(state);
        const currentUrl = window.location.search || window.location.pathname;
        if (newUrl !== currentUrl) {
          window.history.replaceState(null, "", newUrl);
        }
      } catch { /* iframe/cross-origin 환경에서 무시 */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [filterRegion, filterGu, sortKey, budgetMin, budgetMax, minScore, builderTier, benefitOnly, areaMin, areaMax, unitsMin, unitsMax, moveInFilter, searchText]);

  const handleMoveInChange = useCallback((val) => { setMoveInFilter(val); onFilterChange?.(); }, [onFilterChange]);
  const toggleFilterCollapsed = useCallback(() => setFilterCollapsed(p => !p), []);
  const handleMinScoreChange = useCallback((val) => { setMinScore(val); onFilterChange?.(); }, [onFilterChange]);
  const handleBuilderTierChange = useCallback((val) => { setBuilderTier(val); onFilterChange?.(); }, [onFilterChange]);
  const toggleBenefitOnly = useCallback(() => { setBenefitOnly(p => !p); onFilterChange?.(); }, [onFilterChange]);
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

  /** 전체 필터 초기화 */
  const handleResetAll = useCallback(() => {
    setFilterRegion("전체"); setFilterGu("전체"); setSortKeyRaw("total");
    setBudgetMin(""); setBudgetMax(""); setMinScore("");
    setBuilderTier("전체"); setBenefitOnly(false);
    setAreaMin(""); setAreaMax(""); setUnitsMin(""); setUnitsMax("");
    setMoveInFilter("전체"); setSearchText(""); setShowFavOnly(false);
    try { localStorage.setItem("mibunyang_sort", "total"); } catch {}
    onFilterChange?.();
  }, [onFilterChange]);

  /** 프리셋 적용 — 초기화 후 프리셋 값만 덮어쓰기 */
  const applyPreset = useCallback((preset) => {
    setFilterRegion("전체"); setFilterGu("전체"); setSortKeyRaw(preset.sortKey || "total");
    setBudgetMin(preset.budgetMin ?? ""); setBudgetMax(preset.budgetMax ?? "");
    setMinScore(preset.minScore ?? ""); setBuilderTier(preset.builderTier ?? "전체");
    setBenefitOnly(preset.benefitOnly ?? false);
    setAreaMin(preset.areaMin ?? ""); setAreaMax(preset.areaMax ?? "");
    setUnitsMin(preset.unitsMin ?? ""); setUnitsMax(preset.unitsMax ?? "");
    setMoveInFilter(preset.moveInFilter ?? "전체"); setSearchText(""); setShowFavOnly(false);
    try { localStorage.setItem("mibunyang_sort", preset.sortKey || "total"); } catch {}
    onFilterChange?.();
  }, [onFilterChange]);

  /** 현재 필터 상태의 공유 URL 생성 (debounce 무관, 즉시) */
  const getShareURL = useCallback(() => {
    const state = { filterRegion, filterGu, sortKey, budgetMin, budgetMax, minScore, builderTier, benefitOnly, areaMin, areaMax, unitsMin, unitsMax, moveInFilter, searchText };
    const search = serializeToURL(state);
    return `${window.location.origin}${window.location.pathname}${search.startsWith("?") ? search : ""}`;
  }, [filterRegion, filterGu, sortKey, budgetMin, budgetMax, minScore, builderTier, benefitOnly, areaMin, areaMax, unitsMin, unitsMax, moveInFilter, searchText]);

  return { filterRegion, filterGu, sortKey, setSortKey, handleRegionChange, handleGuChange, budgetMin, handleBudgetMinChange, budgetMax, handleBudgetMaxChange, handleBudgetReset, searchText, handleSearchChange, showFavOnly, toggleFavOnly, areaMin, handleAreaMinChange, areaMax, handleAreaMaxChange, unitsMin, handleUnitsMinChange, unitsMax, handleUnitsMaxChange, handleAreaUnitsReset, moveInFilter, handleMoveInChange, filterCollapsed, toggleFilterCollapsed, minScore, handleMinScoreChange, builderTier, handleBuilderTierChange, benefitOnly, toggleBenefitOnly, getShareURL, handleResetAll, applyPreset };
}
