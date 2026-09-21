import type { Apt } from "@/types/scoring";
import type { ScoringResult } from "@/types/components";

export interface ChoroplethViewProps {
  mapInstance: unknown;
  ready: boolean;
  filtered: Array<{ apt: Apt; res: ScoringResult }>;
  /**
   * 시도 폴리곤 클릭. 두 번째 인자 = 그 칸을 칠할 때 쓴 표본 정보(세션554).
   * 점선(표본 부족) 칸을 눌러 점 보기로 넘어가면 경고가 사라지던 자리를 잇기 위해,
   * 색칠에 쓴 수치를 그대로 넘겨 도착 화면이 같은 수를 말하게 한다.
   */
  onSidoClick?: (_dbName: string, _sample: { count: number; enough: boolean }) => void;
  isPC?: boolean;
  isDesktop?: boolean;
}
