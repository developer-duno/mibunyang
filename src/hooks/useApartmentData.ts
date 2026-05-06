import { useState, useEffect, useCallback } from "react";
import { fetchStaticApartments } from "@/services/staticDataApi";
import { dedupApartments } from "@/lib/dedup";
import type { Apt } from "@/types/scoring";
import type { UseApartmentDataReturn } from "@/types/hooks";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 4000];

export function useApartmentData(): UseApartmentDataReturn {
  const [apartments, setApartments] = useState<Apt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataUpdatedAt, setDataUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const { data, dataUpdatedAt: updAt } = await fetchStaticApartments();
        if (signal?.aborted) return;
        const normalized: Apt[] = data.map((a: Apt) => a.region && a.region.includes(",") ? { ...a, region: a.region.split(",")[0].trim() } : a);
        const seen = new Set<string>();
        const idDeduped = normalized.filter((a: Apt) => { if (!a.id || seen.has(a.id)) return false; seen.add(a.id); return true; });
        setApartments(dedupApartments(idDeduped as Array<Apt & { id: string }>));
        setDataUpdatedAt(updAt ?? null);
        setError(null);
        setLoading(false);
        return;
      } catch (err) {
        if (signal?.aborted) return;
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
          if (signal?.aborted) return;
        } else {
          if (err instanceof Error) setError(err.message);
          setLoading(false);
        }
      }
    }
  }, []);

  const retry = useCallback(() => { load(); }, [load]);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  return { apartments, loading, error, retry, dataUpdatedAt };
}
