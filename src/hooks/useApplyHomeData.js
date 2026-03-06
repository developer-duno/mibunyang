import { useState, useEffect } from "react";
import { UNSOLD } from "@/constants/unsold";
import { fetchApplyHomeApartments } from "@/services/applyhomeApi";

export function useApplyHomeData() {
  const [apartments, setApartments] = useState(UNSOLD);
  const [applyHomeLoading, setApplyHomeLoading] = useState(true);
  const [applyHomeError, setApplyHomeError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    fetchApplyHomeApartments()
      .then(({ data }) => {
        if (cancelled) return;
        if (data.length > 0) {
          setApartments(data);
        }
      })
      .catch(err => {
        if (cancelled) return;
        setApplyHomeError(err.message);
      })
      .finally(() => {
        if (!cancelled) setApplyHomeLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { apartments, applyHomeLoading, applyHomeError };
}
