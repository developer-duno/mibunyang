import { useRef, useCallback } from "react";
import { useFinlifeRates } from "./useFinlifeRates";

/** Map 캐시에서 권역별 조회 */
const getMapCached = (ref, grp) => ref.current.get(grp) || null;
/** Map 캐시에 권역별 저장 */
const setMapCached = (ref, grp, data) => ref.current.set(grp, data);

/**
 * 금융감독원 finlife 주택담보대출 금리 데이터 페칭 훅
 * 금융권역(topFinGrpNo)별 캐싱 지원
 * @param {string} topFinGrpNo - 금융권역 코드 (기본 "020000" 은행)
 * @returns {{ rates: Array, loading: boolean, error: string|null }}
 */
export function useLoanRates(topFinGrpNo = "020000") {
  const cacheRef = useRef(new Map());
  const getCached = useCallback((ref) => getMapCached(ref, topFinGrpNo), [topFinGrpNo]);
  const setCached = useCallback((ref, data) => setMapCached(ref, topFinGrpNo, data), [topFinGrpNo]);
  return useFinlifeRates("/api/finlife/loans", topFinGrpNo, cacheRef, getCached, setCached);
}
