import { useState, useCallback, useEffect } from "react";

interface UseHistoryDataReturn {
  data: unknown[];
  loading: boolean;
  error: string | null;
  retry: () => () => void;
}

/**
 * 시계열 데이터 페칭 공통 훅 (usePriceHistory/useUnsoldHistory 통합).
 * data 는 unknown[] — 호출 측 (PriceChart/UnsoldChart) 에서 row 타입 캐스팅.
 */
export function useHistoryData(endpoint: string, apartmentId: string | null | undefined, siblingIds?: string[]): UseHistoryDataReturn {
  const [data, setData] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 원시값으로 직렬화하여 무한 루프 방지
  const idsKey = siblingIds?.length && siblingIds.length > 1 ? siblingIds.join(",") : "";

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!apartmentId) return;
    setLoading(true);
    setError(null);
    try {
      const url = idsKey
        ? `${endpoint}?apartment_ids=${encodeURIComponent(idsKey)}`
        : `${endpoint}?apartment_id=${encodeURIComponent(apartmentId)}`;
      const res = await fetch(url, { signal });
      if (signal?.aborted) return;
      if (!res.ok) {
        if (res.status === 429) throw new Error("요청이 너무 많습니다. 잠시 후 다시 시도해주세요");
        throw new Error(`API 오류 (${res.status})`);
      }
      const json = await res.json() as { ok?: boolean; data?: unknown[]; error?: string };
      if (!json.ok) throw new Error(json.error || "데이터 조회 실패");
      setData(json.data || []);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[useHistoryData:${endpoint}]`, { apartmentId, error: message });
      setError(message);
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
