import { memo } from "react";
import { C, F } from "@/theme";
import { SignupExtraFields } from "./SignupExtraFields";

/**
 * 전문가 로그인/회원가입 폼
 * Props: expert (useExpertMode 전체 반환값), onLogin (handleExpertLogin 콜백), onBack (돌아가기)
 */
export const ExpertLoginForm = memo(function ExpertLoginForm({ expert, onLogin, onBack, onKakaoLogin, kakaoLoading }) {
  return (
        <div style={{ padding: "0 16px", maxWidth: 640, margin: "0 auto" }}>
          <div style={{ background: C.card, borderRadius: 12, padding: "40px 20px", border: `1px solid ${C.border}`, textAlign: "center" }}>
            <div role="tablist" style={{ display: "flex", borderBottom: `2px solid ${C.border}`, marginBottom: 16 }}>
              {[{ key: "login", label: "로그인" }, { key: "signup", label: "회원가입" }].map(tab => {
                const active = expert.authMode === tab.key;
                return (
                  <button key={tab.key} role="tab" aria-selected={active} type="button"
                    onClick={() => { expert.setAuthMode(tab.key); expert.setAuthForm({ email: "", password: "", name: "", affiliation: "", phone: "", specialty: "", license: "", experience: "", bio: "" }); }}
                    style={{
                      flex: 1, padding: "12px 0", fontSize: F.base, fontWeight: active ? 800 : 600,
                      color: active ? C.indigo : C.muted, background: "transparent", border: "none",
                      borderBottom: active ? `2px solid ${C.indigo}` : "2px solid transparent",
                      marginBottom: -2, minHeight: 44, cursor: "pointer", transition: "color .15s, border-color .15s"
                    }}>
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: F.sm, color: C.muted, marginBottom: 20 }}>
              {expert.authMode === "login" ? "파트너 전문가 전용 대시보드입니다" : "전문가 계정을 생성합니다"}
            </div>

            {expert.authStatus === "pending" && (
              <div style={{ fontSize: F.sm, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, padding: "10px 12px", marginBottom: 16, textAlign: "left", lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>승인 대기중</div>
                관리자 승인 후 이용 가능합니다. 잠시만 기다려주세요.
              </div>
            )}
            {expert.authStatus === "rejected" && (
              <div style={{ fontSize: F.sm, color: C.red, background: C.redLight, border: "1px solid #FECACA", borderRadius: 6, padding: "10px 12px", marginBottom: 16, textAlign: "left", lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>승인 거부</div>
                가입 신청이 거부되었습니다. 관리자에게 문의해주세요.
              </div>
            )}
            {expert.authError && !expert.authStatus && (
              <div style={{ fontSize: F.sm, color: C.red, background: C.redLight, borderRadius: 6, padding: "8px 12px", marginBottom: 16 }}>
                {expert.authError}
              </div>
            )}

            <form onSubmit={e => {
              e.preventDefault();
              if (expert.authMode === "login") onLogin();
              else expert.handleExpertSignup();
            }}>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="expert-email" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>이메일</label>
                <input id="expert-email" type="email" autoComplete="email" value={expert.authForm.email}
                  onChange={e => expert.setAuthForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="이메일 입력" style={{
                    width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
                    background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                  }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="expert-pw" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>비밀번호{expert.authMode === "signup" ? " (8자 이상)" : ""}</label>
                <input id="expert-pw" type="password" autoComplete={expert.authMode === "login" ? "current-password" : "new-password"}
                  value={expert.authForm.password}
                  onChange={e => expert.setAuthForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="비밀번호 입력" style={{
                    width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
                    background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                  }} />
              </div>

              {expert.authMode === "signup" && (
                <SignupExtraFields authForm={expert.authForm} setAuthForm={expert.setAuthForm} />
              )}

              <button type="submit" disabled={expert.authLoading} style={{
                width: "100%", padding: "12px", fontSize: F.base, fontWeight: 800, color: C.white,
                background: expert.authLoading ? C.muted : C.indigo,
                border: "none", borderRadius: 6, cursor: expert.authLoading ? "default" : "pointer",
                minHeight: 44, marginBottom: 12, transition: "background .15s"
              }}>{expert.authLoading ? "처리 중..." : expert.authMode === "login" ? "로그인" : "회원가입"}</button>
            </form>

            {/* 카카오 로그인 — 로그인 탭에서만 표시 */}
            {expert.authMode === "login" && onKakaoLogin && (
              <>
                <div style={{ display: "flex", alignItems: "center", margin: "4px 0 12px" }}>
                  <div style={{ flex: 1, height: 1, background: C.border }} />
                  <span style={{ padding: "0 10px", fontSize: F.xs, color: C.muted }}>또는</span>
                  <div style={{ flex: 1, height: 1, background: C.border }} />
                </div>
                <button type="button" onClick={onKakaoLogin} disabled={kakaoLoading}
                  style={{
                    width: "100%", minHeight: 44, padding: "12px", fontSize: F.base, fontWeight: 700,
                    background: kakaoLoading ? "#E5D85C" : "#FEE500", color: "#191919",
                    border: "none", borderRadius: 6, cursor: kakaoLoading ? "default" : "pointer",
                    marginBottom: 12, transition: "background .15s",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path fillRule="evenodd" clipRule="evenodd" d="M9 1C4.58 1 1 3.79 1 7.21c0 2.17 1.44 4.08 3.62 5.18l-.93 3.4c-.08.3.26.54.52.36l4.07-2.68c.24.02.47.03.72.03 4.42 0 8-2.79 8-6.22S13.42 1 9 1z" fill="#191919"/>
                  </svg>
                  {kakaoLoading ? "처리 중..." : "카카오로 시작하기"}
                </button>
              </>
            )}

            <div>
              <button onClick={onBack} style={{
                background: "transparent", border: "none", color: C.muted, fontSize: F.sm, cursor: "pointer"
              }}>돌아가기</button>
            </div>
          </div>
        </div>
  );
});
