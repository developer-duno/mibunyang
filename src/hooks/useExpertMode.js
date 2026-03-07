import { useState, useCallback, useEffect } from "react";

export function useExpertMode(showToast) {
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ email: "", password: "", name: "", affiliation: "" });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [expertLoggedIn, setExpertLoggedIn] = useState(() => !!sessionStorage.getItem("expertToken"));
  const [authUser, setAuthUser] = useState(null);
  const [expertExpandedApt, setExpertExpandedApt] = useState(null);

  const handleExpertLogin = useCallback(async () => {
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authForm.email, password: authForm.password }),
      });
      const data = await res.json();
      if (data.ok) {
        sessionStorage.setItem("expertToken", data.token);
        setExpertLoggedIn(true);
        setAuthUser(data.user);
        setAuthForm({ email: "", password: "", name: "", affiliation: "" });
        showToast("전문가 모드로 전환되었습니다");
        return true;
      }
      setAuthError(data.error || "로그인 실패");
      showToast(data.error || "로그인 실패");
      return false;
    } catch {
      setAuthError("서버 연결 실패");
      showToast("서버 연결에 실패했습니다");
      return false;
    } finally {
      setAuthLoading(false);
    }
  }, [authForm.email, authForm.password, showToast]);

  const handleExpertSignup = useCallback(async () => {
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authForm),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("가입 완료! 로그인해주세요");
        setAuthMode("login");
        setAuthForm(f => ({ ...f, name: "", affiliation: "" }));
        return true;
      }
      setAuthError(data.error || "가입 실패");
      showToast(data.error || "가입 실패");
      return false;
    } catch {
      setAuthError("서버 연결 실패");
      showToast("서버 연결에 실패했습니다");
      return false;
    } finally {
      setAuthLoading(false);
    }
  }, [authForm, showToast]);

  const handleExpertLogout = useCallback((onLogout) => {
    setExpertLoggedIn(false);
    sessionStorage.removeItem("expertToken");
    setExpertExpandedApt(null);
    setAuthUser(null);
    setAuthForm({ email: "", password: "", name: "", affiliation: "" });
    setAuthError("");
    onLogout?.();
    showToast("로그아웃되었습니다");
  }, [showToast]);

  useEffect(() => {
    const token = sessionStorage.getItem("expertToken");
    if (!token) return;
    fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.ok) {
          setExpertLoggedIn(false);
          sessionStorage.removeItem("expertToken");
        } else {
          setAuthUser(data.user);
        }
      })
      .catch(() => {});
  }, []);

  return {
    authMode, setAuthMode,
    authForm, setAuthForm,
    authLoading, authError,
    authUser,
    expertLoggedIn, expertExpandedApt, setExpertExpandedApt,
    handleExpertLogin, handleExpertSignup, handleExpertLogout,
  };
}
