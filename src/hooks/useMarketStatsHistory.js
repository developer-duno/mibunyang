import { useState, useCallback, useEffect } from "react";

const ENDPOINT = "/api/supabase/market-stats-history";

/**
 * region+gu 시장통계 시계열 fetch 훅 (useHistoryData 패턴 답습).
 *
 * @param {string} region — DB 짧은 이름 ("서울"·"경기")
 * @param {string} gu — DB 표기 ("강남구") 또는 "" (시도 단위)
 * @returns {{ data: Array, loading: boolean, error: string|null, retry: () => void }}
 *
 * - region 빈 값이면 fetch 0 (early return)
 * - 429 시 한국어 메시지 (PriceChart/UnsoldChart 패턴)
 * - AbortController cleanup, retry() 재호출
 */
export function useMarketStatsHistory(region, gu) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const guKey = gu || "";

  const load = useCallback(async (signal) => {
    if (!region) return;
    setLoading(true);
    setError(null);
    try {
      const url = `${ENDPOINT}?region=${encodeURIComponent(region)}&gu=${encodeURIComponent(guKey)}`;
      const res = await fetch(url, { signal });
      if (signal?.aborted) return;
      if (!res.ok) {
        if (res.status === 429) throw new Error("요청이 너무 많습니다. 잠시 후 다시 시도해주세요");
        throw new Error(`API 오류 (${res.status})`);
      }
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "데이터 조회 실패");
      setData(Array.isArray(json.data) ? json.data : []);
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error(`[useMarketStatsHistory] ${region}/${guKey}:`, err.message);
      setError(err.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [region, guKey]);

  const retry = useCallback(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  return { data, loading, error, retry };
}
