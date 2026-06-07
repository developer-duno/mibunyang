/**
 * ExpertDashboard 컴포넌트 props 타입 (M3d).
 *
 * ExpertDashboard.jsx:
 *   memo(function ExpertDashboard({ scored, profile, expandedApt, setExpandedApt, onSwitchToAdmin }))
 * 프로필 전환은 전역 HeaderSection 담당 — 대시보드 내 중복 메뉴 제거(세션 383)로 setProfile prop 삭제.
 */
import type { Profile } from "@/types/scoring";
import type { ScoredItem } from "@/types/expert";

export interface ExpertDashboardProps {
  scored: ScoredItem[];
  profile: Profile;
  expandedApt: string | null;
  setExpandedApt: (_v: string | null) => void;
  onSwitchToAdmin?: () => void;
}
