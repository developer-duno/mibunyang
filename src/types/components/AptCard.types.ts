/**
 * AptCard 컴포넌트 props 타입 분할 (M3a a-1, AptCard 181줄 분할 강제).
 *
 * AptCard.jsx L37: memo(function AptCard({ apt, res, rank, onDetail, isComp, onComp, isFav, onFav, profileWeights, isDesktop, isLoggedIn = true }))
 *
 * 호출처 실측 (App.jsx): onDetail/onComp/onFav 모두 apt.id (string) 전달.
 */
import type { Apt } from "@/types/scoring";
import type { ScoringResult, ResponsiveProps, AuthProps, Weights } from "@/types/components";
import type { RegionalStats } from "@/scoring/regionalStats";

export interface AptCardProps extends ResponsiveProps, AuthProps {
  apt: Apt;
  res: ScoringResult;
  rank: number;
  onDetail: (_id: string) => void;
  isComp: boolean;
  onComp: (_id: string) => void;
  isFav: boolean;
  onFav: (_id: string) => void;
  profileWeights: Weights;
  /**
   * 편차 스트립이 쓰는 지역 분포 (세션 487). `useRegionalStats` 가 준 **안정 참조**여야 한다 —
   * 매 렌더 새 객체를 넘기면 memo comparator 가 매번 거짓이 되어 카드 30장이 통째로 다시 그려진다.
   */
  regionStats?: RegionalStats | null;
}
