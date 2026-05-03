/**
 * HeaderSection 컴포넌트 props 타입 (M3e).
 *
 * HeaderSection.jsx L98:
 *   memo(function HeaderSection({
 *     profile, onProfileChange, apartmentCount, isDesktop, tab, onNavClick,
 *     showComp, compCount, expertLoggedIn, containerMaxWidth, upcomingCount
 *   }))
 */
import type { Profile } from "@/types/scoring";

export interface HeaderSectionProps {
  profile: Profile;
  onProfileChange: (_v: Profile) => void;
  apartmentCount: number;
  isDesktop: boolean;
  tab: string;
  onNavClick: (_key: string) => void;
  showComp: boolean;
  compCount: number;
  expertLoggedIn: boolean;
  containerMaxWidth: number;
  upcomingCount?: number | null;
}

/**
 * HelpModal props (HeaderSection 내부 함수 컴포넌트).
 */
export interface HelpModalProps {
  onClose: () => void;
}
