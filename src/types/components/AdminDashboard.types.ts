/**
 * AdminDashboard 컴포넌트 props 타입 (M3d).
 *
 * AdminDashboard.jsx L10:
 *   memo(function AdminDashboard({ admin, onLogout, profile, setProfile, customWeights, saveCustomWeights, scored, showToast = () => {} }))
 */
import type { Profile } from "@/types/scoring";
import type { AdminMode, AdminScoredItem, CustomWeights, ShowToast } from "@/types/admin";

export interface AdminDashboardProps {
  admin: AdminMode;
  onLogout: () => void;
  profile: Profile;
  setProfile: (_v: Profile) => void;
  customWeights: CustomWeights;
  saveCustomWeights: (_v: CustomWeights) => void;
  scored: AdminScoredItem[];
  showToast?: ShowToast;
}
