import { useHistoryData } from "./useHistoryData";

/**
 * 아파트 미분양 추이 시계열 데이터 페칭 훅
 * @param {string} apartmentId - 아파트 ID
 * @param {string[]} [siblingIds] - 재공고 sibling ID 배열 (복수 조회)
 * @returns {{ data, loading, error, retry }}
 */
export function useUnsoldHistory(apartmentId, siblingIds) {
  return useHistoryData("/api/supabase/unsold-history", apartmentId, siblingIds);
}
