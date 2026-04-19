import { useState, useCallback } from "react";

/**
 * 비로그인 게이트 훅
 * App.jsx 로그인 유도 모달(LoginPromptModal) 관련 3 state + 3 핸들러
 */
export function useLoginGate({ isLoggedIn, detail, kakao, setTab }) {
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [loginTrigger, setLoginTrigger] = useState(null);
  const [pendingDetailId, setPendingDetailId] = useState(null);

  const handleDetailGated = useCallback((aptId) => {
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
    setTab("expertLogin");
  }, [setTab]);

  return {
    showLoginPrompt, setShowLoginPrompt,
    loginTrigger, setLoginTrigger,
    handleDetailGated, handleKakaoFromPrompt, handleExpertFromPrompt,
  };
}
