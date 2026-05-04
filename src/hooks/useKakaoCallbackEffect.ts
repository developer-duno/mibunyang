import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

interface KakaoCallbackResult {
  ok: boolean;
  token?: string;
  refreshToken?: string;
  role?: string;
  user?: { affiliation?: string };
  pendingDetail?: string;
}

interface UseKakaoCallbackEffectArgs {
  tab: string;
  kakao: { handleKakaoCallback: () => Promise<KakaoCallbackResult | null | undefined> };
  expert: {
    setExpertLoggedIn: (_v: boolean) => void;
    setAuthUser: (_u: unknown) => void;
  };
  admin: { setAdminLoggedIn: (_v: boolean) => void };
  detail: { setDetailAptId: (_id: string | null) => void };
  setTab: (_tab: string) => void;
  showToast: (_msg: string) => void;
}

/**
 * 카카오 OAuth 콜백 useEffect 훅
 * tab === "kakaoCallback" 진입 시 1회 실행
 * 의도적으로 [tab]만 deps: kakao/expert/admin/detail 참조 변경 시 재실행 방지
 * (모두 useCallback/useState 안정 참조지만, 의미론적으로 탭 전환 시점만 트리거)
 */
export function useKakaoCallbackEffect({ tab, kakao, expert, admin, detail, setTab, showToast }: UseKakaoCallbackEffectArgs): void {
  useEffect(() => {
    if (tab !== "kakaoCallback") return;
    kakao.handleKakaoCallback().then(result => {
      if (result?.ok) {
        if (result.token) localStorage.setItem("expertToken", result.token);
        if (result.refreshToken) localStorage.setItem("refreshToken", result.refreshToken);
        const role = result.role || "user";
        localStorage.setItem("userRole", role);
        expert.setExpertLoggedIn(true);
        expert.setAuthUser(result.user);
        if (role === "admin") { admin.setAdminLoggedIn(true); setTab("admin"); }
        else if (role === "expert") { setTab("expert"); }
        else {
          if (result.pendingDetail) { detail.setDetailAptId(result.pendingDetail); }
          setTab("list");
        }
        showToast("로그인 성공");
        trackEvent("kakao_login", { role, isNew: !result.user?.affiliation });
      } else {
        setTab("list");
      }
      try { window.history.replaceState(null, "", "/"); } catch { /* noop: history.replaceState 미지원 환경 무시 */ }
    });
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
}
