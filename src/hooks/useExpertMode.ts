import { useState, useCallback, useEffect, useRef } from "react";

export interface ExpertAuthForm {
  email: string;
  password: string;
  name: string;
  affiliation: string;
  phone: string;
  specialty: string;
  license: string;
  experience: string;
  bio: string;
}

export type AuthMode = "login" | "signup";
export type AuthStatus = "pending" | "rejected" | null;
type ShowToast = (_msg: string) => void;

export interface ExpertUser {
  email?: string;
  name?: string;
  role?: string;
  [key: string]: unknown;
}

const EMPTY_FORM: ExpertAuthForm = { email: "", password: "", name: "", affiliation: "", phone: "", specialty: "", license: "", experience: "", bio: "" };

export function useExpertMode(showToast: ShowToast) {
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authForm, setAuthForm] = useState<ExpertAuthForm>({ ...EMPTY_FORM });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authStatus, setAuthStatus] = useState<AuthStatus>(null);
  const [expertLoggedIn, setExpertLoggedIn] = useState(() => { try { return !!localStorage.getItem("expertToken"); } catch { return false; } });
  const [authUser, setAuthUser] = useState<ExpertUser | null>(null);
  const [expertExpandedApt, setExpertExpandedApt] = useState<string | null>(null);

  const authFormRef = useRef(authForm);
  const showToastRef = useRef(showToast);
  useEffect(() => {
    authFormRef.current = authForm;
    showToastRef.current = showToast;
  }, [authForm, showToast]);

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
        localStorage.setItem("expertToken", data.token);
        if (data.refreshToken) localStorage.setItem("refreshToken", data.refreshToken);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showToast는 useToast의 useCallback([])로 평생 불변이라 deps 누락 안전 (P-4)
  }, []);

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

  const handleExpertLogout = useCallback(async (onLogout?: () => void) => {
    const token = localStorage.getItem("expertToken");
    const refreshToken = localStorage.getItem("refreshToken");
    if (token) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, refreshToken }),
        });
      } catch { /* best-effort — 로컬 삭제는 항상 실행 */ }
    }
    setExpertLoggedIn(false);
    localStorage.removeItem("expertToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("userRole");
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
    let abortCtrl: AbortController | null = null;
    const verify = () => {
      const token = localStorage.getItem("expertToken");
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
        .then(async (data) => {
          if (cancelled || !data) return;
          if (!data.ok) {
            // access token 만료 → refresh token으로 자동 갱신 시도
            const rt = localStorage.getItem("refreshToken");
            if (rt) {
              try {
                const rr = await fetch("/api/auth/verify", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "refresh", refreshToken: rt }),
                });
                const rd = await rr.json();
                if (rd.ok) {
                  localStorage.setItem("expertToken", rd.token);
                  localStorage.setItem("refreshToken", rd.refreshToken);
                  if (rd.role) localStorage.setItem("userRole", rd.role);
                  setAuthUser(rd.user);
                  return; // 갱신 성공 — 로그아웃 안 함
                }
              } catch { /* refresh 실패 → 아래 로그아웃 */ }
            }
            setExpertLoggedIn(false);
            localStorage.removeItem("expertToken");
            localStorage.removeItem("refreshToken");
            localStorage.removeItem("userRole");
            showToastRef.current("세션이 만료되었습니다. 다시 로그인해주세요.");
          } else {
            setAuthUser(data.user);
            if (data.role) localStorage.setItem("userRole", data.role);
          }
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
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
