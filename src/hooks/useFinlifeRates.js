import { useState, useCallback, useEffect, useRef } from "react";

/**
 * finlife 금리 데이터 페칭 공통 팩토리
 * useLoanRates, useRentLoanRates에서 사용
 * @param {string} apiPath - API 경로 (예: "/api/finlife/loans")
 * @param {string} topFinGrpNo - 금융권역 코드
 * @param {React.MutableRefObject} cacheRef - 캐시 참조 (Map 또는 단일값)
 * @param {function} getCached - 캐시에서 값 조회 (cacheRef) => data|null
 * @param {function} setCached - 캐시에 값 저장 (cacheRef, data) => void
 * @returns {{ rates: Array, loading: boolean, error: string|null }}
 */
export function useFinlifeRates(apiPath, topFinGrpNo, cacheRef, getCached, setCached) {
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (signal) => {
    const cached = getCached(cacheRef);
    if (cached) { setRates(cached); return; }
    setLoading(true);
    setError(null);
    try {
      const sep = apiPath.includes("?") ? "&" : "?";
      const res = await fetch(`${apiPath}${sep}topFinGrpNo=${topFinGrpNo}`, { signal });
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(`API 오류 (${res.status})`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "금리 데이터 조회 실패");
      const data = json.data ?? [];
      setCached(cacheRef, data);
      setRates(data);
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [apiPath, topFinGrpNo, getCached, setCached, cacheRef]);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  return { rates, loading, error };
}
