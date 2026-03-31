import { useState, useCallback, useEffect, useRef } from "react";

/**
 * 금융감독원 finlife 주택담보대출 금리 데이터 페칭 훅
 * 세션 내 1회만 fetch (useRef 캐싱)
 * @returns {{ rates: Array, loading: boolean, error: string|null }}
 */
export function useLoanRates() {
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const cacheRef = useRef(null);

  const load = useCallback(async (signal) => {
    // 캐시 히트 시 재사용
    if (cacheRef.current) {
      setRates(cacheRef.current);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/finlife/loans?topFinGrpNo=020000", { signal });
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(`API 오류 (${res.status})`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "금리 데이터 조회 실패");
      const data = json.data ?? [];
      cacheRef.current = data;
      setRates(data);
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  return { rates, loading, error };
}
