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
export type SortKey =
  | "total"
  | "price"
  | "priceScore"
  | "location"
  | "safe"
  | "benefit"
  | "newest"
  | "unsoldRate"
  | "units"
  | "moveInSoon"
  | "subwayNear"
  | "jeonseHigh"
  | "maintenanceLow"
  | "crimeSafe"
  | "parkingHigh"
  | "hospitalNear"
  | "parkNear";

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
  budgetMin: string;
  budgetMax: string;
  areaMin: string;
  areaMax: string;
  unitsMin: string;
  unitsMax: string;
  minScore: string;
  benefitOnly: boolean;
  subwayOnly: boolean;
  schoolGoodOnly: boolean;
  dsrPassOnly: boolean;
  nonRegulatedOnly: boolean;
  crimeSafeOnly: boolean;
  childcareGoodOnly: boolean;
  parkingGoodOnly: boolean;
  hospitalNearOnly: boolean;
  parkNearOnly: boolean;
  searchQuery: string;
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
    budgetMin: string;
    budgetMax: string;
    areaMin: string;
    areaMax: string;
    unitsMin: string;
    unitsMax: string;
    minScore: string;
    benefitOnly: boolean;
    subwayOnly: boolean;
    schoolGoodOnly: boolean;
    dsrPassOnly: boolean;
    nonRegulatedOnly: boolean;
    crimeSafeOnly: boolean;
    childcareGoodOnly: boolean;
    parkingGoodOnly: boolean;
    hospitalNearOnly: boolean;
    parkNearOnly: boolean;
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
  /** 지도 region-fit 신호 (세션 417) — deferred 값(원시 filterRegion/Gu stale 회피) */
  deferredRegion: string;
  deferredGu: string;
}

/**
 * useComparison 반환 — App.jsx L113 분해.
 */
export interface UseComparisonReturn {
  compIds: string[];
  setCompIds: (_v: string[] | ((_prev: string[]) => string[])) => void;
  showComp: boolean;
  showCompOpen: boolean;
  setShowCompOpen: (_v: boolean | ((_prev: boolean) => boolean)) => void;
  toggleComp: (_id: string) => void;
}

/**
 * useApartmentData 반환 — App.jsx L121 분해.
 */
export interface UseApartmentDataReturn {
  apartments: Apt[];
  loading: boolean;
  error: string | null;
  retry: () => void;
  dataUpdatedAt: string | null;
}

/**
 * useLoginGate 반환 — App.jsx L140~144 분해.
 */
export type LoginTrigger = "detail" | "map" | null;
export interface UseLoginGateReturn {
  showLoginPrompt: boolean;
  setShowLoginPrompt: (_v: boolean) => void;
  loginTrigger: LoginTrigger;
  setLoginTrigger: (_v: LoginTrigger) => void;
  handleKakaoFromPrompt: () => void;
  /** 특정 단지를 이유로 로그인 모달 열기 — 로그인 후 그 단지로 복귀하도록 pendingDetailId 기록 (세션 495). */
  requestLoginForDetail: (_aptId: string) => void;
  /** 로그인 모달 닫기 — trigger·pendingDetailId 동시 리셋 (stale 복원 차단, 세션 495). */
  closeLoginPrompt: () => void;
}

/**
 * 공유 데이터 (useShare openShareSheet 인자) — M4b 2차.
 * useShareCallbacks.ts L5 ShareSheetData 와 동일 형태 (구조형 타입 호환).
 */
export interface ShareData {
  title: string;
  text: string;
  url: string;
}

/**
 * useShare 반환 — App.jsx L122 분해 (7 필드, shareData 미분해).
 */
export interface UseShareReturn {
  openShareSheet: (_data: ShareData) => void;
  closeShareSheet: () => void;
  shareKakao: () => void;
  shareSMS: () => void;
  shareCopy: () => Promise<void>;
  shareSheetOpen: boolean;
  shareData: ShareData | null;
  isMobile: boolean;
}

/**
 * 관심매물 항목 (v2 객체 스키마).
 */
export interface FavoriteEntry {
  memo: string;
  tags: string[];
  addedAt: string;
}

/**
 * useFavorites 반환 — App.jsx L109 분해 (4 필드, favoritesObj 미분해).
 */
export interface UseFavoritesReturn {
  favoriteIds: string[];
  favoriteSet: Set<string>;
  setFavoriteIds: (_idsOrFn: string[] | ((_prev: string[]) => string[])) => void;
  toggleFavorite: (_id: string) => void;
  favoritesObj: Record<string, FavoriteEntry>;
}

/**
 * useRecentlyViewed 반환 — 최근 본 단지 (순서 의미 있음: 최근이 맨 앞).
 * localStorage 기반, useFavorites 패턴 답습. 로그인 시 상세 진입에서만 기록.
 */
export interface UseRecentlyViewedReturn {
  recentIds: string[];
  recordView: (_id: string) => void;
  clearRecent: () => void;
}

/**
 * 시장 통계 시계열 1행 — KOSIS 컬럼 동적 (avg_price_sqm/price_index/...).
 */
export interface MarketStatsRow {
  base_month?: string;
  [key: string]: unknown;
}

/**
 * useMarketStatsHistory 반환 — MarketStatsCharts.tsx L37 어셔션 유지 (회수 별도 sub).
 * fallback: API 가 시도(gu="") 자동 폴백 응답 시 true (UI 헤더 "시도 평균" 표시 분기).
 */
export interface UseMarketStatsHistoryReturn {
  data: MarketStatsRow[];
  loading: boolean;
  error: string | null;
  retry: () => void;
  fallback: boolean;
}

/**
 * 카카오 OAuth 콜백 결과 — useKakaoAuth.handleKakaoCallback 반환.
 * useKakaoCallbackEffect 의 로컬 정의와 구조형 호환 (subtype).
 */
export interface KakaoCallbackResult {
  ok: boolean;
  token?: string;
  refreshToken?: string;
  user?: { affiliation?: string; [key: string]: unknown };
  role?: string;
  pendingDetail?: string | null;
  pendingTab?: string | null; // 로그인 후 복귀할 탭 (예: "map") — 세션 469 지도 복원
  needsMarketingConsent?: boolean; // 신규 가입(또는 미선택) 시 마케팅 동의 모달 표시 신호
  consentMarketing?: boolean | null; // 현재 마케팅 동의 상태 (true/false/null) — 정보 탭 토글 표시용 (D3)
  error?: string;
  statusCode?: number;
}

/**
 * useKakaoAuth 반환 — App.jsx L122 분해 (4 필드).
 */
export interface UseKakaoAuthReturn {
  kakaoLoading: boolean;
  kakaoError: string;
  initKakaoLogin: (_pendingDetailId?: string | null, _pendingTab?: string | null) => void;
  handleKakaoCallback: () => Promise<KakaoCallbackResult>;
}

/**
 * useFilterSort 인자 — App.jsx L112 호출.
 */
export interface UseFilterSortArgs {
  onFilterChange?: () => void;
}

/**
 * 커스텀 필터 프리셋 — localStorage("mibunyang_custom_presets") 저장 단위.
 */
export interface FilterPreset {
  key: string;
  label: string;
  desc: string;
  values: Record<string, string | boolean>;
  custom?: boolean;
}

/**
 * useFilterSort 반환 — App.jsx L112 분해 (39 키).
 *
 * FILTER_URL_MAP 13 상태 + showFavOnly + isSortPending + setSortKey
 *  + 14 핸들러 + getShareURL/handleResetAll/applyPreset
 *  + 커스텀 프리셋 3 + Undo/Redo 4 = 39
 */
export interface UseFilterSortReturn {
  filterRegion: string;
  filterGu: string;
  sortKey: SortKey;
  setSortKey: (_k: SortKey) => void;
  isSortPending: boolean;
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
  crimeSafeOnly: boolean;
  childcareGoodOnly: boolean;
  parkingGoodOnly: boolean;
  hospitalNearOnly: boolean;
  parkNearOnly: boolean;
  showFavOnly: boolean;
  searchQuery: string;
  handleSearchChange: (_v: string) => void;
  handleRegionChange: (_r: string) => void;
  handleGuChange: (_g: string) => void;
  handleBudgetMinChange: (_v: string) => void;
  handleBudgetMaxChange: (_v: string) => void;
  handleBudgetReset: () => void;
  toggleFavOnly: () => void;
  handleAreaMinChange: (_v: string) => void;
  handleAreaMaxChange: (_v: string) => void;
  handleUnitsMinChange: (_v: string) => void;
  handleUnitsMaxChange: (_v: string) => void;
  handleAreaUnitsReset: () => void;
  handleMoveInChange: (_v: string) => void;
  handleMinScoreChange: (_v: string) => void;
  handleBuilderTierChange: (_v: string) => void;
  toggleBenefitOnly: () => void;
  toggleSubwayOnly: () => void;
  toggleSchoolGoodOnly: () => void;
  toggleDsrPassOnly: () => void;
  toggleNonRegulatedOnly: () => void;
  toggleCrimeSafeOnly: () => void;
  toggleChildcareGoodOnly: () => void;
  toggleParkingGoodOnly: () => void;
  toggleHospitalNearOnly: () => void;
  toggleParkNearOnly: () => void;
  getShareURL: () => string;
  handleResetAll: () => void;
  applyPreset: (_preset: Record<string, string | boolean>) => void;
  customPresets: FilterPreset[];
  saveCustomPreset: (_name: string) => void;
  deleteCustomPreset: (_key: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * useAppNavigation 인자 — App.jsx L150 호출 객체.
 * auth/admin/consult/detail 4 도메인 + 추가 필드.
 */
export interface UseAppNavigationArgs {
  tab: string;
  setTab: (_v: string) => void;
  auth: {
    loggedIn: boolean;
    handleLogin: () => Promise<{ ok: boolean; role?: string } | undefined>;
    handleLogout: (_resetCb: () => void) => void;
    [key: string]: unknown;
  };
  admin: import("./admin").AdminMode;
  consult: {
    consultSubmitted: boolean;
    setConsultSubmitted: (_v: boolean) => void;
    setConsultForm: (
      _form:
        | import("@/hooks/useConsult").ConsultForm
        | ((_prev: import("@/hooks/useConsult").ConsultForm) => import("@/hooks/useConsult").ConsultForm)
    ) => void;
    [key: string]: unknown;
  };
  detail: {
    setDetailAptId: (_id: string | null) => void;
  };
  compIds: string[];
  setShowCompOpen: (_v: boolean) => void;
  /** 상세→상담하기 시 해당 단지를 관심 단지에 추가 (useFavorites.setFavoriteIds, 세션 465) */
  setFavoriteIds: (_idsOrFn: string[] | ((_prev: string[]) => string[])) => void;
  showToast: (_msg: string) => void;
  budgetMin: string | number | null;
  budgetMax: string | number | null;
  isLoggedIn: boolean;
  onLoginRequired?: () => void;
}

/**
 * useAppNavigation 반환 — App.jsx 에서 분해.
 */
export interface UseAppNavigationReturn {
  handleAdminLogin: () => Promise<void>;
  handleLogout: () => void;
  switchToInfo: () => void;
  handleConsultFromDetail: (_aptId: string) => void;
  handleNavClick: (_k: string) => void;
}
