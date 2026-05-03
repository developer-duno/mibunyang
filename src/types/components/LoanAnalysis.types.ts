/**
 * LoanAnalysis 컴포넌트 props 타입 (M3d).
 *
 * LoanAnalysis.jsx L9:
 *   memo(function LoanAnalysis({ apt }))
 */
import type { Apt } from "@/types/scoring";

export interface LoanAnalysisProps {
  apt: Apt;
}
