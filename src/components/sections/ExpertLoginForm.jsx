import { memo } from "react";
import { C } from "@/theme";

/**
 * 전문가 로그인/회원가입 폼
 * Props: expert (useExpertMode 전체 반환값), onLogin (handleExpertLogin 콜백), onBack (돌아가기)
 */
export const ExpertLoginForm = memo(function ExpertLoginForm({ expert, onLogin, onBack }) {
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
                      flex: 1, padding: "12px 0", fontSize: 14, fontWeight: active ? 800 : 600,
                      color: active ? C.indigo : C.muted, background: "transparent", border: "none",
                      borderBottom: active ? `2px solid ${C.indigo}` : "2px solid transparent",
                      marginBottom: -2, minHeight: 44, cursor: "pointer", transition: "color .15s, border-color .15s"
                    }}>
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>
              {expert.authMode === "login" ? "파트너 전문가 전용 대시보드입니다" : "전문가 계정을 생성합니다"}
            </div>

            {expert.authStatus === "pending" && (
              <div style={{ fontSize: 12, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, padding: "10px 12px", marginBottom: 16, textAlign: "left", lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>승인 대기중</div>
                관리자 승인 후 이용 가능합니다. 잠시만 기다려주세요.
              </div>
            )}
            {expert.authStatus === "rejected" && (
              <div style={{ fontSize: 12, color: C.red, background: C.redLight, border: "1px solid #FECACA", borderRadius: 6, padding: "10px 12px", marginBottom: 16, textAlign: "left", lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>승인 거부</div>
                가입 신청이 거부되었습니다. 관리자에게 문의해주세요.
              </div>
            )}
            {expert.authError && !expert.authStatus && (
              <div style={{ fontSize: 12, color: C.red, background: C.redLight, borderRadius: 6, padding: "8px 12px", marginBottom: 16 }}>
                {expert.authError}
              </div>
            )}

            <form onSubmit={e => {
              e.preventDefault();
              if (expert.authMode === "login") onLogin();
              else expert.handleExpertSignup();
            }}>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="expert-email" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>이메일</label>
                <input id="expert-email" type="email" autoComplete="email" value={expert.authForm.email}
                  onChange={e => expert.setAuthForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="이메일 입력" style={{
                    width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                    background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                  }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="expert-pw" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>비밀번호{expert.authMode === "signup" ? " (8자 이상)" : ""}</label>
                <input id="expert-pw" type="password" autoComplete={expert.authMode === "login" ? "current-password" : "new-password"}
                  value={expert.authForm.password}
                  onChange={e => expert.setAuthForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="비밀번호 입력" style={{
                    width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                    background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                  }} />
              </div>

              {expert.authMode === "signup" && (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <label htmlFor="expert-name" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>이름</label>
                    <input id="expert-name" type="text" autoComplete="name" value={expert.authForm.name}
                      onChange={e => expert.setAuthForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="이름 입력" style={{
                        width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                        background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                      }} />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label htmlFor="expert-affil" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>소속 (선택)</label>
                    <input id="expert-affil" type="text" autoComplete="organization" value={expert.authForm.affiliation}
                      onChange={e => expert.setAuthForm(f => ({ ...f, affiliation: e.target.value }))}
                      placeholder="부동산 사무소명 등" style={{
                        width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                        background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                      }} />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label htmlFor="expert-phone" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>연락처</label>
                    <input id="expert-phone" type="tel" autoComplete="tel" value={expert.authForm.phone}
                      onChange={e => expert.setAuthForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="010-1234-5678" style={{
                        width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                        background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                      }} />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label htmlFor="expert-specialty" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>전문 분야</label>
                    <select id="expert-specialty" value={expert.authForm.specialty}
                      onChange={e => expert.setAuthForm(f => ({ ...f, specialty: e.target.value }))}
                      style={{
                        width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                        background: C.white, color: expert.authForm.specialty ? C.text : C.muted, boxSizing: "border-box", minHeight: 42,
                        WebkitAppearance: "none", MozAppearance: "none", appearance: "none",
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%236B7280' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,
                        backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center"
                      }}>
                      <option value="">전문 분야 선택</option>
                      {["부동산 중개", "분양 컨설팅", "감정평가", "건축/설계", "기타"].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label htmlFor="expert-license" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>자격증/면허 (선택)</label>
                    <input id="expert-license" type="text" value={expert.authForm.license}
                      onChange={e => expert.setAuthForm(f => ({ ...f, license: e.target.value }))}
                      placeholder="예: 공인중개사, 감정평가사" style={{
                        width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                        background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                      }} />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label htmlFor="expert-exp" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>경력 (년)</label>
                    <input id="expert-exp" type="number" min="0" max="50" value={expert.authForm.experience}
                      onChange={e => expert.setAuthForm(f => ({ ...f, experience: e.target.value }))}
                      placeholder="경력 연수" style={{
                        width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                        background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
                      }} />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label htmlFor="expert-bio" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>자기소개 / 가입 사유 (10자 이상)</label>
                    <textarea id="expert-bio" rows={4} maxLength={500} value={expert.authForm.bio}
                      onChange={e => expert.setAuthForm(f => ({ ...f, bio: e.target.value }))}
                      placeholder="전문가 페이지 이용 사유를 입력해주세요" style={{
                        width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                        background: C.white, color: C.text, boxSizing: "border-box", resize: "vertical", lineHeight: 1.6, fontFamily: "inherit"
                      }} />
                    <div style={{ fontSize: 10, color: C.muted, textAlign: "right", marginTop: 2 }}>{(expert.authForm.bio || "").length}/500</div>
                  </div>
                </>
              )}

              <button type="submit" disabled={expert.authLoading} style={{
                width: "100%", padding: "12px", fontSize: 14, fontWeight: 800, color: C.white,
                background: expert.authLoading ? C.muted : C.indigo,
                border: "none", borderRadius: 6, cursor: expert.authLoading ? "default" : "pointer",
                minHeight: 44, marginBottom: 12, transition: "background .15s"
              }}>{expert.authLoading ? "처리 중..." : expert.authMode === "login" ? "로그인" : "회원가입"}</button>
            </form>

            <div>
              <button onClick={onBack} style={{
                background: "transparent", border: "none", color: C.muted, fontSize: 12, cursor: "pointer"
              }}>돌아가기</button>
            </div>
          </div>
        </div>
  );
});
