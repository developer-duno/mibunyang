import type { Apt } from "@/types/scoring";
import type { ScoringResult } from "@/types/components";

export interface MapViewProps {
  filtered: Array<{ apt: Apt; res: ScoringResult }>;
  onDetail: (_id: string) => void;
  isPC?: boolean;
  isDesktop?: boolean;
}
