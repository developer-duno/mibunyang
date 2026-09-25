/**
 * HeaderSection 컴포넌트 props 타입 (M3e).
 *
 * HeaderSection.jsx L98:
 *   memo(function HeaderSection({
 *     profile, onProfileChange, apartmentCount, isDesktop, tab, onNavClick,
 *     adminLoggedIn, isLoggedIn, containerMaxWidth, upcomingCount
 *   }))
 */
import type { Profile } from "@/types/scoring";
import type { InfoPageProps } from "@/components/sections/InfoPage";

/** 도움말(?) 패널 본문 = InfoPage 에 넘길 값 — App 에서 받아 그대로 넘긴다 (세션 577 A-12, 이름도 InfoPage 것 그대로) */
type HelpInfoProps = Omit<InfoPageProps, "isLoggedIn" | "adminLoggedIn">;

export interface HeaderSectionProps extends HelpInfoProps {
  profile: Profile;
  onProfileChange: (_v: Profile) => void;
  apartmentCount: number;
  isDesktop: boolean;
  tab: string;
  onNavClick: (_key: string) => void;
  /** 관리자 네비 분기 (세션 405 — role 축) */
  adminLoggedIn: boolean;
  /** 데스크톱 로그아웃 버튼 게이트 (공용 토큰 축 — 카카오 손님 포함) */
  isLoggedIn: boolean;
  containerMaxWidth: number;
  upcomingCount?: number | null;
}

/**
 * HelpModal props (HeaderSection 내부 함수 컴포넌트).
 */
export interface HelpModalProps extends InfoPageProps {
  onClose: () => void;
}
