import { useState, useCallback, useEffect } from "react";

/**
 * 아파트 분양가 시계열 데이터 페칭 훅 (useApartmentData 패턴)
 * @param {string} apartmentId - 아파트 ID
 * @returns {{ data, loading, error, retry }}
 */
export function usePriceHistory(apartmentId) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (signal) => {
    if (!apartmentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/supabase/prices?apartment_id=${encodeURIComponent(apartmentId)}`, { signal });
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(`API 오류 (${res.status})`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "데이터 조회 실패");
      setData(json.data || []);
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("[usePriceHistory]", { apartmentId, error: err.message });
      setError(err.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [apartmentId]);

  const retry = useCallback(() => { const ac = new AbortController(); load(ac.signal); return () => ac.abort(); }, [load]);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  return { data, loading, error, retry };
}
