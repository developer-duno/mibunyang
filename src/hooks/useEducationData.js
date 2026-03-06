import { useState, useEffect } from "react";
import { fetchEducationData } from "@/services/neisApi";

export function useEducationData(apartments) {
  const [enriched, setEnriched] = useState(apartments);
  const [educationLoading, setEducationLoading] = useState(true);
  const [educationError, setEducationError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    if (apartments.length === 0) {
      setEducationLoading(false);
      return;
    }

    const withRegion = apartments.filter(a => a.region != null && a.gu != null);
    if (withRegion.length === 0) {
      setEducationLoading(false);
      return;
    }

    fetchEducationData(withRegion)
      .then(({ data }) => {
        if (cancelled) return;
        setEnriched(apartments.map(apt => {
          const edu = data[apt.id];
          if (!edu) return apt;
          return {
            ...apt,
            schoolScore: edu.schoolScore ?? apt.schoolScore,
            schoolGrade: edu.schoolGrade ?? apt.schoolGrade,
            _educationEnriched: true,
          };
        }));
      })
      .catch(err => {
        if (cancelled) return;
        setEducationError(err.message);
      })
      .finally(() => {
        if (!cancelled) setEducationLoading(false);
      });

    return () => { cancelled = true; };
  }, [apartments]);

  return { apartments: enriched, educationLoading, educationError };
}
