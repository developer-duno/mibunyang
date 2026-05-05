/**
 * 관리자(admin) 컴포넌트 props + 도메인 묶음 (M3d).
 *
 * UserCard / WeightEditor / AdminDashboard 만 큰 3개로 분리 (src/types/components/*.types.ts).
 * 나머지 작은 5개 + 도메인 타입은 본 파일에 묶음.
 */
import type { Apt, Profile, ProfileWeights } from "./scoring";
import type { ScoringResult } from "./components";

/**
 * 사용자 상태 — pending/approved/rejected/suspended.
 * + 필터 탭에는 "all" 추가 키 존재.
 */
export type UserStatus = "pending" | "approved" | "rejected" | "suspended";
export type UserStatusFilter = UserStatus | "all";

/**
 * 전문가 신청자 객체 (DB users 테이블 + admin 페이지 가공).
 * admin/UserCard.jsx 사용 필드 기반.
 */
export interface AdminUser {
  email: string;
  name: string;
  status: UserStatus;
  affiliation?: string | null;
  phone?: string | null;
  specialty?: string | null;
  license?: string | null;
  experience?: number | null;
  bio?: string | null;
  reviewNote?: string | null;
  createdAt: string;
}

/**
 * useAdminMode 훅의 반환 객체 — admin/* 컴포넌트의 admin prop.
 *
 * 정밀 타입 부착 완료 (M4 옵션 C).
 */
export interface AdminMode {
  adminLoggedIn: boolean;
  setAdminLoggedIn: (_v: boolean) => void;
  selectedStatus: UserStatusFilter;
  setSelectedStatus: (_v: UserStatusFilter) => void;
  searchQuery: string;
  setSearchQuery: (_v: string) => void;
  selectedEmails: Set<string>;
  toggleSelectEmail: (_email: string) => void;
  selectAllEmails: (_emails: string[]) => void;
  clearSelectedEmails: () => void;
  users: AdminUser[];
  totalUsers: number;
  page: number;
  PAGE_SIZE: number;
  handlePageChange: (_p: number) => void;
  adminLoading: boolean;
  reviewLoading: string | null;
  batchLoading: boolean;
  fetchUsers: (_status: UserStatusFilter, _search?: string, _pg?: number) => Promise<void>;
  handleReview: (_email: string, _action: "approve" | "reject" | "force-logout", _note?: string) => Promise<void>;
  handleBatchReview: (_action: "approve" | "reject", _note?: string) => Promise<void>;
  handleAdminLogout: (_onLogout?: () => void) => Promise<void>;
  stats: AdminStats | null;
  statsLoading: boolean;
}

/**
 * 관리자 통계 객체 — StatsSection.jsx 가 사용.
 */
export interface AdminStats {
  counts: Record<string, number> & { total?: number };
  userTypes: { kakao: number; expert: number };
  specialtyDist: Record<string, number>;
  recentSignups: Array<{ date: string; count: number }>;
}

/**
 * scored 배열 원소 — { apt, res } (expert 와 동일 구조).
 * ScoreBreakdownPreview 가 미리보기 단지로 사용.
 */
export interface AdminScoredItem {
  apt: Apt;
  res: ScoringResult & { weights?: Record<string, number> };
}

/**
 * customWeights — 프로필별 사용자 정의 가중치 맵.
 * 키 누락 가능 (저장된 프로필만).
 */
export type CustomWeights = Partial<Record<Profile, ProfileWeights>>;

export type ShowToast = (_msg: string) => void;

/**
 * AdminHelpGuide props (53줄, 토글 패널).
 */
export interface AdminHelpGuideProps {
  open: boolean;
  onClose: () => void;
}

/**
 * StatsSection props (97줄).
 */
export interface StatsSectionProps {
  stats: AdminStats;
}

/**
 * UserList props (92줄).
 */
export interface UserListProps {
  admin: AdminMode;
}

/**
 * ScoreBreakdownPreview props (71줄, 미리보기 탭).
 */
export interface ScoreBreakdownPreviewProps {
  topApts: AdminScoredItem[];
  previewAptIdx: number;
  setPreviewAptIdx: (_v: number) => void;
}

/**
 * WeightTable props (97줄, 5×6 행렬 표).
 */
export interface WeightTableProps {
  profile: Profile;
  customWeights: CustomWeights;
  editingProfile: Profile | null;
  draft: Partial<ProfileWeights>;
  sum: number;
  onChange: (_catKey: string, _val: string) => void;
  onStartEdit: (_pKey: Profile) => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onReset: (_pKey: Profile) => void;
}
