import { useState, useCallback, useEffect, useMemo, useRef, useTransition } from "react";
import { VALID_SORT_KEYS } from "@/constants/sortOptions";
import { MOVEIN_VALUES, TIER_VALUES } from "@/lib/classify";
import { trackEvent } from "@/lib/analytics";
import type { SortKey, UseFilterSortArgs, UseFilterSortReturn, FilterPreset, FilterHistoryEntry } from "@/types/hooks";

const URL_SYNC_DEBOUNCE_MS = 300;

const LS_CUSTOM_PRESETS = "mibunyang_custom_presets";
const LS_FILTER_HISTORY = "mibunyang_filter_history";
const MAX_HISTORY = 10;
const MAX_UNDO = 20;

type ParserName = "string" | "sortKey" | "num" | "numClamp100" | "tier" | "moveIn" | "bool";

type FilterUrlEntry = readonly [stateKey: string, urlKey: string, defaultVal: string | boolean, parserName: ParserName];

type FilterState = {
  filterRegion: string;
  filterGu: string;
  sortKey: SortKey;
  budgetMin: string;
  budgetMax: string;
  areaMin: string;
  areaMax: string;
  unitsMin: string;
  unitsMax: string;
  moveInFilter: string;
  minScore: string;
  builderTier: string;
  benefitOnly: boolean;
  subwayOnly: boolean;
  schoolGoodOnly: boolean;
  dsrPassOnly: boolean;
  nonRegulatedOnly: boolean;
};

type FilterSnapshot = FilterState & { showFavOnly: boolean };

/* ── URL 필터 직렬화 스키마 ── */
const FILTER_URL_MAP: readonly FilterUrlEntry[] = [
  ["filterRegion", "region", "전체", "string"],
  ["filterGu", "gu", "전체", "string"],
  ["sortKey", "sort", "total", "sortKey"],
  ["budgetMin", "bmin", "", "num"],
  ["budgetMax", "bmax", "", "num"],
  ["minScore", "score", "", "numClamp100"],
  ["builderTier", "tier", "전체", "tier"],
  ["benefitOnly", "benefit", false, "bool"],
  ["subwayOnly", "subway", false, "bool"],
  ["schoolGoodOnly", "school", false, "bool"],
  ["dsrPassOnly", "dsr", false, "bool"],
  ["nonRegulatedOnly", "unreg", false, "bool"],
  ["areaMin", "amin", "", "num"],
  ["areaMax", "amax", "", "num"],
  ["unitsMin", "umin", "", "num"],
  ["unitsMax", "umax", "", "num"],
  ["moveInFilter", "movein", "전체", "moveIn"],
] as const;

const VALID_TIERS = new Set(["전체", ...TIER_VALUES]);
const VALID_MOVEIN = new Set(["전체", ...MOVEIN_VALUES]);

/** 숫자 파라미터 파싱 — isFinite + 하한 0 클램핑 */
function parseNumParam(str: string | null, max = Infinity): string {
  if (str == null || str === "") return "";
  const n = Number(str);
  if (!Number.isFinite(n)) return "";
  return String(Math.max(0, Math.min(max, n)));
}

type ParsedValue = string | boolean | undefined;

/* ── 파서/직렬화 전략 맵 (OCP: 새 타입 추가 시 여기만 수정) ── */
const PARSERS: Record<ParserName, (_raw: string, _defaultVal: string | boolean) => ParsedValue> = {
  string: (raw, defaultVal) => raw || (defaultVal as string),
  sortKey: (raw, defaultVal) => (VALID_SORT_KEYS.has(raw) ? raw : (defaultVal as string)),
  num: (raw) => {
    const v = parseNumParam(raw);
    return v !== "" ? v : undefined;
  },
  numClamp100: (raw) => {
    const v = parseNumParam(raw, 100);
    return v !== "" ? v : undefined;
  },
  tier: (raw, defaultVal) => (VALID_TIERS.has(raw) ? raw : (defaultVal as string)),
  moveIn: (raw, defaultVal) => (VALID_MOVEIN.has(raw) ? raw : (defaultVal as string)),
  bool: (raw) => raw === "1",
};

type SerializerFn = (
  _val: string | boolean,
  _urlKey: string,
  _params: URLSearchParams,
  _defaultVal: string | boolean
) => void;

const SERIALIZERS: { bool: SerializerFn; _default: SerializerFn } = {
  bool: (val, urlKey, params) => {
    if (val) params.set(urlKey, "1");
    else params.delete(urlKey);
  },
  _default: (val, urlKey, params, defaultVal) => {
    if (val === defaultVal || val === "" || val == null) params.delete(urlKey);
    else params.set(urlKey, String(val));
  },
};

/** URL 쿼리스트링에서 필터 초기값 읽기 */
function deserializeFromURL(): Partial<FilterState> | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const result: Record<string, string | boolean> = {};
    for (const [stateKey, urlKey, defaultVal, parserName] of FILTER_URL_MAP) {
      const raw = params.get(urlKey);
      if (raw == null) continue;
      const val = PARSERS[parserName]?.(raw, defaultVal);
      if (val !== undefined) result[stateKey] = val;
    }
    return Object.keys(result).length > 0 ? (result as Partial<FilterState>) : null;
  } catch {
    return null;
  }
}

/** 필터 상태를 URL 쿼리스트링으로 직렬화 (비기본값만) */
function serializeToURL(state: FilterState): string {
  const params = new URLSearchParams(window.location.search);
  for (const [stateKey, urlKey, defaultVal, parserName] of FILTER_URL_MAP) {
    const val = state[stateKey as keyof FilterState] as string | boolean;
    const serializer = parserName === "bool" ? SERIALIZERS.bool : SERIALIZERS._default;
    serializer(val, urlKey, params, defaultVal);
  }
  const search = params.toString();
  return search ? `?${search}` : window.location.pathname;
}

export function useFilterSort({ onFilterChange }: UseFilterSortArgs): UseFilterSortReturn {
  // URL에서 초기값 읽기 (lazy — 1회만)
  const [urlInit] = useState<Partial<FilterState> | null>(() => deserializeFromURL());

  const [filterRegion, setFilterRegion] = useState<string>(() => urlInit?.filterRegion ?? "전체");
  const [filterGu, setFilterGu] = useState<string>(() => urlInit?.filterGu ?? "전체");
  const [sortKey, setSortKeyRaw] = useState<SortKey>(() => {
    if (urlInit?.sortKey) return urlInit.sortKey;
    try {
      const v = localStorage.getItem("mibunyang_sort");
      return v && VALID_SORT_KEYS.has(v) ? (v as SortKey) : "total";
    } catch {
      return "total";
    }
  });
  const [isSortPending, startSortTransition] = useTransition();
  const setSortKey = useCallback(
    (k: SortKey) => {
      try {
        localStorage.setItem("mibunyang_sort", k);
      } catch {
        /* ignore storage errors */
      }
      startSortTransition(() => setSortKeyRaw(k));
    },
    [startSortTransition]
  );
  const [budgetMin, setBudgetMin] = useState<string>(() => urlInit?.budgetMin ?? "");
  const [budgetMax, setBudgetMax] = useState<string>(() => urlInit?.budgetMax ?? "");
  const [showFavOnly, setShowFavOnly] = useState<boolean>(false);
  const [areaMin, setAreaMin] = useState<string>(() => urlInit?.areaMin ?? "");
  const [areaMax, setAreaMax] = useState<string>(() => urlInit?.areaMax ?? "");
  const [unitsMin, setUnitsMin] = useState<string>(() => urlInit?.unitsMin ?? "");
  const [unitsMax, setUnitsMax] = useState<string>(() => urlInit?.unitsMax ?? "");
  const [moveInFilter, setMoveInFilter] = useState<string>(() => urlInit?.moveInFilter ?? "전체");
  const [minScore, setMinScore] = useState<string>(() => urlInit?.minScore ?? "");
  const [builderTier, setBuilderTier] = useState<string>(() => urlInit?.builderTier ?? "전체");
  const [benefitOnly, setBenefitOnly] = useState<boolean>(() => (urlInit?.benefitOnly as boolean) ?? false);
  const [subwayOnly, setSubwayOnly] = useState<boolean>(() => (urlInit?.subwayOnly as boolean) ?? false);
  const [schoolGoodOnly, setSchoolGoodOnly] = useState<boolean>(() => (urlInit?.schoolGoodOnly as boolean) ?? false);
  const [dsrPassOnly, setDsrPassOnly] = useState<boolean>(() => (urlInit?.dsrPassOnly as boolean) ?? false);
  const [nonRegulatedOnly, setNonRegulatedOnly] = useState<boolean>(
    () => (urlInit?.nonRegulatedOnly as boolean) ?? false
  );
  // 단지명·지역 검색어 — URL/undo/preset 미참여(일시적 탐색), resetFilters 만 비움
  const [searchQuery, setSearchQuery] = useState<string>("");

  // URL 동기화 (debounce 300ms, replaceState)
  const isInitialLoad = useRef<boolean>(true);
  useEffect(() => {
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      return;
    }
    const state: FilterState = {
      filterRegion,
      filterGu,
      sortKey,
      budgetMin,
      budgetMax,
      minScore,
      builderTier,
      benefitOnly,
      subwayOnly,
      schoolGoodOnly,
      dsrPassOnly,
      nonRegulatedOnly,
      areaMin,
      areaMax,
      unitsMin,
      unitsMax,
      moveInFilter,
    };
    const timer = setTimeout(() => {
      try {
        const newUrl = serializeToURL(state);
        const currentUrl = window.location.search || window.location.pathname;
        if (newUrl !== currentUrl) {
          window.history.replaceState(null, "", newUrl);
          const active = Object.values(state).filter((v) => v !== "" && v !== "전체" && v !== false).length;
          trackEvent("filter_change", { active_count: active });
        }
      } catch {
        /* iframe/cross-origin 환경에서 무시 */
      }
    }, URL_SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    filterRegion,
    filterGu,
    sortKey,
    budgetMin,
    budgetMax,
    minScore,
    builderTier,
    benefitOnly,
    subwayOnly,
    schoolGoodOnly,
    dsrPassOnly,
    nonRegulatedOnly,
    areaMin,
    areaMax,
    unitsMin,
    unitsMax,
    moveInFilter,
  ]);

  const handleSearchChange = useCallback(
    (val: string) => {
      setSearchQuery(val);
      onFilterChange?.();
    },
    [onFilterChange]
  );
  const handleMoveInChange = useCallback(
    (val: string) => {
      setMoveInFilter(val);
      onFilterChange?.();
    },
    [onFilterChange]
  );
  const handleMinScoreChange = useCallback(
    (val: string) => {
      setMinScore(val);
      onFilterChange?.();
    },
    [onFilterChange]
  );
  const handleBuilderTierChange = useCallback(
    (val: string) => {
      setBuilderTier(val);
      onFilterChange?.();
    },
    [onFilterChange]
  );
  const toggleBenefitOnly = useCallback(() => {
    setBenefitOnly((p) => !p);
    onFilterChange?.();
  }, [onFilterChange]);
  const toggleSubwayOnly = useCallback(() => {
    setSubwayOnly((p) => !p);
    onFilterChange?.();
  }, [onFilterChange]);
  const toggleSchoolGoodOnly = useCallback(() => {
    setSchoolGoodOnly((p) => !p);
    onFilterChange?.();
  }, [onFilterChange]);
  const toggleDsrPassOnly = useCallback(() => {
    setDsrPassOnly((p) => !p);
    onFilterChange?.();
  }, [onFilterChange]);
  const toggleNonRegulatedOnly = useCallback(() => {
    setNonRegulatedOnly((p) => !p);
    onFilterChange?.();
  }, [onFilterChange]);
  const handleRegionChange = useCallback(
    (r: string) => {
      setFilterRegion(r);
      setFilterGu("전체");
      onFilterChange?.();
    },
    [onFilterChange]
  );
  const handleGuChange = useCallback(
    (g: string) => {
      setFilterGu(g);
      onFilterChange?.();
    },
    [onFilterChange]
  );
  const handleBudgetMinChange = useCallback(
    (val: string) => {
      setBudgetMin(val);
      onFilterChange?.();
    },
    [onFilterChange]
  );
  const handleBudgetMaxChange = useCallback(
    (val: string) => {
      setBudgetMax(val);
      onFilterChange?.();
    },
    [onFilterChange]
  );
  const handleBudgetReset = useCallback(() => {
    setBudgetMin("");
    setBudgetMax("");
    onFilterChange?.();
  }, [onFilterChange]);
  const toggleFavOnly = useCallback(() => {
    setShowFavOnly((p) => !p);
    onFilterChange?.();
  }, [onFilterChange]);
  const handleAreaMinChange = useCallback(
    (val: string) => {
      setAreaMin(val);
      onFilterChange?.();
    },
    [onFilterChange]
  );
  const handleAreaMaxChange = useCallback(
    (val: string) => {
      setAreaMax(val);
      onFilterChange?.();
    },
    [onFilterChange]
  );
  const handleUnitsMinChange = useCallback(
    (val: string) => {
      setUnitsMin(val);
      onFilterChange?.();
    },
    [onFilterChange]
  );
  const handleUnitsMaxChange = useCallback(
    (val: string) => {
      setUnitsMax(val);
      onFilterChange?.();
    },
    [onFilterChange]
  );
  const handleAreaUnitsReset = useCallback(() => {
    setAreaMin("");
    setAreaMax("");
    setUnitsMin("");
    setUnitsMax("");
    onFilterChange?.();
  }, [onFilterChange]);

  // setter 맵 — FILTER_URL_MAP stateKey → React setter (DRY: 새 필터 추가 시 여기에도 추가)
  type AnySetter = (_v: string | boolean | SortKey) => void;
  const SETTERS = useMemo<Record<string, AnySetter>>(
    () => ({
      filterRegion: setFilterRegion as AnySetter,
      filterGu: setFilterGu as AnySetter,
      sortKey: setSortKeyRaw as AnySetter,
      budgetMin: setBudgetMin as AnySetter,
      budgetMax: setBudgetMax as AnySetter,
      minScore: setMinScore as AnySetter,
      builderTier: setBuilderTier as AnySetter,
      benefitOnly: setBenefitOnly as AnySetter,
      subwayOnly: setSubwayOnly as AnySetter,
      schoolGoodOnly: setSchoolGoodOnly as AnySetter,
      dsrPassOnly: setDsrPassOnly as AnySetter,
      nonRegulatedOnly: setNonRegulatedOnly as AnySetter,
      areaMin: setAreaMin as AnySetter,
      areaMax: setAreaMax as AnySetter,
      unitsMin: setUnitsMin as AnySetter,
      unitsMax: setUnitsMax as AnySetter,
      moveInFilter: setMoveInFilter as AnySetter,
    }),
    []
  );

  /** 공통 필터 리셋 — overrides로 프리셋 값 덮어쓰기 */
  const resetFilters = useCallback(
    (overrides: Record<string, string | boolean> = {}) => {
      for (const [stateKey, , defaultVal] of FILTER_URL_MAP) {
        const val = stateKey in overrides ? overrides[stateKey] : defaultVal;
        SETTERS[stateKey]?.(val);
      }
      setShowFavOnly(false);
      setSearchQuery(""); // 초기화/프리셋/히스토리 적용 시 검색어도 비움 (셋 다 resetFilters 경유)
      const sk = (overrides.sortKey as string) || "total";
      try {
        localStorage.setItem("mibunyang_sort", sk);
      } catch {
        /* ignore storage errors */
      }
      onFilterChange?.();
    },
    [SETTERS, onFilterChange]
  );

  /** 전체 필터 초기화 */
  const handleResetAll = useCallback(() => resetFilters(), [resetFilters]);
  /** 프리셋 적용 — 초기화 후 프리셋 값만 덮어쓰기 */
  const applyPreset = useCallback((preset: Record<string, string | boolean>) => resetFilters(preset), [resetFilters]);

  /** 현재 필터 상태의 공유 URL 생성 (debounce 무관, 즉시) */
  const getShareURL = useCallback((): string => {
    const state: FilterState = {
      filterRegion,
      filterGu,
      sortKey,
      budgetMin,
      budgetMax,
      minScore,
      builderTier,
      benefitOnly,
      subwayOnly,
      schoolGoodOnly,
      dsrPassOnly,
      nonRegulatedOnly,
      areaMin,
      areaMax,
      unitsMin,
      unitsMax,
      moveInFilter,
    };
    const search = serializeToURL(state);
    return `${window.location.origin}${window.location.pathname}${search.startsWith("?") ? search : ""}`;
  }, [
    filterRegion,
    filterGu,
    sortKey,
    budgetMin,
    budgetMax,
    minScore,
    builderTier,
    benefitOnly,
    subwayOnly,
    schoolGoodOnly,
    dsrPassOnly,
    nonRegulatedOnly,
    areaMin,
    areaMax,
    unitsMin,
    unitsMax,
    moveInFilter,
  ]);

  /* ── 커스텀 프리셋 저장/삭제 (localStorage) ── */
  const [customPresets, setCustomPresets] = useState<FilterPreset[]>(() => {
    try {
      const raw = localStorage.getItem(LS_CUSTOM_PRESETS);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? (parsed as FilterPreset[]) : [];
    } catch {
      return [];
    }
  });

  const saveCustomPreset = useCallback(
    (name: string) => {
      if (!name?.trim()) return;
      const values: Record<string, string | boolean> = {};
      const snap: Record<string, string | boolean> = {
        filterRegion,
        filterGu,
        sortKey,
        budgetMin,
        budgetMax,
        minScore,
        builderTier,
        benefitOnly,
        subwayOnly,
        schoolGoodOnly,
        dsrPassOnly,
        nonRegulatedOnly,
        areaMin,
        areaMax,
        unitsMin,
        unitsMax,
        moveInFilter,
      };
      for (const [stateKey, , defaultVal] of FILTER_URL_MAP) {
        const cur = SETTERS[stateKey] ? snap[stateKey] : undefined;
        if (cur !== defaultVal && cur !== "" && cur != null && cur !== false) values[stateKey] = cur;
      }
      const preset: FilterPreset = {
        key: `custom_${Date.now()}`,
        label: name.trim().slice(0, 12),
        desc: "사용자 프리셋",
        values,
        custom: true,
      };
      const next = [...customPresets.filter((p) => p.label !== preset.label), preset].slice(-10);
      setCustomPresets(next);
      try {
        localStorage.setItem(LS_CUSTOM_PRESETS, JSON.stringify(next));
      } catch {
        /* ignore storage errors */
      }
    },
    [
      SETTERS,
      customPresets,
      filterRegion,
      filterGu,
      sortKey,
      budgetMin,
      budgetMax,
      minScore,
      builderTier,
      benefitOnly,
      subwayOnly,
      schoolGoodOnly,
      dsrPassOnly,
      nonRegulatedOnly,
      areaMin,
      areaMax,
      unitsMin,
      unitsMax,
      moveInFilter,
    ]
  );

  const deleteCustomPreset = useCallback(
    (key: string) => {
      const next = customPresets.filter((p) => p.key !== key);
      setCustomPresets(next);
      try {
        localStorage.setItem(LS_CUSTOM_PRESETS, JSON.stringify(next));
      } catch {
        /* ignore storage errors */
      }
    },
    [customPresets]
  );

  /* ── 필터 히스토리 (최근 MAX_HISTORY개, URL 변경 시 자동 저장) ── */
  const [filterHistory, setFilterHistory] = useState<FilterHistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem(LS_FILTER_HISTORY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? (parsed as FilterHistoryEntry[]) : [];
    } catch {
      return [];
    }
  });

  const saveToHistory = useCallback((state: FilterState) => {
    const nonDefault = Object.entries(state).filter(([k, v]) => {
      const entry = FILTER_URL_MAP.find(([sk]) => sk === k);
      return entry && v !== entry[2] && v !== "" && v != null && v !== false;
    });
    if (nonDefault.length === 0) return;
    const sig = nonDefault
      .map(([k, v]) => `${k}:${v}`)
      .sort()
      .join("|");
    setFilterHistory((prev) => {
      if (prev[0]?.sig === sig) return prev;
      const entry: FilterHistoryEntry = {
        sig,
        values: state as unknown as Record<string, string | boolean>,
        ts: Date.now(),
        count: nonDefault.length,
      };
      const next = [entry, ...prev.filter((h) => h.sig !== sig)].slice(0, MAX_HISTORY);
      try {
        localStorage.setItem(LS_FILTER_HISTORY, JSON.stringify(next));
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
  }, []);

  // URL 동기화 시 히스토리에도 저장 (isHistoryInitial: 초기 로드 방지, skipHistory: undo/redo 오염 방지)
  const isHistoryInitial = useRef<boolean>(true);
  const skipHistory = useRef<boolean>(false);
  useEffect(() => {
    if (isHistoryInitial.current) {
      isHistoryInitial.current = false;
      return;
    }
    if (skipHistory.current) {
      skipHistory.current = false;
      return;
    }
    const state: FilterState = {
      filterRegion,
      filterGu,
      sortKey,
      budgetMin,
      budgetMax,
      minScore,
      builderTier,
      benefitOnly,
      subwayOnly,
      schoolGoodOnly,
      dsrPassOnly,
      nonRegulatedOnly,
      areaMin,
      areaMax,
      unitsMin,
      unitsMax,
      moveInFilter,
    };
    const timer = setTimeout(() => saveToHistory(state), 500);
    return () => clearTimeout(timer);
  }, [
    filterRegion,
    filterGu,
    sortKey,
    budgetMin,
    budgetMax,
    minScore,
    builderTier,
    benefitOnly,
    subwayOnly,
    schoolGoodOnly,
    dsrPassOnly,
    nonRegulatedOnly,
    areaMin,
    areaMax,
    unitsMin,
    unitsMax,
    moveInFilter,
    saveToHistory,
  ]);

  const applyHistory = useCallback(
    (entry: FilterHistoryEntry) => {
      if (entry?.values) resetFilters(entry.values);
    },
    [resetFilters]
  );

  const clearHistory = useCallback(() => {
    setFilterHistory([]);
    try {
      localStorage.removeItem(LS_FILTER_HISTORY);
    } catch {
      /* ignore storage errors */
    }
  }, []);

  /* ── Undo / Redo (MAX_UNDO 스택) ── */
  const undoStack = useRef<FilterSnapshot[]>([]);
  const redoStack = useRef<FilterSnapshot[]>([]);
  const skipUndo = useRef<boolean>(false);
  const [undoDepth, setUndoDepth] = useState<number>(0);
  const [redoDepth, setRedoDepth] = useState<number>(0);

  const getCurrentSnapshot = useCallback(
    (): FilterSnapshot => ({
      filterRegion,
      filterGu,
      sortKey,
      budgetMin,
      budgetMax,
      minScore,
      builderTier,
      benefitOnly,
      subwayOnly,
      schoolGoodOnly,
      dsrPassOnly,
      nonRegulatedOnly,
      areaMin,
      areaMax,
      unitsMin,
      unitsMax,
      moveInFilter,
      showFavOnly,
    }),
    [
      filterRegion,
      filterGu,
      sortKey,
      budgetMin,
      budgetMax,
      minScore,
      builderTier,
      benefitOnly,
      subwayOnly,
      schoolGoodOnly,
      dsrPassOnly,
      nonRegulatedOnly,
      areaMin,
      areaMax,
      unitsMin,
      unitsMax,
      moveInFilter,
      showFavOnly,
    ]
  );

  // 필터 변경 시 undo 스택에 이전 상태 푸시
  const prevSnapshot = useRef<FilterSnapshot | null>(null);
  useEffect(() => {
    const snap = getCurrentSnapshot();
    if (skipUndo.current) {
      skipUndo.current = false;
      prevSnapshot.current = snap;
      return;
    }
    if (prevSnapshot.current && JSON.stringify(prevSnapshot.current) !== JSON.stringify(snap)) {
      undoStack.current = [...undoStack.current, prevSnapshot.current].slice(-MAX_UNDO);
      redoStack.current = [];
      setUndoDepth(undoStack.current.length);
      setRedoDepth(0);
    }
    prevSnapshot.current = snap;
  }, [getCurrentSnapshot]);

  const canUndo = undoDepth > 0;
  const canRedo = redoDepth > 0;

  const applySnapshot = useCallback(
    (snap: FilterSnapshot) => {
      skipUndo.current = true;
      skipHistory.current = true;
      for (const [stateKey] of FILTER_URL_MAP) {
        if (stateKey in snap) SETTERS[stateKey]?.(snap[stateKey as keyof FilterSnapshot] as string | boolean);
      }
      if ("showFavOnly" in snap) setShowFavOnly(snap.showFavOnly);
      const sk = snap.sortKey || "total";
      try {
        localStorage.setItem("mibunyang_sort", sk);
      } catch {
        /* ignore storage errors */
      }
    },
    [SETTERS]
  );

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    const current = getCurrentSnapshot();
    redoStack.current = [...redoStack.current, current];
    const prev = undoStack.current[undoStack.current.length - 1];
    undoStack.current = undoStack.current.slice(0, -1);
    setUndoDepth(undoStack.current.length);
    setRedoDepth(redoStack.current.length);
    applySnapshot(prev);
  }, [getCurrentSnapshot, applySnapshot]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const current = getCurrentSnapshot();
    undoStack.current = [...undoStack.current, current];
    const next = redoStack.current[redoStack.current.length - 1];
    redoStack.current = redoStack.current.slice(0, -1);
    setUndoDepth(undoStack.current.length);
    setRedoDepth(redoStack.current.length);
    applySnapshot(next);
  }, [getCurrentSnapshot, applySnapshot]);

  return {
    filterRegion,
    filterGu,
    sortKey,
    setSortKey,
    handleRegionChange,
    handleGuChange,
    budgetMin,
    handleBudgetMinChange,
    budgetMax,
    handleBudgetMaxChange,
    handleBudgetReset,
    showFavOnly,
    toggleFavOnly,
    areaMin,
    handleAreaMinChange,
    areaMax,
    handleAreaMaxChange,
    unitsMin,
    handleUnitsMinChange,
    unitsMax,
    handleUnitsMaxChange,
    handleAreaUnitsReset,
    moveInFilter,
    handleMoveInChange,
    minScore,
    handleMinScoreChange,
    builderTier,
    handleBuilderTierChange,
    benefitOnly,
    toggleBenefitOnly,
    subwayOnly,
    toggleSubwayOnly,
    schoolGoodOnly,
    toggleSchoolGoodOnly,
    dsrPassOnly,
    toggleDsrPassOnly,
    nonRegulatedOnly,
    toggleNonRegulatedOnly,
    searchQuery,
    handleSearchChange,
    getShareURL,
    handleResetAll,
    applyPreset,
    customPresets,
    saveCustomPreset,
    deleteCustomPreset,
    filterHistory,
    applyHistory,
    clearHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    isSortPending,
  };
}
