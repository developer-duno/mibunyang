/**
 * AptCard 컴포넌트 props 타입 분할 (M3a a-1, AptCard 181줄 분할 강제).
 *
 * AptCard.jsx L37: memo(function AptCard({ apt, res, rank, onDetail, isComp, onComp, isFav, onFav, profileWeights, isDesktop, isLoggedIn = true }))
 *
 * 호출처 실측 (App.jsx): onDetail/onComp/onFav 모두 apt.id (string) 전달.
 */
import type { Apt } from "@/types/scoring";
import type { ScoringResult, ResponsiveProps, AuthProps, Weights } from "@/types/components";

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
}
