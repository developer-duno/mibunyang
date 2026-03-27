import { useState, useCallback, useEffect } from "react";

/**
 * 아파트 미분양 추이 시계열 데이터 페칭 훅
 * @param {string} apartmentId - 아파트 ID
 * @param {string[]} [siblingIds] - 재공고 sibling ID 배열 (복수 조회)
 * @returns {{ data, loading, error, retry }}
 */
export function useUnsoldHistory(apartmentId, siblingIds) {
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
        ? `/api/supabase/unsold-history?apartment_ids=${encodeURIComponent(idsKey)}`
        : `/api/supabase/unsold-history?apartment_id=${encodeURIComponent(apartmentId)}`;
      const res = await fetch(url, { signal });
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(`API 오류 (${res.status})`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "데이터 조회 실패");
      setData(json.data || []);
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("[useUnsoldHistory]", { apartmentId, error: err.message });
      setError(err.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [apartmentId, idsKey]);

  const retry = useCallback(() => { const ac = new AbortController(); load(ac.signal); return () => ac.abort(); }, [load]);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  return { data, loading, error, retry };
}
