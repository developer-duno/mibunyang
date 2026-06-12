/**
 * UpcomingPage 컴포넌트 props 타입.
 *
 * UpcomingPage.tsx:
 *   function UpcomingPage({ onOpenDetail, onBackToMain, scored, dataLoading })
 * (memo 아님 — lazy 마운트 1회용 페이지)
 */

import type { ScoredApt } from "@/types/hooks";

export interface UpcomingPageProps {
  onOpenDetail?: (_id: string) => void;
  onBackToMain: () => void;
  /** 분양결과 탭 입력 (정적 JSON 기반 — 새 fetch 0, 세션 406 Phase 2) */
  scored: ScoredApt[];
  /** scored 로딩 전 거짓 빈 상태 차단용 (useApartmentData loading) */
  dataLoading: boolean;
}
