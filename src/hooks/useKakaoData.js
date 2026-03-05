import { useState, useEffect } from "react";
import { fetchKakaoInfra } from "@/services/kakaoApi";

export function useKakaoData(apartments) {
  const [enriched, setEnriched] = useState(apartments);
  const [kakaoLoading, setKakaoLoading] = useState(true);
  const [kakaoError, setKakaoError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const withCoords = apartments.filter(a => a.lat != null && a.lng != null);
    if (withCoords.length === 0) {
      setKakaoLoading(false);
      return;
    }

    fetchKakaoInfra(withCoords)
      .then(({ data }) => {
        if (cancelled) return;
        setEnriched(apartments.map(apt => {
          const k = data[apt.id];
          if (!k) return apt;
          return {
            ...apt,
            hospital: k.hospital ?? apt.hospital,
            mart: k.mart ?? apt.mart,
            conv: k.conv ?? apt.conv,
            park: k.park ?? apt.park,
            cafe: k.cafe ?? apt.cafe,
            culture: k.culture ?? apt.culture,
            bank: k.bank ?? apt.bank,
            pharmacy: k.pharmacy ?? apt.pharmacy,
            subwayDist: k.subwayDist ?? apt.subwayDist,
            _kakaoEnriched: true,
          };
        }));
      })
      .catch(err => {
        if (cancelled) return;
        setKakaoError(err.message);
      })
      .finally(() => {
        if (!cancelled) setKakaoLoading(false);
      });

    return () => { cancelled = true; };
  }, [apartments]);

  return { apartments: enriched, kakaoLoading, kakaoError };
}
