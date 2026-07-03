import { useState, useCallback } from "react";
import type { LoginTrigger, UseLoginGateReturn } from "@/types/hooks";

interface UseLoginGateArgs {
  isLoggedIn: boolean;
  detail: { handleOpenDetail: (_id: string) => void };
  kakao: { initKakaoLogin: (_pendingDetailId: string | null, _pendingTab?: string | null) => void };
}

/**
 * 비로그인 게이트 훅
 * App.jsx 로그인 유도 모달(LoginPromptModal) 관련 3 state + 2 핸들러 (세션 405 — 카카오 단독)
 */
export function useLoginGate({ isLoggedIn, detail, kakao }: UseLoginGateArgs): UseLoginGateReturn {
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [loginTrigger, setLoginTrigger] = useState<LoginTrigger>(null);
  const [pendingDetailId, setPendingDetailId] = useState<string | null>(null);

  const handleDetailGated = useCallback(
    (aptId: string) => {
      if (isLoggedIn) {
        detail.handleOpenDetail(aptId);
        return;
      }
      setPendingDetailId(aptId);
      setLoginTrigger("detail");
      setShowLoginPrompt(true);
    },
    [isLoggedIn, detail]
  );

  const handleKakaoFromPrompt = useCallback(() => {
    setShowLoginPrompt(false);
    // map 트리거면 지도 탭 복귀, 아니면 상세 복원 — 상호배타 강제(세션 469).
    // pendingDetailId 는 detail 게이트에서만 세팅되고 리셋 경로가 없어 stale 로 남을 수 있으므로,
    // map 트리거일 땐 명시적으로 null 을 넘겨 "지도 착지 + 엉뚱한 상세 모달 동반"을 차단.
    if (loginTrigger === "map") {
      kakao.initKakaoLogin(null, "map");
    } else {
      kakao.initKakaoLogin(pendingDetailId, null);
    }
  }, [kakao, pendingDetailId, loginTrigger]);

  return {
    showLoginPrompt,
    setShowLoginPrompt,
    loginTrigger,
    setLoginTrigger,
    handleDetailGated,
    handleKakaoFromPrompt,
  };
}
