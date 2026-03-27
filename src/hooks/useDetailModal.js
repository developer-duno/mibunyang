import { useState, useCallback, useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

export function useDetailModal(tab) {
  const [detailAptId, setDetailAptId] = useState(null);
  const handleOpenDetail = useCallback((id) => { setDetailAptId(id); trackEvent("detail_open", { apartment_id: id }); }, []);
  const handleCloseDetail = useCallback(() => { setDetailAptId(null); }, []);
  useEffect(() => { setDetailAptId(null); }, [tab]);
  return { detailAptId, handleOpenDetail, handleCloseDetail, setDetailAptId };
}
