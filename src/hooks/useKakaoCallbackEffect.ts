import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { trackEvent } from "@/lib/analytics";
import { isFeatureHome } from "@/constants/featureFlags";
import type { UseKakaoAuthReturn } from "@/types/hooks";
import type { AdminMode } from "@/types/admin";
import type { ExpertUser } from "./useExpertMode";

interface UseKakaoCallbackEffectArgs {
  tab: string;
  kakao: Pick<UseKakaoAuthReturn, "handleKakaoCallback">;
  expert: {
    setExpertLoggedIn: Dispatch<SetStateAction<boolean>>;
    setAuthUser: Dispatch<SetStateAction<ExpertUser | null>>;
  };
  admin: Pick<AdminMode, "setAdminLoggedIn">;
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
        expert.setAuthUser((result.user ?? null) as ExpertUser | null);
        if (role === "admin") { admin.setAdminLoggedIn(true); setTab("admin"); }
        else {
          // role "expert" 잔존 레코드도 일반 손님 취급 (세션 405 전문가 폐지)
          if (result.pendingDetail) { detail.setDetailAptId(result.pendingDetail); }
          setTab(isFeatureHome() ? "home" : "list"); // 로그인 직후 홈 = 지도 위젯 열린 첫 경험 (spec §1)
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
