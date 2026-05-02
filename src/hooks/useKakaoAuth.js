import { useState, useCallback, useRef } from "react";

/**
 * 카카오 OAuth 프론트 훅
 * - initKakaoLogin(): 카카오 인가 URL로 이동
 * - handleKakaoCallback(): 콜백 처리 (state 검증 + POST /api/auth/kakao)
 * - SDK 미사용 (window.location.href 리다이렉트 — useShare의 Kakao.init 충돌 없음)
 */

// OAuth authorize URL의 client_id는 REST API 키를 사용 (JS키 아님)
const KAKAO_REST_KEY = import.meta.env.VITE_KAKAO_REST_API_KEY || "";

function generateState() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
}

export function useKakaoAuth(showToast) {
  const [kakaoLoading, setKakaoLoading] = useState(false);
  const [kakaoError, setKakaoError] = useState("");
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  /** 카카오 인가 URL로 이동 (pendingDetailId: 로그인 후 복귀할 상세 ID) */
  const initKakaoLogin = useCallback((pendingDetailId) => {
    if (!KAKAO_REST_KEY) {
      showToastRef.current("카카오 로그인을 사용할 수 없습니다");
      return;
    }
    if (kakaoLoading) return; // 중복 클릭 방지

    const state = generateState();
    setKakaoLoading(true);
    try {
      sessionStorage.setItem("kakao_oauth_state", state);
      if (pendingDetailId) sessionStorage.setItem("kakao_pending_detail", pendingDetailId);
    } catch { /* sessionStorage 접근 실패 시 무시 */ }

    const params = new URLSearchParams({
      client_id: KAKAO_REST_KEY,
      redirect_uri: `${window.location.origin}/oauth/kakao/callback`,
      response_type: "code",
      state,
    });
    window.location.href = `https://kauth.kakao.com/oauth/authorize?${params}`;
  }, [kakaoLoading]);

  /** 콜백 처리 — App.jsx에서 pathname 감지 후 호출 */
  const handleKakaoCallback = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);

    // 카카오 에러 처리 (사용자가 동의 거부 등)
    const error = params.get("error");
    if (error) {
      const desc = params.get("error_description") || "카카오 로그인이 취소되었습니다";
      setKakaoError(desc);
      showToastRef.current(desc);
      return { ok: false, error: desc };
    }

    const code = params.get("code");
    const urlState = params.get("state");

    if (!code) {
      setKakaoError("인가 코드가 없습니다");
      return { ok: false, error: "인가 코드가 없습니다" };
    }

    // state 검증 (CSRF 방어)
    let savedState = null;
    try {
      savedState = sessionStorage.getItem("kakao_oauth_state");
      sessionStorage.removeItem("kakao_oauth_state"); // 1회용 즉시 삭제
    } catch { /* sessionStorage 접근 실패 시 무시 */ }

    if (!urlState || urlState !== savedState) {
      setKakaoError("보안 검증에 실패했습니다");
      showToastRef.current("보안 검증에 실패했습니다. 다시 시도해주세요.");
      return { ok: false, error: "state 불일치" };
    }

    setKakaoLoading(true);
    setKakaoError("");

    try {
      const res = await fetch("/api/auth/kakao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, redirect_uri: `${window.location.origin}/oauth/kakao/callback` }),
      });

      if (res.status === 429) {
        const msg = "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
        setKakaoError(msg);
        showToastRef.current(msg);
        return { ok: false, error: msg };
      }

      const data = await res.json();

      if (data.ok) {
        // pendingDetail 복원
        let pendingDetail = null;
        try { pendingDetail = sessionStorage.getItem("kakao_pending_detail"); sessionStorage.removeItem("kakao_pending_detail"); } catch {}
        return { ok: true, token: data.token, refreshToken: data.refreshToken, user: data.user, role: data.role || "user", pendingDetail };
      }

      setKakaoError(data.error || "카카오 로그인 실패");
      showToastRef.current(data.error || "카카오 로그인 실패");
      return { ok: false, error: data.error, statusCode: data.statusCode };
    } catch {
      const msg = "서버 연결에 실패했습니다";
      setKakaoError(msg);
      showToastRef.current(msg);
      return { ok: false, error: msg };
    } finally {
      setKakaoLoading(false);
    }
  }, []);

  return { kakaoLoading, kakaoError, initKakaoLogin, handleKakaoCallback };
}
