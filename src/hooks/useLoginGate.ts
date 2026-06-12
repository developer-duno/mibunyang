import { useState, useCallback } from "react";
import type { LoginTrigger, UseLoginGateReturn } from "@/types/hooks";

interface UseLoginGateArgs {
  isLoggedIn: boolean;
  detail: { handleOpenDetail: (_id: string) => void };
  kakao: { initKakaoLogin: (_pendingDetailId: string | null) => void };
  setTab: (_tab: string) => void;
}

/**
 * 비로그인 게이트 훅
 * App.jsx 로그인 유도 모달(LoginPromptModal) 관련 3 state + 3 핸들러
 */
export function useLoginGate({ isLoggedIn, detail, kakao, setTab }: UseLoginGateArgs): UseLoginGateReturn {
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

  const handleExpertFromPrompt = useCallback(() => {
    setShowLoginPrompt(false);
    setTab("adminLogin");
  }, [setTab]);

  return {
    showLoginPrompt, setShowLoginPrompt,
    loginTrigger, setLoginTrigger,
    handleDetailGated, handleKakaoFromPrompt, handleExpertFromPrompt,
  };
}
