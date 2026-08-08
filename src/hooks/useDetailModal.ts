import { useState, useCallback, useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

export function useDetailModal(tab: string, recordView?: (_id: string) => void) {
  const [detailAptId, setDetailAptId] = useState<string | null>(null);
  // 상세 진입 단일 지점. 세션 503(2-B) 전에는 로그인 게이트를 통과한 호출만 도달해서 "로그인 시에만
  // 기록"이 저절로 지켜졌지만, 이제 비로그인도 여기로 들어온다 — recordView(최근 본 단지)는 브라우저
  // 로컬 저장이라 비로그인도 남기는 게 맞다(로그인해야 볼 수 있는 값이 아니다).
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
