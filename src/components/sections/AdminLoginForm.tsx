import { memo, type Dispatch, type SetStateAction } from "react";
import { C, F } from "@/theme";
import type { AuthForm } from "@/hooks/useExpertMode";

// useExpertMode() 반환값 중 본 컴포넌트가 사용하는 필드만 선언.
type AuthState = {
  authForm: AuthForm;
  setAuthForm: Dispatch<SetStateAction<AuthForm>>;
  authError?: string | null;
  authLoading?: boolean;
};

type AdminLoginFormProps = {
  auth: AuthState;
  onLogin: () => void;
  onBack: () => void;
};

/**
 * 관리자 로그인 폼 (세션 405 — 구 ExpertLoginForm 개명·축소).
 * 전문가 가입(tablist·SignupExtraFields·승인 배너)과 카카오 버튼 절 제거 — 카카오 입구는 InfoPage.
 * input[type=email]/input[type=password]/button[type=submit] 구조는 e2e admin.spec 셀렉터와 계약.
 */
export const AdminLoginForm = memo(function AdminLoginForm({ auth, onLogin, onBack }: AdminLoginFormProps) {
  return (
        <div style={{ padding: "0 16px", maxWidth: 640, margin: "0 auto" }}>
          <div style={{ background: C.card, borderRadius: 12, padding: "40px 20px", border: `1px solid ${C.border}`, textAlign: "center" }}>
            <div style={{ fontSize: F.lg, fontWeight: 800, color: C.text, marginBottom: 6 }}>관리자 로그인</div>
            <div style={{ fontSize: F.sm, color: C.muted, marginBottom: 20 }}>관리자 전용 로그인입니다</div>

            {auth.authError && (
              <div style={{ fontSize: F.sm, color: C.red, background: C.redLight, borderRadius: 6, padding: "8px 12px", marginBottom: 16 }}>
                {auth.authError}
              </div>
            )}

            <form onSubmit={e => { e.preventDefault(); onLogin(); }}>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="admin-email" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>이메일</label>
                <input id="admin-email" type="email" autoComplete="email" value={auth.authForm.email}
                  onChange={e => auth.setAuthForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="이메일 입력" style={{
                    width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
                    background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                  }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="admin-pw" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>비밀번호</label>
                <input id="admin-pw" type="password" autoComplete="current-password"
                  value={auth.authForm.password}
                  onChange={e => auth.setAuthForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="비밀번호 입력" style={{
                    width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
                    background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                  }} />
              </div>

              <button type="submit" disabled={auth.authLoading} style={{
                width: "100%", padding: "12px", fontSize: F.base, fontWeight: 800, color: C.white,
                background: auth.authLoading ? C.muted : C.indigo,
                border: "none", borderRadius: 6, cursor: auth.authLoading ? "default" : "pointer",
                minHeight: 44, marginBottom: 12, transition: "background .15s"
              }}>{auth.authLoading ? "처리 중..." : "로그인"}</button>
            </form>

            <div>
              <button onClick={onBack} style={{
                background: "transparent", border: "none", color: C.muted, fontSize: F.sm, cursor: "pointer"
              }}>돌아가기</button>
            </div>
          </div>
        </div>
  );
});
