/**
 * DataSections 컴포넌트 props 타입 (M3d).
 *
 * DataSections.jsx L84:
 *   memo(function DataSections({ apt }))
 */
import type { Apt } from "@/types/scoring";

export interface DataSectionsProps {
  apt: Apt;
}

/**
 * DATA_SECTIONS 배열 원소 — section 정의.
 * highlight (강조 박스 필드) / pairs (인프라 [count,dist] 쌍) / grid (일반 필드).
 * 셋 다 optional 이지만 적어도 하나는 채워짐.
 */
export interface DataSection {
  title: string;
  highlight?: readonly string[];
  pairs?: ReadonlyArray<readonly [string, string | null]>;
  grid?: readonly string[];
}
