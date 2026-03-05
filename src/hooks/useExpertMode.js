import { useState, useCallback } from "react";

export function useExpertMode(showToast) {
  const [expertPw, setExpertPw] = useState("");
  const [expertLoggedIn, setExpertLoggedIn] = useState(false);
  const [expertExpandedApt, setExpertExpandedApt] = useState(null);
  const handleExpertLogin = useCallback(() => {
    if (expertPw === "expert2024") {
      setExpertLoggedIn(true);
      setExpertPw("");
      showToast("전문가 모드로 전환되었습니다");
      return true;
    }
    showToast("비밀번호가 일치하지 않습니다");
    return false;
  }, [expertPw, showToast]);
  const handleExpertLogout = useCallback((onLogout) => {
    setExpertLoggedIn(false);
    setExpertExpandedApt(null);
    setExpertPw("");
    onLogout?.();
    showToast("로그아웃되었습니다");
  }, [showToast]);
  return { expertPw, setExpertPw, expertLoggedIn, expertExpandedApt, setExpertExpandedApt, handleExpertLogin, handleExpertLogout };
}
