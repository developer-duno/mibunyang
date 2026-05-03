/**
 * UpcomingPage 컴포넌트 props 타입 (M3e).
 *
 * UpcomingPage.jsx L21:
 *   function UpcomingPage({ onOpenDetail, onBackToMain })
 * (memo 아님 — lazy 마운트 1회용 페이지)
 */

export interface UpcomingPageProps {
  onOpenDetail?: (_id: string) => void;
  onBackToMain: () => void;
}
