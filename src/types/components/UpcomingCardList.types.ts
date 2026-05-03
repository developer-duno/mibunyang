/**
 * UpcomingCardList + UpcomingCard 컴포넌트 props 타입 (M3e).
 *
 * UpcomingCardList.jsx L45:
 *   memo(function UpcomingCardList({ items, onSubscribe, onOpenDetail, isMobile }))
 * UpcomingCard.jsx L69 (내부):
 *   memo(function UpcomingCard({ apt, onSubscribe, onOpenDetail, isMobile }))
 */
import type { UpcomingApt } from "@/types/upcoming";

export interface UpcomingCardListProps {
  items: UpcomingApt[];
  onSubscribe?: (_aptId: string) => void;
  onOpenDetail?: (_aptId: string) => void;
  isMobile: boolean;
}

export interface UpcomingCardProps {
  apt: UpcomingApt;
  onSubscribe?: (_aptId: string) => void;
  onOpenDetail?: (_aptId: string) => void;
  isMobile: boolean;
}

/**
 * computeDday 함수 반환 — D-day 라벨 + 색.
 */
export interface DdayInfo {
  label: string;
  color: string;
}
