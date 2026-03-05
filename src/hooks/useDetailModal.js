import { useState, useCallback, useEffect } from "react";

export function useDetailModal(tab) {
  const [detailAptId, setDetailAptId] = useState(null);
  const handleOpenDetail = useCallback((id) => { setDetailAptId(id); }, []);
  const handleCloseDetail = useCallback(() => { setDetailAptId(null); }, []);
  useEffect(() => { setDetailAptId(null); }, [tab]);
  return { detailAptId, handleOpenDetail, handleCloseDetail, setDetailAptId };
}
