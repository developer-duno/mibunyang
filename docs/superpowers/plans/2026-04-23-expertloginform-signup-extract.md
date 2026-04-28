# ExpertLoginForm 회원가입 필드 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/components/sections/ExpertLoginForm.jsx` (191줄) 의 회원가입 추가 필드 7개(이름/소속/연락처/전문분야/자격증/경력/자기소개)를 새 파일 `SignupExtraFields.jsx` 로 추출해 본체를 150줄 미만으로 슬림화한다.

**Architecture:** 단일 부모(`ExpertLoginForm`) 안에 단일 신규 자식(`SignupExtraFields`)을 도입한다. 자식은 props 2개(`authForm`, `setAuthForm`)만 받는 순수 표현 컴포넌트로 React Fragment 루트를 사용해 부모 `<form>` 안에 형제 `<div>` 7개를 그대로 배치한다. 부모의 회원가입 모드 분기(`expert.authMode === "signup"`)는 유지하고 인라인 75줄을 자식 호출 1줄로 교체한다.

**Tech Stack:** React 19 + Vite 8 (Rolldown) / `memo()` 패턴 / `@/theme` (C, F 상수) / Vitest + @testing-library/react

**Spec:** [docs/superpowers/specs/2026-04-23-expertloginform-signup-extract-design.md](../specs/2026-04-23-expertloginform-signup-extract-design.md)

---

## File Structure

| 파일 | 책임 | 상태 |
|------|------|------|
| `src/components/sections/SignupExtraFields.jsx` | 회원가입 추가 필드 7개 표현 (이름/소속/연락처/전문분야/자격증/경력/자기소개) | **신규** ~85줄 |
| `src/components/sections/ExpertLoginForm.jsx` | 탭 + 상태 메시지 + 이메일/비밀번호 + 회원가입 호출 + 카카오 + 돌아가기 | 191 → ~130줄 (수정) |
| `src/components/sections/ExpertLoginForm.test.jsx` | 부모 통합 렌더링 14케이스 | **0수정** |
| `src/App.jsx` | ExpertLoginForm 호출부 | **0수정** |
| `src/hooks/useExpertMode.js` | authForm/setAuthForm/handleExpertSignup 정의 | **0수정** |

---

## Task 1: SignupExtraFields.jsx 신규 작성

**Files:**
- Create: `src/components/sections/SignupExtraFields.jsx`

- [ ] **Step 1: 신규 파일 작성**

다음 내용 그대로 작성. 본체 ExpertLoginForm.jsx L76-149 의 7필드 JSX 와 100% 동일하지만 `expert.authForm` → `authForm`, `expert.setAuthForm` → `setAuthForm` 으로 prop 참조만 교체.

```jsx
import { memo } from "react";
import { C, F } from "@/theme";

/**
 * 전문가 회원가입 추가 필드 — 이름/소속/연락처/전문분야/자격증/경력/자기소개 7개
 *
 * Props:
 *  - authForm: useExpertMode().authForm — 회원가입 7키 + email/password 9키 객체
 *  - setAuthForm: useExpertMode().setAuthForm — (updater) => void React 표준 setter
 *
 * 부모 ExpertLoginForm 의 <form> 안에 React Fragment 로 형제 <div> 7개 렌더.
 * 회원가입 모드(expert.authMode === "signup")일 때만 부모가 호출.
 */
export const SignupExtraFields = memo(function SignupExtraFields({ authForm, setAuthForm }) {
  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="expert-name" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>이름</label>
        <input id="expert-name" type="text" autoComplete="name" value={authForm.name}
          onChange={e => setAuthForm(f => ({ ...f, name: e.target.value }))}
          placeholder="이름 입력" style={{
            width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
            background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
          }} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="expert-affil" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>소속 (선택)</label>
        <input id="expert-affil" type="text" autoComplete="organization" value={authForm.affiliation}
          onChange={e => setAuthForm(f => ({ ...f, affiliation: e.target.value }))}
          placeholder="부동산 사무소명 등" style={{
            width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
            background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
          }} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="expert-phone" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>연락처</label>
        <input id="expert-phone" type="tel" autoComplete="tel" value={authForm.phone}
          onChange={e => setAuthForm(f => ({ ...f, phone: e.target.value }))}
          placeholder="010-1234-5678" style={{
            width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
            background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
          }} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="expert-specialty" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>전문 분야</label>
        <select id="expert-specialty" value={authForm.specialty}
          onChange={e => setAuthForm(f => ({ ...f, specialty: e.target.value }))}
          style={{
            width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
            background: C.white, color: authForm.specialty ? C.text : C.muted, boxSizing: "border-box", minHeight: 42,
            WebkitAppearance: "none", MozAppearance: "none", appearance: "none",
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%236B7280' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center"
          }}>
          <option value="">전문 분야 선택</option>
          {["부동산 중개", "분양 컨설팅", "감정평가", "건축/설계", "기타"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="expert-license" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>자격증/면허 (선택)</label>
        <input id="expert-license" type="text" value={authForm.license}
          onChange={e => setAuthForm(f => ({ ...f, license: e.target.value }))}
          placeholder="예: 공인중개사, 감정평가사" style={{
            width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
            background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
          }} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="expert-exp" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>경력 (년)</label>
        <input id="expert-exp" type="number" min="0" max="50" value={authForm.experience}
          onChange={e => setAuthForm(f => ({ ...f, experience: e.target.value }))}
          placeholder="경력 연수" style={{
            width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
            background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
          }} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="expert-bio" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>자기소개 / 가입 사유 (10자 이상)</label>
        <textarea id="expert-bio" rows={4} maxLength={500} value={authForm.bio}
          onChange={e => setAuthForm(f => ({ ...f, bio: e.target.value }))}
          placeholder="전문가 페이지 이용 사유를 입력해주세요" style={{
            width: "100%", padding: "10px 12px", fontSize: F.base, border: `1px solid ${C.border}`, borderRadius: 6,
            background: C.white, color: C.text, boxSizing: "border-box", resize: "vertical", lineHeight: 1.6, fontFamily: "inherit"
          }} />
        <div style={{ fontSize: F.micro, color: C.muted, textAlign: "right", marginTop: 2 }}>{(authForm.bio || "").length}/500</div>
      </div>
    </>
  );
});
```

- [ ] **Step 2: 줄 수 측정**

Run: `wc -l src/components/sections/SignupExtraFields.jsx`
Expected: 80~95 사이 (예측 ~85줄)

- [ ] **Step 3: 빌드 확인**

Run: `npx vite build`
Expected: `✓ built in <시간>ms` 출력. 0 errors. 번들 크기 변화 미미 (신규 컴포넌트는 기존 인라인 JSX 와 동일 표현).

---

## Task 2: ExpertLoginForm.jsx 본체 수정

**Files:**
- Modify: `src/components/sections/ExpertLoginForm.jsx`

- [ ] **Step 1: import 추가**

`src/components/sections/ExpertLoginForm.jsx` L1-3 영역에 import 1줄 추가. 기존 import 2줄 유지.

기존:
```jsx
import { memo } from "react";
import { C, F } from "@/theme";
```

수정 후:
```jsx
import { memo } from "react";
import { C, F } from "@/theme";
import { SignupExtraFields } from "./SignupExtraFields";
```

- [ ] **Step 2: L76-149 인라인 75줄 제거 + 호출 1줄로 교체**

기존 (L76-149, 74줄):
```jsx
              {expert.authMode === "signup" && (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <label htmlFor="expert-name" ...>이름</label>
                    ... (이름/소속/연락처/전문분야/자격증/경력/자기소개 7개 div) ...
                  </div>
                </>
              )}
```

수정 후 (3줄):
```jsx
              {expert.authMode === "signup" && (
                <SignupExtraFields authForm={expert.authForm} setAuthForm={expert.setAuthForm} />
              )}
```

**중요**: `<>...</>` 와 7개 `<div>` 전체를 통째로 자식 호출 1줄로 치환. 외곽 `expert.authMode === "signup" &&` 분기는 유지.

- [ ] **Step 3: 줄 수 측정**

Run: `wc -l src/components/sections/ExpertLoginForm.jsx`
Expected: <150 (예측 ~130줄)

- [ ] **Step 4: 빌드 확인**

Run: `npx vite build`
Expected: `✓ built in <시간>ms` 출력. 0 errors.

---

## Task 3: 회귀 테스트 — 14케이스 0수정 통과

**Files:**
- Test: `src/components/sections/ExpertLoginForm.test.jsx` (수정 없이 그대로 실행)

- [ ] **Step 1: ExpertLoginForm.test.jsx 단독 실행**

Run: `npx vitest run src/components/sections/ExpertLoginForm.test.jsx`
Expected: `Tests  14 passed (14)` — 14/14 PASS

만약 5케이스(L53/L64/L71/L119/L137) 중 하나라도 실패하면:
- `screen.getByLabelText("이름")` 등이 자식 컴포넌트 내부 input 을 찾지 못한 것
- 원인: 자식 import 경로 오타 또는 prop 이름 오타
- 수정: SignupExtraFields.jsx 의 `id`, `htmlFor`, `value`, `onChange` 가 본체 원본과 100% 일치하는지 grep 으로 재확인

- [ ] **Step 2: 전체 테스트 실행**

Run: `npm test`
Expected: `Test Files  150 passed (150)` / `Tests  2434 passed (2434)` — 베이스라인(세션141) 유지.

만약 베이스라인(2434) 보다 적거나 많으면:
- 적음 → 다른 곳 회귀. 실패 메시지 추적
- 많음 → 신규 테스트 추가됐다는 의미. 본 작업은 신규 단위 테스트 추가 안 함이므로 코드 검토

---

## Task 4: 5교차검증

**Files:** (검증만, 수정 없음)

- [ ] **Step 1: null-safety-checker 호출**

다음 프롬프트로 서브에이전트 호출:
```
src/components/sections/SignupExtraFields.jsx 와 src/components/sections/ExpertLoginForm.jsx 의 변경 부분을 검증해줘. authForm/setAuthForm props 의 null/undefined 가드, 7필드 (name/affiliation/phone/specialty/license/experience/bio) 의 빈값/undefined 처리, optional chaining 누락이 없는지. authForm.bio 의 (authForm.bio || "").length 폴백이 분리 후에도 유지되는지 확인.
```

Expected: 🟢 PASS (High/Med 0). Low 정보성 이슈는 허용.

- [ ] **Step 2: 메인 agent 직접 검증 — Hook 규칙**

확인 항목:
- SignupExtraFields 가 `memo(function ...)` 패턴인가
- 새 useState/useEffect 추가 0건 (순수 표현 컴포넌트)
- 부모 ExpertLoginForm 의 hook 호출 순서 변경 0건

Run: `grep -n "useState\|useEffect\|useCallback\|useMemo" src/components/sections/SignupExtraFields.jsx`
Expected: 0건 (no match) — 자식은 순수 표현 컴포넌트

- [ ] **Step 3: 메인 agent 직접 검증 — 보안**

Run: `grep -n "dangerouslySetInnerHTML\|innerHTML\|eval(" src/components/sections/SignupExtraFields.jsx src/components/sections/ExpertLoginForm.jsx`
Expected: 0건 (no match)

- [ ] **Step 4: 빌드 + 번들 크기 비교**

Run: `npx vite build 2>&1 | grep -E "kB|gzip"`
Expected: vendor·index 청크 크기 ±0.5kB 이내. 신규 컴포넌트는 기존 JSX 를 그대로 옮긴 것이라 거의 변동 없음.

---

## Task 5: 커밋

**Files:** (스테이징 + 커밋만)

- [ ] **Step 1: 변경 파일 확인**

Run: `git status`
Expected:
```
new file:   src/components/sections/SignupExtraFields.jsx
modified:   src/components/sections/ExpertLoginForm.jsx
```

(2파일만. 그 외 다른 파일이 변경됐다면 즉시 중단하고 원인 파악)

- [ ] **Step 2: diff 확인**

Run: `git diff src/components/sections/ExpertLoginForm.jsx | head -100`
Expected:
- L1-3: import 1줄 추가 (`+import { SignupExtraFields }`)
- L76-149: 인라인 74줄 제거 + 자식 호출 3줄 추가
- 그 외 변경 0건

- [ ] **Step 3: 커밋**

Run:
```bash
git add src/components/sections/SignupExtraFields.jsx src/components/sections/ExpertLoginForm.jsx
git commit -m "$(cat <<'EOF'
refactor(expert): extract SignupExtraFields and slim ExpertLoginForm

회원가입 추가 필드 7개(이름/소속/연락처/전문분야/자격증/경력/자기소개)를
SignupExtraFields.jsx 로 분리. ExpertLoginForm 191 → <150줄.

Props 2개(authForm, setAuthForm)만 받는 순수 표현 자식 컴포넌트.
React Fragment 루트로 부모 <form> 안에 형제 <div> 7개 그대로 렌더.
ExpertLoginForm.test.jsx 14케이스 0수정 통과 (통합 렌더링).

Spec: docs/superpowers/specs/2026-04-23-expertloginform-signup-extract-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: 원격 푸시**

Run: `git push origin main`
Expected: `main -> main` 정상 푸시

- [ ] **Step 5: 최종 줄 수 보고**

Run: `wc -l src/components/sections/ExpertLoginForm.jsx src/components/sections/SignupExtraFields.jsx`

기록:
- ExpertLoginForm.jsx: 191 → <측정값> (목표 <150)
- SignupExtraFields.jsx: <측정값> (예측 ~85)

---

## 완료 조건 (Done Definition)

- [ ] SignupExtraFields.jsx 신규 작성 완료
- [ ] ExpertLoginForm.jsx 본체 <150줄
- [ ] `npx vite build` 0 errors
- [ ] `npm test` 150 files / 2434 tests PASS (베이스라인 유지)
- [ ] ExpertLoginForm.test.jsx 14/14 PASS, 0수정
- [ ] 5교차검증: null-safety 🟢 / Hook 🟢 / 보안 🟢
- [ ] App.jsx 0수정, useExpertMode.js 0수정
- [ ] 단일 커밋 + push

## 롤백

문제 발생 시:
```bash
git revert HEAD
git push origin main
```

선례 `de250f7` (PresetPanel) 와 동일 단일 커밋 구조라 1회 revert 로 완전 복구.
