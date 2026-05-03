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

export interface DetailModalProps extends ResponsiveProps {
  item: CompareItem | null;
  onClose: CloseHandler;
  isComp: boolean;
  onComp: (_id: string) => void;
  isFav: boolean;
  onFav: (_id: string) => void;
  onShare?: (_id: string) => void;
  onConsult?: (_id: string) => void;
}
