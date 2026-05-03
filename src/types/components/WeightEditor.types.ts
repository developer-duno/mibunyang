/**
 * WeightEditor 컴포넌트 props 타입 (M3d).
 *
 * WeightEditor.jsx L18 (default export):
 *   memo(function WeightEditor({ profile, setProfile, customWeights, saveCustomWeights, scored, showToast = () => {} }))
 */
import type { Profile } from "@/types/scoring";
import type { AdminScoredItem, CustomWeights, ShowToast } from "@/types/admin";

export interface WeightEditorProps {
  profile: Profile;
  setProfile: (_v: Profile) => void;
  customWeights: CustomWeights;
  saveCustomWeights: (_v: CustomWeights) => void;
  scored: AdminScoredItem[];
  showToast?: ShowToast;
}
