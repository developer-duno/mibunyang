import { useHistoryData } from "./useHistoryData";

/**
 * 아파트 미분양 추이 시계열 데이터 페칭 훅.
 * data 는 unknown[] — 호출 측 (UnsoldChart) 에서 row 타입 캐스팅.
 */
export function useUnsoldHistory(apartmentId: string | null | undefined, siblingIds?: string[]) {
  return useHistoryData("/api/supabase/unsold-history", apartmentId, siblingIds);
}
