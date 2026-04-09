import { memo, useEffect } from "react";
import { C } from "@/theme";
import { trackEvent } from "@/lib/analytics";

/**
 * 로그인 유도 모달 — 비로그인 사용자가 상세/비교/지도/관심매물 접근 시 표시
 * Props: open, onClose, onKakaoLogin, onExpertLogin, kakaoLoading
 */
export const LoginPromptModal = memo(function LoginPromptModal({ open, onClose, onKakaoLogin, onExpertLogin, kakaoLoading, trigger }) {
  useEffect(() => {
    if (open) trackEvent("login_prompt_shown", { trigger: trigger || "unknown" });
  }, [open, trigger]);

  if (!open) return null;

  return (
    <div
      role="dialog" aria-modal="true" aria-label="로그인 안내"
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, left: 0,
        background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9999, padding: 16,
      }}
      onClick={() => { trackEvent("login_prompt_dismissed", { trigger }); onClose(); }}
    >
      <div
        style={{
          background: C.card, borderRadius: 16, padding: "32px 24px",
          maxWidth: 360, width: "100%", textAlign: "center",
          border: `1px solid ${C.border}`,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* 안내 아이콘 */}
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>

        <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 8 }}>
          로그인이 필요합니다
        </div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 24 }}>
          점수 분석과 상세 정보를<br />
          이용하려면 로그인해주세요.
        </div>

        {/* 카카오 로그인 버튼 */}
        <button
          type="button"
          onClick={() => { trackEvent("login_prompt_kakao_click", { trigger }); onKakaoLogin(); }}
          disabled={kakaoLoading}
          style={{
            width: "100%", minHeight: 44, padding: "12px 16px",
            background: kakaoLoading ? "#E5D85C" : "#FEE500",
            color: "#191919", fontSize: 15, fontWeight: 700,
            border: "none", borderRadius: 8, cursor: kakaoLoading ? "default" : "pointer",
            marginBottom: 12, transition: "background .15s",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          {/* 카카오 로고 SVG */}
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path fillRule="evenodd" clipRule="evenodd" d="M9 1C4.58 1 1 3.79 1 7.21c0 2.17 1.44 4.08 3.62 5.18l-.93 3.4c-.08.3.26.54.52.36l4.07-2.68c.24.02.47.03.72.03 4.42 0 8-2.79 8-6.22S13.42 1 9 1z" fill="#191919"/>
          </svg>
          {kakaoLoading ? "처리 중..." : "카카오로 시작하기"}
        </button>

        {/* 전문가 로그인 링크 */}
        <button
          type="button"
          onClick={() => { trackEvent("login_prompt_expert_click", { trigger }); onExpertLogin(); }}
          style={{
            background: "transparent", border: "none",
            color: C.muted, fontSize: 12, cursor: "pointer",
            padding: "8px 0", width: "100%",
          }}
        >
          전문가 계정으로 로그인
        </button>

        {/* 닫기 */}
        <button
          type="button"
          onClick={() => { trackEvent("login_prompt_dismissed", { trigger }); onClose(); }}
          style={{
            background: "transparent", border: "none",
            color: C.muted, fontSize: 11, cursor: "pointer",
            padding: "4px 0", marginTop: 4,
          }}
        >
          나중에 하기
        </button>
      </div>
    </div>
  );
});
