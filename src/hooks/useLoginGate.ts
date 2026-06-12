import { useState, useCallback } from "react";
import type { LoginTrigger, UseLoginGateReturn } from "@/types/hooks";

interface UseLoginGateArgs {
  isLoggedIn: boolean;
  detail: { handleOpenDetail: (_id: string) => void };
  kakao: { initKakaoLogin: (_pendingDetailId: string | null) => void };
}

/**
 * 비로그인 게이트 훅
 * App.jsx 로그인 유도 모달(LoginPromptModal) 관련 3 state + 2 핸들러 (세션 405 — 카카오 단독)
 */
export function useLoginGate({ isLoggedIn, detail, kakao }: UseLoginGateArgs): UseLoginGateReturn {
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [loginTrigger, setLoginTrigger] = useState<LoginTrigger>(null);
  const [pendingDetailId, setPendingDetailId] = useState<string | null>(null);

  const handleDetailGated = useCallback((aptId: string) => {
    if (isLoggedIn) { detail.handleOpenDetail(aptId); return; }
    setPendingDetailId(aptId);
    setLoginTrigger("detail");
    setShowLoginPrompt(true);
  }, [isLoggedIn, detail]);

  const handleKakaoFromPrompt = useCallback(() => {
    setShowLoginPrompt(false);
    kakao.initKakaoLogin(pendingDetailId);
  }, [kakao, pendingDetailId]);

  return {
    showLoginPrompt, setShowLoginPrompt,
    loginTrigger, setLoginTrigger,
    handleDetailGated, handleKakaoFromPrompt,
  };
}
