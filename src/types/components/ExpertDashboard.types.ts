/**
 * ExpertDashboard 컴포넌트 props 타입 (M3d).
 *
 * ExpertDashboard.jsx L17:
 *   memo(function ExpertDashboard({ scored, profile, setProfile, expandedApt, setExpandedApt, onSwitchToAdmin }))
 */
import type { Profile } from "@/types/scoring";
import type { ScoredItem } from "@/types/expert";

export interface ExpertDashboardProps {
  scored: ScoredItem[];
  profile: Profile;
  setProfile: (_v: Profile) => void;
  expandedApt: string | null;
  setExpandedApt: (_v: string | null) => void;
  onSwitchToAdmin?: () => void;
}
