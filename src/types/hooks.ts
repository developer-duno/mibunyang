/**
 * 27개 커스텀 훅의 인자/반환 타입 (M4a).
 *
 * App.jsx 사용처 정합 + 훅 내부 .ts 변환 시 함수 시그니처 명시.
 */
import type { Apt, Profile, ProfileWeights, Cats } from "./scoring";
import type { ScoringResult } from "./components";
import type { CustomWeights } from "./admin";

/**
 * scored 배열 원소 — useDataPipeline 의 모든 단계에서 공통.
 * weights 는 useDataPipeline 의 scored useMemo 에서 추가 부착.
 */
export interface ScoredApt {
  apt: Apt;
  res: ScoringResult & { weights?: ProfileWeights };
}

/**
 * catsCache 배열 원소 — apt + 그 단지의 6 카테고리 점수.
 */
export interface CatsCacheItem {
  apt: Apt;
  cats: Cats;
}

/**
 * 정렬 키 — useDataPipeline.SORTERS 의 키.
 */
export type SortKey = "total" | "price" | "priceScore" | "location" | "safe" | "benefit" | "newest";

/**
 * 입주 시기 분류 — classifyMoveIn 반환.
 */
export type MoveInClass = string;

/**
 * 시공사 등급 분류 — classifyTier 반환.
 */
export type BuilderTierClass = string;

/**
 * useDataPipeline 인자.
 */
export interface UseDataPipelineArgs {
  apartments: Apt[];
  profile: Profile;
  customWeights: CustomWeights;
  filterRegion: string;
  filterGu: string;
  sortKey: SortKey;
  moveInFilter: string;
  builderTier: string;
  showFavOnly: boolean;
  favoriteSet: Set<string>;
  budgetMin: number | null;
  budgetMax: number | null;
  areaMin: number | null;
  areaMax: number | null;
  unitsMin: number | null;
  unitsMax: number | null;
  minScore: number | null;
  benefitOnly: boolean;
  hideNoUnsold: boolean;
  compIds: string[];
  dataUpdatedAt?: string | null;
}

/**
 * useDataPipeline 반환 — App.jsx 사용처 정합.
 */
export interface UseDataPipelineReturn {
  guOptions: string[];
  catsCache: CatsCacheItem[];
  scored: ScoredApt[];
  baseFilterArgs: {
    showFavOnly: boolean;
    favoriteSet: Set<string>;
    budgetMin: number | null;
    budgetMax: number | null;
    areaMin: number | null;
    areaMax: number | null;
    unitsMin: number | null;
    unitsMax: number | null;
    minScore: number | null;
    benefitOnly: boolean;
  };
  filtered: ScoredApt[];
  visible: ScoredApt[];
  visibleCount: number;
  setVisibleCount: (_v: number | ((_prev: number) => number)) => void;
  scoredMap: Map<string, ScoredApt>;
  compItems: ScoredApt[];
  pw: ProfileWeights;
  activeFilterCount: number;
  regionOptions: string[];
  filterOptionCounts: {
    regionCounts: Record<string, number>;
    guCounts: Record<string, number>;
    moveInCounts: Record<string, number>;
    tierCounts: Record<string, number>;
  } | null;
  dataFreshnessText: string | null;
  isFilterPending: boolean;
}

/**
 * useExpertMode 반환 — useAdminMode 와 별도, 전문가 로그인 도메인.
 * (.js 훅 — 향후 정밀화)
 */
export interface UseExpertModeReturn {
  expertLoggedIn: boolean;
  setExpertLoggedIn: (_v: boolean) => void;
  showExpertLogin: boolean;
  setShowExpertLogin: (_v: boolean) => void;
  expertLoading: boolean;
  expertError: string | null;
  handleExpertLogin: (_email: string, _password: string) => Promise<boolean>;
  handleExpertLogout: (_resetCb?: () => void) => void;
  consultsLoading: boolean;
  consults: Array<Record<string, unknown>>;
  consultsError: string | null;
  fetchConsults: () => Promise<void>;
  // 기타 동적 필드
  [key: string]: unknown;
}
