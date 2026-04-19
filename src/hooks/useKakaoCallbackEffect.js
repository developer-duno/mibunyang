import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

/**
 * 카카오 OAuth 콜백 useEffect 훅
 * tab === "kakaoCallback" 진입 시 1회 실행
 * 의도적으로 [tab]만 deps: kakao/expert/admin/detail 참조 변경 시 재실행 방지
 * (모두 useCallback/useState 안정 참조지만, 의미론적으로 탭 전환 시점만 트리거)
 */
export function useKakaoCallbackEffect({ tab, kakao, expert, admin, detail, setTab, showToast }) {
  useEffect(() => {
    if (tab !== "kakaoCallback") return;
    kakao.handleKakaoCallback().then(result => {
      if (result?.ok) {
        localStorage.setItem("expertToken", result.token);
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
        trackEvent("kakao_login", { role, isNew: !result.user.affiliation });
      } else {
        setTab("list");
      }
      try { window.history.replaceState(null, "", "/"); } catch {}
    });
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
}
