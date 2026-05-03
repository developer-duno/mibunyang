import { memo, type Dispatch, type SetStateAction } from "react";
import { C, F } from "@/theme";

type SignupForm = Record<string, any>;
type SignupExtraFieldsProps = {
  authForm: SignupForm;
  setAuthForm: Dispatch<SetStateAction<SignupForm>>;
};

/**
 * 전문가 회원가입 추가 필드 — 이름/소속/연락처/전문분야/자격증/경력/자기소개 7개
 */
export const SignupExtraFields = memo(function SignupExtraFields({ authForm, setAuthForm }: SignupExtraFieldsProps) {
  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="expert-name" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" as const }}>이름</label>
        <input id="expert-name" type="text" autoComplete="name" value={String(authForm.name ?? "")}
          onChange={e => setAuthForm((f: SignupForm) => ({ ...f, name: e.target.value }))}
          placeholder="이름 입력" style={{
            width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
            background: C.white, color: C.text, boxSizing: "border-box" as const, minHeight: 42
          }} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="expert-affil" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" as const }}>소속 (선택)</label>
        <input id="expert-affil" type="text" autoComplete="organization" value={String(authForm.affiliation ?? "")}
          onChange={e => setAuthForm((f: SignupForm) => ({ ...f, affiliation: e.target.value }))}
          placeholder="부동산 사무소명 등" style={{
            width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
            background: C.white, color: C.text, boxSizing: "border-box" as const, minHeight: 42
          }} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="expert-phone" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" as const }}>연락처</label>
        <input id="expert-phone" type="tel" autoComplete="tel" value={String(authForm.phone ?? "")}
          onChange={e => setAuthForm((f: SignupForm) => ({ ...f, phone: e.target.value }))}
          placeholder="010-1234-5678" style={{
            width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
            background: C.white, color: C.text, boxSizing: "border-box" as const, minHeight: 42
          }} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="expert-specialty" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" as const }}>전문 분야</label>
        <select id="expert-specialty" value={String(authForm.specialty ?? "")}
          onChange={e => setAuthForm((f: SignupForm) => ({ ...f, specialty: e.target.value }))}
          style={{
            width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
            background: C.white, color: authForm.specialty ? C.text : C.muted, boxSizing: "border-box" as const, minHeight: 42,
            WebkitAppearance: "none", MozAppearance: "none", appearance: "none",
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%236B7280' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center"
          }}>
          <option value="">전문 분야 선택</option>
          {["부동산 중개", "분양 컨설팅", "감정평가", "건축/설계", "기타"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="expert-license" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" as const }}>자격증/면허 (선택)</label>
        <input id="expert-license" type="text" value={String(authForm.license ?? "")}
          onChange={e => setAuthForm((f: SignupForm) => ({ ...f, license: e.target.value }))}
          placeholder="예: 공인중개사, 감정평가사" style={{
            width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
            background: C.white, color: C.text, boxSizing: "border-box" as const, minHeight: 42
          }} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="expert-exp" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" as const }}>경력 (년)</label>
        <input id="expert-exp" type="number" min="0" max="50" value={String(authForm.experience ?? "")}
          onChange={e => setAuthForm((f: SignupForm) => ({ ...f, experience: e.target.value }))}
          placeholder="경력 연수" style={{
            width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
            background: C.white, color: C.text, boxSizing: "border-box" as const, minHeight: 42
          }} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="expert-bio" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" as const }}>자기소개 / 가입 사유 (10자 이상)</label>
        <textarea id="expert-bio" rows={4} maxLength={500} value={String(authForm.bio ?? "")}
          onChange={e => setAuthForm((f: SignupForm) => ({ ...f, bio: e.target.value }))}
          placeholder="전문가 페이지 이용 사유를 입력해주세요" style={{
            width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
            background: C.white, color: C.text, boxSizing: "border-box" as const, resize: "vertical" as const, lineHeight: 1.6, fontFamily: "inherit"
          }} />
        <div style={{ fontSize: F.micro, color: C.muted, textAlign: "right" as const, marginTop: 2 }}>{String(authForm.bio ?? "").length}/500</div>
      </div>
    </>
  );
});
