import { useState, useCallback, useEffect, useRef } from "react";
import { TOKEN_KEY, getAuthToken, clearAuthTokens } from "@/lib/authToken";

// 공용 인증 훅 (세션 405 전문가 role 폐지 후, 세션 426 명칭 정리 — 구 useExpertMode).
// 카카오 손님·관리자가 같은 토큰 축(authToken)을 사용한다.
// 구 키 "expertToken" 은 getAuthToken() 이 첫 진입 시 authToken 으로 1회 자동 이관(로그아웃 0).
// 가입(signup)·승인(authStatus) 흐름은 전문가 폐지와 함께 제거 — 비밀번호 로그인은 관리자 전용.

export interface AuthForm {
  email: string;
  password: string;
}

type ShowToast = (_msg: string) => void;

export interface AuthUser {
  email?: string;
  name?: string;
  role?: string;
  [key: string]: unknown;
}

const EMPTY_FORM: AuthForm = { email: "", password: "" };

export function useAuth(showToast: ShowToast) {
  const [authForm, setAuthForm] = useState<AuthForm>({ ...EMPTY_FORM });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [loggedIn, setLoggedIn] = useState(() => !!getAuthToken());
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  const authFormRef = useRef(authForm);
  const showToastRef = useRef(showToast);
  useEffect(() => {
    authFormRef.current = authForm;
    showToastRef.current = showToast;
  }, [authForm, showToast]);

  const handleLogin = useCallback(async () => {
    const form = authFormRef.current;
    setAuthLoading(true);
    setAuthError("");
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
        localStorage.setItem(TOKEN_KEY, data.token);
        if (data.refreshToken) localStorage.setItem("refreshToken", data.refreshToken);
        setLoggedIn(true);
        setAuthUser(data.user);
        setAuthForm({ ...EMPTY_FORM });
        showToast("로그인되었습니다");
        return { ok: true, role: data.role || "user" };
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

  const handleLogout = useCallback(
    async (onLogout?: () => void) => {
      const token = localStorage.getItem(TOKEN_KEY);
      const refreshToken = localStorage.getItem("refreshToken");
      if (token) {
        try {
          await fetch("/api/auth/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, refreshToken }),
          });
        } catch {
          /* best-effort — 로컬 삭제는 항상 실행 */
        }
      }
      setLoggedIn(false);
      clearAuthTokens();
      localStorage.removeItem("refreshToken");
      setAuthUser(null);
      setAuthForm({ ...EMPTY_FORM });
      setAuthError("");
      onLogout?.();
      showToast("로그아웃되었습니다");
    },
    [showToast]
  );

  useEffect(() => {
    let cancelled = false;
    let abortCtrl: AbortController | null = null;
    const verify = () => {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) return;
      abortCtrl = new AbortController();
      fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        signal: abortCtrl.signal,
      })
        .then((r) => {
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
                  localStorage.setItem(TOKEN_KEY, rd.token);
                  localStorage.setItem("refreshToken", rd.refreshToken);
                  if (rd.role) localStorage.setItem("userRole", rd.role);
                  setAuthUser(rd.user);
                  return; // 갱신 성공 — 로그아웃 안 함
                }
              } catch {
                /* refresh 실패 → 아래 로그아웃 */
              }
            }
            setLoggedIn(false);
            localStorage.removeItem(TOKEN_KEY);
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
    const onVisibility = () => {
      if (document.visibilityState === "visible") verify();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      abortCtrl?.abort();
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [showToast]);

  return {
    authForm,
    setAuthForm,
    authLoading,
    authError,
    authUser,
    setAuthUser,
    loggedIn,
    setLoggedIn,
    handleLogin,
    handleLogout,
  };
}
