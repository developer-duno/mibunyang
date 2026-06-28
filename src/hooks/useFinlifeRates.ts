import { useState, useCallback, useEffect } from "react";
import type { MutableRefObject } from "react";

/** 금리 데이터 1건 (finlife API 스키마 일부, 추가 필드는 동적). */
export interface FinlifeRate {
  bank?: string;
  product?: string;
  rateMin?: number;
  rateMax?: number;
  [key: string]: unknown;
}

interface UseFinlifeRatesReturn {
  rates: FinlifeRate[];
  loading: boolean;
  error: string | null;
}

/**
 * finlife 금리 데이터 페칭 공통 팩토리.
 * 호출 측 cacheRef 타입이 다양하여 (Map<string, unknown> 또는 단일값) generic R 로 좁힘.
 * 데이터는 FinlifeRate 인덱스 시그니처로 동적 필드 허용.
 */
export function useFinlifeRates<R extends MutableRefObject<unknown>>(
  apiPath: string,
  topFinGrpNo: string,
  cacheRef: R,
  getCached: (_ref: R) => unknown,
  setCached: (_ref: R, _data: unknown) => void
): UseFinlifeRatesReturn {
  const [rates, setRates] = useState<FinlifeRate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const cached = getCached(cacheRef);
      if (cached) {
        setRates(cached as FinlifeRate[]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const sep = apiPath.includes("?") ? "&" : "?";
        const res = await fetch(`${apiPath}${sep}topFinGrpNo=${topFinGrpNo}`, { signal });
        if (signal?.aborted) return;
        if (!res.ok) throw new Error(`API 오류 (${res.status})`);
        const json = (await res.json()) as { ok?: boolean; data?: FinlifeRate[]; error?: string };
        if (!json.ok) throw new Error(json.error || "금리 데이터 조회 실패");
        const data = json.data ?? [];
        setCached(cacheRef, data);
        setRates(data);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (err instanceof Error) setError(err.message);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [apiPath, topFinGrpNo, getCached, setCached, cacheRef]
  );

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  return { rates, loading, error };
}
