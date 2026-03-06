import { useState, useEffect } from "react";
import { fetchStaticApartments } from "@/services/staticDataApi";

export function useApartmentData() {
  const [apartments, setApartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    fetchStaticApartments()
      .then(({ data }) => {
        if (!cancelled) setApartments(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { apartments, loading, error };
}
