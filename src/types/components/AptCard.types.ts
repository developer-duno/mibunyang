/**
 * AptCard 컴포넌트 props 타입 분할 (M3a a-1, AptCard 181줄 분할 강제).
 *
 * AptCard.jsx L37: memo(function AptCard({ apt, res, rank, onDetail, isComp, onComp, isFav, onFav, profileWeights, onExpertView, isDesktop, isLoggedIn = true }))
 */
import type { Apt } from "@/types/scoring";
import type {
  ScoringResult,
  DetailHandler,
  CompareHandler,
  FavoriteHandler,
  ExpertViewHandler,
  ResponsiveProps,
  AuthProps,
  Weights,
} from "@/types/components";

export interface AptCardProps extends ResponsiveProps, AuthProps {
  apt: Apt;
  res: ScoringResult;
  rank: number;
  onDetail: DetailHandler;
  isComp: boolean;
  onComp: CompareHandler;
  isFav: boolean;
  onFav: FavoriteHandler;
  profileWeights: Weights;
  onExpertView: ExpertViewHandler;
}
