import { useHistoryData } from "./useHistoryData";

/**
 * 아파트 분양가 시계열 데이터 페칭 훅
 * @param {string} apartmentId - 아파트 ID
 * @param {string[]} [siblingIds] - 재공고 sibling ID 배열 (복수 조회)
 * @returns {{ data, loading, error, retry }}
 */
export function usePriceHistory(apartmentId, siblingIds) {
  return useHistoryData("/api/supabase/prices", apartmentId, siblingIds);
}
