/**
 * DetailModal props 타입 분할 (M3a a-1, DetailModal 177줄 분할 강제).
 *
 * DetailModal.jsx L36: memo(function DetailModal({ item, onClose, isComp, onComp, isFav, onFav, onShare, isPC, isDesktop, onConsult }))
 *
 * 호출처 실측: onComp/onFav/onShare/onConsult 모두 apt.id (string) 전달.
 */
import type { CompareItem, CloseHandler, ResponsiveProps } from "@/types/components";
import type { Profile } from "@/types/scoring";
import type { RegionalStats } from "@/scoring/regionalStats";

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
  /**
   * 종합 탭 편차 스트립이 쓰는 지역 분포 (세션 487 PR-4).
   * `useRegionalStats` 가 준 **안정 참조**여야 한다 — 매 렌더 새 객체면 모달이 계속 다시 그려진다.
   * 없으면(null) 스트립을 아예 안 그린다. "미수집" 8줄짜리 빈 블록이 더 나쁘기 때문.
   */
  regionStats?: RegionalStats | null;
  /**
   * 로그인 여부 — false 면 점수·가중치만 블라인드 (단계 2-A, 세션 489 A안).
   *
   * **기본값 true** 가 이 슬라이스의 안전장치다. 지금은 useLoginGate 가 비로그인 상세 진입 자체를
   * 막고 있어(2-B 에서 완화 예정) 이 분기는 실제로 그려지지 않는다 — 즉 이 PR 은 머지돼도
   * 화면 변화 0 인 "잠자는 코드". 기본값을 false 로 바꾸는 순간 잠이 깬다.
   */
  isLoggedIn?: boolean;
  /** 블라인드 자리 카카오 CTA 클릭 — 로그인 유도 모달 열기. 미전달 시 CTA 는 눌러도 무동작. */
  onRequestLogin?: () => void;
}
