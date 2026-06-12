import type { Apt } from "@/types/scoring";
import type { ScoringResult } from "@/types/components";

export interface MapViewProps {
  filtered: Array<{ apt: Apt; res: ScoringResult }>;
  onDetail: (_id: string) => void;
  isPC?: boolean;
  isDesktop?: boolean;
  /** 루트 높이 오버라이드 — 미전달 시 현행 뷰포트 기준 3분기 calc (기존 지도 탭 무변경) */
  height?: string;
  /** 위젯 모드: 인프라 오버레이·모드토글·현위치·줌 컨트롤 숨김 + 휠 줌 차단. 마운트 시 고정 — 동적 변경 미지원 */
  compact?: boolean;
  /** 선택 미러 — 커밋된 selected 변경 전부 전파 (V2 옆패널·미래 위젯 전제, spec §8). unmount 시 null 미통지 */
  onSelect?: (_item: { apt: Apt; res: ScoringResult } | null) => void;
}
