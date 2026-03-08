import { useState, useCallback, useEffect } from "react";

const EMPTY_FORM = { email: "", password: "", name: "", affiliation: "", phone: "", specialty: "", license: "", experience: "", bio: "" };

export function useExpertMode(showToast) {
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ ...EMPTY_FORM });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authStatus, setAuthStatus] = useState(null);
  const [expertLoggedIn, setExpertLoggedIn] = useState(() => !!sessionStorage.getItem("expertToken"));
  const [authUser, setAuthUser] = useState(null);
  const [expertExpandedApt, setExpertExpandedApt] = useState(null);

  const handleExpertLogin = useCallback(async () => {
    setAuthLoading(true);
    setAuthError("");
    setAuthStatus(null);
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
        setAuthForm({ ...EMPTY_FORM });
        showToast("전문가 모드로 전환되었습니다");
        return { ok: true, role: data.role || "expert" };
      }
      if (data.statusCode === "PENDING") {
        setAuthStatus("pending");
      } else if (data.statusCode === "REJECTED") {
        setAuthStatus("rejected");
      }
      setAuthError(data.error || "로그인 실패");
      showToast(data.error || "로그인 실패");
      return { ok: false };
    } catch {
      setAuthError("서버 연결 실패");
      showToast("서버 연결에 실패했습니다");
      return { ok: false };
    } finally {
      setAuthLoading(false);
    }
  }, [authForm.email, authForm.password, showToast]);

  const handleExpertSignup = useCallback(async () => {
    setAuthLoading(true);
    setAuthError("");
    setAuthStatus(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authForm),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("가입 신청 완료! 관리자 승인 후 이용 가능합니다");
        setAuthMode("login");
        setAuthForm(f => ({ ...EMPTY_FORM, email: f.email }));
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
    sessionStorage.removeItem("userRole");
    setExpertExpandedApt(null);
    setAuthUser(null);
    setAuthForm({ ...EMPTY_FORM });
    setAuthError("");
    setAuthStatus(null);
    onLogout?.();
    showToast("로그아웃되었습니다");
  }, [showToast]);

  useEffect(() => {
    let cancelled = false;
    const verify = () => {
      const token = sessionStorage.getItem("expertToken");
      if (!token) return;
      fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
        .then(r => {
          if (r.status === 429) return null; // rate limit — skip, don't logout
          return r.json();
        })
        .then(data => {
          if (cancelled || !data) return;
          if (!data.ok) {
            setExpertLoggedIn(false);
            sessionStorage.removeItem("expertToken");
            sessionStorage.removeItem("userRole");
          } else {
            setAuthUser(data.user);
            if (data.role) sessionStorage.setItem("userRole", data.role);
          }
        })
        .catch(() => {
          if (cancelled) return;
          setExpertLoggedIn(false);
          sessionStorage.removeItem("expertToken");
          sessionStorage.removeItem("userRole");
        });
    };
    verify();
    const id = setInterval(verify, 15 * 60 * 1000);
    const onVisibility = () => { if (document.visibilityState === "visible") verify(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  return {
    authMode, setAuthMode,
    authForm, setAuthForm,
    authLoading, authError, authStatus,
    authUser,
    expertLoggedIn, expertExpandedApt, setExpertExpandedApt,
    handleExpertLogin, handleExpertSignup, handleExpertLogout,
  };
}
