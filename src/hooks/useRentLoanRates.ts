import { useRef, useCallback } from "react";
import type { MutableRefObject } from "react";
import { useFinlifeRates } from "./useFinlifeRates";

type SingleCacheRef = MutableRefObject<unknown>;
const getSingleCached = (ref: SingleCacheRef) => ref.current;
const setSingleCached = (ref: SingleCacheRef, _grp: string | null, data: unknown) => {
  ref.current = data;
};

/**
 * 금융감독원 finlife 전세자금대출 금리 데이터 페칭 훅.
 * 세션 내 1회만 fetch (useRef 캐싱).
 */
export function useRentLoanRates() {
  const cacheRef = useRef<unknown>(null);
  const getCached = useCallback((ref: SingleCacheRef) => getSingleCached(ref), []);
  const setCached = useCallback((ref: SingleCacheRef, data: unknown) => setSingleCached(ref, null, data), []);
  return useFinlifeRates("/api/finlife/rates?type=rent", "020000", cacheRef, getCached, setCached);
}
