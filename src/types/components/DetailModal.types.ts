/**
 * DetailModal props 타입 분할 (M3a a-1, DetailModal 177줄 분할 강제).
 *
 * DetailModal.jsx L36: memo(function DetailModal({ item, onClose, isComp, onComp, isFav, onFav, onShare, isPC, isDesktop, onConsult }))
 */
import type {
  CompareItem,
  CloseHandler,
  CompareHandler,
  FavoriteHandler,
  ResponsiveProps,
} from "@/types/components";

export interface DetailModalProps extends ResponsiveProps {
  item: CompareItem | null;
  onClose: CloseHandler;
  isComp: boolean;
  onComp: CompareHandler;
  isFav: boolean;
  onFav: FavoriteHandler;
  onShare: (_item: CompareItem) => void;
  onConsult: (_item: CompareItem) => void;
}
