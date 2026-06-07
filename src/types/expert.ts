/**
 * 전문가(expert) 컴포넌트 props 묶음 (M3d).
 *
 * ExpertDashboard 만 큰 1개로 분리 (src/types/components/ExpertDashboard.types.ts).
 * 나머지 8개 작은 컴포넌트 props 는 본 파일에 묶음.
 */
import type { Apt, Profile } from "./scoring";
import type { ScoringResult } from "./components";

/**
 * scored 배열 원소 — { apt, res }.
 * App.jsx → ExpertDashboard → ExpertSidebar 로 prop drill 됨.
 */
export interface ScoredItem {
  apt: Apt;
  res: ScoringResult;
}

/**
 * 정렬 키 — ExpertSidebar 의 sort prop.
 * EXPERT_SORT_OPTIONS (src/constants/sortOptions.js) 의 key 와 일치.
 */
export type ExpertSortKey = "total" | "price" | "priceScore" | "location" | "safe";

/**
 * ExpertSidebar props (76줄).
 */
export interface ExpertSidebarProps {
  scored: ScoredItem[];
  selectedId: string | null;
  onSelect: (_id: string) => void;
  search: string;
  setSearch: (_v: string) => void;
  regionFilter: string;
  setRegionFilter: (_v: string) => void;
  sort: ExpertSortKey;
  setSort: (_v: ExpertSortKey) => void;
  isMobile: boolean;
  onClose: () => void;
}

/**
 * ExpertHelpGuide props (75줄, 토글 패널).
 */
export interface ExpertHelpGuideProps {
  open: boolean;
  onClose: () => void;
}

/**
 * ExpertScoreBreakdown props (69줄, 적정가 산출 + 카테고리 점수표).
 */
export interface ExpertScoreBreakdownProps {
  apt: Apt;
  res: ScoringResult;
  profile: Profile;
}

/**
 * ExpertDataCompleteness props (49줄, 데이터 완성도 진행바).
 */
export interface ExpertDataCompletenessProps {
  apt: Apt;
}

/**
 * ExpertScoreSummary props (44줄, 가중 합계 표).
 */
export interface ExpertScoreSummaryProps {
  res: ScoringResult;
  profile: Profile;
}

/**
 * ExpertAptHeader props (39줄, 단지 헤더 + 레이더).
 */
export interface ExpertAptHeaderProps {
  apt: Apt;
  res: ScoringResult;
}

/**
 * ExpertUnitPlaceholder props (30줄, 동/호수 자리표시).
 */
export interface ExpertUnitPlaceholderProps {
  apt: Apt;
}

/**
 * ExpertFieldTable props (28줄, 카테고리별 필드 테이블).
 * fields = FIELD_SECTIONS[i].fields (string 배열 — FIELD_META 키).
 */
export interface ExpertFieldTableProps {
  apt: Apt;
  fields: readonly string[];
  title: string;
  color?: string;
  exclude?: readonly string[];
  /** 프로필 상위 카테고리 섹션 — 헤더에 ★ 중점 배지 (세션 382) */
  emphasized?: boolean;
}
