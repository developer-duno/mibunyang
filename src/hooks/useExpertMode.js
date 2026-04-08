import { useState, useCallback, useEffect, useRef } from "react";

const EMPTY_FORM = { email: "", password: "", name: "", affiliation: "", phone: "", specialty: "", license: "", experience: "", bio: "" };

export function useExpertMode(showToast) {
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ ...EMPTY_FORM });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authStatus, setAuthStatus] = useState(null);
  const [expertLoggedIn, setExpertLoggedIn] = useState(() => { try { return !!sessionStorage.getItem("expertToken"); } catch { return false; } });
  const [authUser, setAuthUser] = useState(null);
  const [expertExpandedApt, setExpertExpandedApt] = useState(null);

  const authFormRef = useRef(authForm);
  const showToastRef = useRef(showToast);
  authFormRef.current = authForm;
  showToastRef.current = showToast;

  const handleExpertLogin = useCallback(async () => {
    const form = authFormRef.current;
    setAuthLoading(true);
    setAuthError("");
    setAuthStatus(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, password: form.password }),
      });
      if (res.status === 429) {
        setAuthError("요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
        showToast("요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
        return { ok: false };
      }
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
  }, []); // showToastRef 사용으로 showToast 의존성 제거 (P-4)

  const handleExpertSignup = useCallback(async () => {
    const form = authFormRef.current;
    setAuthLoading(true);
    setAuthError("");
    setAuthStatus(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.status === 429) {
        setAuthError("요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
        showToast("요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
        return false;
      }
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
  }, [showToast]);

  const handleExpertLogout = useCallback(async (onLogout) => {
    const token = sessionStorage.getItem("expertToken");
    if (token) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
      } catch { /* best-effort — 세션 삭제는 항상 실행 */ }
    }
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
    let abortCtrl = null;
    const verify = () => {
      const token = sessionStorage.getItem("expertToken");
      if (!token) return;
      abortCtrl = new AbortController();
      fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        signal: abortCtrl.signal,
      })
        .then(r => {
          if (r.status === 429 || r.status >= 500) return null;
          return r.json();
        })
        .then(data => {
          if (cancelled || !data) return;
          if (!data.ok) {
            setExpertLoggedIn(false);
            sessionStorage.removeItem("expertToken");
            sessionStorage.removeItem("userRole");
            showToastRef.current("세션이 만료되었습니다. 다시 로그인해주세요.");
          } else {
            setAuthUser(data.user);
            if (data.role) sessionStorage.setItem("userRole", data.role);
          }
        })
        .catch(err => {
          if (err.name === "AbortError") return;
          // 네트워크 일시 장애 시 로그아웃하지 않음 (다음 verify 주기에 재시도)
        });
    };
    verify();
    const id = setInterval(verify, 15 * 60 * 1000);
    const onVisibility = () => { if (document.visibilityState === "visible") verify(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { cancelled = true; abortCtrl?.abort(); clearInterval(id); document.removeEventListener("visibilitychange", onVisibility); };
  }, [showToast]);

  return {
    authMode, setAuthMode,
    authForm, setAuthForm,
    authLoading, authError, authStatus,
    authUser, setAuthUser,
    expertLoggedIn, setExpertLoggedIn, expertExpandedApt, setExpertExpandedApt,
    handleExpertLogin, handleExpertSignup, handleExpertLogout,
  };
}
