/**
 * DetailModal props 타입 분할 (M3a a-1, DetailModal 177줄 분할 강제).
 *
 * DetailModal.jsx L36: memo(function DetailModal({ item, onClose, isComp, onComp, isFav, onFav, onShare, isPC, isDesktop, onConsult }))
 *
 * 호출처 실측: onComp/onFav/onShare/onConsult 모두 apt.id (string) 전달.
 */
import type {
  CompareItem,
  CloseHandler,
  ResponsiveProps,
} from "@/types/components";
import type { Profile } from "@/types/scoring";

export interface DetailModalProps extends ResponsiveProps {
  item: CompareItem | null;
  onClose: CloseHandler;
  isComp: boolean;
  onComp: (_id: string) => void;
  isFav: boolean;
  onFav: (_id: string) => void;
  onShare?: (_id: string) => void;
  onConsult?: (_id: string) => void;
  /** 활성 프로필 — 상위 2 카테고리 CatPanel 맞춤 강조용 (세션 382). 미전달 시 강조 0. */
  profile?: Profile;
  /** 관리자 인사이트 레이어 게이트 (세션 405 전문가 대시보드 이식). 기본 false = 소비자 화면 무변경. */
  adminLoggedIn?: boolean;
}
