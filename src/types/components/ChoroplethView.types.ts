import type { Apt } from "@/types/scoring";
import type { ScoringResult } from "@/types/components";

export interface ChoroplethViewProps {
  mapInstance: unknown;
  ready: boolean;
  filtered: Array<{ apt: Apt; res: ScoringResult }>;
  onSidoClick?: (_dbName: string) => void;
  isPC?: boolean;
  isDesktop?: boolean;
}
