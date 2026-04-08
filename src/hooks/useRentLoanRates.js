import { useRef, useCallback } from "react";
import { useFinlifeRates } from "./useFinlifeRates";

/** 단일 캐시 조회 */
const getSingleCached = (ref) => ref.current;
/** 단일 캐시 저장 */
const setSingleCached = (ref, _grp, data) => { ref.current = data; };

/**
 * 금융감독원 finlife 전세자금대출 금리 데이터 페칭 훅
 * 세션 내 1회만 fetch (useRef 캐싱)
 * @returns {{ rates: Array, loading: boolean, error: string|null }}
 */
export function useRentLoanRates() {
  const cacheRef = useRef(null);
  const getCached = useCallback((ref) => getSingleCached(ref), []);
  const setCached = useCallback((ref, data) => setSingleCached(ref, null, data), []);
  return useFinlifeRates("/api/finlife/rates?type=rent", "020000", cacheRef, getCached, setCached);
}
