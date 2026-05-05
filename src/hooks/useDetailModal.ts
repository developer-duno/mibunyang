import { useState, useCallback, useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

export function useDetailModal(tab: string) {
  const [detailAptId, setDetailAptId] = useState<string | null>(null);
  const handleOpenDetail = useCallback((id: string) => { setDetailAptId(id); trackEvent("detail_open", { apartment_id: id }); }, []);
  const handleCloseDetail = useCallback(() => { setDetailAptId(null); }, []);
  // tab 전환 시 모달 닫기 — setTab 호출지 10곳 (useAppNavigation handler 7개 + URL 딥링크 등) 에 분산하면 누락 위험
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDetailAptId(null); }, [tab]);
  return { detailAptId, handleOpenDetail, handleCloseDetail, setDetailAptId };
}
