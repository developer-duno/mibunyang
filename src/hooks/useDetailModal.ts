import { useState, useCallback, useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

export function useDetailModal(tab: string, recordView?: (_id: string) => void) {
  const [detailAptId, setDetailAptId] = useState<string | null>(null);
  // 상세 진입 단일 지점 — 로그인 게이트(useLoginGate)를 통과한 호출만 도달하므로 "로그인 시 기록" 자동 충족
  const handleOpenDetail = useCallback(
    (id: string) => {
      setDetailAptId(id);
      trackEvent("detail_open", { apartment_id: id });
      recordView?.(id);
    },
    [recordView]
  );
  const handleCloseDetail = useCallback(() => {
    setDetailAptId(null);
  }, []);
  // tab 전환 시 모달 닫기 — setTab 호출지 10곳 (useAppNavigation handler 7개 + URL 딥링크 등) 에 분산하면 누락 위험
  useEffect(() => {
    setDetailAptId(null);
  }, [tab]);
  return { detailAptId, handleOpenDetail, handleCloseDetail, setDetailAptId };
}
