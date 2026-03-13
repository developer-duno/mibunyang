import { useState, useEffect, useCallback } from "react";
import { fetchStaticApartments } from "@/services/staticDataApi";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 4000];

export function useApartmentData() {
  const [apartments, setApartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const { data } = await fetchStaticApartments();
        if (signal?.aborted) return;
        setApartments(data);
        setError(null);
        setLoading(false);
        return;
      } catch (err) {
        if (signal?.aborted) return;
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
          if (signal?.aborted) return;
        } else {
          setError(err.message);
          setLoading(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const retry = useCallback(() => { load(); }, [load]);

  return { apartments, loading, error, retry };
}
