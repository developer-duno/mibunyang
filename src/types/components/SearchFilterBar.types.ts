// SearchFilterBar 는 6개 FilterButton + 패널 오케스트레이터로
// props 가 30+ 개 (필터 제어 + 토글 + 프리셋 + 히스토리 + undo/redo).
// 명시 props 와 escape hatch (`[key: string]: any`) 병기 — 본체 props 체이닝 시 신규 추가 마찰 줄임.
// 이 catch-all 은 향후 props 정리 후 제거 검토.
import type { FilterPreset, FilterHistoryEntry, SortKey, UseDataPipelineReturn } from "@/types/hooks";

export interface SearchFilterBarProps {
  filterRegion: string;
  onRegionChange: (_v: string) => void;
  regionOptions: string[];
  filterGu: string;
  onGuChange: (_v: string) => void;
  guOptions: string[];
  budgetMin: string;
  onBudgetMinChange: (_v: string) => void;
  budgetMax: string;
  onBudgetMaxChange: (_v: string) => void;
  onBudgetReset: () => void;
  areaMin: string;
  onAreaMinChange: (_v: string) => void;
  areaMax: string;
  onAreaMaxChange: (_v: string) => void;
  unitsMin: string;
  onUnitsMinChange: (_v: string) => void;
  unitsMax: string;
  onUnitsMaxChange: (_v: string) => void;
  onAreaUnitsReset: () => void;
  moveInFilter: string;
  onMoveInChange: (_v: string) => void;
  minScore: string | number;
  onMinScoreChange: (_v: string) => void;
  builderTier: string;
  onBuilderTierChange: (_v: string) => void;
  benefitOnly: boolean;
  onToggleBenefitOnly: () => void;
  hideNoUnsold?: boolean;
  onToggleHideNoUnsold?: () => void;
  sortKey: SortKey;
  onSortChange: (_v: SortKey) => void;
  searchQuery?: string;
  onSearchChange?: (_v: string) => void;
  filterOptionCounts?: NonNullable<UseDataPipelineReturn["filterOptionCounts"]>;
  filteredLength: number;
  scoredLength: number;
  onShareFilters?: () => void;
  onApplyPreset?: (_p: Record<string, string | boolean>) => void;
  onSavePreset?: (_name: string) => void;
  onDeletePreset?: (_name: string) => void;
  customPresets?: FilterPreset[];
  filterHistory?: FilterHistoryEntry[];
  onApplyHistory?: (_h: FilterHistoryEntry) => void;
  onClearHistory?: () => void;
  activeFilterCount: number;
  showToast?: (_msg: string) => void;
  isDesktop?: boolean;
  isPC?: boolean;
  showFavOnly?: boolean;
  onToggleFavOnly?: () => void;
  favCount?: number;
  onResetAll?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  // escape hatch — 본체 props 체이닝 / 향후 추가 props 마찰 감소.
  // 모든 props 명시 후 제거 검토.
  [key: string]: any;
}
