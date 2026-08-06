import { useState, useCallback } from "react";
import type { LoginTrigger, UseLoginGateReturn } from "@/types/hooks";

interface UseLoginGateArgs {
  isLoggedIn: boolean;
  detail: { handleOpenDetail: (_id: string) => void };
  kakao: { initKakaoLogin: (_pendingDetailId: string | null, _pendingTab?: string | null) => void };
}

/**
 * 비로그인 게이트 훅
 * App.jsx 로그인 유도 모달(LoginPromptModal) 관련 3 state + 2 핸들러 (세션 405 — 카카오 단독)
 */
export function useLoginGate({ isLoggedIn, detail, kakao }: UseLoginGateArgs): UseLoginGateReturn {
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [loginTrigger, setLoginTrigger] = useState<LoginTrigger>(null);
  const [pendingDetailId, setPendingDetailId] = useState<string | null>(null);

  /**
   * "이 단지 때문에" 로그인 모달을 여는 단일 입구 (세션 495).
   *
   * 카카오 로그인은 전체 페이지 리다이렉트라, 어느 단지를 보다 눌렀는지 여기서 적어두지 않으면
   * 돌아왔을 때 복귀할 곳이 없다(null) — 또는 더 나쁘게, 예전에 눌렀던 단지로 되돌아간다.
   * 게이트 경로(handleDetailGated)와 블라인드 CTA 경로(App onRequestLogin)가 같은 문을 쓴다.
   */
  const requestLoginForDetail = useCallback((aptId: string) => {
    setPendingDetailId(aptId);
    setLoginTrigger("detail");
    setShowLoginPrompt(true);
  }, []);

  const handleDetailGated = useCallback(
    (aptId: string) => {
      if (isLoggedIn) {
        detail.handleOpenDetail(aptId);
        return;
      }
      requestLoginForDetail(aptId);
    },
    [isLoggedIn, detail, requestLoginForDetail]
  );

  /** 로그인 안내 모달을 그냥 닫은 경로 — 적어둔 단지도 같이 지운다(stale 복원 차단). */
  const closeLoginPrompt = useCallback(() => {
    setShowLoginPrompt(false);
    setLoginTrigger(null);
    setPendingDetailId(null);
  }, []);

  const handleKakaoFromPrompt = useCallback(() => {
    setShowLoginPrompt(false);
    // map 트리거면 지도 탭 복귀, 아니면 상세 복원 — 상호배타 강제(세션 469).
    // pendingDetailId 는 detail 요청 시점에만 세팅되고 모달을 닫으면 지워지지만(closeLoginPrompt),
    // map 트리거일 땐 명시적으로 null 을 넘겨 "지도 착지 + 엉뚱한 상세 모달 동반"을 이중으로 차단.
    if (loginTrigger === "map") {
      kakao.initKakaoLogin(null, "map");
    } else {
      kakao.initKakaoLogin(pendingDetailId, null);
    }
  }, [kakao, pendingDetailId, loginTrigger]);

  return {
    showLoginPrompt,
    setShowLoginPrompt,
    loginTrigger,
    setLoginTrigger,
    handleDetailGated,
    handleKakaoFromPrompt,
    requestLoginForDetail,
    closeLoginPrompt,
  };
}
