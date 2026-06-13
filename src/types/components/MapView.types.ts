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
  /** 초기 뷰포트 복원 (M3) — 마운트 시 1회만 호출(동적 변경 미지원, compact 답습). getter 함수라 부모 render 중 ref 접근 회피. null = MAP_DEFAULTS 진입 */
  getViewport?: () => { lat: number; lng: number; level: number } | null;
  /** idle 시 현재 center/level 끌어올림 (M3) — 탭 전환/언마운트 간 위치 보존. ref 미러로 마커 effect 격리 */
  onViewportChange?: (_v: { lat: number; lng: number; level: number }) => void;
}
