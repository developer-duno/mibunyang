import { useHistoryData } from "./useHistoryData";

/**
 * 아파트 분양가 시계열 데이터 페칭 훅.
 * data 는 unknown[] — 호출 측 (PriceChart) 에서 row 타입 캐스팅.
 */
export function usePriceHistory(apartmentId: string | null | undefined, siblingIds?: string[]) {
  return useHistoryData("/api/supabase/prices", apartmentId, siblingIds);
}
