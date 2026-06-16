import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { trackEvent } from "@/lib/analytics";
import { TOKEN_KEY } from "@/lib/authToken";
import { isFeatureHome } from "@/constants/featureFlags";
import type { UseKakaoAuthReturn } from "@/types/hooks";
import type { AdminMode } from "@/types/admin";
import type { AuthUser } from "./useAuth";

interface UseKakaoCallbackEffectArgs {
  tab: string;
  kakao: Pick<UseKakaoAuthReturn, "handleKakaoCallback">;
  auth: {
    setLoggedIn: Dispatch<SetStateAction<boolean>>;
    setAuthUser: Dispatch<SetStateAction<AuthUser | null>>;
  };
  admin: Pick<AdminMode, "setAdminLoggedIn">;
  detail: { setDetailAptId: (_id: string | null) => void };
  setTab: (_tab: string) => void;
  showToast: (_msg: string) => void;
  onNeedsMarketingConsent?: () => void; // 신규 카카오 가입 시 마케팅 동의 모달 열기
}

/**
 * 카카오 OAuth 콜백 useEffect 훅
 * tab === "kakaoCallback" 진입 시 1회 실행
 * 의도적으로 [tab]만 deps: kakao/auth/admin/detail 참조 변경 시 재실행 방지
 * (모두 useCallback/useState 안정 참조지만, 의미론적으로 탭 전환 시점만 트리거)
 */
export function useKakaoCallbackEffect({ tab, kakao, auth, admin, detail, setTab, showToast, onNeedsMarketingConsent }: UseKakaoCallbackEffectArgs): void {
  useEffect(() => {
    if (tab !== "kakaoCallback") return;
    kakao.handleKakaoCallback().then(result => {
      if (result?.ok) {
        if (result.token) localStorage.setItem(TOKEN_KEY, result.token);
        if (result.refreshToken) localStorage.setItem("refreshToken", result.refreshToken);
        const role = result.role || "user";
        localStorage.setItem("userRole", role);
        auth.setLoggedIn(true);
        auth.setAuthUser((result.user ?? null) as AuthUser | null);
        if (role === "admin") { admin.setAdminLoggedIn(true); setTab("admin"); }
        else {
          // role "expert" 잔존 레코드도 일반 손님 취급 (세션 405 전문가 폐지)
          if (result.pendingDetail) { detail.setDetailAptId(result.pendingDetail); }
          setTab(isFeatureHome() ? "home" : "list"); // 로그인 직후 홈 = 지도 위젯 열린 첫 경험 (spec §1)
          // 신규 가입(또는 동의 미선택) 손님이면 마케팅 동의 모달 — 관리자는 제외
          if (result.needsMarketingConsent) onNeedsMarketingConsent?.();
        }
        showToast("로그인 성공");
        trackEvent("kakao_login", { role, isNew: !result.user?.affiliation });
      } else {
        setTab(isFeatureHome() ? "home" : "list");
      }
      try { window.history.replaceState(null, "", "/"); } catch { /* noop: history.replaceState 미지원 환경 무시 */ }
    });
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
}
