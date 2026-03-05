import { useState, useEffect } from "react";
import { UNSOLD } from "@/constants/unsold";
import { fetchKosisStats } from "@/services/kosisApi";

export function useKosisData() {
  const [apartments, setApartments] = useState(UNSOLD);
  const [kosisLoading, setKosisLoading] = useState(true);
  const [kosisError, setKosisError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    fetchKosisStats()
      .then(({ data }) => {
        if (cancelled) return;
        const enriched = UNSOLD.map(apt => {
          const regional = data[apt.region];
          if (!regional) return apt;
          return {
            ...apt,
            popGrowth: apt.popGrowth ?? regional.popGrowthRate,
            _regionalUnsold: regional.unsoldCount,
            _regionalIncome: regional.avgIncome,
          };
        });
        setApartments(enriched);
      })
      .catch(err => {
        if (cancelled) return;
        setKosisError(err.message);
      })
      .finally(() => {
        if (!cancelled) setKosisLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { apartments, kosisLoading, kosisError };
}
