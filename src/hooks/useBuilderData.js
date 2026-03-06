import { useState, useEffect } from "react";
import { fetchBuilderFinancials } from "@/services/dartApi";

export function useBuilderData(apartments) {
  const [enriched, setEnriched] = useState(apartments);
  const [builderLoading, setBuilderLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (apartments.length === 0) {
      setBuilderLoading(false);
      return;
    }

    const builders = [...new Set(apartments.map(a => a.builder).filter(Boolean))];
    if (builders.length === 0) {
      setEnriched(apartments);
      setBuilderLoading(false);
      return;
    }

    fetchBuilderFinancials(builders)
      .then(({ data }) => {
        if (cancelled) return;
        setEnriched(apartments.map(apt => {
          const fin = data[apt.builder];
          if (!fin) return apt;
          return {
            ...apt,
            builderDebtRatio: fin.debtRatio ?? apt.builderDebtRatio,
            builderCreditGrade: fin.creditGrade ?? apt.builderCreditGrade,
          };
        }));
      })
      .catch(() => {
        if (!cancelled) setEnriched(apartments);
      })
      .finally(() => {
        if (!cancelled) setBuilderLoading(false);
      });

    return () => { cancelled = true; };
  }, [apartments]);

  return { apartments: enriched, builderLoading };
}
