import { useState, useCallback, useEffect } from "react";
import type { MarketStatsRow, UseMarketStatsHistoryReturn } from "@/types/hooks";

const ENDPOINT = "/api/supabase/market-stats-history";

// region+gu 별 시장통계 시계열 캐시. SPA 세션 동안 유지(TTL 없음).
// MarketStatsCharts 도 DetailModal 안이라 모듈 레벨 Map 이어야 재오픈 시 재fetch 제거.
const marketStatsCache = new Map<string, MarketStatsRow[]>();
/** 테스트 격리용 — vitest beforeEach 에서 비운다. */
export function _clearMarketStatsCache(): void { marketStatsCache.clear(); }

/**
 * region+gu 시장통계 시계열 fetch 훅 (useHistoryData 패턴 답습).
 *
 * - region 빈 값이면 fetch 0 (early return)
 * - 429 시 한국어 메시지 (PriceChart/UnsoldChart 패턴)
 * - AbortController cleanup, retry() 재호출
 * - catch 패턴: useHistoryData 답습 (AbortError 무시 + non-Error 는 String(err) fallback)
 */
export function useMarketStatsHistory(region: string, gu: string): UseMarketStatsHistoryReturn {
  const [data, setData] = useState<MarketStatsRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guKey = gu || "";

  const load = useCallback(async (signal?: AbortSignal, forceRefresh = false) => {
    if (!region) return;
    const cacheKey = `${region}|${guKey}`;
    if (!forceRefresh) {
      const cached = marketStatsCache.get(cacheKey);
      // 빈 배열은 캐시 히트로 보지 않음 (늦게 적재되는 시계열 고착 방지).
      if (cached && cached.length > 0) { setData(cached); setLoading(false); setError(null); return; }
    }
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
      const json = await res.json() as { ok?: boolean; data?: unknown; error?: string };
      if (!json.ok) throw new Error(json.error || "데이터 조회 실패");
      const rows = Array.isArray(json.data) ? json.data as MarketStatsRow[] : [];
      marketStatsCache.set(cacheKey, rows);
      setData(rows);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[useMarketStatsHistory] ${region}/${guKey}:`, message);
      setError(message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [region, guKey]);

  const retry = useCallback(() => {
    const ac = new AbortController();
    // retry 는 신선한 재요청이 목적이므로 캐시를 우회한다.
    load(ac.signal, true);
  }, [load]);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  return { data, loading, error, retry };
}
