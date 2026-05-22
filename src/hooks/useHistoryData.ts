import { useState, useCallback, useEffect } from "react";

interface UseHistoryDataReturn {
  data: unknown[];
  loading: boolean;
  error: string | null;
  retry: () => () => void;
}

// apartmentId(또는 siblingIds)별 시계열 응답 캐시. SPA 세션 동안 유지(TTL 없음).
// DetailModal 은 조건부 렌더라 닫으면 PriceChart/UnsoldChart 가 언마운트되므로,
// 컴포넌트 useRef 가 아닌 모듈 레벨 Map 이어야 모달 재오픈 시 재fetch 가 제거된다.
const historyCache = new Map<string, unknown[]>();
/** 테스트 격리용 — 모듈 캐시는 vitest 테스트 간 공유되므로 beforeEach 에서 비운다. */
export function _clearHistoryCache(): void { historyCache.clear(); }

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

  const load = useCallback(async (signal?: AbortSignal, forceRefresh = false) => {
    if (!apartmentId) return;
    // fetch URL 과 1:1 대응하는 캐시 키 (idsKey 가 단일/복수 조회를 구분).
    const cacheKey = `${endpoint}|${idsKey || apartmentId}`;
    if (!forceRefresh) {
      const cached = historyCache.get(cacheKey);
      // 빈 배열은 캐시 히트로 보지 않음 — ETL 로 늦게 적재되는 시계열이
      // 한 번 빈 응답을 받으면 영구히 빈 차트로 고착되는 것을 막는다.
      if (cached && cached.length > 0) { setData(cached); setLoading(false); setError(null); return; }
    }
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
      const rows = json.data || [];
      historyCache.set(cacheKey, rows);
      setData(rows);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : String(err);
      if (import.meta.env.DEV) {
        console.error(`[useHistoryData:${endpoint}]`, { apartmentId, error: message });
      }
      setError(message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [apartmentId, idsKey, endpoint]);

  // retry 는 신선한 재요청이 목적이므로 forceRefresh=true 로 캐시를 우회한다.
  const retry = useCallback(() => { const ac = new AbortController(); load(ac.signal, true); return () => ac.abort(); }, [load]);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  return { data, loading, error, retry };
}
