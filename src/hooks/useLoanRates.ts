import { useRef, useCallback } from "react";
import type { MutableRefObject } from "react";
import { useFinlifeRates } from "./useFinlifeRates";

type CacheRef<T> = MutableRefObject<Map<string, T>>;

/** Map 캐시에서 권역별 조회 */
const getMapCached = <T,>(ref: CacheRef<T>, grp: string): T | null => ref.current.get(grp) || null;
/** Map 캐시에 권역별 저장 */
const setMapCached = <T,>(ref: CacheRef<T>, grp: string, data: T): void => { ref.current.set(grp, data); };

/**
 * 금융감독원 finlife 주택담보대출 금리 데이터 페칭 훅
 * 금융권역(topFinGrpNo)별 캐싱 지원
 */
export function useLoanRates(topFinGrpNo: string = "020000") {
  const cacheRef = useRef(new Map<string, unknown>());
  const getCached = useCallback((ref: CacheRef<unknown>) => getMapCached(ref, topFinGrpNo), [topFinGrpNo]);
  const setCached = useCallback((ref: CacheRef<unknown>, data: unknown) => setMapCached(ref, topFinGrpNo, data), [topFinGrpNo]);
  return useFinlifeRates("/api/finlife/rates?type=mortgage", topFinGrpNo, cacheRef, getCached, setCached);
}
