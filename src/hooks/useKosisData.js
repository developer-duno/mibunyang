import { useState, useEffect } from "react";
import { fetchKosisStats } from "@/services/kosisApi";

export function useKosisData(baseApartments) {
  const [apartments, setApartments] = useState(baseApartments);
  const [kosisLoading, setKosisLoading] = useState(true);
  const [kosisError, setKosisError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    if (baseApartments.length === 0) {
      setApartments(baseApartments);
      setKosisLoading(false);
      return;
    }

    fetchKosisStats()
      .then(({ data }) => {
        if (cancelled) return;
        const enriched = baseApartments.map(apt => {
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
        setApartments(baseApartments);
      })
      .finally(() => {
        if (!cancelled) setKosisLoading(false);
      });

    return () => { cancelled = true; };
  }, [baseApartments]);

  return { apartments, kosisLoading, kosisError };
}
