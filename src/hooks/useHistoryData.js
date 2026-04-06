import { useState, useCallback, useEffect } from "react";

/**
 * 시계열 데이터 페칭 공통 훅 (usePriceHistory/useUnsoldHistory 통합)
 * @param {string} endpoint - API 엔드포인트 (예: "/api/supabase/prices")
 * @param {string} apartmentId - 아파트 ID
 * @param {string[]} [siblingIds] - 재공고 sibling ID 배열 (복수 조회)
 * @returns {{ data, loading, error, retry }}
 */
export function useHistoryData(endpoint, apartmentId, siblingIds) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // 원시값으로 직렬화하여 무한 루프 방지
  const idsKey = siblingIds?.length > 1 ? siblingIds.join(",") : "";

  const load = useCallback(async (signal) => {
    if (!apartmentId) return;
    setLoading(true);
    setError(null);
    try {
      const url = idsKey
        ? `${endpoint}?apartment_ids=${encodeURIComponent(idsKey)}`
        : `${endpoint}?apartment_id=${encodeURIComponent(apartmentId)}`;
      const res = await fetch(url, { signal });
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(`API 오류 (${res.status})`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "데이터 조회 실패");
      setData(json.data || []);
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error(`[useHistoryData:${endpoint}]`, { apartmentId, error: err.message });
      setError(err.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [apartmentId, idsKey, endpoint]);

  const retry = useCallback(() => { const ac = new AbortController(); load(ac.signal); return () => ac.abort(); }, [load]);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  return { data, loading, error, retry };
}
